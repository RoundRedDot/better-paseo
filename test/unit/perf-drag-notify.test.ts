import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disablePerf,
  enablePerf,
  observeTasksCommit,
  perfSnapshot,
  perfStart,
  probeDragEnd,
  probeDragMove,
  probeDragStart,
  probeTasksCommit,
  probeTasksNotify,
  resetPerf,
  type CommitSeen,
} from "../../client/debug/perf";
import { createPerfStore } from "../../client/debug/store";

/** The probes read `performance.now()` on every call: each test sets what it returns. */
let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  disablePerf();
  resetPerf();
});

/** One move as the sheet's handler makes it: `perfStart` at `startAt`, the work, `probeDragMove` at `endAt`. */
function move(track: ReturnType<typeof probeDragStart>, ts: number | undefined, startAt: number, endAt: number) {
  clock = startAt;
  const startedAt = perfStart();
  clock = endAt;
  probeDragMove(track, ts, startedAt);
}

describe("perf store samples and marks", () => {
  it("summarise named series, keep marks in order, and clear both on reset", () => {
    const store = createPerfStore();
    store.sample("sheet.move.jsGapMs", 8);
    store.sample("sheet.move.jsGapMs", 40);
    store.mark({ name: "a", at: 1, data: {} });
    store.mark({ name: "b", at: 2, data: { ts: null } });
    const snap = store.snapshot();
    expect(snap.samples["sheet.move.jsGapMs"]).toMatchObject({ count: 2, total: 48, max: 40 });
    expect(snap.marks.map((mark) => mark.name)).toEqual(["a", "b"]);
    expect(snap.marksDropped).toBe(0);
    store.reset();
    expect(store.snapshot()).toMatchObject({ samples: {}, marks: [], marksDropped: 0 });
  });

  it("stops keeping marks at the cap and counts the rest", () => {
    const store = createPerfStore();
    for (let index = 0; index < 1505; index += 1) store.mark({ name: "m", at: index, data: {} });
    const snap = store.snapshot();
    expect(snap.marks).toHaveLength(1500);
    expect(snap.marks.at(-1)!.at).toBe(1499);
    expect(snap.marksDropped).toBe(5);
  });
});

describe("drag probes", () => {
  it("record nothing and allocate no track while off", () => {
    expect(probeDragStart("sheet", 1000)).toBeNull();
    expect(perfStart()).toBe(0);
    probeDragMove(null, 1008, 0);
    probeDragEnd(null, "release", 1016);
    const snap = perfSnapshot();
    expect(snap.samples).toEqual({});
    expect(snap.marks).toEqual([]);
    expect(snap.counters).toEqual({});
  });

  it("keep the JS clock and the touch clock apart over consecutive moves and a release", () => {
    enablePerf();
    clock = 100;
    const track = probeDragStart("sheet", 1000);
    expect(track).not.toBeNull();
    // On time: JS starts 10 ms after the grant, 8 ms of touch time later; the handler takes 2 ms.
    move(track, 1008, 110, 112);
    // JS busy: the next move starts 40 ms later, and the touch it carries is only 8 ms newer
    // (moves in between were coalesced); it reaches JS 32 ms later than the first did.
    move(track, 1016, 150, 151);
    clock = 160;
    probeDragEnd(track, "release", 1020);

    const snap = perfSnapshot();
    expect(snap.counters).toEqual({ "sheet.grant": 1, "sheet.release": 1 });
    expect(snap.samples["sheet.move.jsGapMs"]).toMatchObject({ count: 2, total: 50, max: 40 });
    expect(snap.samples["sheet.move.tsGapMs"]).toMatchObject({ count: 2, total: 16, max: 8 });
    expect(snap.samples["sheet.move.handlerMs"]).toMatchObject({ count: 2, total: 3, max: 2 });
    expect(snap.samples["sheet.move.offsetRiseMs"]).toMatchObject({ count: 2, total: 32, max: 32 });
    expect(snap.samples["sheet.dragJsMs"]).toMatchObject({ count: 1, total: 60 });
    // The raw values stay in the timeline, each clock in its own field.
    expect(snap.marks).toEqual([
      { name: "sheet.grant", at: 100, data: { drag: track!.id, ts: 1000 } },
      { name: "sheet.move", at: 110, data: { drag: track!.id, move: 1, ts: 1008, handlerMs: 2 } },
      { name: "sheet.move", at: 150, data: { drag: track!.id, move: 2, ts: 1016, handlerMs: 1 } },
      { name: "sheet.release", at: 160, data: { drag: track!.id, moves: 2, ts: 1020 } },
    ]);
  });

  it("count a termination, and leave the touch-clock series out when the touch has no timestamp", () => {
    enablePerf();
    clock = 0;
    const track = probeDragStart("sheet", undefined);
    move(track, undefined, 16, 17);
    clock = 30;
    probeDragEnd(track, "terminate", undefined);
    const snap = perfSnapshot();
    expect(snap.counters).toEqual({ "sheet.grant": 1, "sheet.terminate": 1 });
    expect(snap.samples["sheet.move.jsGapMs"]).toMatchObject({ count: 1, total: 16 });
    expect(snap.samples["sheet.move.tsGapMs"]).toBeUndefined();
    expect(snap.samples["sheet.move.offsetRiseMs"]).toBeUndefined();
    expect(snap.marks.map((mark) => mark.data.ts)).toEqual([null, null, null]);
  });

  it("drop a drag that began before a reset, so the new round measures no gap from the old one", () => {
    enablePerf();
    clock = 0;
    const track = probeDragStart("sheet", 0);
    resetPerf();
    move(track, 500, 500, 501);
    clock = 600;
    probeDragEnd(track, "release", 600);
    expect(perfSnapshot()).toMatchObject({ samples: {}, marks: [], counters: {} });
  });

  it("measure no drag that began while off, and none after turning off", () => {
    const before = probeDragStart("sheet", 0);
    enablePerf();
    move(before, 8, 8, 9);
    probeDragEnd(before, "release", 16);
    expect(perfSnapshot().counters).toEqual({});

    const track = probeDragStart("sheet", 20);
    disablePerf();
    move(track, 28, 28, 29);
    probeDragEnd(track, "release", 36);
    // Off then on is a new round too: the drag from before stays dropped.
    enablePerf();
    move(track, 44, 44, 45);
    expect(perfSnapshot().counters).toEqual({ "sheet.grant": 1 });
    expect(perfSnapshot().samples).toEqual({});
  });
});

describe("store notification and board commit probes", () => {
  const storeA = {};
  const storeB = {};

  function commit(previous: CommitSeen | null, at: number, owner: object, live: unknown, lanes: unknown = live) {
    clock = at;
    return observeTasksCommit(previous, "board", owner, live, lanes);
  }
  function notify(owner: object, at: number) {
    clock = at;
    probeTasksNotify(owner, 1);
  }

  it("record nothing, render no probe, and keep the board's state while off", () => {
    probeTasksNotify(storeA, 1);
    expect(probeTasksCommit("board", storeA, {}, {})).toBeNull();
    expect(observeTasksCommit(null, "board", storeA, {}, {})).toBeNull();
    expect(perfSnapshot()).toMatchObject({ samples: {}, marks: [], counters: {} });
  });

  it("render a probe only while on, and only for a store owner", () => {
    enablePerf();
    expect(probeTasksCommit("board", storeA, {}, {})).not.toBeNull();
    expect(probeTasksCommit("board", undefined, {}, {})).toBeNull();
  });

  it("pair a commit with every notification it followed, batched or not, newest and oldest apart", () => {
    enablePerf();
    // The board's first commit is a baseline: it cannot tell which notifications came before it.
    let seen = commit(null, 5, storeA, "t0");
    expect(perfSnapshot().samples).toEqual({});
    // Three notifications, one render that takes them all.
    notify(storeA, 10);
    notify(storeA, 20);
    notify(storeA, 30);
    seen = commit(seen, 50, storeA, "t1");
    // A commit of the board's own state (a detent) follows no notification.
    seen = commit(seen, 60, storeA, "t1");

    const snap = perfSnapshot();
    expect(snap.counters["tasks.notify"]).toBe(3);
    expect(snap.counters["board.commit"]).toBe(2);
    expect(snap.counters["board.commitWithoutNotify"]).toBe(1);
    expect(snap.samples["board.notifiesPerCommit"]).toMatchObject({ count: 1, max: 3 });
    expect(snap.samples["board.notifyToCommitMs.newest"]).toMatchObject({ count: 1, max: 20 });
    expect(snap.samples["board.notifyToCommitMs.oldest"]).toMatchObject({ count: 1, max: 40 });
    const commits = snap.marks.filter((mark) => mark.name === "board.commit");
    expect(commits.map((mark) => [mark.data.seenFrom, mark.data.seenTo])).toEqual([[0, 3], [3, 3]]);
  });

  it("keep two stores' notifications apart, and two boards' views of one store apart", () => {
    enablePerf();
    let first = commit(null, 0, storeA, "a0");
    let second = commit(null, 0, storeA, "a0");
    let other = commit(null, 0, storeB, "b0");
    expect(first!.board).not.toBe(second!.board);
    expect(first!.store).not.toBe(other!.store);
    // Another store's notification is not this board's.
    notify(storeB, 10);
    first = commit(first, 20, storeA, "a0");
    expect(perfSnapshot().counters["board.commitWithoutNotify"]).toBe(1);
    other = commit(other, 25, storeB, "b1");
    expect(perfSnapshot().samples["board.notifyToCommitMs.newest"]).toMatchObject({ count: 1, max: 15 });
    // One notification of A, committed by each board at its own time: each pairs it once.
    notify(storeA, 30);
    first = commit(first, 34, storeA, "a1");
    second = commit(second, 70, storeA, "a1");
    first = commit(first, 80, storeA, "a1");
    const newest = perfSnapshot().samples["board.notifyToCommitMs.newest"]!;
    expect(newest).toMatchObject({ count: 3, total: 15 + 4 + 40 });
    expect(perfSnapshot().counters["board.commitWithoutNotify"]).toBe(2);
  });

  it("time the deferred lanes from the oldest notification since they last changed", () => {
    enablePerf();
    let seen = commit(null, 0, storeA, "live0", "lanes0");
    notify(storeA, 10);
    // The bars take the new tasks; the lanes are deferred and keep theirs.
    seen = commit(seen, 15, storeA, "live1", "lanes0");
    notify(storeA, 20);
    seen = commit(seen, 25, storeA, "live2", "lanes0");
    expect(perfSnapshot().samples["board.notifyToLanesChangeMs"]).toBeUndefined();
    // The lanes catch up, with no new notification of their own.
    seen = commit(seen, 130, storeA, "live2", "live2");
    expect(perfSnapshot().samples["board.notifyToLanesChangeMs"]).toMatchObject({ count: 1, max: 120 });
    const marks = perfSnapshot().marks.filter((mark) => mark.name === "board.commit");
    expect(marks.map((mark) => [mark.data.liveChanged, mark.data.lanesChanged])).toEqual([[1, 0], [1, 0], [0, 1]]);
    // A lanes change with nothing new from the store is not timed again.
    seen = commit(seen, 140, storeA, "live3", "live3");
    expect(perfSnapshot().samples["board.notifyToLanesChangeMs"]!.count).toBe(1);
  });

  it("start a board over after a reset, so it pairs no notification from the old round", () => {
    enablePerf();
    let seen = commit(null, 0, storeA, "t0");
    notify(storeA, 10);
    resetPerf();
    // The first commit after the reset is a baseline again.
    seen = commit(seen, 20, storeA, "t1");
    expect(perfSnapshot().samples).toEqual({});
    notify(storeA, 30);
    seen = commit(seen, 35, storeA, "t2");
    const snap = perfSnapshot();
    expect(snap.samples["board.notifyToCommitMs.newest"]).toMatchObject({ count: 1, max: 5 });
    expect(snap.marks.filter((mark) => mark.name === "tasks.notify").map((mark) => mark.data.seq)).toEqual([1]);
  });

  it("time a board more than the ring behind from the oldest notification the ring kept", () => {
    enablePerf();
    let seen = commit(null, 0, storeA, "t0");
    for (let index = 1; index <= 70; index += 1) notify(storeA, index);
    seen = commit(seen, 100, storeA, "t1");
    const snap = perfSnapshot();
    expect(snap.samples["board.notifiesPerCommit"]).toMatchObject({ max: 70 });
    expect(snap.counters["board.notifyRingOverflow"]).toBe(1);
    // 64 kept: the oldest is notification 7, sent at 7.
    expect(snap.samples["board.notifyToCommitMs.oldest"]).toMatchObject({ max: 93 });
  });
});
