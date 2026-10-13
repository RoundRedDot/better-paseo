import { beforeEach, describe, expect, it } from "vitest";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { defaultToolExpanded, toolDisclosureKey } from "../../client/tools/disclosure";
import { toolCopyPlan } from "../../client/tools/copy";
import { getDisclosure, resetDisclosureStore, setDisclosure } from "../../client/state/disclosure-store";

function read(status: string, extra: Partial<ToolCallPayload> = {}): ToolCallPayload {
  return {
    name: "Read",
    status,
    callId: "toolu_1",
    error: null,
    detail: { type: "read", filePath: "/w/a.ts", ...(status === "running" ? {} : { content: "x" }) },
    ...extra,
  };
}

/** What the live renderer reads from `useDisclosure`, without React. */
function isExpanded(agentId: string, payload: ToolCallPayload, preference: "collapsed" | "expand-failed" = "collapsed") {
  const view = classifyTool(payload);
  return getDisclosure(toolDisclosureKey(agentId, view)) ?? defaultToolExpanded(view, preference);
}

describe("tool disclosure", () => {
  beforeEach(() => resetDisclosureStore());

  it("collapses running, completed and failed calls by default", () => {
    expect(isExpanded("a", read("running"))).toBe(false);
    expect(isExpanded("a", read("completed"))).toBe(false);
    expect(isExpanded("a", read("failed", { error: "x" }))).toBe(false);
  });

  it("opens failures only under the expand-failed preference", () => {
    expect(isExpanded("a", read("failed", { error: "x" }), "expand-failed")).toBe(true);
    expect(isExpanded("a", read("completed"), "expand-failed")).toBe(false);
  });

  it("keeps a call the reader opened while it ran open after it completes", () => {
    // running → the reader expands it
    const running = classifyTool(read("running"));
    setDisclosure(toolDisclosureKey("a", running), true);
    // completes, and the host remounts the row in history: a fresh read of
    // the same key, a new view object, a new default.
    expect(isExpanded("a", read("completed"))).toBe(true);
    // ... and a collapse the reader chose survives completion too.
    setDisclosure(toolDisclosureKey("a", running), false);
    expect(isExpanded("a", read("completed"), "expand-failed")).toBe(false);
  });

  it("keys by agent and call id, so another agent's call is separate", () => {
    setDisclosure(toolDisclosureKey("a", classifyTool(read("running"))), true);
    expect(isExpanded("b", read("completed"))).toBe(false);
  });

  it("falls back to name and input when there is no call id, ignoring output", () => {
    const base = { name: "frob", status: "running", error: null } as const;
    const first = classifyTool({ ...base, detail: { type: "unknown", input: { x: 1 }, output: "a" } });
    const later = classifyTool({ ...base, status: "completed", detail: { type: "unknown", input: { x: 1 }, output: "ab" } });
    expect(toolDisclosureKey("a", first)).toBe(toolDisclosureKey("a", later));
    expect(toolDisclosureKey("a", first)).toMatch(/^a:frob:/);
  });
});

describe("tool copy plan", () => {
  const resolve = (path: string) => (path.startsWith("/") ? path : `/w/${path}`);

  it("copies the command first, output and both from the menu", () => {
    const plan = toolCopyPlan(
      classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "ls", output: "\u001b[1ma\u001b[0m" } }),
      resolve,
    );
    expect(plan.primary).toMatchObject({ id: "command", text: "ls" });
    expect(plan.menu.map((entry) => [entry.id, entry.text])).toEqual([
      ["output", "a"],
      ["command-output", "$ ls\na"],
    ]);
  });

  it("copies the absolute path of a relative read, and the content from the menu", () => {
    const plan = toolCopyPlan(
      classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "src/a.ts", content: "x" } }),
      resolve,
    );
    expect(plan.primary).toMatchObject({ id: "path", text: "/w/src/a.ts" });
    expect(plan.menu).toEqual([{ id: "content", label: "Copy file content", text: "x" }]);
  });

  it("copies an edit's path, patch and new content", () => {
    const plan = toolCopyPlan(
      classifyTool({
        name: "Edit",
        status: "completed",
        detail: { type: "edit", filePath: "/w/a.ts", unifiedDiff: "@@ -1 +1 @@\n-a\n+b\n", newString: "b" },
      }),
      resolve,
    );
    expect(plan.primary?.text).toBe("/w/a.ts");
    expect(plan.menu.map((entry) => entry.id)).toEqual(["patch", "new-content"]);
  });

  it("copies an edit's path, the diff built from its text, and its new text", () => {
    const plan = toolCopyPlan(
      classifyTool({ name: "Edit", status: "completed", detail: { type: "edit", filePath: "/w/a.ts", oldString: "a\nb", newString: "a\nB" } }),
      resolve,
    );
    expect(plan.primary?.text).toBe("/w/a.ts");
    expect(plan.menu.map((entry) => [entry.id, entry.text])).toEqual([
      ["patch", " a\n-b\n+B"],
      ["new-content", "a\nB"],
    ]);
  });

  it("copies a sub-agent's description, then its prompt and log", () => {
    const plan = toolCopyPlan(
      classifyTool({
        name: "Task",
        status: "completed",
        detail: { type: "sub_agent", description: "Find x", prompt: "Look for x in src/.", log: "done" },
      }),
      resolve,
    );
    expect(plan.primary).toMatchObject({ id: "description", text: "Find x" });
    expect(plan.menu.map((entry) => [entry.id, entry.text])).toEqual([
      ["prompt", "Look for x in src/."],
      ["log", "done"],
    ]);
  });

  it("copies a search's query and its files as absolute paths", () => {
    const plan = toolCopyPlan(
      classifyTool({ name: "Grep", status: "completed", detail: { type: "search", query: "q", filePaths: ["a.ts", "/x/b.ts"] } }),
      resolve,
    );
    expect(plan.primary?.text).toBe("q");
    expect(plan.menu[0]?.text).toBe("/w/a.ts\n/x/b.ts");
  });

  it("copies a web search's query, then its text summary and links", () => {
    const plan = toolCopyPlan(
      classifyTool({
        name: "WebSearch",
        status: "completed",
        detail: {
          type: "search",
          query: "q",
          toolName: "web_search",
          webResults: [{ title: "A", url: "https://a.dev" }],
          annotations: ["First **part**.", "Second part."],
        },
      }),
      resolve,
    );
    expect(plan.primary?.text).toBe("q");
    expect(plan.menu.map((entry) => [entry.id, entry.label, entry.text])).toEqual([
      ["summary", "Copy summary", "First **part**.\n\nSecond part."],
      ["files", "Copy file list", "https://a.dev"],
    ]);
  });

  it("copies an MCP result first and its arguments from the menu", () => {
    const plan = toolCopyPlan(
      classifyTool({ name: "mcp__s__t", status: "completed", detail: { type: "unknown", input: { q: 1 }, output: "res" } }),
      resolve,
    );
    expect(plan.primary).toMatchObject({ id: "result", text: "res" });
    expect(plan.menu[0]).toMatchObject({ id: "args", text: '{\n  "q": 1\n}' });
  });

  it("copies a fetch's URL first", () => {
    const plan = toolCopyPlan(
      classifyTool({ name: "WebFetch", status: "completed", detail: { type: "fetch", url: "https://x.dev", result: "r" } }),
      resolve,
    );
    expect(plan.primary?.text).toBe("https://x.dev");
    expect(plan.menu[0]?.text).toBe("r");
  });
});
