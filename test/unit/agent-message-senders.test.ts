import { describe, expect, it, vi } from "vitest";
import type { PaseoAgentTimelineHandle } from "@getpaseo/client";
import { createAgentMessageSenderStore } from "../../client/state/agent-message-senders";
import { timelineEntry as entry, timelinePage as page, type TimelineEntry } from "./helpers/turn-timeline";

const message = (seq: number, sender: string) => entry({
  type: "tool_call", callId: `paseo-agent-message:${seq}`, name: "agent_message", status: "completed", error: null,
  detail: { type: "plain_text", text: `hi ${seq}` },
  agentMessage: { event: "message", sender: { id: sender, title: `Agent ${sender}` }, text: `hi ${seq}` },
} as TimelineEntry["item"], seq);
const filler = (seq: number) => entry({ type: "assistant_message", text: `reply ${seq}` }, seq);

/** A daemon timeline of `count` entries, read newest first in pages, as the host pages it. */
function setup(count: number, messages: Record<number, string>) {
  const entries = Array.from({ length: count }, (_, index) =>
    messages[index + 1] ? message(index + 1, messages[index + 1]!) : filler(index + 1));
  const refetch = vi.fn<PaseoAgentTimelineHandle["refetch"]>().mockImplementation(async (options = {}) => {
    const end = options.direction === "before" ? entries.findIndex((item) => item.seqStart === options.cursor!.seq) : entries.length;
    const start = Math.max(0, end - (options.limit ?? 200));
    return page(entries.slice(start, end), { hasOlder: start > 0, direction: options.direction ?? "tail" });
  });
  const store = createAgentMessageSenderStore(() => ({ refetch }));
  return { store, refetch, entries, settle: () => new Promise((resolve) => setTimeout(resolve, 0)) };
}

describe("agent message senders", () => {
  it("reads every row's sender in one tail read", async () => {
    const { store, refetch, settle } = setup(30, { 28: "a", 29: "b" });
    store.retain("paseo-agent-message:28");
    store.retain("paseo-agent-message:29");
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(store.get("paseo-agent-message:28")?.sender).toEqual({ id: "a", title: "Agent a" });
    expect(store.get("paseo-agent-message:29")?.sender.id).toBe("b");
  });

  it("pages back for an older message, and a row further up pages on from there", async () => {
    const { store, refetch, settle } = setup(1000, { 600: "a", 100: "b" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.retain("paseo-agent-message:600");
    await settle();
    expect(store.get("paseo-agent-message:600")?.sender.id).toBe("a");
    expect(listener).toHaveBeenCalledTimes(1);
    // Tail 951–1000, then 751–950 and 551–750.
    expect(refetch).toHaveBeenCalledTimes(3);
    refetch.mockClear();
    store.retain("paseo-agent-message:100");
    await settle();
    expect(store.get("paseo-agent-message:100")?.sender.id).toBe("b");
    // A fresh tail, then on from 551: 351–550 and 151–350 and 1–150.
    expect(refetch.mock.calls.map(([options]) => options?.cursor?.seq ?? null)).toEqual([null, 551, 351, 151]);
  });

  it("does not read the timeline again for a call it did not find", async () => {
    const { store, refetch, settle } = setup(10, {});
    const release = store.retain("paseo-agent-message:missing");
    await settle();
    expect(store.get("paseo-agent-message:missing")).toBeNull();
    release();
    store.retain("paseo-agent-message:missing");
    await settle();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a row senderless when the read fails", async () => {
    const { store, refetch, settle } = setup(10, { 5: "a" });
    refetch.mockRejectedValueOnce(new Error("offline"));
    store.retain("paseo-agent-message:5");
    await settle();
    expect(store.get("paseo-agent-message:5")).toBeNull();
  });
});
