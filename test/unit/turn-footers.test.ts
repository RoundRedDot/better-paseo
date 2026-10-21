import { describe, expect, it, vi } from "vitest";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { completedTurnFooters, type CompletedTurnFooter } from "../../client/state/turn-duration";
import { createTurnFooterStore } from "../../client/state/turn-footers";
import type { RecordedTurn } from "../../shared/turn-usage-rpc";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry, type TimelinePage } from "./helpers/turn-timeline";

const prompt = (seq: number, turnId?: string) => entry({ type: "user_message", text: "prompt" }, seq, seq * 1000, turnId);
const reply = (seq: number, text: string, turnId?: string, at = seq * 1000) => entry({ type: "assistant_message", text }, seq, at, turnId);
const turns = () => [prompt(1, "one"), reply(2, "intermediate", "one"), reply(3, "first", "one"),
  prompt(4, "two"), reply(5, "second", "two")];

function setup(initial = turns(), loadRecorded?: (since: number) => Promise<RecordedTurn[]>) {
  let entries = initial;
  let handler: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0] | null = null;
  const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
  const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockImplementation(async () => page(entries));
  const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>().mockImplementation((next) => { handler = next; return release; });
  const store = createTurnFooterStore(() => ({ refetch, subscribe }), loadRecorded);
  return { store, refetch, subscribe, release,
    replace: (next: TimelineEntry[]) => { entries = next; },
    emit: (event: PaseoAgentTimelineEvent["event"]) => handler?.({ agentId: "a", event } as PaseoAgentTimelineEvent) };
}

describe("completed turn footers", () => {
  it("selects one final AI reply per completed turn", () => {
    expect(completedTurnFooters(turns(), false, null).map((row) => [row.text, row.startedAt, row.completedAt, row.durationMs]))
      .toEqual([["first", 1000, 3000, 2000], ["second", 4000, 5000, 1000]]);
  });

  it("keeps previous footers while a new turn runs, including before its first item arrives", () => {
    expect(completedTurnFooters(turns(), true, "two").map((row) => row.text)).toEqual(["first"]);
    expect(completedTurnFooters(turns(), true, "three").map((row) => row.text)).toEqual(["first", "second"]);
    expect(completedTurnFooters([...turns(), prompt(6, "three"), reply(7, "working", "three")], true, "three")
      .map((row) => row.text)).toEqual(["first", "second"]);
  });

  it("uses source sequence for equal timestamps and does not invent missing duration", () => {
    const rows = [prompt(1, "one"), reply(2, "earlier", "one", 2000), reply(3, "final", "one", 2000),
      reply(4, "system turn without visible prompt", "system")];
    expect(completedTurnFooters(rows, false, null).map((row) => [row.text, row.durationMs]))
      .toEqual([["final", 1000], ["system turn without visible prompt", null]]);
    expect(completedTurnFooters(rows, false, null).at(-1)?.startedAt).toBeNull();
  });

  it("excludes system envelopes and still uses the turn's final event for timing", () => {
    const rows = [prompt(1), reply(2, "answer"), entry({ type: "reasoning", text: "later" }, 3),
      reply(4, "<system-notice>Job finished</system-notice>")];
    expect(completedTurnFooters(rows, false, null)).toEqual([{ at: 2000, text: "answer", startedAt: 1000, completedAt: 4000, durationMs: 3000 }]);
  });

  it("retains prompt boundaries when canonical turn IDs are unavailable", () => {
    const rows = [prompt(1), reply(2, "first"), prompt(3), reply(4, "second")];
    expect(completedTurnFooters(rows, true, null).map((row) => row.text)).toEqual(["first"]);
    expect(completedTurnFooters(rows, false, null).map((row) => row.text)).toEqual(["first", "second"]);
  });

  it("does not render duplicate footers for indistinguishable source items", () => {
    expect(completedTurnFooters([prompt(1), reply(2, "same", undefined, 3000), reply(3, "same", undefined, 3000)], false, null)).toEqual([]);
  });
});

const reasoning = (seq: number, turnId?: string, at = seq * 1000) => entry({ type: "reasoning", text: "thinking" }, seq, at, turnId);
const notice = (seq: number, turnId?: string) => entry({ type: "tool_call", name: "task_notification", callId: `n${seq}`,
  status: "completed", detail: { type: "unknown", input: null, output: null }, error: null } as TimelineEntry["item"], seq, seq * 1000, turnId);
const timing = (rows: CompletedTurnFooter[]) => rows.map((row) => [row.text, row.startedAt, row.durationMs]);

describe("turns no prompt started", () => {
  // The user's chat: a background task notification started autonomous-turn-18
  // without a user message, so its reply had no elapsed time.
  const notified = () => [prompt(1, "foreground-turn-1"), reply(2, "first", "foreground-turn-1"),
    reasoning(10, "autonomous-turn-2"), entry({ type: "reasoning", text: "tool" }, 12, 12000, "autonomous-turn-2"),
    reply(15, "notified", "autonomous-turn-2")];

  it("times a notification-started turn from its first item", () => {
    expect(timing(completedTurnFooters(notified(), false, null)))
      .toEqual([["first", 1000, 1000], ["notified", 10000, 5000]]);
  });

  it("prefers the start the server recorded before the turn's first item", () => {
    const marks = { starts: [1000, 9400], ends: [2100, 15100] };
    expect(timing(completedTurnFooters(notified(), false, null, { marks })))
      .toEqual([["first", 1000, 1000], ["notified", 9400, 5600]]);
    // A start outside the gap before the first item belongs to another turn.
    expect(timing(completedTurnFooters(notified(), false, null, { marks: { starts: [1500, 11000], ends: [] } })).at(-1))
      .toEqual(["notified", 10000, 5000]);
  });

  it("times the first turn of an agent's history only when no older page exists", () => {
    const rows = [reasoning(3, "autonomous-turn-1"), reply(4, "scheduled", "autonomous-turn-1")];
    expect(timing(completedTurnFooters(rows, false, null))).toEqual([["scheduled", null, null]]);
    expect(timing(completedTurnFooters(rows, false, null, { fromStart: true }))).toEqual([["scheduled", 3000, 1000]]);
  });

  it("splits history reloaded without turn IDs at the recorded turns", () => {
    // A daemon restart reloads history from the provider: no turn IDs, and the
    // notification that woke the agent arrives long after the previous turn.
    const rows = [prompt(1), reply(2, "first"), notice(40), reasoning(41), reply(45, "notified"),
      prompt(50), reply(52, "third")];
    // Without the record the notified turn swallows the first and spans 44 s.
    expect(timing(completedTurnFooters(rows, false, null))).toEqual([["notified", 1000, 44000], ["third", 50000, 2000]]);
    const marks = { starts: [1000, 40500, 50000], ends: [2100, 45100, 52100] };
    expect(timing(completedTurnFooters(rows, false, null, { marks })))
      .toEqual([["first", 1000, 1000], ["notified", 40500, 4500], ["third", 50000, 2000]]);
  });

  it("keeps a turn's trailing items when the record ends just before them", () => {
    const rows = [prompt(1), reply(2, "draft"), reply(4, "final")];
    expect(timing(completedTurnFooters(rows, false, null, { marks: { starts: [1000], ends: [3000] } })))
      .toEqual([["final", 1000, 3000]]);
  });

  it("starts a live turn after reloaded history even without a prompt", () => {
    const rows = [prompt(1), reply(2, "reloaded"), reasoning(10, "autonomous-x"), reply(12, "live", "autonomous-x")];
    expect(timing(completedTurnFooters(rows, false, null))).toEqual([["reloaded", 1000, 1000], ["live", 10000, 2000]]);
  });
});

describe("shared turn footer timeline", () => {
  it.each(["codex", "claude", "cursor", "grok"])("recovers the latest %s usage from the daemon snapshot after reopening", async (provider) => {
    const { store, refetch, emit } = setup();
    const usage = { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 678 };
    const snapshot = { provider, status: "idle", activeTurn: null, lastUserMessageAt: new Date(4000).toISOString(),
      lastUsage: usage } as NonNullable<TimelinePage["agent"]>;
    refetch.mockImplementation(async () => page(turns(), { agent: snapshot }));
    store.setRunning(false);
    const stop = store.retain(5000, "second");
    try {
      await store.refresh();
      expect(store.get(5000, "second")?.usage).toEqual(usage);
      expect(store.get(3000, "first")?.usage).toBeUndefined();
      const second = store.get(5000, "second");
      await store.refresh();
      expect(store.get(5000, "second")).toBe(second);
      emit({ type: "subscription_restored" });
      await store.refresh();
      expect(store.get(5000, "second")?.usage).toEqual(usage);
    } finally { stop(); }
  });

  it("falls back to the server's record for turns this client did not see, matched by ID and end time", async () => {
    const recorded: RecordedTurn[] = [
      // The same ID from an earlier daemon, long before this turn ended.
      { turnId: "one", endedAt: 3000 - 60 * 60_000, usage: { outputTokens: 1 } },
      { turnId: "one", endedAt: 3200, usage: { outputTokens: 7 } },
      { turnId: "two", endedAt: 5100, usage: { outputTokens: 9 } },
    ];
    const loadRecorded = vi.fn(async (since: number) => recorded.filter((turn) => turn.endedAt >= since));
    const { store, emit } = setup(turns(), loadRecorded);
    store.setRunning(false);
    const stop = store.retain(3000, "first");
    try {
      await store.refresh();
      expect(loadRecorded).toHaveBeenCalledTimes(1);
      expect(loadRecorded).toHaveBeenLastCalledWith(3000 - 5_000);
      expect(store.get(3000, "first")?.usage).toEqual({ outputTokens: 7 });
      expect(store.get(5000, "second")?.usage).toEqual({ outputTokens: 9 });
      await store.refresh();
      expect(loadRecorded).toHaveBeenCalledTimes(1);
      // A completion asks again for the turns still unseen; its live reading wins.
      emit({ type: "turn_completed", provider: "claude", turnId: "two", usage: { outputTokens: 10 } });
      await store.refresh();
      expect(loadRecorded).toHaveBeenCalledTimes(2);
      expect(store.get(5000, "second")?.usage).toEqual({ outputTokens: 10 });
    } finally { stop(); }
  });

  it("matches history reloaded without turn IDs by end time, never taking a neighbour's record", async () => {
    // A daemon restart reloads history from the provider without turn IDs.
    const rows = [prompt(1), reply(2, "first"), prompt(3), reply(4, "second"), prompt(5), reply(6, "third")];
    const loadRecorded = vi.fn(async () => [
      { turnId: "foreground-turn-1", endedAt: 2100, usage: { outputTokens: 7 } },
      // The second turn was never recorded; the third's record lies inside its window.
      { turnId: "foreground-turn-3", endedAt: 6050, usage: { outputTokens: 9 } },
    ]);
    const { store } = setup(rows, loadRecorded);
    store.setRunning(false);
    const stop = store.retain(2000, "first");
    try {
      await store.refresh();
      expect(store.get(2000, "first")?.usage).toEqual({ outputTokens: 7 });
      expect(store.get(4000, "second")?.usage).toBeUndefined();
      expect(store.get(6000, "third")?.usage).toEqual({ outputTokens: 9 });
    } finally { stop(); }
  });

  it("keeps footers and timing when the record cannot be read", async () => {
    const { store } = setup(turns(), async () => { throw new Error("no such RPC"); });
    store.setRunning(false);
    const stop = store.retain(5000, "second");
    try {
      await store.refresh();
      expect(store.get(5000, "second")).toMatchObject({ durationMs: 1000, usage: undefined });
    } finally { stop(); }
  });

  it("reads final daemon usage when a new completion event omits usage", async () => {
    const { store, refetch, emit } = setup();
    const usage = { inputTokens: 100, cachedInputTokens: 20, outputTokens: 30 };
    const snapshot = { status: "running", activeTurn: { turnId: "two", startedAt: new Date(4000).toISOString() },
      lastUserMessageAt: new Date(4000).toISOString(), lastUsage: usage } as NonNullable<TimelinePage["agent"]>;
    refetch.mockImplementation(async () => page(turns(), { agent: snapshot }));
    store.setRunning(true);
    const stop = store.retain(5000, "second");
    try {
      await store.refresh();
      expect(store.get(5000, "second")).toBeNull();
      snapshot.status = "idle";
      snapshot.activeTurn = null;
      emit({ type: "turn_completed", provider: "codex", turnId: "two" });
      await store.refresh();
      expect(store.get(5000, "second")?.usage).toEqual(usage);
    } finally { stop(); }
  });

  it.each(["running", "mismatched prompt", "missing prompt", "trailing turn", "newer page"])
  ("does not attribute snapshot usage from a %s to historical replies", async (caseName) => {
    const { store, refetch } = setup();
    const snapshot = { status: caseName === "running" ? "running" : "idle", activeTurn: null,
      lastUserMessageAt: caseName === "missing prompt" ? null : new Date(caseName === "mismatched prompt" ? 6000 : 4000).toISOString(),
      lastUsage: { inputTokens: 999 } } as NonNullable<TimelinePage["agent"]>;
    const rows = caseName === "trailing turn" ? [...turns(), reply(6, "system", "system")] : turns();
    refetch.mockImplementation(async () => page(rows, { agent: snapshot, hasNewer: caseName === "newer page" }));
    store.setRunning(false);
    const stop = store.retain(5000, "second");
    try {
      await store.refresh();
      expect(store.get(3000, "first")?.usage).toBeUndefined();
      expect(store.get(5000, "second")?.usage).toBeUndefined();
    } finally { stop(); }
  });

  it("does not rescan loaded timeline entries when replies remount", async () => {
    const rows = turns();
    const readItem = vi.fn();
    for (const row of rows) {
      const item = row.item;
      Object.defineProperty(row, "item", { get: () => { readItem(); return item; } });
    }
    const { store } = setup(rows);
    store.setRunning(false);
    const stops = [store.retain(3000, "first")];
    await store.refresh();
    readItem.mockClear();
    for (let index = 0; index < 100; index++) stops.push(store.retain(5000, "second"));
    expect(readItem).not.toHaveBeenCalled();
    stops.forEach((stop) => stop());
  });

  it("captures completion usage before the first streaming reply settles without reading on chunks", async () => {
    const { store, refetch, emit } = setup([prompt(1, "one"), reply(3, "first", "one")]);
    store.setRunning(true);
    const stopObserving = store.observe();
    const usage = { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 678 };
    emit({ type: "timeline", provider: "codex", item: { type: "assistant_message", text: "streaming" } });
    await Promise.resolve();
    expect(refetch).not.toHaveBeenCalled();
    emit({ type: "turn_completed", provider: "codex", turnId: "one", usage });
    await store.refresh();
    stopObserving();
    store.setRunning(false);
    const stop = store.retain(3000, "first");
    await store.refresh();
    expect(store.get(3000, "first")?.usage).toEqual(usage);
    stop();
  });

  it("keeps usage tied to turn IDs, preserves it on remount, and clears it on replacement", async () => {
    const { store, emit, replace } = setup();
    store.setRunning(false);
    let stop = store.retain(3000, "first");
    await store.refresh();
    expect(store.get(3000, "first")?.usage).toBeUndefined();
    emit({ type: "turn_completed", provider: "codex", turnId: "one", usage: { outputTokens: 7 } });
    emit({ type: "turn_completed", provider: "codex", turnId: "two", usage: { outputTokens: 9 } });
    // Events without a turn ID must never be assigned to the latest reply.
    emit({ type: "turn_completed", provider: "codex", usage: { outputTokens: 999 } });
    await store.refresh();
    expect(store.get(3000, "first")?.usage).toEqual({ outputTokens: 7 });
    expect(store.get(5000, "second")?.usage).toEqual({ outputTokens: 9 });
    const first = store.get(3000, "first");
    replace([...turns(), prompt(6, "three"), reply(7, "third", "three")]);
    emit({ type: "turn_completed", provider: "codex", turnId: "three", usage: { outputTokens: 11 } });
    await store.refresh();
    expect(store.get(3000, "first")).toBe(first);
    expect(store.get(7000, "third")?.usage).toEqual({ outputTokens: 11 });
    stop();
    stop = store.retain(3000, "first");
    await store.refresh();
    expect(store.get(3000, "first")?.usage).toEqual({ outputTokens: 7 });
    emit({ type: "replacement", epoch: "new" });
    await store.refresh();
    expect(store.get(3000, "first")?.usage).toBeUndefined();
    stop();
  });

  it("shares one read and subscription, preserves historical snapshots and ignores streamed chunks", async () => {
    const { store, refetch, subscribe, release, replace, emit } = setup();
    store.setRunning(false);
    const stops = [store.retain(2000, "intermediate"), store.retain(3000, "first"), store.retain(5000, "second")];
    await store.refresh();
    const first = store.get(3000, "first");
    const second = store.get(5000, "second");
    expect(first?.durationMs).toBe(2000);
    expect(second?.durationMs).toBe(1000);
    expect(store.get(2000, "intermediate")).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ direction: "tail", projection: "projected", limit: 50 });
    expect(subscribe).toHaveBeenCalledTimes(1);
    replace([...turns(), prompt(6, "three"), reply(7, "working", "three")]);
    store.setRunning(true);
    expect(store.get(3000, "first")).toBe(first);
    await store.refresh();
    expect(store.get(3000, "first")).toBe(first);
    expect(store.get(5000, "second")).toBe(second);
    expect(store.get(7000, "working")).toBeNull();
    const count = refetch.mock.calls.length;
    emit({ type: "timeline", provider: "codex", item: { type: "assistant_message", text: "chunk" } });
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(count);
    store.setRunning(false);
    await store.refresh();
    expect(store.get(7000, "working")?.durationMs).toBe(1000);
    stops.forEach((stop) => stop());
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.get(3000, "first")).toBeNull();
  });

  it("paginates once to cover all mounted turns and reuses already loaded history", async () => {
    const { store, refetch } = setup();
    refetch.mockReset().mockResolvedValueOnce(page([reply(5, "second", "two")], { hasOlder: true }))
      .mockResolvedValueOnce(page([prompt(4, "two")], { hasOlder: true }))
      .mockResolvedValueOnce(page([prompt(1, "one"), reply(3, "first", "one")]));
    store.setRunning(false);
    const stopFirst = store.retain(3000, "first");
    const stopSecond = store.retain(5000, "second");
    await store.refresh();
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(refetch.mock.calls[1]![0]).toMatchObject({ direction: "before", cursor: { epoch: "e", seq: 5 } });
    expect(store.get(3000, "first")?.durationMs).toBe(2000);
    expect(store.get(5000, "second")?.durationMs).toBe(1000);
    const copy = store.retain(3000, "first");
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(3);
    stopFirst(); stopSecond(); copy();
  });

  it.each(["gap", "staleCursor", "epoch"])("rejects an inconsistent %s page", async (failure) => {
    const { store, refetch } = setup();
    refetch.mockReset().mockResolvedValueOnce(page([reply(5, "second")], { hasOlder: true }))
      .mockResolvedValueOnce(page([prompt(1)], failure === "epoch" ? { epoch: "changed" } : { [failure]: true }));
    store.setRunning(false);
    const stop = store.retain(5000, "second");
    await store.refresh();
    expect(store.get(5000, "second")).toBeNull();
    stop();
  });

  it("loads additional history when an older reply scrolls into view", async () => {
    const { store, refetch } = setup();
    const tail = page([prompt(4, "two"), reply(5, "second", "two")], { hasOlder: true });
    refetch.mockReset().mockResolvedValueOnce(tail).mockResolvedValueOnce(tail)
      .mockResolvedValueOnce(page([prompt(1, "one"), reply(3, "first", "one")]));
    store.setRunning(false);
    const stopSecond = store.retain(5000, "second");
    await store.refresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    const stopFirst = store.retain(3000, "first");
    await store.refresh();
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(store.get(3000, "first")?.durationMs).toBe(2000);
    expect(store.get(5000, "second")?.durationMs).toBe(1000);
    stopFirst(); stopSecond();
  });

  it("keeps agents isolated even when their reply text and timestamp match", async () => {
    const first = setup([prompt(1), reply(3, "same")]);
    const second = setup([prompt(2), reply(3, "same")]);
    const stopFirst = first.store.retain(3000, "same");
    const stopSecond = second.store.retain(3000, "same");
    await Promise.all([first.store.refresh(), second.store.refresh()]);
    expect(first.store.get(3000, "same")?.durationMs).toBe(2000);
    expect(second.store.get(3000, "same")?.durationMs).toBe(1000);
    stopFirst(); stopSecond();
  });

  it("drops stale in-flight reads after a running-state change", async () => {
    const { store, refetch, replace } = setup();
    let finish!: (result: TimelinePage) => void;
    refetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    store.setRunning(false);
    const stop = store.retain(5000, "second");
    const pending = store.refresh();
    await Promise.resolve();
    store.setRunning(true);
    replace([...turns(), prompt(6, "three")]);
    finish(page(turns()));
    await pending;
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(store.get(5000, "second")).not.toBeNull();
    stop();
  });

  it("invalidates removed history on replacement and releases its subscription", async () => {
    const { store, replace, emit, release } = setup();
    store.setRunning(false);
    const stop = store.retain(5000, "second");
    await store.refresh();
    expect(store.get(5000, "second")).not.toBeNull();
    replace([]);
    emit({ type: "replacement", epoch: "new" });
    expect(store.get(5000, "second")).toBeNull();
    await store.refresh();
    expect(store.get(5000, "second")).toBeNull();
    stop();
    expect(release).toHaveBeenCalledOnce();
  });

  it("ignores a request that resolves after all consumers unmount", async () => {
    const { store, refetch } = setup();
    let finish!: (result: TimelinePage) => void;
    refetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const stop = store.retain(3000, "first");
    const pending = store.refresh();
    await Promise.resolve();
    stop();
    finish(page(turns()));
    await pending;
    expect(store.get(3000, "first")).toBeNull();
  });
});

describe("turn footer timing after a reload", () => {
  it("reads the record for a notification-started turn and keeps its start", async () => {
    const rows = [prompt(1, "foreground-turn-1"), reply(2, "first", "foreground-turn-1"),
      reasoning(10, "autonomous-turn-2"), reply(15, "notified", "autonomous-turn-2")];
    const loadRecorded = vi.fn(async (since: number) => [
      { turnId: "foreground-turn-1", startedAt: 1000, endedAt: 2100, usage: { outputTokens: 3 } },
      { turnId: "autonomous-turn-2", startedAt: 9300, endedAt: 15100 },
    ].filter((turn) => turn.endedAt >= since));
    const { store } = setup(rows, loadRecorded);
    store.setRunning(false);
    const stop = store.retain(15000, "notified");
    try {
      await store.refresh();
      expect(loadRecorded).toHaveBeenCalledWith(1000 - 5_000);
      expect(store.get(15000, "notified")).toMatchObject({ startedAt: 9300, durationMs: 5700 });
      expect(store.get(2000, "first")).toMatchObject({ durationMs: 1000, usage: { outputTokens: 3 } });
    } finally { stop(); }
  });

  it("restores every footer and its time from history reloaded without turn IDs", async () => {
    const rows = [prompt(1), reply(2, "first"), notice(40), reasoning(41), reply(45, "notified"), prompt(50), reply(52, "third")];
    const loadRecorded = vi.fn(async () => [
      { turnId: "foreground-turn-1", startedAt: 1000, endedAt: 2100, usage: { outputTokens: 7 } },
      { turnId: "autonomous-turn-2", startedAt: 40500, endedAt: 45100, usage: { outputTokens: 8 } },
      { turnId: "foreground-turn-3", startedAt: 50000, endedAt: 52100 },
    ]);
    const { store } = setup(rows, loadRecorded);
    store.setRunning(false);
    const stops = [store.retain(2000, "first"), store.retain(45000, "notified"), store.retain(52000, "third")];
    try {
      await store.refresh();
      expect(store.get(2000, "first")).toMatchObject({ startedAt: 1000, durationMs: 1000, usage: { outputTokens: 7 } });
      expect(store.get(45000, "notified")).toMatchObject({ startedAt: 40500, durationMs: 4500, usage: { outputTokens: 8 } });
      // A timing-only record never lends its neighbour's usage.
      expect(store.get(52000, "third")).toMatchObject({ startedAt: 50000, durationMs: 2000, usage: undefined });
    } finally { stops.forEach((stop) => stop()); }
  });

  it("still times a notification-started turn when the record cannot be read", async () => {
    const rows = [prompt(1, "one"), reply(2, "first", "one"), reasoning(10, "auto"), reply(15, "notified", "auto")];
    const { store } = setup(rows, async () => { throw new Error("no such RPC"); });
    store.setRunning(false);
    const stop = store.retain(15000, "notified");
    try {
      await store.refresh();
      expect(store.get(15000, "notified")).toMatchObject({ startedAt: 10000, durationMs: 5000 });
    } finally { stop(); }
  });
});
