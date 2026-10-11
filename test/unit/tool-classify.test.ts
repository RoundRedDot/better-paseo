import { describe, expect, it } from "vitest";
import { classifyTool, type ToolCallPayload, type ToolKind } from "../../client/tools/classify";

function call(name: string, detail: Record<string, unknown>, extra: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return { name, status: "completed", detail, callId: "c1", error: null, ...extra };
}

/** One row per kind: the host's item, and the kind the card must draw. */
const CASES: Array<[string, ToolCallPayload, ToolKind]> = [
  ["protocol read", call("Read", { type: "read", filePath: "/w/a.ts", offset: 10, limit: 71 }), "read"],
  ["protocol write", call("Write", { type: "write", filePath: "/w/a.ts", content: "x\n" }), "write"],
  ["protocol edit", call("Edit", { type: "edit", filePath: "/w/a.ts", unifiedDiff: "+a" }), "edit"],
  ["protocol shell", call("Bash", { type: "shell", command: "npm test", cwd: "/w", output: "ok", exitCode: 0 }), "shell"],
  ["omp bash by name", call("bash", { type: "unknown", input: { command: "ls" }, output: "a" }), "bash"],
  ["git through shell", call("Bash", { type: "shell", command: "git status", output: "" }), "git"],
  ["protocol search", call("Grep", { type: "search", query: "useAgent", toolName: "grep", numFiles: 8, numMatches: 23 }), "search"],
  ["grep by name", call("grep", { type: "unknown", input: { pattern: "foo" }, output: "a.ts:1" }), "search"],
  ["protocol fetch", call("WebFetch", { type: "fetch", url: "https://github.com/x", code: 200, bytes: 12288 }), "fetch"],
  [
    "worktree setup",
    call("worktree_setup", { type: "worktree_setup", worktreePath: "/w/.worktrees/f", branchName: "f", log: "", commands: [] }),
    "worktree_setup",
  ],
  ["claude Task is a sub-agent", call("Task", { type: "sub_agent", subAgentType: "explore", description: "Find x", log: "" }), "sub_agent"],
  ["plan", call("ExitPlanMode", { type: "plan", text: "# Plan\n1. a" }), "plan"],
  ["plain text", call("note", { type: "plain_text", label: "Note", text: "hello" }), "plain_text"],
  ["mcp", call("mcp__srv__do_thing", { type: "unknown", input: { query: "q" }, output: "r" }), "mcp"],
  ["paseo", call("create_agent", { type: "unknown", input: { title: "T", provider: "claude/opus" }, output: "" }), "paseo"],
  ["ask", call("ask", { type: "unknown", input: { question: "Go?", options: [{ label: "Yes" }] }, output: "" }), "ask"],
  ["hub", call("hub", { type: "unknown", input: { op: "wait" }, output: "" }), "hub"],
  ["eval", call("eval", { type: "unknown", input: { code: "1+1" }, output: "2" }), "eval"],
  ["omp task", call("task", { type: "unknown", input: { tasks: [{ name: "a", task: "do" }] } }), "task"],
  ["github", call("github", { type: "unknown", input: { content: "{}" }, output: "" }), "github"],
  ["thinking", call("thinking", { type: "unknown", input: {}, output: "hmm" }), "thinking"],
  ["anything else", call("frobnicate", { type: "unknown", input: { x: 1 }, output: { y: 2 } }), "unknown"],
];

describe("classifyTool", () => {
  it.each(CASES)("%s", (_label, payload, kind) => {
    expect(classifyTool(payload).tool).toBe(kind);
  });

  it("never draws a call that ran no command as a terminal", () => {
    const view = classifyTool(call("frobnicate", { type: "unknown", input: { x: 1 }, output: { y: 2 } }));
    expect(view.tool).toBe("unknown");
    expect(view.command).toBeUndefined();
    expect(view.input).toEqual({ x: 1 });
    expect(view.output).toContain('"y": 2');
  });

  it("keeps the shell command, cwd and exit code", () => {
    const view = classifyTool(
      call("Bash", { type: "shell", command: "npm test", cwd: "/w/app", output: "ok", exitCode: 1 }),
    );
    expect(view).toMatchObject({ command: "npm test", cwd: "/w/app", output: "ok", exitCode: 1, language: "bash" });
  });

  it("carries a read's offset and limit", () => {
    const view = classifyTool(call("Read", { type: "read", filePath: "/w/a.py", offset: 10, limit: 71, content: "x" }));
    expect(view).toMatchObject({ offset: 10, limit: 71, filePath: "/w/a.py", language: "python", code: "x" });
  });

  it("reads search results from the protocol detail", () => {
    const view = classifyTool(
      call("Grep", {
        type: "search",
        query: "useAgent",
        toolName: "grep",
        filePaths: ["/w/a.ts", "/w/b.ts"],
        numFiles: 2,
        numMatches: 5,
        content: "a.ts:1",
      }),
    );
    expect(view.search).toEqual({
      query: "useAgent",
      toolName: "grep",
      files: ["/w/a.ts", "/w/b.ts"],
      numFiles: 2,
      numMatches: 5,
      content: "a.ts:1",
      webResults: undefined,
      truncated: undefined,
    });
  });

  it("does not take a fetch's HTTP status for an exit code", () => {
    const view = classifyTool(call("WebFetch", { type: "fetch", url: "https://x.dev/a", code: 404, bytes: 10 }));
    expect(view.exitCode).toBeUndefined();
    expect(view.fetch).toMatchObject({ url: "https://x.dev/a", code: 404, bytes: 10 });
  });

  it("reads worktree commands and sub-agent actions", () => {
    const worktree = classifyTool(
      call("setup", {
        type: "worktree_setup",
        worktreePath: "/w/.worktrees/f",
        branchName: "feat",
        log: "done",
        commands: [{ index: 0, command: "npm ci", cwd: "/w", log: "", status: "failed", exitCode: 1 }],
      }),
    ).worktree;
    expect(worktree?.commands[0]).toMatchObject({ command: "npm ci", status: "failed", exitCode: 1 });

    const agent = classifyTool(
      call("Task", {
        type: "sub_agent",
        description: "Find x",
        log: "",
        actions: [{ index: 0, toolName: "Read", summary: "a.ts" }],
      }),
    ).subAgent;
    expect(agent?.actions).toEqual([{ index: 0, toolName: "Read", summary: "a.ts" }]);
  });

  it("drops an error the transformer could only stringify as [object Object]", () => {
    const view = classifyTool(call("Bash", { type: "shell", command: "x", output: "boom" }, { status: "failed", error: "[object Object]" }));
    expect(view.error).toBeUndefined();
  });

  it("reports status and error", () => {
    const view = classifyTool(call("Read", { type: "read", filePath: "/a" }, { status: "failed", error: "ENOENT" }));
    expect(view.status).toBe("failed");
    expect(view.error).toBe("ENOENT");
    expect(classifyTool(call("Read", { type: "read", filePath: "/a" }, { status: "canceled" })).status).toBe(
      "completed",
    );
  });
});
