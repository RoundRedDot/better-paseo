import { describe, expect, it } from "vitest";
import { copyPlan, newContentFromPatch, stripAnsi, type CopySource } from "../../client/copy/content";

const PATCH = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+++ x",
  " export { a, b };",
  "\\ No newline at end of file",
  "",
].join("\n");

/** One row per line of the plan §3.8 table: [source, primary, menu]. */
const TABLE: Array<[string, CopySource, string | null, Array<[string, string]>]> = [
  [
    "bash: command; output; command + output, without ANSI",
    { kind: "shell", command: " npm test ", stdout: "\u001b[32mok\u001b[0m\n", stderr: "warn\n" },
    "npm test",
    [
      ["output", "ok\nwarn"],
      ["command-output", "$ npm test\nok\nwarn"],
    ],
  ],
  ["shell without output", { kind: "shell", command: "true" }, "true", []],
  [
    "read: absolute path; file content",
    { kind: "read", absolutePath: "/p/src/a.ts", content: "x\n" },
    "/p/src/a.ts",
    [["content", "x\n"]],
  ],
  ["write: absolute path", { kind: "write", absolutePath: "/p/b.ts" }, "/p/b.ts", []],
  [
    "edit: absolute path; patch; new content from the diff",
    { kind: "edit", absolutePath: "/p/src/a.ts", patch: PATCH },
    "/p/src/a.ts",
    [
      ["patch", PATCH],
      ["new-content", "const a = 1;\nconst b = 3;\n++ x\nexport { a, b };"],
    ],
  ],
  [
    "edit: protocol newString wins over the diff",
    { kind: "edit", absolutePath: "/p/a.ts", patch: PATCH, newString: "NEW" },
    "/p/a.ts",
    [
      ["patch", PATCH],
      ["new-content", "NEW"],
    ],
  ],
  [
    "search: query; absolute file list",
    { kind: "search", query: "useAgent", files: ["/p/a.ts", "/p/b.ts"] },
    "useAgent",
    [["files", "/p/a.ts\n/p/b.ts"]],
  ],
  [
    "search: query; the text summary, then the links",
    { kind: "search", query: "paseo", summary: " Paseo is a host.\n", files: ["https://paseo.dev"] },
    "paseo",
    [
      ["summary", "Paseo is a host."],
      ["files", "https://paseo.dev"],
    ],
  ],
  [
    "mcp / paseo: result; arguments as JSON",
    { kind: "mcp", result: "done", args: { q: 1 } },
    "done",
    [["args", '{\n  "q": 1\n}']],
  ],
  [
    "reasoning: the section's raw text, no numbering",
    { kind: "reasoning", text: "**Plan**\n\nRead the file first.\n" },
    "**Plan**\n\nRead the file first.",
    [],
  ],
  ["code block: the code", { kind: "code", code: "let x = 1;" }, "let x = 1;", []],
  ["PathText: absolute path", { kind: "path", absolutePath: "/p/a.ts" }, "/p/a.ts", []],
  ["nothing to copy", { kind: "mcp" }, null, []],
];

describe("copyPlan", () => {
  for (const [name, source, primary, menu] of TABLE) {
    it(name, () => {
      const plan = copyPlan(source);
      expect(plan.primary?.text ?? null).toBe(primary);
      expect(plan.menu.map((entry) => [entry.id, entry.text])).toEqual(menu);
    });
  }

  it("never prefixes step numbers to reasoning", () => {
    expect(copyPlan({ kind: "reasoning", text: "First.\n\nSecond." }).primary?.text).toBe("First.\n\nSecond.");
  });
});

describe("stripAnsi", () => {
  it("removes colour, cursor and OSC hyperlink sequences", () => {
    expect(stripAnsi("\u001b[1;31merror\u001b[0m")).toBe("error");
    expect(stripAnsi("a\u001b[2Kb\u001b[1A")).toBe("ab");
    expect(stripAnsi("\u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007")).toBe("link");
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("newContentFromPatch", () => {
  it("joins the new side of several hunks and files", () => {
    const patch = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/y b/y",
      "--- a/y",
      "+++ b/y",
      "@@ -1,2 +1,2 @@",
      " keep",
      "+add",
    ].join("\n");
    expect(newContentFromPatch(patch)).toBe("new\nkeep\nadd");
  });

  it("treats a removed '-- x' line inside a hunk as content, not a header", () => {
    expect(newContentFromPatch("@@ -1,2 +1,1 @@\n--- comment\n keep\n")).toBe("keep");
  });
});

describe("copyPlan for the newer tool kinds", () => {
  it("copies a fetch's URL first and its result from the menu", () => {
    expect(copyPlan({ kind: "fetch", url: " https://x.dev/a ", result: "body" })).toEqual({
      primary: { id: "url", label: "Copy URL", text: "https://x.dev/a" },
      menu: [{ id: "result", label: "Copy result", text: "body" }],
    });
  });

  it("copies a worktree's path and its log without ANSI", () => {
    expect(copyPlan({ kind: "worktree", absolutePath: "/w/.worktrees/f", log: "\u001b[32mok\u001b[0m\n\n" })).toEqual({
      primary: { id: "path", label: "Copy path", text: "/w/.worktrees/f" },
      menu: [{ id: "log", label: "Copy log", text: "ok" }],
    });
  });

  it("copies a sub-agent's description and log", () => {
    const plan = copyPlan({ kind: "sub-agent", description: " Find x ", log: "step 1\n" });
    expect(plan.primary).toEqual({ id: "description", label: "Copy description", text: "Find x" });
    expect(plan.menu).toEqual([{ id: "log", label: "Copy log", text: "step 1" }]);
  });

  it("copies a sub-agent's prompt between its description and log", () => {
    const plan = copyPlan({ kind: "sub-agent", description: "Find x", prompt: "Look for x.\n", log: "step 1\n" });
    expect(plan.primary?.id).toBe("description");
    expect(plan.menu).toEqual([
      { id: "prompt", label: "Copy prompt", text: "Look for x." },
      { id: "log", label: "Copy log", text: "step 1" },
    ]);
  });

  it("has nothing to copy for an empty source", () => {
    expect(copyPlan({ kind: "fetch", url: "" }).primary).toBeNull();
    expect(copyPlan({ kind: "sub-agent" })).toEqual({ primary: null, menu: [] });
  });
});
