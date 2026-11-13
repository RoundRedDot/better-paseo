import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { configureTurnWorkObservations, createTurnFooterStore } from "../../client/state/turn-footers";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry } from "./helpers/turn-timeline";

const rows = () => [
  entry({ type: "user_message", text: "prompt" }, 1, 1000, "one"),
  entry({ type: "reasoning", text: "thinking" }, 2, 2000, "one"),
  entry({ type: "tool_call", callId: "c", name: "shell", status: "completed", error: null,
    detail: { type: "plain_text", text: "output" } }, 3, 3000, "one"),
  entry({ type: "assistant_message", text: "answer" }, 4, 4000, "one"),
];
function setup(initial = rows(), onWorkChange?: Parameters<typeof createTurnFooterStore>[3]) {
  let entries = initial;
  let onEvent: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0] = () => {};
  const release = Object.assign(vi.fn(), { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
  const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockImplementation(async () => page(entries));
  const subscribe = vi.fn<PaseoAgentTimelineHandle["subscribe"]>().mockImplementation((handler) => { onEvent = handler; return release; });
  const store = createTurnFooterStore(() => ({ refetch, subscribe }), undefined, undefined, onWorkChange);
  return { store, refetch, subscribe, release,
    replace: (next: TimelineEntry[]) => { entries = next; },
    emit: (event: PaseoAgentTimelineEvent["event"]) => onEvent({ agentId: "a", event } as PaseoAgentTimelineEvent) };
}

afterEach(() => configureTurnWorkObservations(false));

describe("shared completed work state", () => {
  it("does not retain an event lease for groups rejected by projection capacity", async () => {
    configureTurnWorkObservations(true);
    const { store, release } = setup(rows(), () => false);
    store.setRunning(false);
    const stop = store.retain(3000, "", "3:tool:c");
    await store.refresh();
    stop();
    expect(store.getWork("3:tool:c")).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("keeps a folded offscreen group's observer without refetching or unfolding itself", async () => {
    configureTurnWorkObservations(true);
    const { store, refetch, release, emit } = setup();
    store.setRunning(false);
    const stop = store.retain(3000, "", "3:tool:c");
    await store.refresh();
    const group = store.getWork("3:tool:c");
    stop();
    await Promise.resolve();
    expect(store.getWork("3:tool:c")).toBe(group);
    expect(release).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
    emit({ type: "subscription_restored" } as PaseoAgentTimelineEvent["event"]);
    expect(store.getWork("3:tool:c")).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("releases offscreen group observations when the feature is disabled or unloaded", async () => {
    configureTurnWorkObservations(true);
    const { store, release } = setup();
    store.setRunning(false);
    const stop = store.retain(3000, "", "3:tool:c");
    await store.refresh();
    stop();
    configureTurnWorkObservations(false);
    expect(store.getWork("3:tool:c")).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("shares one read and observation with every work row and the reply footer", async () => {
    const { store, refetch, subscribe, release } = setup();
    store.setRunning(false);
    const stops = [store.retain(2000, "", "2:thought:thinking"), store.retain(3000, "", "3:tool:c"), store.retain(4000, "answer")];
    await store.refresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(store.getWork("3:tool:c")?.members).toHaveLength(2);
    expect(store.get(4000, "answer")?.text).toBe("answer");
    const group = store.getWork("3:tool:c");
    await store.refresh();
    expect(store.getWork("3:tool:c")).toBe(group);
    for (const stop of stops) stop();
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.getWork("3:tool:c")).toBeNull();
  });

  it("pages to the turn boundary before hiding any of a long turn's rows", async () => {
    const { store, refetch } = setup();
    const entries = rows();
    refetch.mockImplementation(async (options) => options?.direction === "before"
      ? page(entries.slice(0, 1)) : page(entries.slice(1), { hasOlder: true }));
    store.setRunning(false);
    const stop = store.retain(3000, "", "3:tool:c");
    try {
      await store.refresh();
      expect(refetch.mock.calls.map(([options]) => options?.direction)).toEqual(["tail", "before"]);
      expect(store.getWork("3:tool:c")?.anchor).toBe("2:thought:thinking");
    } finally { stop(); }
  });

  it("pages an older source even when the recent turn contains identical thought text", async () => {
    const older = rows();
    const recent = older.map((row) => ({ ...row, seqStart: row.seqStart + 4, seqEnd: row.seqEnd + 4,
      turnId: "two", timestamp: new Date(Date.parse(row.timestamp) + 4000).toISOString() }));
    const { store, refetch } = setup();
    refetch.mockImplementation(async (options) => options?.direction === "before"
      ? page(older) : page(recent, { hasOlder: true }));
    store.setRunning(false);
    const stop = store.retain(2000, "", "2:thought:thinking");
    try {
      await store.refresh();
      expect(refetch.mock.calls.map(([options]) => options?.direction)).toEqual(["tail", "before"]);
      expect(store.getWork("2:thought:thinking")?.key).toBe("e:1");
      expect(store.getWork("6:thought:thinking")?.key).toBe("e:5");
    } finally { stop(); }
  });

  it("restores folded work when its dormant timeline channel reports an error", async () => {
    configureTurnWorkObservations(true);
    const { store, release, emit } = setup();
    store.setRunning(false);
    const stop = store.retain(3000, "", "3:tool:c");
    await store.refresh();
    stop();
    emit({ type: "error" } as PaseoAgentTimelineEvent["event"]);
    expect(store.getWork("3:tool:c")).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("waits for completion and restores original rows if a refetch or reconnect fails", async () => {
    const { store, refetch, emit } = setup();
    store.setRunning(true);
    const stop = store.retain(3000, "", "3:tool:c");
    try {
      await store.refresh();
      expect(store.getWork("3:tool:c")).toBeNull();
      store.setRunning(false);
      emit({ type: "turn_completed", provider: "codex", turnId: "one" });
      await store.refresh();
      expect(store.getWork("3:tool:c")).not.toBeNull();
      refetch.mockRejectedValue(new Error("offline"));
      emit({ type: "subscription_restored" } as PaseoAgentTimelineEvent["event"]);
      expect(store.getWork("3:tool:c")).toBeNull();
      await store.refresh();
      expect(store.getWork("3:tool:c")).toBeNull();
    } finally { stop(); }
  });

  it("ignores a stale response from the previous timeline epoch", async () => {
    const { store, refetch, emit } = setup();
    let finish!: (value: ReturnType<typeof page>) => void;
    refetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    store.setRunning(false);
    const stop = store.retain(3000, "", "3:tool:c");
    const pending = store.refresh();
    await Promise.resolve();
    refetch.mockResolvedValue(page([], { epoch: "new" }));
    emit({ type: "replacement" } as PaseoAgentTimelineEvent["event"]);
    finish(page(rows()));
    try {
      await pending;
      expect(store.getWork("3:tool:c")).toBeNull();
    } finally { stop(); }
  });
});
