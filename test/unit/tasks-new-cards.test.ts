import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import type { LaneId, LaneModel, TaskCard } from "../../client/tasks/model";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

import { ANNOUNCE_AFTER_MS, FLASH_AFTER_ENTER_MS, FLASH_AFTER_SCROLL_MS, NEW_WINDOW_MS, createNewCardStore, pillDirection } from "../../client/tasks/board/new-cards";
import { FRESH_MS, useFreshIds } from "../../client/tasks/board/board-parts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const card = (id: string, lane: LaneId, createdAgo = 0, extra: Partial<TaskCard> = {}) => ({ id, lane, timing: { createdAt: new Date(NOW - createdAgo).toISOString() }, ...extra }) as unknown as TaskCard;
function lanes(cards: TaskCard[]): Record<LaneId, LaneModel> {
  return Object.fromEntries(["needs_input", "running", "review", "done", "archived"].map((id) => [id, { cards: cards.filter((item) => item.lane === id) }])) as Record<LaneId, LaneModel>;
}

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe("new card store", () => {
  it("learns the first board without counting anything, then counts the tasks created since", () => {
    const store = createNewCardStore();
    const a = card("a", "running", 1000);
    store.track(lanes([a]));
    expect(store.pending("running")).toEqual([]);
    store.track(lanes([a, card("b", "running")]));
    expect(store.pending("running")).toEqual(["b"]);
    // Its lane says so only once it went unseen for a moment.
    expect(store.unseen("running")).toEqual([]);
    expect(store.lanes().size).toBe(0);
    vi.advanceTimersByTime(ANNOUNCE_AFTER_MS);
    expect(store.unseen("running")).toEqual(["b"]);
    expect([...store.lanes()]).toEqual(["running"]);
  });

  it("does not count a task created a while ago, or a provider's subagent", () => {
    const store = createNewCardStore();
    store.track(lanes([]));
    store.track(lanes([card("old", "running", NEW_WINDOW_MS + 1), card("sub", "running", 0, { subagent: { subtitle: null } })]));
    expect(store.pending("running")).toEqual([]);
  });

  it("outlines a card seen while it enters after the entrance, one scrolled to almost at once, and each only once", () => {
    const store = createNewCardStore();
    store.track(lanes([]));
    store.track(lanes([card("a", "running"), card("b", "running")]));
    const listener = vi.fn();
    store.subscribe(listener);
    store.seen(["a"]);
    expect(store.flash("a")).toMatchObject({ delay: FLASH_AFTER_ENTER_MS });
    expect(store.flash("b").key).toBe(0);
    vi.advanceTimersByTime(2000);
    store.seen(["b", "a"]);
    expect(store.flash("b")).toMatchObject({ delay: FLASH_AFTER_SCROLL_MS });
    expect(store.flash("b").key).toBeGreaterThan(store.flash("a").key);
    expect(store.pending("running")).toEqual([]);
    vi.advanceTimersByTime(FLASH_AFTER_SCROLL_MS + 2800);
    expect(store.flash("a").key).toBe(0);
    expect(store.flash("b").key).toBe(0);
    // Seen again: nothing.
    store.seen(["a", "b"]);
    expect(store.flash("a").key).toBe(0);
    expect(listener).toHaveBeenCalled();
  });

  it("forgets a new card that left its lane unseen, and keeps a lane's list the same array while it holds", () => {
    const store = createNewCardStore();
    store.track(lanes([]));
    const b = card("b", "running");
    store.track(lanes([card("a", "running"), b]));
    vi.advanceTimersByTime(ANNOUNCE_AFTER_MS);
    const first = store.unseen("running");
    store.track(lanes([card("a", "running"), b, card("old", "done", NEW_WINDOW_MS * 2)]));
    expect(store.unseen("running")).toBe(first);
    store.track(lanes([card("a", "review"), b]));
    expect(store.unseen("running")).toEqual(["b"]);
    expect(store.pending("review")).toEqual([]);
  });

  it("points the pill at the edge the first new card is past", () => {
    const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(pillDirection(cards, ["c"], 0)).toBe("down");
    expect(pillDirection(cards, ["a"], 1)).toBe("up");
    expect(pillDirection(cards, ["a"], -1)).toBe("down");
  });
});

describe("useFreshIds", () => {
  it("answers through one reader for the lane's life, so a card coming in does not change the list's renderItem", () => {
    const readers: ((id: string) => boolean)[] = [];
    const answers: boolean[][] = [];
    function Lane(props: { ids: string[] }) {
      const isFresh = useFreshIds(props.ids, true);
      readers.push(isFresh);
      answers.push(props.ids.map(isFresh));
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Lane, { ids: ["a"] })); });
    act(() => renderer.update(React.createElement(Lane, { ids: ["a", "b"] })));
    // A row a list mounts in a later batch still enters, for a moment.
    act(() => renderer.update(React.createElement(Lane, { ids: ["a", "b"] })));
    vi.advanceTimersByTime(FRESH_MS);
    act(() => renderer.update(React.createElement(Lane, { ids: ["a", "b"] })));
    expect(new Set(readers).size).toBe(1);
    expect(answers).toEqual([[false], [false, true], [false, true], [false, false]]);
    // Gone and back: it enters again.
    act(() => renderer.update(React.createElement(Lane, { ids: ["a"] })));
    act(() => renderer.update(React.createElement(Lane, { ids: ["a", "b"] })));
    expect(answers.at(-1)).toEqual([false, true]);
  });
});

describe("lane motion: a card added after a lane's last", () => {
  async function setup() {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    vi.resetModules();
    const { createLaneMotionStore, appended } = await import("../../client/tasks/board/lane-motion");
    const store = createLaneMotionStore(true);
    const box = (y: number) => ({ measureInWindow: (done: (x: number, y: number, w: number, h: number) => void) => done(0, y, 300, 100) });
    store.layer = { measureInWindow: (done: (x: number, y: number, w: number, h: number) => void) => done(0, 0, 700, 600) };
    store.attach("a", box(0), null);
    store.attach("b", box(120), null);
    return { store, appended };
  }
  afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

  it("enters under no cover on native, while one added above the others still covers its lane", async () => {
    const { store, appended } = await setup();
    const first = [card("a", "running"), card("b", "running")];
    const last = lanes(first);
    const after = lanes([...first, card("c", "running")]);
    store.freeze(store.snapshot(last), last, after);
    expect(store.covered().size).toBe(0);
    expect(store.ghosts()).toHaveLength(0);
    const above = lanes([card("c", "running"), ...first]);
    store.freeze(store.snapshot(last), last, above);
    expect([...store.covered()]).toEqual(["running"]);
    store.settle();
    expect(appended([], [{ id: "a" }])).toBe(false);
    expect(appended([{ id: "a" }], [{ id: "a" }])).toBe(false);
    expect(appended([{ id: "a" }], [{ id: "b" }, { id: "a" }])).toBe(false);
  });
});
