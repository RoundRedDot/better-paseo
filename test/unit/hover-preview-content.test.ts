import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: clipboard.copyText, useToast: () => ({ show: clipboard.show, error: clipboard.error }), useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolCallout } from "../../client/components/tool-callouts";
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { DisclosureHeader } from "../../client/ui/disclosure-header";
import { HoverPreviewHeader } from "../../client/ui/hover-preview";
import { classifyTool } from "../../client/tools/classify";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
beforeEach(() => vi.clearAllMocks());

async function exercisePreview(element: React.ReactElement, verify: (
  body: ReturnType<typeof TestRenderer.create>, row: ReturnType<typeof TestRenderer.create>,
) => Promise<void>) {
  let row!: ReturnType<typeof TestRenderer.create>;
  let body!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { row = TestRenderer.create(element); });
  const header = row.root.findByType(DisclosureHeader);
  await act(async () => { body = TestRenderer.create(React.createElement(React.Fragment, null, header.props.previewContent())); });
  try {
    await verify(body, row);
  } finally {
    act(() => { row.unmount(); body.unmount(); });
  }
}

async function press(renderer: ReturnType<typeof TestRenderer.create>, label: string) {
  const button = renderer.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
  await act(async () => { button.props.onPress(); });
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "children" in value) return textOf(value.children);
  return "";
}
function previewOf(element: React.ReactElement) {
  let row!: ReturnType<typeof TestRenderer.create>;
  let body!: ReturnType<typeof TestRenderer.create>;
  act(() => { row = TestRenderer.create(element); });
  expect(row.root.findAllByProps({ testID: "hover-preview" })).toHaveLength(0);
  const header = row.root.findByType(DisclosureHeader);
  act(() => { body = TestRenderer.create(React.createElement(React.Fragment, null, header.props.previewContent())); });
  const text = textOf(body.toJSON());
  act(() => { row.unmount(); body.unmount(); });
  return text;
}
describe("full hover preview content", () => {
  it("lays every copy out on the preview's toolbar, each with its own icon", async () => {
    const data = classifyTool({ name: "Bash", status: "completed", detail: {
      type: "shell", command: "printf full-command", output: "\u001b[1mfull-output\u001b[0m\n",
    } });
    await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body, row) => {
      const header = body.root.findByType(HoverPreviewHeader);
      const buttons = header.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel?.startsWith("Copy"));
      expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(["Copy command", "Copy output", "Copy command and output"]);
      const icons = buttons.map((node) => node.find((child) => typeof child.props.name === "string").props.name);
      expect(new Set(icons).size).toBe(icons.length);
      expect(header.findAll((node) => node.props.accessibilityLabel === "More actions")).toHaveLength(0);
      await press(body, "Copy command");
      expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
      await press(body, "Copy output");
      expect(clipboard.copyText).toHaveBeenLastCalledWith("full-output");
      await press(body, "Copy command and output");
      expect(clipboard.copyText).toHaveBeenLastCalledWith("$ printf full-command\nfull-output");
      // The row's own header offers the same buttons, and no `⋯` either.
      let rowActions!: ReturnType<typeof TestRenderer.create>;
      act(() => { rowActions = TestRenderer.create(row.root.findByType(DisclosureHeader).props.actions); });
      expect(rowActions.root.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.accessibilityLabel))
        .toEqual(["Copy command", "Copy output", "Copy command and output"]);
      act(() => rowActions.unmount());
      expect(row.root.findByType(DisclosureHeader).props.expanded).toBe(false);
    });
  });
  it("copies the absolute path and file content from a read preview", async () => {
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "const value = 1;" } });
    await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body) => {
      await press(body, "Copy path");
      expect(clipboard.copyText).toHaveBeenLastCalledWith("/w/a.ts");
      await press(body, "Copy file content");
      expect(clipboard.copyText).toHaveBeenLastCalledWith("const value = 1;");
    });
  });
  it("copies the whole thought from its preview", async () => {
    const thought = "Reasoning body. ".repeat(80);
    await exercisePreview(React.createElement(ReasoningCard, { segmentation: { kind: "prose", body: thought },
      streaming: false, durationMs: null, expanded: false, onToggle() {}, tokens, storeKey: "preview-copy", copyText: thought }), async (body) => {
      await press(body, "Copy thought");
      expect(body.root.findByType(HoverPreviewHeader).props.tokens).toBe(tokens);
      expect(clipboard.copyText).toHaveBeenLastCalledWith(thought.trim());
    });
  });
  it("includes both ends of a long command output without the earlier-lines control", () => {
    const output = Array.from({ length: 100 }, (_, i) => `output-line-${i}`).join("\n");
    const data = classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "printf full-command", output } });
    const text = previewOf(React.createElement(ToolCallout, { data, tokens }));
    expect(text).toContain("printf full-command");
    expect(text).toContain("output-line-0");
    expect(text).toContain("output-line-99");
    expect(text).not.toContain("earlier lines");
  });
  it("includes the full path and a file larger than the normal code fold limit", () => {
    const content = Array.from({ length: 500 }, (_, i) => `file-line-${i}`).join("\n");
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/full-path.ts", content } });
    const text = previewOf(React.createElement(ToolCallout, { data, tokens }));
    expect(text).toContain("/w/full-path.ts");
    expect(text).toContain("file-line-0");
    expect(text).toContain("file-line-499");
  });
  it("shows a long thought without a Show more control", () => {
    const thought = "Long reasoning paragraph. ".repeat(80) + "FINAL_SENTENCE";
    const text = previewOf(React.createElement(ReasoningCard, { segmentation: { kind: "prose", body: thought },
      streaming: false, durationMs: null, expanded: false, onToggle() {}, tokens, storeKey: "preview", copyText: thought }));
    expect(text).toContain("FINAL_SENTENCE");
    expect(text).not.toContain("Show more");
  });
});

type JsonNode = { type: string; props: Record<string, unknown>; children: Array<JsonNode | string> | null };

function findJson(node: unknown, match: (node: JsonNode) => boolean): JsonNode | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findJson(child, match);
      if (found) return found;
    }
    return null;
  }
  const json = node as JsonNode;
  return match(json) ? json : findJson(json.children, match);
}

/** Each row of a preview's lines: its gutter number, its text, and whether it is shaded. */
function previewRows(element: React.ReactElement) {
  let row!: ReturnType<typeof TestRenderer.create>;
  let body!: ReturnType<typeof TestRenderer.create>;
  act(() => { row = TestRenderer.create(element); });
  act(() => { body = TestRenderer.create(React.createElement(React.Fragment, null, row.root.findByType(DisclosureHeader).props.previewContent())); });
  const json = body.toJSON();
  act(() => { row.unmount(); body.unmount(); });
  const lines = findJson(json, (node) => node.props.testID === "preview-lines");
  const rows = lines === null ? null : (lines.children as JsonNode[]).map((rowNode) => {
    const style = Object.assign({}, ...[rowNode.props.style].flat(Infinity).filter(Boolean));
    const [first, second] = rowNode.children as JsonNode[];
    const number = second ? first! : null;
    return { number: number ? textOf(number) : null, text: textOf(second ?? first), shaded: Boolean(style.backgroundColor) };
  });
  return { rows, text: textOf(json) };
}

describe("preview line numbers and shading", () => {
  beforeEach(() => resetEnhancerPreferences());

  it("shades every other line and draws no numbers by default", () => {
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "one\ntwo\nthree\n" } });
    const { rows } = previewRows(React.createElement(ToolCallout, { data, tokens }));
    expect(rows).toEqual([
      { number: null, text: "one", shaded: false },
      { number: null, text: "two", shaded: true },
      { number: null, text: "three", shaded: false },
    ]);
  });

  it("numbers a partial read from the line it starts at", () => {
    updateEnhancerPreferences({ previewLineNumbers: true, previewStripes: false });
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "ten\neleven", offset: 10, limit: 2 } });
    const { rows } = previewRows(React.createElement(ToolCallout, { data, tokens }));
    expect(rows).toEqual([
      { number: "10", text: "ten", shaded: false },
      { number: "11", text: "eleven", shaded: false },
    ]);
  });

  it("numbers a diff with the file's own lines and leaves its chrome blank", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const diff = "@@ -4,2 +4,2 @@\n-old\n+new\n keep";
    const data = classifyTool({ name: "Edit", status: "completed", detail: { type: "edit", filePath: "/w/a.ts", unifiedDiff: diff } });
    const { rows } = previewRows(React.createElement(ToolCallout, { data, tokens }));
    expect(rows?.map((row) => [row.number, row.text])).toEqual([["", "@@ -4,2 +4,2 @@"], ["4", "-old"], ["4", "+new"], ["5", " keep"]]);
  });

  it("numbers and shades command output, keeping its colours", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "make", output: "PASS a\nFAIL b\n" } });
    const { rows } = previewRows(React.createElement(ToolCallout, { data, tokens }));
    expect(rows).toEqual([
      { number: "1", text: "PASS a", shaded: false },
      { number: "2", text: "FAIL b", shaded: true },
    ]);
  });

  it("draws the content as one text when both are off", () => {
    updateEnhancerPreferences({ previewLineNumbers: false, previewStripes: false });
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "one\ntwo" } });
    const shell = classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "make", output: "PASS a\nFAIL b\n" } });
    for (const data of [read, shell]) {
      const { rows, text } = previewRows(React.createElement(ToolCallout, { data, tokens }));
      expect(rows).toBeNull();
      expect(text).toMatch(/one\ntwo|PASS a\nFAIL b/);
    }
  });
});
