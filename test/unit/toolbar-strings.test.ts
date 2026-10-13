import { describe, expect, it } from "vitest";
import { copyPlan, type CopySource } from "../../client/copy/content";
import { toolbarLabel } from "../../client/i18n/toolbar-strings";

// Every copy a preview toolbar can offer, each source filled in so no entry is dropped.
const SOURCES: CopySource[] = [
  { kind: "shell", command: "ls", stdout: "a" },
  { kind: "read", absolutePath: "/a", content: "x" },
  { kind: "write", absolutePath: "/a", content: "x" },
  { kind: "edit", absolutePath: "/a", patch: "@@ -1 +1 @@\n-a\n+b", newString: "b" },
  { kind: "search", query: "q", files: ["/a"] },
  { kind: "mcp", result: "r", args: { a: 1 } },
  { kind: "reasoning", text: "t" },
  { kind: "code", code: "c" },
  { kind: "path", absolutePath: "/a" },
  { kind: "fetch", url: "https://a", result: "r" },
  { kind: "worktree", absolutePath: "/a", log: "l" },
  { kind: "sub-agent", description: "d", log: "l" },
  { kind: "ask", question: "q", answer: "a" },
  { kind: "eval", code: "c", output: "o" },
];
const TOOLBAR = ["Copied", "Copy thought", "Previous operation", "Next operation", "Wrap lines",
  "Do not wrap lines", "Maximize preview", "Close preview"];

describe("toolbar hover names", () => {
  it("has a Chinese name for every copy and toolbar button", () => {
    const labels = [...new Set([...SOURCES.flatMap((source) => {
      const plan = copyPlan(source);
      return [plan.primary, ...plan.menu].flatMap((action) => action ? [action.label] : []);
    }), ...TOOLBAR])];
    const missing = labels.filter((label) => toolbarLabel(label, "zh") === label);
    expect(missing).toEqual([]);
  });

  it("follows the language setting, and the device locale under Follow system", () => {
    expect(toolbarLabel("Copy path", "zh")).toBe("复制路径");
    expect(toolbarLabel("Copy path", "en")).toBe("Copy path");
    expect(toolbarLabel("Copy path", "system", "zh-CN")).toBe("复制路径");
    expect(toolbarLabel("Copy path", "system", "en-US")).toBe("Copy path");
    expect(toolbarLabel("Something new", "zh")).toBe("Something new");
  });
});
