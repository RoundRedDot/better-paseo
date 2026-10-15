import { describe, expect, it, vi } from "vitest";
import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import { loadReplyTurnDuration, replyTurnDuration } from "../../client/state/turn-duration";

type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Entry = Page["entries"][number];
function entry(type: "user_message" | "assistant_message", at: number, text = "reply"): Entry {
  return { provider: "codex", item: { type, text }, timestamp: new Date(at).toISOString(),
    seqStart: at, seqEnd: at, sourceSeqRanges: [], collapsed: [] };
}
function page(entries: Entry[], hasOlder = false): Page {
  return { entries, hasOlder, hasNewer: false, epoch: "e", startCursor: { epoch: "e", seq: entries[0]?.seqStart ?? 0 },
    endCursor: null, error: null, gap: false, staleCursor: false, reset: false, requestId: "r", agentId: "a",
    agent: null, direction: "tail", projection: "projected", window: { minSeq: 0, maxSeq: 200000, nextSeq: 200001 } };
}

describe("reply turn duration", () => {
  it("uses this turn's prompt and last item, excluding following turns", () => {
    const entries = [entry("user_message", 0), entry("assistant_message", 1000),
      entry("user_message", 2000), entry("assistant_message", 100000), entry("assistant_message", 140000),
      entry("user_message", 150000), entry("assistant_message", 160000)];
    expect(replyTurnDuration(entries, 100000, "reply")).toBe(138000);
    expect(replyTurnDuration(entries, 100001, "reply")).toBeNull();
    expect(replyTurnDuration(entries, 100000, "different reply")).toBeNull();
  });

  it("does not invent timing without a prompt or with invalid timestamps", () => {
    expect(replyTurnDuration([entry("assistant_message", 1000)], 1000, "reply")).toBeNull();
    expect(replyTurnDuration([entry("user_message", 2000), entry("assistant_message", 1000)], 1000, "reply")).toBeNull();
    expect(replyTurnDuration([entry("user_message", 1000), entry("assistant_message", 1000)], 1000, "reply")).toBe(0);
  });

  it("respects canonical turn boundaries for system-injected turns", () => {
    const entries = [
      { ...entry("user_message", 0), turnId: "first" },
      { ...entry("assistant_message", 1000), turnId: "first" },
      { ...entry("assistant_message", 9000), turnId: "system" },
    ];
    expect(replyTurnDuration(entries, 1000, "reply")).toBe(1000);
    expect(replyTurnDuration(entries, 9000, "reply")).toBeNull();
  });

  it("loads an older page when the prompt falls outside the tail", async () => {
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>()
      .mockResolvedValueOnce(page([entry("assistant_message", 140000)], true))
      .mockResolvedValueOnce(page([entry("user_message", 2000)]));
    const timeline = { refetch };
    expect(await loadReplyTurnDuration(timeline, 140000, "reply", () => false)).toBe(138000);
    expect(refetch).toHaveBeenLastCalledWith({ direction: "before", cursor: { epoch: "e", seq: 140000 }, limit: 200, projection: "projected" });
  });

  it("stops on cancellation or an inconsistent timeline", async () => {
    const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockResolvedValue({ ...page([], true), gap: true });
    expect(await loadReplyTurnDuration({ refetch }, 1, "reply", () => false)).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
    refetch.mockClear();
    expect(await loadReplyTurnDuration({ refetch }, 1, "reply", () => true)).toBeNull();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
