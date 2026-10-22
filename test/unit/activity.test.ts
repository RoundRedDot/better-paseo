import { describe, expect, it } from "vitest";
import { transformCompaction, transformToolCall } from "../../client/tools/transform";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { summarizeTool } from "../../client/tools/summarize";
import { toolHasDetail } from "../../client/tools/detail";

interface Call { name: string; detail: unknown; status?: string; error?: unknown; metadata?: Record<string, unknown> }

function transform(call: Call) {
  return transformToolCall({ item: { type: "tool_call", callId: "c1", status: "completed", error: null, ...call } as never,
    phase: "complete" });
}

function view(call: Call) {
  return classifyTool(transform(call)!.items[0]!.data as unknown as ToolCallPayload);
}

function row(call: Call) {
  const summary = summarizeTool(view(call));
  return { verb: summary.verb, target: summary.target, meta: summary.meta, tone: summary.tone,
    ...(summary.errorLine ? { errorLine: summary.errorLine } : {}), ...(summary.iconTone ? { iconTone: summary.iconTone } : {}) };
}

const sessionDir = "/private/tmp/claude-501/-Users-luke-app/93393f57/tasks";

describe("Claude task notifications", () => {
  it("drops the notification a foreground command sends, which repeats its own row", () => {
    expect(transform({ name: "task_notification",
      detail: { type: "plain_text", label: "Check repo state", icon: "wrench", text: "Check repo state" },
      metadata: { synthetic: true, taskId: "bm0", toolUseId: "toolu_1", status: "completed" } })).toEqual({ items: [] });
  });

  it("draws a background command's result with its exit code and output file", () => {
    const call: Call = { name: "task_notification",
      detail: { type: "plain_text", label: 'Background command "Run tests" completed (exit code 0)', icon: "wrench",
        text: 'Background command "Run tests" completed (exit code 0)' },
      metadata: { synthetic: true, source: "claude_task_notification", taskId: "bx5", status: "completed",
        outputFile: `${sessionDir}/bx5.output` } };
    expect(row(call)).toEqual({ verb: "Command finished", target: "Run tests", meta: ["exit 0"], tone: "default",
      iconTone: "success" });
    expect(view(call).activity?.sections).toEqual([{ label: "Output", text: `${sessionDir}/bx5.output`, format: "path" }]);
    // Only the fields a row reads ride along.
    expect(transform(call)!.items[0]!.data).toMatchObject({ metadata: { taskId: "bx5", status: "completed",
      outputFile: `${sessionDir}/bx5.output` } });
    expect(transform(call)!.items[0]!.data).not.toHaveProperty("metadata.source");
  });

  it("reads a failed subtask's reason, result and note out of the envelope", () => {
    const summary = 'Agent "Review the fix" failed: Agent terminated early due to an API error: rate limit';
    const call: Call = { name: "task_notification", status: "failed", error: { message: summary } as never,
      detail: { type: "plain_text", label: summary, icon: "wrench",
        text: `<task-notification>\n<task-id>a9e</task-id>\n<output-file>${sessionDir}/a9e.output</output-file>\n` +
          `<status>failed</status>\n<summary>${summary}</summary>\n<note>Send it a message to resume.</note>\n` +
          "<result>Now the .env keys.</result>\n</task-notification>" },
      metadata: { status: "failed", outputFile: `${sessionDir}/a9e.output` } };
    expect(row(call)).toEqual({ verb: "Subtask failed", target: "Review the fix", meta: [], tone: "danger",
      errorLine: "Agent terminated early due to an API error: rate limit" });
    expect(view(call).activity?.sections.map((section) => section.label)).toEqual(["Result", "Note", "Output"]);
  });

  it("says a failed command failed once, with its exit code, and no generic error line", () => {
    expect(row({ name: "task_notification", status: "failed",
      error: { message: 'Background command "Run Metro" failed with exit code 144' } as never,
      detail: { type: "plain_text", label: 'Background command "Run Metro" failed with exit code 144' },
      metadata: { status: "failed", outputFile: `${sessionDir}/b1.output` } }))
      .toEqual({ verb: "Command failed", target: "Run Metro", meta: ["exit 144"], tone: "danger" });
  });

  it("names a task that did not finish before the session ended", () => {
    expect(row({ name: "task_notification",
      detail: { type: "plain_text", label: "Background shell command didn't finish before the previous session ended" },
      metadata: { status: "stopped", outputFile: `${sessionDir}/b2.output` } }))
      .toMatchObject({ verb: "Command stopped", target: "Background shell command didn't finish before the previous session ended" });
  });
});

describe("Claude tools without a card", () => {
  it("lists the tools ToolSearch loaded", () => {
    const call: Call = { name: "ToolSearch", detail: { type: "unknown",
      input: { query: "select:mcp__cua-driver__list_windows,mcp__cua-driver__run_steps", max_results: 2 },
      output: { output: [{ tool_name: "mcp__cua-driver__list_windows", type: "tool_reference" },
        { tool_name: "mcp__cua-driver__run_steps", type: "tool_reference" }] } } };
    expect(row(call)).toEqual({ verb: "Load tools", target: "cua-driver / list_windows, cua-driver / run_steps",
      meta: ["2 tools"], tone: "default" });
    // An unnamed call that answers with tool references is the same load.
    expect(row({ ...call, name: "tool", detail: { ...(call.detail as object), input: null } }).verb).toBe("Load tools");
  });

  it("draws the service's icon when every loaded tool is one service's", () => {
    const load = (...names: string[]): Call => ({ name: "ToolSearch", detail: { type: "unknown",
      input: { query: `select:${names.join(",")}` },
      output: { output: names.map((tool_name) => ({ tool_name, type: "tool_reference" })) } } });
    expect(view(load("mcp__linear-server__save_issue", "mcp__linear-server__get_issue")).activity?.icon)
      .toBe("brand:linear");
    expect(view(load("mcp__linear-server__get_issue", "mcp__github__get_me")).activity?.icon).toBe("Wrench");
    expect(view(load("mcp__linear-server__get_issue", "WebFetch")).activity?.icon).toBe("Wrench");
    // A select query draws the icon before its answer lands.
    const pending = load("mcp__claude_ai_Gmail__get_thread");
    expect(view({ ...pending, detail: { ...(pending.detail as object), output: null } }).activity?.icon)
      .toBe("brand:gmail");
  });

  it("draws a message to a subtask with its summary and recipient", () => {
    const call: Call = { name: "SendMessage", detail: { type: "unknown",
      input: { to: "a9ea0ca4b9f9e7846", summary: "Resume the review", message: "Quota reset, **carry on**." },
      output: { output: { success: true, message: "Resuming agent a9ea0ca", resumedAgentId: "a9ea0ca4b9f9e7846" } } } };
    expect(row(call)).toEqual({ verb: "Sent message", target: "Resume the review", meta: ["to a9ea0ca4", "resumed"],
      tone: "default" });
    expect(view(call).activity?.sections).toEqual([{ text: "Quota reset, **carry on**.", format: "markdown" }]);
    expect(row({ ...call, status: "running" }).verb).toBe("Sending message");
  });

  it("names a launched skill and a scheduled wakeup", () => {
    expect(row({ name: "Skill", detail: { type: "plain_text", label: "hand-off", icon: "sparkles",
      text: "Launching skill: hand-off" } })).toEqual({ verb: "Skill", target: "hand-off", meta: [], tone: "default" });
    const wakeup = view({ name: "ScheduleWakeup", detail: { type: "unknown",
      input: { delaySeconds: 1200, prompt: "Check the build", reason: "fallback check on the build" },
      output: { output: "Next wakeup scheduled for 22:05:00 (in 1243s)." } } });
    expect(summarizeTool(wakeup)).toMatchObject({ verb: "Wake up in 20m", target: "fallback check on the build",
      meta: ["at 22:05"] });
    expect(toolHasDetail(wakeup, 72)).toBe(true);
  });

  it("names a cron job and a stopped task, without the refusal's tags", () => {
    expect(row({ name: "CronCreate", detail: { type: "unknown",
      input: { cron: "7 10 21 10 *", recurring: false, prompt: "Inspect the release\nRead only." }, output: null } }))
      .toEqual({ verb: "Schedule", target: "Inspect the release", meta: ["7 10 21 10 *", "once"], tone: "default" });
    expect(row({ name: "TaskStop", status: "failed",
      error: { type: "tool_result", content: "<tool_use_error>Task b1 is not running</tool_use_error>" } as never,
      detail: { type: "unknown", input: { task_id: "b1" }, output: null } }))
      .toEqual({ verb: "Stop task", target: "b1", meta: [], tone: "danger", errorLine: "Task b1 is not running" });
  });
});

describe("Codex tools without a card", () => {
  it("draws typed terminal input, and drops a poll that names nothing", () => {
    expect(row({ name: "terminal", detail: { type: "plain_text", label: "git add -p NoteDao.kt", text: "y\ny\nn\n",
      icon: "square_terminal" } })).toEqual({ verb: "Terminal input", target: "git add -p NoteDao.kt",
      meta: ["y ⏎ y ⏎ n ⏎"], tone: "default" });
    expect(row({ name: "terminal", detail: { type: "plain_text", label: "bash verify.sh", text: "" } }))
      .toMatchObject({ verb: "Terminal", target: "bash verify.sh" });
    expect(transform({ name: "terminal", detail: { type: "plain_text", text: "", icon: "square_terminal" } }))
      .toEqual({ items: [] });
  });

  it("draws a computer-use step by its title, and a failure by its reason", () => {
    const step: Call = { name: "cua_repl.js", detail: { type: "unknown",
      input: { code: "await chrome.pressKey('super+t');", title: "Open a new tab" },
      output: { content: [{ type: "text", text: "Computer Use server error -10005: frontmostApplicationChanged" }] } } };
    expect(row(step)).toEqual({ verb: "Computer use", target: "Open a new tab", meta: [], tone: "default" });
    expect(row({ ...step, status: "failed", error: { message: "Tool call failed" } as never })).toEqual({
      verb: "Computer use", target: "Open a new tab", meta: [], tone: "danger",
      errorLine: "Computer Use server error -10005: frontmostApplicationChanged" });
  });
});

describe("Grok tools", () => {
  it("draws a UseTool call as the MCP or Paseo call it wraps", () => {
    const mcp = view({ name: "rea__read_bytes", detail: { type: "unknown",
      input: { variant: "UseTool", tool_name: "rea__read_bytes", tool_input: { address: "0x10009b32e", length: 16 } },
      output: { type: "MCP", tool_name: "read_bytes", server_name: "rea", output: { OkayOutput: "{\"bytes\":\"00\"}" } } } });
    expect(mcp.tool).toBe("mcp");
    expect(mcp.mcp).toMatchObject({ server: "rea", tool: "read_bytes", arguments: { address: "0x10009b32e", length: 16 },
      result: "{\"bytes\":\"00\"}" });
    const failed = view({ name: "paseo__archive_workspace", status: "failed", error: { message: "Tool call failed" } as never,
      detail: { type: "unknown", input: { variant: "UseTool", tool_name: "paseo__archive_workspace",
        tool_input: { workspaceId: "wks_1" } },
      output: { type: "MCP", tool_name: "archive_workspace", server_name: "paseo",
        output: { Error: "Workspace not found: wks_1" }, is_error: true } } });
    expect(failed).toMatchObject({ status: "failed", error: "Workspace not found: wks_1" });
  });

  it("reads task output, a stopped task, a monitor and a listing", () => {
    expect(row({ name: "git push origin HEAD (c6cfce92)", detail: { type: "unknown",
      input: { variant: "TaskOutput", task_ids: ["c6cfce92"] },
      output: { type: "TaskOutput", Result: { task_id: "c6cfce92", command: "git push origin HEAD", status: "completed",
        exit_code: 0, duration_secs: 4.7, output: "To github.com\n" } } } }))
      .toEqual({ verb: "Task output", target: "git push origin HEAD", meta: ["exit 0", "5s"], tone: "default" });
    expect(row({ name: "<long>", detail: { type: "unknown", input: { variant: "TaskOutput", task_ids: ["01a1"] },
      output: { type: "TaskOutput", Result: { task_id: "01a1", command: "[subagent:general-purpose] Third send args",
        status: "running", exit_code: null, duration_secs: 610 } } } }))
      .toMatchObject({ verb: "Subtask output", target: "Third send args", meta: ["running", "10m"] });
    expect(row({ name: "kill d818f257 (killed)", detail: { type: "unknown",
      input: { variant: "KillTask", task_id: "d818f257-86dd-49ca" },
      output: { type: "KillTask", Result: { outcome: "already_exited" } } } }))
      .toEqual({ verb: "Stop task", target: "d818f257", meta: ["already exited"], tone: "default" });
    expect(row({ name: "other", detail: { type: "unknown", input: { variant: "Monitor", command: "zsh watch.sh",
      description: "Watch REA import", timeout_ms: 36000000 }, output: { type: "Monitor" } } }))
      .toEqual({ verb: "Monitor", target: "Watch REA import", meta: ["up to 10h"], tone: "default" });
    expect(row({ name: "List `/tmp`", detail: { type: "unknown", input: { variant: "ListDir", target_directory: "/tmp" },
      output: { type: "ListDir", Content: { content: "- /tmp/\n  - a.txt\n  - b/" } } } }))
      .toMatchObject({ verb: "List", target: "/tmp", meta: ["2 entries"] });
  });

  it("draws a plan update as a checklist, not JSON", () => {
    const todos = { type: "Todo", TodosUpdated: { todos: [
      { content: "Read the design", status: "completed" }, { content: "Implement stores", status: "in_progress" },
      { content: "Test", status: "pending" }] } };
    const plan = view({ name: "think", detail: { type: "plain_text", label: "Updating plan", icon: "brain",
      text: JSON.stringify(todos) } });
    expect(summarizeTool(plan)).toMatchObject({ verb: "Plan", target: "Implement stores", meta: ["1/3 done"] });
    expect(plan.activity?.sections[0]?.text).toBe("- [x] Read the design\n- [ ] Implement stores *(in progress)*\n- [ ] Test");
  });

  it("reads a tool search and a subtask started in the background", () => {
    expect(row({ name: "other", detail: { type: "plain_text", label: 'Search tools: "rea read_bytes"',
      text: JSON.stringify({ results: [{ server: "rea", tools: [{ tool_name: "rea__read_bytes", description: "Read bytes." }] }] }) } }))
      .toEqual({ verb: "Search tools", target: "rea read_bytes", meta: ["1 tool"], tone: "default" });
    expect(row({ name: "Pair send site args", detail: { type: "plain_text", label: "Pair send site args",
      text: "Subagent started in background.\nsubagent_id: 01a1\ndescription: Pair send site args" } }))
      .toEqual({ verb: "Started subtask", target: "Pair send site args", meta: ["background"], tone: "default" });
  });
});

describe("Cursor, OpenCode and Antigravity tools", () => {
  it("draws Cursor's MCP calls on the MCP and Paseo cards, and its task as a subtask", () => {
    expect(view({ name: "other", detail: { type: "unknown", input: { providerIdentifier: "github",
      toolName: "search_pull_requests", args: { query: "tab width" } }, output: { success: true } } }))
      .toMatchObject({ tool: "mcp", mcp: { server: "github", tool: "search_pull_requests", arguments: { query: "tab width" } } });
    expect(view({ name: "other", detail: { type: "unknown", input: { providerIdentifier: "paseo", toolName: "list_profiles",
      args: {} }, output: { success: true } } }).tool).toBe("paseo");
    expect(view({ name: "other", detail: { type: "unknown", input: { providerIdentifier: "android", toolName: "get_ui_tree",
      args: {} }, output: { error: "Tool execution error" } } })).toMatchObject({ status: "failed", error: "Tool execution error" });
    expect(view({ name: "other", detail: { type: "unknown", input: { _toolName: "task", prompt: "Write the docs" }, output: null } }).tool)
      .toBe("sub_agent");
  });

  it("draws OpenCode's Paseo tools, fetches, scripts and skills", () => {
    expect(view({ name: "paseo_list_models", detail: { type: "unknown", input: { provider: "opencode" },
      output: "models_count=10" } })).toMatchObject({ tool: "paseo" });
    expect(view({ name: "webfetch", detail: { type: "unknown", input: { url: "https://github.com/x", format: "markdown" },
      output: "# x" } })).toMatchObject({ tool: "fetch", fetch: { url: "https://github.com/x", result: "# x" } });
    expect(row({ name: "execute", detail: { type: "unknown", input: { code: "const r = await tools.shell({});\nreturn r;" },
      output: "{}" } })).toMatchObject({ verb: "Run code", target: "const r = await tools.shell({});" });
    expect(row({ name: "skill", detail: { type: "unknown", input: { id: "commit" }, output: "<skill_content>" } }))
      .toMatchObject({ verb: "Skill", target: "commit" });
  });

  it("reads Antigravity's tool label instead of its name, which is always `other`", () => {
    expect(row({ name: "other", detail: { type: "plain_text", label: "read_file", text: "59 lines, 5446 bytes" } }))
      .toEqual({ verb: "Read", target: undefined, meta: ["59 lines, 5446 bytes"], tone: "default" });
    expect(row({ name: "think", detail: { type: "plain_text", label: "manage_task", icon: "brain",
      text: "Task: aed6/task-94\nStatus: DONE\nLog output:\nf37b0a8b5 feat: schedule" } }))
      .toMatchObject({ verb: "Task", target: "Task: aed6/task-94", meta: [] });
    expect(row({ name: "other", detail: { type: "unknown", input: { Path: "/repo/reports/C1.md" }, output: "" } }))
      .toMatchObject({ verb: "File", target: "/repo/reports/C1.md" });
  });
});

describe("context compaction", () => {
  it("is drawn as a row: running while it compacts, then with the size it started from", () => {
    const loading = transformCompaction({ item: { type: "compaction", status: "loading" } })!.items[0]!.data;
    expect(summarizeTool(classifyTool(loading as unknown as ToolCallPayload))).toMatchObject({ verb: "Compacting context" });
    expect(classifyTool(loading as unknown as ToolCallPayload).status).toBe("running");
    const done = transformCompaction({ item: { type: "compaction", status: "completed", trigger: "auto", preTokens: 972610 } })!
      .items[0]!.data;
    expect(summarizeTool(classifyTool(done as unknown as ToolCallPayload)))
      .toMatchObject({ verb: "Compacted context", meta: ["from 973K tokens"] });
  });
});

describe("the rest of the generic rows", () => {
  const rejection = { type: "tool_result", is_error: true, content: "The user doesn't want to proceed with this tool use. " +
    "The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing " +
    "and wait for the user to tell you how to proceed." };

  it("says a call the reader rejected was rejected, quietly, instead of quoting Claude's instruction", () => {
    const bash = view({ name: "Bash", status: "failed", error: rejection, detail: { type: "shell", command: "sleep 420" } });
    expect(bash).toMatchObject({ rejected: true, error: "You rejected this call." });
    expect(summarizeTool(bash)).toMatchObject({ verb: "Bash", target: "sleep 420", meta: ["rejected"], tone: "default" });
    expect(summarizeTool(bash)).not.toHaveProperty("errorLine");
    expect(row({ name: "tool", status: "failed", error: rejection, detail: { type: "unknown", input: null, output: null } }))
      .toEqual({ verb: "Tool call", target: undefined, meta: ["rejected"], tone: "default" });
    // A real failure keeps its colour and its line.
    expect(row({ name: "Bash", status: "failed", error: { message: "Exit code 1" }, detail: { type: "shell", command: "false" } }))
      .toMatchObject({ tone: "danger", errorLine: "Exit code 1" });
  });

  it("counts the peer sessions ListAgents found", () => {
    const listing = "This session is align-206-ca [24c068] - the name other sessions use.\n\nPeer sessions (34):\n" +
      "  beautiful-chat-2e [e4cb66]  ·  interactive  ·  idle";
    expect(row({ name: "ListAgents", detail: { type: "unknown", input: {}, output: { output: listing } } }))
      .toEqual({ verb: "List sessions", target: "34 peer sessions", meta: ["this is align-206-ca"], tone: "default" });
  });
});

describe("Codex async questions", () => {
  const questionData = (text: string) => (transform({ name: "request_user_input_async",
    detail: { type: "plain_text", icon: "brain", text } })!.items[0]!.data as { questionData?: unknown }).questionData;

  it("reads an answered question back into the question card's shape", () => {
    expect(questionData("Ship the Server first?\nShip the Server, schedule Admin later")).toEqual({
      questions: [{ question: "Ship the Server first?", options: [] }],
      answers: ["Ship the Server, schedule Admin later"],
    });
  });

  it("keeps a dismissed question's options, and each question of a set", () => {
    expect(questionData("Which SHA?\nProvide the Web SHA, Patch the old protocol\n\nAnd the docs?\nYes, No\n\nDismissed")).toEqual({
      questions: [
        { question: "Which SHA?", options: [{ label: "Provide the Web SHA" }, { label: "Patch the old protocol" }] },
        { question: "And the docs?", options: [{ label: "Yes" }, { label: "No" }] },
      ],
      status: "dismissed",
    });
  });
});
