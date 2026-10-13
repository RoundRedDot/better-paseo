import { describe, expect, it } from "vitest";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import {
  countDiff,
  describeGitCommand,
  formatBytes,
  formatDuration,
  hostOf,
  lineRangeLabel,
  summarizeTool,
  type ToolSummary,
} from "../../client/tools/summarize";

function call(name: string, detail: Record<string, unknown>, extra: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return { name, status: "completed", detail, callId: "c1", error: null, ...extra };
}

type Expected = Partial<ToolSummary>;

/** Plan §3.3 item 3, row by row: the item, and what its header says. */
const TABLE: Array<[string, ToolCallPayload, Expected]> = [
  [
    "read · L10–80",
    call("Read", { type: "read", filePath: "/w/src/a.ts", offset: 10, limit: 71 }),
    { verb: "Read", target: "/w/src/a.ts", targetIsPath: true, meta: ["L10–80"], tone: "default" },
  ],
  [
    "write · 120 lines",
    call("Write", { type: "write", filePath: "/w/src/a.ts", content: `${"x\n".repeat(120)}` }),
    { verb: "Write", target: "/w/src/a.ts", targetIsPath: true, meta: ["120 lines"] },
  ],
  [
    "edit · +12 −3",
    call("Edit", {
      type: "edit",
      filePath: "/w/src/a.ts",
      unifiedDiff: `--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n${"+a\n".repeat(12)}${"-b\n".repeat(3)}`,
    }),
    { verb: "Edit", targetIsPath: true, meta: ["+12 −3"] },
  ],
  [
    "edit from old and new text counts the lines that changed",
    call("Edit", { type: "edit", filePath: "/w/src/a.ts", oldString: "a\nb\nc\n", newString: "a\nB\nc\nd\n" }),
    { verb: "Edit", meta: ["+2 −1"] },
  ],
  [
    "edit from old and new text counts a changed SQL comment as a line, not a file header",
    call("Edit", { type: "edit", filePath: "/w/q.sql", oldString: "-- old\nselect 1", newString: "-- new\nselect 1" }),
    { verb: "Edit", meta: ["+1 −1"] },
  ],
  [
    "bash · exit 0 · 1.2s",
    call("Bash", { type: "unknown", input: { command: "npm test\nnpm run lint" }, output: "", exitCode: 0, durationMs: 1200 }),
    { verb: "Bash", target: "npm test …", meta: ["exit 0", "1.2s"], tone: "default" },
  ],
  [
    "shell non-zero exit is danger, with the cwd as meta path",
    call("shell", { type: "shell", command: "make", cwd: "/w/sub", output: "boom", exitCode: 2 }),
    { verb: "Shell", target: "make", meta: ["exit 2"], metaPath: "/w/sub", tone: "danger" },
  ],
  [
    "git commit · subject",
    call("Bash", { type: "shell", command: 'git commit -m "Fix the header\n\nbody"', output: "" }),
    { verb: "Git", target: "commit · Fix the header" },
  ],
  [
    "git push → origin/main",
    call("Bash", { type: "shell", command: "git push -u origin main", output: "" }),
    { verb: "Git", target: "push → origin/main" },
  ],
  [
    "search · 8 files · 23 matches",
    call("Grep", { type: "search", query: "useAgent", numFiles: 8, numMatches: 23 }),
    { verb: "Search", target: '"useAgent"', meta: ["8 files", "23 matches"] },
  ],
  [
    "web search counts results",
    call("WebSearch", { type: "search", query: "paseo", toolName: "web_search", webResults: [{ title: "a", url: "https://a" }] }),
    { verb: "Web search", target: '"paseo"', meta: ["1 result"] },
  ],
  [
    "web search times itself in seconds, drawn as every other duration",
    call("WebSearch", { type: "search", query: "paseo", toolName: "web_search", annotations: ["x"], durationSeconds: 3.25 }),
    { verb: "Web search", target: '"paseo"', meta: ["3.3s"] },
  ],
  [
    "fetch · github.com · 200 · 12 KB",
    call("WebFetch", { type: "fetch", url: "https://user@github.com/a/b?x=1", code: 200, bytes: 12288 }),
    { verb: "Fetch", target: "github.com", meta: ["200", "12 KB"], tone: "default" },
  ],
  [
    "fetch 404 is danger",
    call("WebFetch", { type: "fetch", url: "https://x.dev", code: 404 }),
    { verb: "Fetch", target: "x.dev", meta: ["404"], tone: "danger" },
  ],
  [
    "mcp · server / tool · key argument",
    call("mcp__devnav__codedb_search", { type: "unknown", input: { query: "PathText", limit: 5 }, output: "" }),
    { verb: "devnav / codedb_search", target: "PathText" },
  ],
  [
    "paseo · create_agent · title",
    call("create_agent", { type: "unknown", input: { title: "Reviewer", provider: "claude/opus" }, output: "" }),
    { verb: "paseo / create_agent", target: "Reviewer" },
  ],
  [
    "codex mcp · server / tool",
    call("devnav.codedb_search", { type: "unknown", input: { query: "PathText" }, output: null }),
    { verb: "devnav / codedb_search", target: "PathText" },
  ],
  [
    "paseo through mcp · leaf name",
    call("mcp__paseo__list_models", { type: "unknown", input: { provider: "claude" }, output: "" }),
    { verb: "paseo / list_models" },
  ],
  ["hub keeps its op", call("hub", { type: "unknown", input: { op: "wait" }, output: "" }), { verb: "Hub", target: "wait" }],
  [
    "github keeps op, repo and subject",
    call("github", { type: "unknown", input: { content: '{"op":"pr_view","repo":"a/b","pr":3}' }, output: "" }),
    { verb: "GitHub" },
  ],
  [
    "omp github sent as plain text keeps its op and target",
    call("github", { type: "plain_text", label: "search_code useAgent", text: "src/a.ts:1: useAgent()" }),
    { verb: "GitHub", target: "search_code useAgent" },
  ],
  ["plan · first line", call("ExitPlanMode", { type: "plan", text: "# Ship it\n1. a" }), { verb: "Plan", target: "Ship it …" }],
  [
    "plan · rejected, in the quiet tone",
    call("plan_approval", { type: "plan", text: "# Ship it" }, { approved: false }),
    { verb: "Plan", target: "Ship it", meta: ["rejected"], tone: "default" },
  ],
  [
    "plan · canceled is not drawn as running or failed",
    call("plan_approval", { type: "plan", text: "# Ship it" }, { status: "canceled" }),
    { verb: "Plan", target: "Ship it", meta: ["canceled"], tone: "default" },
  ],
  [
    "plan · approved",
    call("plan_approval", { type: "plan", text: "# Ship it" }, { approved: true }),
    { verb: "Plan", meta: ["approved"] },
  ],
  ["plain_text · label", call("x", { type: "plain_text", label: "Note", text: "hello" }), { verb: "Note", target: "hello" }],
  ["plain_text without label uses the name", call("status", { type: "plain_text", text: "ok" }), { verb: "Status" }],
  [
    "worktree_setup · branch · path",
    call("setup", {
      type: "worktree_setup",
      worktreePath: "/w/.worktrees/f",
      branchName: "feat",
      log: "",
      commands: [{ index: 0, command: "npm ci", cwd: "/w", log: "", status: "completed", exitCode: 0 }],
    }),
    { verb: "Worktree", target: "feat", metaPath: "/w/.worktrees/f", meta: ["1 command"] },
  ],
  [
    "sub_agent · description · actions",
    call("Task", {
      type: "sub_agent",
      subAgentType: "explore",
      description: "Find the bug",
      log: "",
      actions: [{ index: 0, toolName: "Read" }],
    }),
    { verb: "Explore", target: "Find the bug", meta: ["1 action"] },
  ],
  [
    "sub_agent · the description, not the prompt",
    call("Agent", {
      type: "sub_agent",
      subAgentType: "general-purpose",
      description: "Find the bug",
      prompt: "Read src/ and report where the crash starts.",
      log: "",
    }),
    { verb: "General-purpose", target: "Find the bug", meta: [] },
  ],
  [
    "unknown · name · key argument",
    call("frobnicate", { type: "unknown", input: { path: "/w/x" }, output: "" }),
    { verb: "frobnicate", target: "/w/x" },
  ],
];

describe("summarizeTool", () => {
  it.each(TABLE)("%s", (_label, payload, expected) => {
    expect(summarizeTool(classifyTool(payload))).toMatchObject(expected);
  });

  it("covers every kind in the table", () => {
    const kinds = new Set(TABLE.map(([, payload]) => classifyTool(payload).tool));
    for (const kind of [
      "read", "write", "edit", "bash", "shell", "git", "search", "fetch", "mcp", "paseo",
      "hub", "github", "plan", "plain_text", "worktree_setup", "sub_agent", "unknown",
    ]) {
      expect(kinds.has(kind as never), kind).toBe(true);
    }
  });

  it("shows no exit code while the command runs", () => {
    const summary = summarizeTool(
      classifyTool(call("Bash", { type: "shell", command: "sleep 5", exitCode: null }, { status: "running" })),
    );
    expect(summary.meta).toEqual([]);
    expect(summary.tone).toBe("default");
  });

  it("puts the first line of a failure under the header", () => {
    const summary = summarizeTool(
      classifyTool(
        call("Read", { type: "read", filePath: "/w/a" }, { status: "failed", error: "\nENOENT: no such file\n  at x" }),
      ),
    );
    expect(summary.tone).toBe("danger");
    expect(summary.errorLine).toBe("ENOENT: no such file");
  });

  it("falls back to the last output line for a failed command without an error", () => {
    const summary = summarizeTool(
      classifyTool(
        call("Bash", { type: "shell", command: "npm test", output: "ok\n\u001b[31mnpm ERR! 1 failing\u001b[0m\n", exitCode: 1 }, { status: "failed" }),
      ),
    );
    expect(summary.errorLine).toBe("npm ERR! 1 failing");
  });

  it("drops an error line that only repeats the row's target", () => {
    // A failed background task: its summary is the label, the text and the error.
    const summary = summarizeTool(
      classifyTool(
        call(
          "task_notification",
          { type: "plain_text", label: "选文件后取消并切回主题", text: "选文件后取消并切回主题" },
          { status: "failed", error: "选文件后取消并切回主题" },
        ),
      ),
    );
    expect(summary.tone).toBe("danger");
    expect(summary.errorLine).toBeUndefined();
  });

  it("drops an error line that only repeats the verb of a row without a target", () => {
    const summary = summarizeTool(
      classifyTool(call("task_notification", { type: "plain_text", label: "Build" }, { status: "failed", error: "Build" })),
    );
    expect(summary.tone).toBe("danger");
    expect(summary.errorLine).toBeUndefined();
  });

  it("has no error line for a call that did not fail", () => {
    expect(summarizeTool(classifyTool(call("Read", { type: "read", filePath: "/a" }))).errorLine).toBeUndefined();
  });
});

describe("summary helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(125000)).toBe("2m 5s");
    expect(formatDuration(undefined)).toBeUndefined();
  });

  it("formats byte counts", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12288)).toBe("12 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
  });

  it("turns offset and limit into a line range", () => {
    expect(lineRangeLabel(10, 71)).toBe("L10–80");
    expect(lineRangeLabel(0, 149)).toBe("L1–149");
    expect(lineRangeLabel(40, undefined)).toBe("L40+");
    expect(lineRangeLabel(undefined, undefined)).toBeUndefined();
  });

  it("counts a diff without its file headers", () => {
    expect(countDiff("--- a\n+++ b\n@@\n+x\n-y\n-z\n ctx")).toEqual({ added: 1, removed: 2 });
  });

  it("describes git commands", () => {
    expect(describeGitCommand("git -C /w status --short")).toBe("status --short");
    expect(describeGitCommand("git commit -am 'Tidy up'")).toBe("commit · Tidy up");
    expect(describeGitCommand("git push")).toBe("push");
    expect(describeGitCommand("git add . && git commit -m x")).toBe("add .");
  });

  it("reads a URL's host", () => {
    expect(hostOf("https://a:b@github.com:8443/x")).toBe("github.com:8443");
    expect(hostOf("not a url")).toBe("not a url");
  });
});
