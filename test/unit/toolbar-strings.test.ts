import { describe, expect, it } from "vitest";
import { copyPlan, type CopySource } from "../../client/copy/content";
import { copiedToast, toolbarLabel } from "../../client/i18n/toolbar-strings";

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
];
const TOOLBAR = ["Copied", "Couldn't copy", "Copy thought", "Copy section", "Copy reply", "Copy prompt", "Previous operation", "Next operation", "Wrap lines",
  "Do not wrap lines", "Maximize preview", "Close preview", "Open tasks in a window", "Copy Markdown table", "Copy as Markdown", "Copy as image",
  // The selection bar's buttons and what they turn into after a press.
  "Copy", "Add to chat", "Added", "Copied instead", "Copy model name", "Thinking level", "Elapsed time"];

describe("toolbar hover names", () => {
  it("includes the copied model name without changing its spelling", () => {
    const label = "Copy model name: GPT-6.1-Sol";
    expect(copiedToast(label, "zh")).toBe("已复制模型名称：GPT-6.1-Sol");
    expect(copiedToast(label, "en")).toBe("Copied model name: GPT-6.1-Sol");
    expect(copiedToast(label, "system", "zh-CN")).toBe("已复制模型名称：GPT-6.1-Sol");
  });
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

  it("words each copy's toast after what it copied, in both languages", () => {
    const labels = [...new Set(SOURCES.flatMap((source) => {
      const plan = copyPlan(source);
      return [plan.primary, ...plan.menu].flatMap((action) => action ? [action.label] : []);
    }))].filter((label) => label !== "Copy");
    for (const language of ["en", "zh"] as const) {
      const toasts = labels.map((label) => copiedToast(label, language));
      expect(new Set(toasts).size).toBe(toasts.length);
    }
    expect(copiedToast("Copy path", "zh")).toBe("已复制路径");
    expect(copiedToast("Copy command and output", "en")).toBe("Copied command and output");
    expect(copiedToast("2. Copy patch", "zh")).toBe("已复制补丁");
    expect(copiedToast("Copy", "zh")).toBe("已复制");
    expect(copiedToast("Copy", "en")).toBe("Copied");
  });
});
