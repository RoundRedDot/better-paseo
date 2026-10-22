import { describe, expect, it } from "vitest";
import { classifyTool } from "../../client/tools/classify";
import { canRollupTool, groupAdjacentTools, summarizeToolCall, summarizeToolGroup, toolGroupKey, toolPermissionTargets } from "../../client/tools/group";
import type { ToolCallView } from "../../client/tools/classify";
import { summarizeTool } from "../../client/tools/summarize";

function call(id: string, path = "src/a.ts", tool = "edit", status = "completed") {
  return classifyTool({ name: tool, callId: id, status, detail: {
    type: tool, filePath: path, unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n+extra",
  } });
}

describe("consecutive file operations", () => {
  it("merges the same operation and exact path, preserving each call", () => {
    const entries = [{ tool: call("1") }, { tool: call("2") }, { tool: call("3", "src/b.ts") }];
    const groups = groupAdjacentTools(entries);
    expect(groups.get(entries[0]!)).toEqual([entries[0]!.tool, entries[1]!.tool]);
    expect(groups.get(entries[1]!)).toBeNull();
    expect(groups.get(entries[2]!)).toEqual([entries[2]!.tool]);
  });

  it("stops at a non-tool boundary", () => {
    const entries = [{ tool: call("1") }, {}, { tool: call("2") }];
    const groups = groupAdjacentTools(entries);
    expect(groups.get(entries[0]!)).toHaveLength(1);
    expect(groups.get(entries[2]!)).toHaveLength(1);
  });

  it("does not merge reads, writes and edits of the same file", () => {
    const entries = ["read", "write", "edit"].map((tool) => ({ tool: call(tool, "src/a.ts", tool) }));
    const groups = groupAdjacentTools(entries);
    for (const entry of entries) expect(groups.get(entry)).toHaveLength(1);
  });

  it("does not group unidentified calls or non-file tools", () => {
    expect(toolGroupKey({ ...call("1"), callId: undefined })).toBeUndefined();
    expect(toolGroupKey({ ...call("1"), filePath: undefined })).toBeUndefined();
    expect(toolGroupKey(call("1", "src/a.ts", "bash"))).toBeUndefined();
  });

  it("sums edit counts and retains a failure from any member", () => {
    const summary = summarizeToolGroup([call("1"), { ...call("2", "src/a.ts", "edit", "failed"), error: "Permission denied" }]);
    expect(summary.meta).toEqual(["+4 −2"]);
    expect(summary.tone).toBe("danger");
    expect(summary.errorLine).toBe("Permission denied");
  });

  it("does not label a whole read group with one member's line range", () => {
    const first = { ...call("1", "src/a.ts", "read"), offset: 10, limit: 5 };
    expect(summarizeToolGroup([first]).meta).toEqual(["L10–14"]);
    expect(summarizeToolGroup([first, call("2", "src/a.ts", "read")]).meta).toEqual([]);
  });

  it("reuses each member's summary and recounts when one member's result changes", () => {
    const first = call("1");
    expect(summarizeToolCall(first)).toBe(summarizeToolCall(first));
    expect(summarizeToolCall(first)).toEqual(summarizeTool(first));
    const longer = classifyTool({ name: "edit", callId: "2", status: "completed", detail: {
      type: "edit", filePath: "src/a.ts", unifiedDiff: "@@ -1 +1 @@\n-old\n+new\n+extra\n+more",
    } });
    expect(summarizeToolGroup([first, call("2")]).meta).toEqual(["+4 −2"]);
    expect(summarizeToolGroup([first, longer]).meta).toEqual(["+5 −2"]);
  });
});

describe("all-tool rollup membership", () => {
  it("does not filter any category, tool name, failure, rejection or canceled outcome", () => {
    const entries = (["read", "paseo", "sub_agent", "hub", "activity", "mcp", "unknown", "plan", "plain_text"] as const)
      .map((tool, index) => ({
        tool: { ...call(String(index)), tool, name: "request_user_input", status: "failed", error: "denied",
          rejected: true, planOutcome: "canceled", questionData: {} } as ToolCallView,
        rollup: { order: index, previous: index ? String(index - 1) : undefined },
      }));
    expect(entries.every((entry) => canRollupTool(entry.tool))).toBe(true);
    const groups = groupAdjacentTools(entries);
    expect(groups.get(entries[0]!)).toHaveLength(entries.length);
    for (const entry of entries.slice(1)) expect(groups.get(entry)).toBeNull();
  });

  it("finds only cards that actually render permission controls", () => {
    expect(toolPermissionTargets({ ...call("q"), questionData: { questions: [{}] } })).toEqual([]);
    expect(toolPermissionTargets({ ...call("a"), agentStatus: {
      agentId: "child", title: "Child", status: "finished", body: "Done",
    } })).toEqual([]);
    expect(toolPermissionTargets({ ...call("a"), agentStatus: {
      agentId: "child", title: "Child", status: "needs permission",
      body: '<permission-request>{"requestId":"r","request":{"kind":"question"}}</permission-request>',
    } })).toEqual(["child"]);
    const list = { ...call("list"), paseo: { tool: "list_pending_permissions", agentOperation: { permissions: [
      { agentId: "a", requestId: "r1" }, { agentId: "b", requestId: "r2" }, { agentId: "a", requestId: "r3" },
    ] } } } as unknown as ToolCallView;
    expect(toolPermissionTargets(list)).toEqual(["a", "b"]);
  });
});
