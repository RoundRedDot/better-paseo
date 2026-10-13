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
import { sourceLineTops } from "../../client/ui/preview-lines";

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
  it("shows a failed command's error, not \"completed without output\", in the preview and the opened card", () => {
    const data = classifyTool({ name: "Bash", status: "failed", error: "Exit code 2\nerror: not found",
      detail: { type: "shell", command: "false" } });
    const preview = previewOf(React.createElement(ToolCallout, { data, tokens }));
    expect(preview).toContain("Exit code 2\nerror: not found");
    expect(preview).not.toContain("Command completed without output.");
    let row!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} })); });
    const opened = textOf(row.toJSON());
    expect(opened).toContain("Exit code 2\nerror: not found");
    expect(opened).not.toContain("Command completed without output.");
    act(() => row.unmount());
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

const styleOf = (node: JsonNode) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));

/** A preview's lines as drawn: the one selectable text, the number column, and the shaded bands. */
function previewLines(element: React.ReactElement, layout?: (renderer: ReturnType<typeof TestRenderer.create>) => void) {
  let row!: ReturnType<typeof TestRenderer.create>;
  let body!: ReturnType<typeof TestRenderer.create>;
  act(() => { row = TestRenderer.create(element); });
  act(() => { body = TestRenderer.create(React.createElement(React.Fragment, null, row.root.findByType(DisclosureHeader).props.previewContent())); });
  if (layout) act(() => layout(body));
  const json = body.toJSON();
  act(() => { row.unmount(); body.unmount(); });
  const lines = findJson(json, (node) => node.props.testID === "preview-lines");
  if (!lines) return { placed: false as const, text: textOf(json) };
  const gutter = findJson(lines, (node) => node.props.testID === "preview-line-numbers");
  const stripes = findJson(lines, (node) => node.props.testID === "preview-line-stripes");
  const content = findJson(lines, (node) => node.type === "Text" && node.props.selectable === true)!;
  return {
    placed: true as const,
    content: textOf(content),
    numbers: gutter ? (gutter.children as JsonNode[]).map((node) => [textOf(node), styleOf(node).top]) : null,
    stripes: stripes ? (stripes.children as JsonNode[]).map((node) => [styleOf(node).top, styleOf(node).height]) : null,
  };
}

describe("preview line numbers and shading", () => {
  beforeEach(() => resetEnhancerPreferences());
  const line = tokens.typography.mono.lineHeight;

  it("shades every other line behind one text, with no numbers by default", () => {
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "one\ntwo\nthree\nfour\n" } });
    expect(previewLines(React.createElement(ToolCallout, { data, tokens }))).toEqual({
      placed: true, content: "one\ntwo\nthree\nfour", numbers: null, stripes: [[line, line], [3 * line, line]],
    });
  });

  it("numbers a partial read from the line it starts at, in a column beside the text", () => {
    updateEnhancerPreferences({ previewLineNumbers: true, previewStripes: false });
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "ten\neleven", offset: 10, limit: 2 } });
    expect(previewLines(React.createElement(ToolCallout, { data, tokens }))).toEqual({
      placed: true, content: "ten\neleven", numbers: [["10", 0], ["11", line]], stripes: null,
    });
  });

  it("numbers a diff with the file's own lines and leaves its chrome blank", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const diff = "@@ -4,2 +4,2 @@\n-old\n+new\n keep";
    const data = classifyTool({ name: "Edit", status: "completed", detail: { type: "edit", filePath: "/w/a.ts", unifiedDiff: diff } });
    const drawn = previewLines(React.createElement(ToolCallout, { data, tokens }));
    expect(drawn.placed && drawn.numbers?.map(([number]) => number)).toEqual(["", "4", "4", "5"]);
  });

  it("keeps command output coloured in one text", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "make", output: "PASS a\nFAIL b\n" } });
    const drawn = previewLines(React.createElement(ToolCallout, { data, tokens }));
    expect(drawn).toMatchObject({ content: "PASS a\nFAIL b", numbers: [["1", 0], ["2", line]], stripes: [[line, line]] });
  });

  it("moves numbers and bands to where a wrapped line pushes the lines below it", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "a long line\nb\nc" } });
    const drawn = previewLines(React.createElement(ToolCallout, { data, tokens }), (body) => {
      const text = body.root.find((node) => (node.type as unknown) === "Text" && typeof node.props.onTextLayout === "function");
      // iOS reports each laid-out line's text only: the first source line takes two.
      text.props.onTextLayout({ nativeEvent: { lines: ["a long ", "line\n", "b\n", "c"] } });
      body.root.findByProps({ testID: "preview-lines" }).findAll((node) => typeof node.props.onLayout === "function")[0]!
        .props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 4 * line } } });
    });
    expect(drawn).toMatchObject({ numbers: [["1", 0], ["2", 2 * line], ["3", 3 * line]], stripes: [[2 * line, line]] });
  });

  it("draws the content as one text, with nothing placed, when both are off", () => {
    updateEnhancerPreferences({ previewLineNumbers: false, previewStripes: false });
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "one\ntwo" } });
    const shell = classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "make", output: "PASS a\nFAIL b\n" } });
    for (const data of [read, shell]) {
      const drawn = previewLines(React.createElement(ToolCallout, { data, tokens }));
      expect(drawn.placed).toBe(false);
      expect(drawn.text).toMatch(/one\ntwo|PASS a\nFAIL b/);
    }
  });
});

describe("source line tops", () => {
  it("starts a source line after each laid-out line that ends one", () => {
    expect(sourceLineTops([{ text: "ab" }, { text: "c\n" }, { text: "\n" }, { text: "d" }], 10, 3)).toEqual([0, 20, 30]);
  });
  it("takes a platform's own line tops when it gives them", () => {
    expect(sourceLineTops([{ text: "a\n", y: 0 }, { text: "b", y: 19 }], 18, 2)).toEqual([0, 19]);
  });
  it("ignores a layout of other content", () => {
    expect(sourceLineTops([{ text: "a\n" }, { text: "b" }], 18, 3)).toBeNull();
  });
});
