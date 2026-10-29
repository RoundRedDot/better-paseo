import { describe, expect, it, vi } from "vitest";
import { conversationExcerpt, conversationSearchRpc } from "../../shared/conversation-search";
import { searchConversationPage } from "../../server/tasks/conversation-search";

const empty = { match: null, nextCursor: null, unavailable: false, error: null };
const cursor = { epoch: "history", seq: 16 };
function fixture() {
  const source = { agent: { status: "idle", cwd: process.cwd() } };
  const refresh = vi.fn(async () => source);
  const refetch = vi.fn(async () => ({ entries: [] as Array<{ item: unknown }>, error: null as string | null, hasNewer: false, endCursor: null as typeof cursor | null, reset: false }));
  const fetchProviderSubagentTimeline = vi.fn(async () => ({ rows: [] as Array<{ item: unknown }>, error: null, hasNewer: false, endCursor: null as typeof cursor | null }));
  const close = vi.fn(async () => {});
  const connect = vi.fn(async () => ({ fetchProviderSubagentTimeline, close }));
  const api = { agents: { ref: () => ({ refresh, timeline: { refetch } }) } } as never;
  const host = { connect, available: () => true } as never;
  const search = (input: { agentId: string; parentAgentId?: string; query: string; cursor?: typeof cursor }) => searchConversationPage(api, host, input);
  return { source, refetch, refresh, fetchProviderSubagentTimeline, connect, close, search };
}

describe("bounded conversation page search", () => {
  it.each(["user_message", "assistant_message", "reasoning"])("finds %s and sends only a bounded excerpt", async (type) => {
    const f = fixture();
    f.refetch.mockResolvedValueOnce({ entries: [{ item: { type, text: "x".repeat(100_000) + "Dragonfruit" + "y".repeat(100_000) } }], error: null, hasNewer: true, endCursor: cursor, reset: false });
    const result = await f.search({ agentId: "a", query: "dragonfruit" });
    expect(result.match).toContain("Dragonfruit");
    expect(result.match!.length).toBeLessThanOrEqual(213);
    expect(conversationSearchRpc.output.parse(result)).toEqual(result);
    expect(result.nextCursor).toBeNull();
    expect(f.refetch).toHaveBeenCalledWith({ direction: "after", limit: 16, projection: "projected" });
  });

  it("ignores tool inputs and outputs while continuing to search subsequent messages", async () => {
    const f = fixture();
    for (const detail of [{ type: "shell", command: "echo Dragonfruit", output: "ok" }, { type: "unknown", input: {}, output: { content: [{ text: "Dragonfruit found" }] } }]) {
      f.refetch.mockResolvedValueOnce({ entries: [{ item: { type: "tool_call", detail } }], error: null, hasNewer: false, endCursor: null, reset: false });
      expect((await f.search({ agentId: "a", query: "dragonfruit" })).match).toBeNull();
    }
    expect(conversationExcerpt({ type: "user_message", messageId: "secret-id", text: "ordinary" }, "secret-id")).toBeNull();
    expect(conversationExcerpt("x".repeat(4094) + "Dragonfruit", "dragonfruit")).toContain("Dragonfruit");
    expect(conversationExcerpt("İ preceding Dragonfruit", "dragonfruit")).toContain("Dragonfruit");
  });

  it("returns a cursor after a nonmatching page, then finds a later reply", async () => {
    const f = fixture();
    f.refetch.mockResolvedValueOnce({ entries: [{ item: { type: "user_message", text: "first message" } }], error: null, hasNewer: true, endCursor: cursor, reset: false });
    expect(await f.search({ agentId: "a", query: "later" })).toEqual({ ...empty, nextCursor: cursor });
    f.refetch.mockResolvedValueOnce({ entries: [{ item: { type: "assistant_message", text: "later reply" } }], error: null, hasNewer: false, endCursor: { ...cursor, seq: 32 }, reset: false });
    expect((await f.search({ agentId: "a", query: "later", cursor })).match).toBe("later reply");
    expect(f.refetch).toHaveBeenLastCalledWith({ direction: "after", limit: 16, projection: "projected", cursor });
  });

  it("does not wake closed, missing or removed-directory sessions", async () => {
    const f = fixture();
    f.source.agent.status = "closed";
    expect(await f.search({ agentId: "a", query: "target" })).toEqual({ ...empty, unavailable: true });
    f.source.agent.status = "idle";
    f.source.agent.cwd = "/missing-better-paseo-search-fixture";
    expect((await f.search({ agentId: "a", query: "target" })).unavailable).toBe(true);
    f.refresh.mockResolvedValueOnce(null as never);
    expect((await f.search({ agentId: "a", query: "target" })).unavailable).toBe(true);
    expect(f.refetch).not.toHaveBeenCalled();
  });

  it("skips a subagent's tool content, searches its messages and closes the daemon connection", async () => {
    const f = fixture();
    f.fetchProviderSubagentTimeline.mockResolvedValueOnce({ rows: [], hasNewer: true, endCursor: cursor, error: null });
    expect((await f.search({ agentId: "child", parentAgentId: "parent", query: "target" })).nextCursor).toEqual(cursor);
    f.fetchProviderSubagentTimeline.mockResolvedValueOnce({ rows: [{ item: { type: "tool_call", detail: { output: "target tool result" } } }, { item: { type: "assistant_message", text: "target result" } }], hasNewer: false, endCursor: { ...cursor, seq: 32 }, error: null });
    expect((await f.search({ agentId: "child", parentAgentId: "parent", query: "target", cursor })).match).toBe("target result");
    expect(f.fetchProviderSubagentTimeline).toHaveBeenLastCalledWith("parent", "child", { direction: "after", limit: 16, cursor });
    expect(f.close).toHaveBeenCalledTimes(2);
    expect(f.refetch).not.toHaveBeenCalled();
    f.fetchProviderSubagentTimeline.mockRejectedValueOnce(new Error("offline"));
    expect((await f.search({ agentId: "child", parentAgentId: "parent", query: "target" })).error).toBe("offline");
    expect(f.close).toHaveBeenCalledTimes(3);
  });

  it("keeps missing prerequisites unavailable and network failures retryable", async () => {
    const f = fixture();
    f.refetch.mockRejectedValueOnce(new Error("Agent a references unavailable provider 'cursor'"));
    expect((await f.search({ agentId: "a", query: "target" })).unavailable).toBe(true);
    f.refetch.mockResolvedValueOnce({ entries: [], error: "offline", hasNewer: false, endCursor: null, reset: false });
    expect(await f.search({ agentId: "a", query: "target" })).toEqual({ ...empty, error: "offline" });
  });

  it.each(["reset", "stalled", "epoch", "missing-cursor"])("reports %s pagination rather than a false no-match", async (failure) => {
    const f = fixture();
    f.refetch.mockResolvedValueOnce({ entries: [], error: null, hasNewer: true, endCursor: failure === "missing-cursor" ? null : failure === "epoch" ? { epoch: "new", seq: 32 } : cursor, reset: failure === "reset" });
    expect((await f.search({ agentId: "a", query: "target", cursor })).error).toBeTruthy();
  });

  it("treats the daemon's cursorless empty initial timeline as empty", async () => {
    const f = fixture();
    f.refetch.mockResolvedValueOnce({ entries: [], error: null, hasNewer: true, endCursor: null, reset: false });
    expect(await f.search({ agentId: "a", query: "target" })).toEqual(empty);
  });
});
