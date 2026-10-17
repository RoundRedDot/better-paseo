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
  // Codex names an MCP call `server.tool`; OMP's bridge, `server / tool`.
  ["codex mcp", call("custom.run", { type: "unknown", input: { foo: "bar" }, output: null }), "mcp"],
  ["omp bridged mcp", call("local / echo_secret", { type: "unknown", input: { word: "hi" }, output: { content: [] } }), "mcp"],
  ["claude paseo tool", call("mcp__paseo__create_agent", { type: "unknown", input: { title: "T" }, output: "" }), "paseo"],
  ["codex paseo tool", call("paseo.create_agent", { type: "unknown", input: { title: "T" }, output: null }), "paseo"],
  // Dotted names the host can send for other reasons stay what they are.
  ["a file name is not an mcp tool", call("package.json", { type: "unknown", input: { path: "package.json" }, output: null }), "unknown"],
  ["a dotted name answering with text is not an mcp tool", call("foo.bar", { type: "unknown", input: {}, output: "done" }), "unknown"],
  ["a dotted name with a typed detail keeps its kind", call("custom.run", { type: "shell", command: "ls" }), "shell"],
  ["a title with spaces is not an mcp tool", call("Read notes.txt", { type: "unknown", input: {}, output: null }), "unknown"],
  ["a slash without the bridge's spaces", call("a/b", { type: "unknown", input: {}, output: { content: [] } }), "unknown"],
  // Paseo 0.8-0.10 passes these Oh My Pi tools by name; they have no card of their own.
  ["ask by name", call("ask", { type: "unknown", input: { question: "Go?", options: [{ label: "Yes" }] }, output: "" }), "unknown"],
  ["hub", call("hub", { type: "unknown", input: { op: "wait" }, output: "" }), "hub"],
  ["eval by name", call("eval", { type: "unknown", input: { code: "1+1" }, output: "2" }), "unknown"],
  ["task by name", call("task", { type: "unknown", input: { tasks: [{ name: "a", task: "do" }] } }), "unknown"],
  // Paseo 0.11 turns them into protocol details first.
  ["eval as plain text", call("eval", { type: "plain_text", label: "run", text: "2" }), "plain_text"],
  ["task as a sub-agent", call("task", { type: "sub_agent", subAgentType: "a", description: "do" }), "sub_agent"],
  ["github", call("github", { type: "unknown", input: { content: "{}" }, output: "" }), "github"],
  ["omp github as plain text", call("github", { type: "plain_text", label: "status", text: "Working tree clean" }), "github"],
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

  it("reads a web search's text summary and times it in milliseconds", () => {
    const view = classifyTool(
      call("WebSearch", {
        type: "search",
        query: "paseo",
        toolName: "web_search",
        webResults: [{ title: "Paseo", url: "https://paseo.dev" }],
        annotations: ["Paseo is **a host**.", "", 42, "See [docs](https://paseo.dev)."],
        durationSeconds: 2.5,
      }),
    );
    expect(view.search?.annotations).toEqual(["Paseo is **a host**.", "See [docs](https://paseo.dev)."]);
    expect(view.durationMs).toBe(2500);
    // A grep reports milliseconds already; that figure stays.
    expect(classifyTool(call("Glob", { type: "search", query: "*.ts", durationMs: 12, durationSeconds: 9 })).durationMs).toBe(12);
  });

  it("splits Codex's `server.tool` MCP name and unwraps its result", () => {
    const view = classifyTool(
      call("custom.run", {
        type: "unknown",
        input: { foo: "bar" },
        output: { content: [{ type: "text", text: "ran" }], structuredContent: { ok: true } },
      }),
    );
    expect(view.mcp).toMatchObject({ server: "custom", tool: "run", arguments: { foo: "bar" }, result: "ran" });
    expect(view.title).toBe("custom / run");
    // A tool whose own name carries a dot keeps it; the server is the first segment.
    expect(classifyTool(call("docs.files.read", { type: "unknown", input: {}, output: null })).mcp)
      .toMatchObject({ server: "docs", tool: "files.read" });
  });

  it("splits OMP's bridged `server / tool` MCP name", () => {
    const view = classifyTool(
      call("local / echo_secret", {
        type: "unknown",
        input: { word: "hello" },
        output: { content: [{ type: "text", text: "MANGO:hello" }] },
      }),
    );
    expect(view.mcp).toMatchObject({ server: "local", tool: "echo_secret", arguments: { word: "hello" }, result: "MANGO:hello" });
    expect(view.title).toBe("local / echo_secret");
  });

  it.each(["mcp__paseo__create_agent", "paseo.create_agent", "paseo_remote.create_agent", "paseo / create_agent"])(
    "draws Paseo's own %s as its create-agent card",
    (name) => {
      const view = classifyTool(
        call(name, { type: "unknown", input: { title: "Reviewer", provider: "claude/opus" }, output: null }),
      );
      expect(view.tool).toBe("paseo");
      expect(view.title).toBe("Paseo: create_agent");
      expect(view.paseo?.createAgent).toMatchObject({ title: "Reviewer", provider: "claude", model: "opus" });
    },
  );

  it("reads explicit create-agent thinking and permission settings and keeps the complete model ID", () => {
    const agent = classifyTool(call("paseo.create_agent", { type: "unknown", input: {
      provider: "codex/vendor/model-name", settings: { thinkingOptionId: "max", modeId: "full-access" },
    } })).paseo?.createAgent;
    expect(agent).toMatchObject({ provider: "codex", model: "vendor/model-name",
      thinkingOptionId: "max", modeId: "full-access" });
  });

  it.each([undefined, null, [], "max", {}, { thinkingOptionId: 7, modeId: false },
    { thinkingOptionId: "", modeId: "" }])("leaves absent or invalid create-agent settings unspecified: %j", (settings) => {
    const agent = classifyTool(call("paseo.create_agent", { type: "unknown", input: {
      provider: "codex/gpt-6-luna", settings, initialPrompt: "Use Max thinking and full-access permissions.",
    } })).paseo?.createAgent;
    expect(agent?.thinkingOptionId).toBeUndefined();
    expect(agent?.modeId).toBeUndefined();
  });

  it("keeps a Paseo-server tool this plugin has no card for as an MCP call", () => {
    const view = classifyTool(call("mcp__paseo__list_worktrees", { type: "unknown", input: {}, output: "" }));
    expect(view.tool).toBe("mcp");
    expect(view.mcp).toMatchObject({ server: "paseo", tool: "list_worktrees" });
  });

  it("does not take another server's tool of the same name for Paseo's", () => {
    const view = classifyTool(call("github.create_agent", { type: "unknown", input: {}, output: null }));
    expect(view.tool).toBe("mcp");
    expect(view.mcp).toMatchObject({ server: "github", tool: "create_agent" });
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

  it("reads a sub-agent's prompt, dropping one that is blank, not text, or only repeats the description", () => {
    const prompt = (value: unknown, description = "Find x") =>
      classifyTool(call("Task", { type: "sub_agent", description, log: "", prompt: value })).subAgent?.prompt;
    expect(prompt("Look for x in src/.\n\n- report paths")).toBe("Look for x in src/.\n\n- report paths");
    expect(prompt(undefined)).toBeUndefined();
    expect(prompt(42)).toBeUndefined();
    expect(prompt("  \n ")).toBeUndefined();
    expect(prompt(" Find x \n")).toBeUndefined();
  });

  it("builds an edit's diff from its old and new text when the provider sent no diff", () => {
    const view = classifyTool(call("Edit", { type: "edit", filePath: "/w/a.ts", oldString: "a\nb\n", newString: "a\nB\n" }));
    expect(view).toMatchObject({ diff: " a\n-b\n+B", diffFromText: true });
    const added = classifyTool(call("Edit", { type: "edit", filePath: "/w/a.ts", newString: "x" }));
    expect(added).toMatchObject({ diff: "+x", diffFromText: true });
  });

  it("keeps the provider's own diff over one built from the text", () => {
    const view = classifyTool(
      call("Edit", { type: "edit", filePath: "/w/a.ts", oldString: "a", newString: "b", unifiedDiff: "@@ -3 +3 @@\n-a\n+b" }),
    );
    expect(view.diff).toBe("@@ -3 +3 @@\n-a\n+b");
    expect(view.diffFromText).toBeUndefined();
  });

  it("reads an OMP github call sent as plain text: the op and its target from the label, the reply from the text", () => {
    expect(classifyTool(call("github", { type: "plain_text", label: "status", text: "Working tree clean" })).github)
      .toEqual({ op: "status", text: "Working tree clean" });
    expect(classifyTool(call("github", { type: "plain_text", label: "file_read src/a.ts", text: "const a = 1;" })).github)
      .toEqual({ op: "file_read", subject: "src/a.ts", file: { name: "src/a.ts", language: "typescript", code: "const a = 1;" } });
    expect(classifyTool(call("github", { type: "plain_text", label: "pr_view", text: "https://github.com/a/b/pull/3" })).github)
      .toMatchObject({ op: "pr_view", link: "https://github.com/a/b/pull/3", rows: [{ label: "pull request", value: "#3" }] });
    expect(classifyTool(call("github", { type: "plain_text", label: "run_watch" }, { status: "running" })).github)
      .toEqual({ op: "run_watch" });
  });

  it("drops an error the transformer could only stringify as [object Object]", () => {
    const view = classifyTool(call("Bash", { type: "shell", command: "x", output: "boom" }, { status: "failed", error: "[object Object]" }));
    expect(view.error).toBeUndefined();
  });

  it("reads a plan's verdict as the host draws it: canceled, then rejected or approved", () => {
    const plan = (extra: Partial<ToolCallPayload>) => classifyTool(call("plan_approval", { type: "plan", text: "# Ship it" }, extra));
    expect(plan({ approved: false })).toMatchObject({ planOutcome: "rejected", status: "completed" });
    expect(plan({ approved: true })).toMatchObject({ planOutcome: "approved", status: "completed" });
    expect(plan({ status: "canceled" })).toMatchObject({ planOutcome: "canceled", status: "completed" });
    expect(plan({ status: "canceled", approved: true }).planOutcome).toBe("canceled");
    expect(plan({ status: "running" }).planOutcome).toBeUndefined();
    expect(plan({}).planOutcome).toBeUndefined();
    // Only a plan has a verdict; another canceled call is drawn as finished.
    const read = classifyTool(call("Read", { type: "read", filePath: "/a" }, { status: "canceled", approved: false }));
    expect(read.planOutcome).toBeUndefined();
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
