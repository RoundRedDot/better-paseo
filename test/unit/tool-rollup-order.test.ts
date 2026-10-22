import { describe, expect, it, vi } from "vitest";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { createToolRollupOrderStore, toolRollupPositions } from "../../client/state/tool-rollup-order";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry } from "./helpers/turn-timeline";

const tool = (seq: number, id = `t${seq}`) => entry({ type: "tool_call", name: "Read", callId: id,
  status: "completed", error: null, detail: { type: "read", filePath: `/src/${seq}.ts` } }, seq, 1);

function setup(initial: TimelineEntry[]) {
  let entries = initial;
  let handler: Parameters<PaseoAgentTimelineHandle["subscribe"]>[0] | undefined;
  const release = vi.fn();
  const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>(async (options = {}) => {
    const end = options.direction === "before" ? entries.findIndex((row) => row.seqStart === options.cursor!.seq) : entries.length;
    const start = Math.max(0, end - (options.limit ?? 200));
    return page(entries.slice(start, end), { hasOlder: start > 0 });
  });
  const subscribe: PaseoAgentTimelineHandle["subscribe"] = (listener) => {
    handler = listener;
    return Object.assign(release, { ready: Promise.resolve(), subscriptionId: "s", release: async () => {} });
  };
  const store = createToolRollupOrderStore(() => ({ refetch, subscribe }));
  return { store, refetch, release, replace: (next: TimelineEntry[]) => { entries = next; },
    emit: (event: PaseoAgentTimelineEvent["event"]) => handler?.({ agentId: "a", event } as PaseoAgentTimelineEvent),
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

describe("authoritative tool rollup order", () => {
  it.each(["assistant_message", "user_message", "reasoning", "error", "compaction", "todo", "notification"])(
    "treats a native %s as a boundary even with identical timestamps", (type) => {
      const boundary = entry({ type, text: "update" } as TimelineEntry["item"], 3, 1);
      const positions = toolRollupPositions([tool(1), tool(2), boundary, tool(4), tool(5)]);
      expect(positions.get("t2")).toEqual({ order: 2, previous: "t1" });
      expect(positions.get("t4")).toEqual({ order: 4, previous: undefined });
      expect(positions.get("t5")?.previous).toBe("t4");
    });

  it("refuses ambiguous duplicate call identities", () => {
    expect(toolRollupPositions([tool(1, "same"), tool(2, "same")]).has("same")).toBe(false);
  });

  it("coalesces mounted rows, pages for history, and releases the observation", async () => {
    const { store, refetch, release, settle } = setup(Array.from({ length: 300 }, (_, i) => tool(i + 1)));
    const first = store.retain("t80");
    const second = store.retain("t81");
    expect(store.get("t80")).toBeNull();
    await settle();
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(store.get("t81")).toEqual({ order: 81, previous: "t80" });
    first();
    expect(release).not.toHaveBeenCalled();
    second();
    expect(release).toHaveBeenCalledOnce();
    expect(store.get("t81")).toBeNull();
  });

  it("reads live additions but does not refetch on known tool output chunks", async () => {
    const { store, refetch, replace, emit, settle } = setup([tool(1), tool(2)]);
    const first = store.retain("t1");
    await settle();
    emit({ type: "timeline", provider: "codex", item: tool(2).item });
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    replace([tool(1), tool(2), entry({ type: "assistant_message", text: "update" }, 3), tool(4)]);
    const next = store.retain("t4");
    await settle();
    expect(store.get("t4")?.previous).toBeUndefined();
    expect(refetch).toHaveBeenCalledTimes(2);
    first(); next();
  });

  it.each(["replacement", "subscription_restored"] as const)("drops stale groups on %s and refetches", async (type) => {
    const { store, replace, emit, settle } = setup([tool(1), tool(2)]);
    const release = store.retain("t2");
    await settle();
    expect(store.get("t2")?.previous).toBe("t1");
    replace([entry({ type: "user_message", text: "next" }, 1), tool(2)]);
    emit(type === "replacement" ? { type, epoch: "new" } : { type });
    expect(store.get("t2")).toBeNull();
    await settle();
    expect(store.get("t2")?.previous).toBeUndefined();
    release();
  });

  it("keeps cards standalone after a fetch error and bounds deep-history reads", async () => {
    const { store, refetch, settle } = setup(Array.from({ length: 2500 }, (_, i) => tool(i + 1)));
    refetch.mockRejectedValueOnce(new Error("offline"));
    let release = store.retain("t1");
    await settle();
    expect(store.get("t1")).toBeNull();
    release();
    refetch.mockClear();
    release = store.retain("t1");
    await settle();
    expect(refetch).toHaveBeenCalledTimes(11);
    expect(store.get("t1")).toBeNull();
    release();
  });

  it.each([
    ["gap", { gap: true }],
    ["stale cursor", { staleCursor: true }],
    ["changed epoch", { epoch: "new" }],
    ["reset", { reset: true }],
  ] as const)("clears previously usable positions on %s while paging", async (_name, incomplete) => {
    const { store, refetch, settle } = setup([tool(2), tool(3)]);
    const release = store.retain("t3");
    await settle();
    expect(store.get("t3")).toEqual({ order: 3, previous: "t2" });

    refetch.mockClear();
    refetch.mockResolvedValueOnce(page([tool(2), tool(3)], { hasOlder: true }));
    refetch.mockResolvedValueOnce(page([tool(1)], incomplete));
    const releaseOlder = store.retain("t1");
    await settle();

    expect(refetch).toHaveBeenCalledTimes(2);
    expect(refetch.mock.calls[1]![0]?.direction).toBe("before");
    // Neither the prior adjacency nor the partial new page may group cards.
    expect(store.get("t3")).toBeNull();
    expect(store.get("t1")).toBeNull();
    releaseOlder();
    release();
  });
});
