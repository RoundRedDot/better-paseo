import { describe, expect, it } from "vitest";
import { classifyTool, type ToolCallPayload } from "../../client/tools/classify";
import { fitsRow, toolHasDetail } from "../../client/tools/detail";

const BUDGET = 72;

function view(detail: Record<string, unknown>, extra: Partial<ToolCallPayload> = {}) {
  return classifyTool({ name: "tool", status: "completed", callId: "c1", error: null, detail, ...extra });
}

describe("toolHasDetail", () => {
  it("has none for a sub-agent whose only payload is its one-line description", () => {
    const agent = view({ type: "sub_agent", description: "截图并读取界面", log: "" });
    expect(toolHasDetail(agent, BUDGET)).toBe(false);
  });

  it("has detail once a sub-agent logs, acts, or describes past one line", () => {
    expect(toolHasDetail(view({ type: "sub_agent", description: "a", log: "done" }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "sub_agent", description: "a", log: "", actions: [{ toolName: "Read" }] }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "sub_agent", description: "a\nb", log: "" }), BUDGET)).toBe(true);
  });

  it("has detail once a sub-agent carries a prompt beyond its description", () => {
    expect(toolHasDetail(view({ type: "sub_agent", description: "截图并读取界面", log: "", prompt: "打开模拟器，截图后读出界面上的文字。" }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "sub_agent", description: "截图并读取界面", log: "", prompt: "截图并读取界面" }), BUDGET)).toBe(false);
    expect(toolHasDetail(view({ type: "sub_agent", description: "截图并读取界面", log: "", prompt: " " }), BUDGET)).toBe(false);
  });

  it("has detail for a web search that brought back only its text summary", () => {
    expect(toolHasDetail(view({ type: "search", query: "q", toolName: "web_search" }), BUDGET)).toBe(false);
    expect(toolHasDetail(view({ type: "search", query: "q", toolName: "web_search", annotations: ["Paseo is a host."] }), BUDGET)).toBe(true);
  });

  it("counts full-width characters as two cells", () => {
    expect(fitsRow("界".repeat(36), BUDGET)).toBe(true);
    expect(fitsRow("界".repeat(37), BUDGET)).toBe(false);
    expect(fitsRow("a".repeat(72), BUDGET)).toBe(true);
  });

  it("has none for a short silent shell command, detail for output or a long command", () => {
    const silent = view({ type: "shell", command: "true" }, { name: "Bash" });
    expect(toolHasDetail(silent, BUDGET)).toBe(false);
    expect(toolHasDetail(view({ type: "shell", command: "ls", output: "a.ts" }, { name: "Bash" }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "shell", command: "x".repeat(100) }, { name: "Bash" }), BUDGET)).toBe(true);
  });

  it("has none for one-line plain text, detail for more", () => {
    expect(toolHasDetail(view({ type: "plain_text", text: "Started" }), BUDGET)).toBe(false);
    expect(toolHasDetail(view({ type: "plain_text", text: "Started\nwith flags" }), BUDGET)).toBe(true);
  });

  it("has none for an empty read, detail for content or an image", () => {
    expect(toolHasDetail(view({ type: "read", filePath: "/w/a.ts" }, { name: "Read" }), BUDGET)).toBe(false);
    expect(toolHasDetail(view({ type: "read", filePath: "/w/a.ts", content: "x" }, { name: "Read" }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "read", filePath: "/w/a.png" }, { name: "Read" }), BUDGET)).toBe(true);
  });

  it("has detail for an edit that sent only its old and new text", () => {
    expect(toolHasDetail(view({ type: "edit", filePath: "/w/a.ts", oldString: "a", newString: "b" }, { name: "Edit" }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "edit", filePath: "/w/a.ts", newString: "b" }, { name: "Edit" }), BUDGET)).toBe(true);
    expect(toolHasDetail(view({ type: "edit", filePath: "/w/a.ts" }, { name: "Edit" }), BUDGET)).toBe(false);
  });

  it("has detail for an OMP github call sent as plain text", () => {
    expect(toolHasDetail(view({ type: "plain_text", label: "status", text: "Working tree clean" }, { name: "github" }), BUDGET)).toBe(true);
  });

  it("has none for an unknown call with no input and no output", () => {
    expect(toolHasDetail(view({}, { name: "frob" }), BUDGET)).toBe(false);
    expect(toolHasDetail(view({ type: "unknown", input: { x: 1 } }, { name: "frob" }), BUDGET)).toBe(true);
  });

  it("opens a failure only when its error says more than the row's error line", () => {
    const short = view({ type: "shell", command: "false" }, { name: "Bash", status: "failed", error: "boom" });
    expect(toolHasDetail(short, BUDGET)).toBe(false);
    const long = view({ type: "shell", command: "false" }, { name: "Bash", status: "failed", error: "boom\nat x" });
    expect(toolHasDetail(long, BUDGET)).toBe(true);
  });
});
