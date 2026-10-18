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
import { ToolCallout, ToolPreviewContent } from "../../client/components/tool-callouts";
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { DisclosureHeader, RowIcon } from "../../client/ui/disclosure-header";
import { AlwaysWrapPreview, HoverPreviewHeader, PreviewPanelSample } from "../../client/ui/hover-preview";
import { ToolbarButton } from "../../client/ui/toolbar-button";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { classifyTool, type ToolKind } from "../../client/tools/classify";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { layoutBottom, placeLineTops, PreviewLines, sameLineTops, sourceLineTops } from "../../client/ui/preview-lines";
import { SyntaxHighlightBlock } from "../../client/components/syntax-highlight";

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
  it.each(["md", "markdown", "MD"])("toggles a Write .%s preview with one button and copies the source in both modes", async (extension) => {
    const content = "# Title\n\n**bold**\n\n| A | B |\n| --- | --- |\n| one | two |";
    const data = classifyTool({ name: "Write", status: "completed", detail: {
      type: "write", filePath: `/w/notes.${extension}`, content,
    } });
    updateEnhancerPreferences({ previewLineNumbers: true, previewStripes: true });
    try {
      await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body) => {
        expect(body.root.findByType(MarkdownView).props.text).toBe(content);
        expect(body.root.findByType(AlwaysWrapPreview).props.keepControl).toBe(true);
        const toggle = () => body.root.findAllByType(ToolbarButton).filter((node) =>
          node.props.label === "Show raw text" || node.props.label === "Render Markdown");
        expect(toggle()).toHaveLength(1);
        expect(toggle()[0]!.props.icon).toBe("Code");
        await press(body, "Copy file content");
        expect(clipboard.copyText).toHaveBeenLastCalledWith(content);
        await press(body, "Show raw text");
        expect(toggle()).toHaveLength(1);
        expect(toggle()[0]!.props.icon).toBe("FileText");
        expect(body.root.findAllByType(MarkdownView)).toHaveLength(0);
        expect(body.root.findByType(PreviewLines).props.text).toBe(content);
        expect(body.root.findByProps({ testID: "preview-line-numbers" })).toBeDefined();
        expect(body.root.findByProps({ testID: "preview-line-stripes" })).toBeDefined();
        await press(body, "Copy file content");
        expect(clipboard.copyText).toHaveBeenLastCalledWith(content);
        await press(body, "Render Markdown");
        expect(body.root.findByType(MarkdownView).props.text).toBe(content);
        expect(textOf(body.toJSON())).toContain(`/w/notes.${extension}`);
      });
    } finally {
      resetEnhancerPreferences();
    }
  });

  it.each(["web", "ios", "android"])("keeps the wrap slot disabled for Markdown and restores raw wrapping on %s", async (os) => {
    const platform = globalThis as { __rnMockOS?: string };
    platform.__rnMockOS = os;
    updateEnhancerPreferences({ previewWrap: false });
    const data = classifyTool({ callId: "write", name: "Write", status: "completed", detail: {
      type: "write", filePath: "/w/a.md", content: "# Title\n\n**bold**",
    } });
    let body!: ReturnType<typeof TestRenderer.create>;
    try {
      act(() => { body = TestRenderer.create(React.createElement(PreviewPanelSample, { tokens,
        children: React.createElement(ToolPreviewContent, { data, tokens, compact: false, resolvePath: (path) => path }),
      })); });
      const start = () => body.root.findByProps({ testID: "hover-preview-start" });
      const controls = () => start().findAll((node) => (node.type as unknown) === "Pressable");
      expect(controls().map((node) => node.props.accessibilityLabel)).toEqual(["Do not wrap lines", "Show raw text"]);
      expect(controls()[0]!.props.disabled).toBe(true);
      await press(body, "Show raw text");
      expect(controls().map((node) => node.props.accessibilityLabel)).toEqual(["Wrap lines", "Render Markdown"]);
      expect(controls()[0]!.props.disabled).toBe(false);
      await press(body, "Wrap lines");
      expect(controls()[0]!.props.accessibilityLabel).toBe("Do not wrap lines");
      await press(body, "Render Markdown");
      expect(controls()[0]!.props.disabled).toBe(true);
      await press(body, "Show raw text");
      expect(controls()[0]!.props.accessibilityLabel).toBe("Do not wrap lines");
      expect(controls()[0]!.props.disabled).toBe(false);
    } finally {
      act(() => body?.unmount());
      delete platform.__rnMockOS;
      resetEnhancerPreferences();
    }
  });

  it("updates a streaming Markdown write in either mode and settles when completed", async () => {
    const view = (content: string, status: "running" | "completed") => React.createElement(ToolPreviewContent, {
      data: classifyTool({ callId: "write", name: "Write", status, detail: { type: "write", filePath: "/w/a.md", content } }),
      tokens, compact: false, resolvePath: (path: string) => path,
    });
    let body!: ReturnType<typeof TestRenderer.create>;
    act(() => { body = TestRenderer.create(view("# First", "running")); });
    try {
      expect(body.root.findByType(MarkdownView).props.streaming).toBe(true);
      act(() => body.update(view("# First\n\n**latest**", "running")));
      expect(body.root.findByType(MarkdownView).props.text).toContain("**latest**");
      await press(body, "Show raw text");
      act(() => body.update(view("# First\n\n**latest**\nTail", "running")));
      expect(body.root.findByType(PreviewLines).props.text).toContain("Tail");
      act(() => body.update(view("# First\n\n**latest**\nTail", "completed")));
      expect(body.root.findAllByProps({ testID: "hover-preview-streaming" })).toHaveLength(0);
      await press(body, "Render Markdown");
      expect(body.root.findByType(MarkdownView).props).toMatchObject({ streaming: false, text: "# First\n\n**latest**\nTail" });
    } finally {
      act(() => body.unmount());
    }
  });

  it.each([
    ["Write", "/w/a.ts", "const x = 1;", undefined],
    ["Read", "/w/a.md", "# Title", undefined],
    ["Edit", "/w/a.md", "# Title", "-old\n+new"],
    ["Write", "/w/empty.md", "", undefined],
    ["Write", "/w/diff.md", "# Title", "-old\n+new"],
  ])("keeps %s %s on its existing file view", async (name, filePath, content, unifiedDiff) => {
    const data = classifyTool({ name, status: "completed", detail: { type: name.toLowerCase(), filePath, content, unifiedDiff } });
    await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body) => {
      expect(body.root.findAllByType(MarkdownView)).toHaveLength(0);
      expect(body.root.findAllByType(ToolbarButton).filter((node) => node.props.label === "Show raw text")).toHaveLength(0);
    });
  });

  it("resets Markdown mode when paging between writes and preserves edit diffs", async () => {
    const calls = [
      classifyTool({ callId: "w1", name: "Write", status: "completed", detail: { type: "write", filePath: "/w/a.md", content: "# First" } }),
      classifyTool({ callId: "w2", name: "Write", status: "running", detail: { type: "write", filePath: "/w/a.md", content: "# Second" } }),
      classifyTool({ callId: "e1", name: "Edit", status: "completed", detail: { type: "edit", filePath: "/w/a.md", unifiedDiff: "-old\n+new" } }),
    ];
    await exercisePreview(React.createElement(ToolCallout, { data: calls[0]!, groupCalls: calls, tokens }), async (body) => {
      await press(body, "Show raw text");
      expect(body.root.findByType(PreviewLines).props.text).toBe("# First");
      await press(body, "Next operation");
      expect(body.root.findByType(MarkdownView).props).toMatchObject({ text: "# Second", streaming: true });
      await press(body, "Next operation");
      expect(body.root.findAllByType(MarkdownView)).toHaveLength(0);
      expect(body.root.findByType(PreviewLines).props.text).toBe("-old\n+new");
      await press(body, "Previous operation");
      expect(body.root.findByType(MarkdownView).props.text).toBe("# Second");
    });
  });

  it.each(["Bash", "Read"])("centres the tool name in a single %s preview", async (name) => {
    const data = classifyTool({ name, status: "completed", detail: name === "Bash"
      ? { type: "shell", command: "printf hello", output: "hello" }
      : { type: "read", filePath: "/w/a.ts", content: "hello" },
    });
    await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body) => {
      const center = body.root.findByProps({ testID: "hover-preview-center" });
      const title = center.findByProps({ testID: "hover-preview-tool-name" });
      expect(center.findByProps({ testID: "hover-preview-icon" }).findByType(RowIcon)).toBeDefined();
      expect(textOf(title)).toBe(name);
      expect(title.props.numberOfLines).toBe(1);
    });
  });

  it("keeps existing centre content without adding a tool name", () => {
    let header!: ReturnType<typeof TestRenderer.create>;
    act(() => { header = TestRenderer.create(React.createElement(HoverPreviewHeader, {
      tokens, icon: "Image", iconLabel: "Read", center: React.createElement("ImageMeta", null, "640 × 480"),
    })); });
    expect(header.root.findByProps({ testID: "hover-preview-center" }).findAll((node) => (node.type as unknown) === "ImageMeta")).toHaveLength(1);
    expect(header.root.findAllByProps({ testID: "hover-preview-tool-name" })).toHaveLength(0);
    act(() => header.unmount());
  });

  it.each<ToolKind>([
    "git", "github", "paseo", "bash", "shell", "read", "edit", "write", "thinking",
    "mcp", "hub", "search", "fetch", "worktree_setup", "sub_agent", "plan", "plain_text", "unknown",
  ])("uses the timeline row's icon renderer for a %s preview", async (tool) => {
    const data = { ...classifyTool({ name: "Read", status: "completed", detail: {
      type: "read", filePath: "/w/a.ts", content: "const value = 1;",
    } }), tool };
    await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body, row) => {
      const timelineIcon = row.root.findByType(DisclosureHeader).props.icon as React.ReactElement<{ name: string }>;
      const previewIcon = body.root.findByProps({ testID: "hover-preview-icon" }).findByType(RowIcon);
      expect(timelineIcon.type).toBe(RowIcon);
      expect(previewIcon.props.name).toBe(timelineIcon.props.name);
      expect(previewIcon.props.color).toBe(tokens.foregroundMuted);
    });
  });

  it("updates the preview icon to match the call selected by the group pager", async () => {
    const calls = ["Read", "Edit"].map((name, index) => classifyTool({
      callId: String(index), name, status: "completed", detail: index
        ? { type: "edit", filePath: "/w/a.ts", unifiedDiff: "-old\n+new" }
        : { type: "read", filePath: "/w/a.ts", content: "old" },
    }));
    await exercisePreview(React.createElement(ToolCallout, { data: calls[0]!, groupCalls: calls, tokens }), async (body) => {
      const kind = () => body.root.findByProps({ testID: "hover-preview-icon" }).findByType(RowIcon).props.name;
      expect(kind()).toBe("FileText");
      expect(textOf(body.root.findByProps({ testID: "hover-preview-start" }))).toBe("1 / 2");
      expect(textOf(body.root.findByProps({ testID: "hover-preview-center" }))).toBe("Read");
      await press(body, "Next operation");
      expect(kind()).toBe("Pencil");
      expect(textOf(body.root.findByProps({ testID: "hover-preview-start" }))).toBe("2 / 2");
      expect(textOf(body.root.findByProps({ testID: "hover-preview-center" }))).toBe("Edit");
    });
  });

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
  it("shows a sub-agent's prompt under its description in the preview and the opened card", () => {
    const data = classifyTool({ name: "Task", status: "running", detail: {
      type: "sub_agent", subAgentType: "Explore", description: "Find x", log: "",
      prompt: "Look for **x** in src/.\n\n- list the paths\n- quote PROMPT_TAIL",
    } });
    const preview = previewOf(React.createElement(ToolCallout, { data, tokens }));
    expect(preview).toContain("Find x");
    expect(preview).toContain("Look for x in src/.");
    expect(preview).not.toContain("**x**");
    expect(preview.indexOf("Find x")).toBeLessThan(preview.indexOf("Look for"));
    expect(preview).toContain("PROMPT_TAIL");
    let row!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} })); });
    const opened = textOf(row.toJSON());
    expect(opened).toContain("Look for x in src/.");
    expect(opened).toContain("PROMPT_TAIL");
    act(() => row.unmount());
  });
  it("shows a web search's text summary as markdown in the preview and the opened card", () => {
    const data = classifyTool({ name: "WebSearch", status: "completed", detail: {
      type: "search", query: "paseo", toolName: "web_search",
      webResults: [{ title: "Paseo docs", url: "https://paseo.dev" }],
      annotations: ["Paseo is **a host** for agents.", "SUMMARY_TAIL"],
    } });
    const preview = previewOf(React.createElement(ToolCallout, { data, tokens }));
    expect(preview).toContain("Paseo docs");
    expect(preview).toContain("Paseo is a host for agents.");
    expect(preview).not.toContain("**a host**");
    expect(preview).toContain("SUMMARY_TAIL");
    expect(preview).not.toContain("No results.");
    let row!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} })); });
    const opened = textOf(row.toJSON());
    expect(opened).toContain("Paseo is a host for agents.");
    expect(opened).toContain("SUMMARY_TAIL");
    act(() => row.unmount());
  });
  it("shows a web search's summary alone, without \"No results.\"", () => {
    const data = classifyTool({ name: "WebSearch", status: "completed", detail: {
      type: "search", query: "paseo", toolName: "web_search", annotations: ["Only the summary came back."],
    } });
    const preview = previewOf(React.createElement(ToolCallout, { data, tokens }));
    expect(preview).toContain("Only the summary came back.");
    expect(preview).not.toContain("No results.");
  });
  it("shows an OMP github call's reply when it arrives as plain text", () => {
    const data = classifyTool({ name: "github", status: "completed", detail: { type: "plain_text", label: "status", text: "Working tree clean" } });
    expect(previewOf(React.createElement(ToolCallout, { data, tokens }))).toContain("Working tree clean");
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

  it("keeps a streaming dot in the title bar's centre, beside a name when there is one", () => {
    let header!: ReturnType<typeof TestRenderer.create>;
    act(() => { header = TestRenderer.create(React.createElement(HoverPreviewHeader, { tokens, streaming: true })); });
    const center = header.root.findByProps({ testID: "hover-preview-center" });
    const dot = center.findByProps({ testID: "hover-preview-streaming" }).findByProps({ accessibilityRole: "progressbar" });
    expect(dot.props.accessibilityLabel).toBe("Streaming");
    expect(center.findAllByProps({ testID: "hover-preview-tool-name" })).toHaveLength(0);
    act(() => header.update(React.createElement(HoverPreviewHeader, {
      tokens, streaming: true, icon: "Image", iconLabel: "Read", center: React.createElement("ImageMeta", null, "640 × 480"),
    })));
    const named = header.root.findByProps({ testID: "hover-preview-center" });
    expect(named.findByProps({ testID: "hover-preview-streaming" })).toBeDefined();
    expect(named.findAll((node) => (node.type as unknown) === "ImageMeta")).toHaveLength(1);
    expect(named.findAllByProps({ testID: "hover-preview-tool-name" })).toHaveLength(0);
    act(() => header.update(React.createElement(HoverPreviewHeader, { tokens })));
    expect(header.root.findAllByProps({ testID: "hover-preview-streaming" })).toHaveLength(0);
    act(() => header.unmount());
  });

  it("shows a streaming thought's dot and its latest text in the hover and maximized preview", () => {
    const card = (body: string, streaming: boolean) => React.createElement(ReasoningCard, {
      segmentation: { kind: "prose", body }, streaming, durationMs: null, expanded: false, onToggle() {},
      tokens, storeKey: "preview-live", copyText: body,
    });
    let row!: ReturnType<typeof TestRenderer.create>;
    let preview!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(card("first paragraph", true)); });
    const open = () => row.root.findByType(DisclosureHeader).props.previewContent();
    act(() => { preview = TestRenderer.create(open()); });
    expect(preview.root.findByProps({ testID: "hover-preview-center" }).findByProps({ testID: "hover-preview-streaming" })).toBeDefined();
    expect(preview.root.findByType(MarkdownView).props.streaming).toBe(true);
    expect(textOf(preview.toJSON())).toContain("first paragraph");
    act(() => { row.update(card("first paragraph\n\nLATEST_OUTPUT", true)); });
    act(() => { preview.update(open()); });
    expect(textOf(preview.toJSON())).toContain("LATEST_OUTPUT");
    expect(preview.root.findByType(MarkdownView).props.streaming).toBe(true);
    act(() => { row.update(card("first paragraph\n\nLATEST_OUTPUT", false)); });
    act(() => { preview.update(open()); });
    expect(preview.root.findAllByProps({ testID: "hover-preview-streaming" })).toHaveLength(0);
    expect(preview.root.findByType(MarkdownView).props.streaming).toBe(false);
    act(() => { row.unmount(); preview.unmount(); });
  });

  it("shows a running command's dot and replaces the preview with its latest output", () => {
    const data = (output: string, status: "running" | "completed" = "running") => classifyTool({
      name: "Bash", status, detail: { type: "shell", command: "make", output },
    });
    let row!: ReturnType<typeof TestRenderer.create>;
    let preview!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data: data("line-1"), tokens })); });
    const open = () => row.root.findByType(DisclosureHeader).props.previewContent();
    act(() => { preview = TestRenderer.create(open()); });
    const center = () => preview.root.findByProps({ testID: "hover-preview-center" });
    expect(center().findByProps({ testID: "hover-preview-streaming" })).toBeDefined();
    expect(textOf(center())).toContain("Bash");
    expect(textOf(preview.toJSON())).toContain("line-1");
    act(() => { row.update(React.createElement(ToolCallout, { data: data("line-1\nline-2"), tokens })); });
    act(() => { preview.update(open()); });
    expect(textOf(preview.toJSON())).toContain("line-2");
    act(() => { row.update(React.createElement(ToolCallout, { data: data("line-1\nline-2", "completed"), tokens })); });
    act(() => { preview.update(open()); });
    expect(preview.root.findAllByProps({ testID: "hover-preview-streaming" })).toHaveLength(0);
    expect(textOf(preview.toJSON())).toContain("line-2");
    act(() => { row.unmount(); preview.unmount(); });
  });

  it("marks only the grouped call that is still running", async () => {
    const calls = [
      classifyTool({ callId: "0", name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "done" } }),
      classifyTool({ callId: "1", name: "Bash", status: "running", detail: { type: "shell", command: "make", output: "so far" } }),
    ];
    await exercisePreview(React.createElement(ToolCallout, { data: calls[0]!, groupCalls: calls, tokens }), async (body) => {
      expect(body.root.findAllByProps({ testID: "hover-preview-streaming" })).toHaveLength(0);
      await press(body, "Next operation");
      expect(body.root.findByProps({ testID: "hover-preview-streaming" })).toBeDefined();
      expect(textOf(body.toJSON())).toContain("so far");
    });
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

  it("copies whole lines after holding the gutter and dragging, preserving indentation and empty lines", async () => {
    vi.useFakeTimers();
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "first\n  second\n\nlast" } });
    try {
      await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body) => {
        const gutter = () => body.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers");
        act(() => gutter().props.onResponderGrant({ nativeEvent: { locationY: line + 1, pageY: 100 } }));
        act(() => { vi.advanceTimersByTime(400); });
        act(() => gutter().props.onResponderMove({ nativeEvent: { pageY: 100 + line } }));
        expect(body.root.findAllByProps({ testID: "preview-line-selection-menu" })).toHaveLength(0);
        act(() => gutter().props.onResponderRelease());
        await press(body, "Copy selected lines");
        expect(clipboard.copyText).toHaveBeenCalledWith("  second\n");
      });
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("draws a diff built from an edit's old and new text without inventing file line numbers", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Edit", status: "completed", detail: { type: "edit", filePath: "/w/a.ts", oldString: "keep\nold", newString: "keep\nnew" } });
    expect(previewLines(React.createElement(ToolCallout, { data, tokens }))).toMatchObject({
      placed: true, content: " keep\n-old\n+new", numbers: null,
    });
    let row!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, expanded: true, onExpandedChange: () => {} })); });
    const block = row.root.findByType(SyntaxHighlightBlock);
    expect(block.props).toMatchObject({ code: " keep\n-old\n+new", language: "diff", showLineNumbers: false });
    expect(textOf(row.toJSON())).not.toContain("[Edit: diff applied]");
    act(() => row.unmount());
  });

  it("draws an edit that only added text as added lines", () => {
    const data = classifyTool({ name: "Edit", status: "completed", detail: { type: "edit", filePath: "/w/a.ts", newString: "one\ntwo" } });
    expect(previewOf(React.createElement(ToolCallout, { data, tokens }))).toContain("+one\n+two");
  });

  it("keeps command output coloured in one text", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Bash", status: "completed", detail: { type: "shell", command: "make", output: "PASS a\nFAIL b\n" } });
    const drawn = previewLines(React.createElement(ToolCallout, { data, tokens }));
    expect(drawn).toMatchObject({ content: "PASS a\nFAIL b", numbers: [["1", 0], ["2", line]], stripes: [[line, line]] });
  });

  it("moves numbers and bands to where a wrapped line pushes the lines below it", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "a long line\nb\nc\nd wraps" } });
    const drawn = previewLines(React.createElement(ToolCallout, { data, tokens }), (body) => {
      const text = body.root.find((node) => (node.type as unknown) === "Text" && typeof node.props.onTextLayout === "function");
      // iOS reports each laid-out line's text only: the first and last source lines take two.
      text.props.onTextLayout({ nativeEvent: { lines: ["a long ", "line\n", "b\n", "c\n", "d ", "wraps"] } });
    });
    // The bottom comes from the same layout, so the last band covers both of its rows.
    expect(drawn).toMatchObject({
      numbers: [["1", 0], ["2", 2 * line], ["3", 3 * line], ["4", 4 * line]],
      stripes: [[2 * line, line], [4 * line, 2 * line]],
    });
  });

  it("places streamed lines below the last laid-out one before the text reports them", () => {
    updateEnhancerPreferences({ previewLineNumbers: true });
    const call = (output: string) => classifyTool({ name: "Bash", status: "running", detail: { type: "shell", command: "make", output } });
    let row!: ReturnType<typeof TestRenderer.create>;
    let body!: ReturnType<typeof TestRenderer.create>;
    let commits = 0;
    const content = () => React.createElement(React.Profiler, { id: "body", onRender: () => { commits++; } },
      row.root.findByType(DisclosureHeader).props.previewContent());
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data: call("a long line\nb\n"), tokens })); });
    act(() => { body = TestRenderer.create(content()); });
    const text = () => body.root.find((node) => (node.type as unknown) === "Text" && typeof node.props.onTextLayout === "function");
    act(() => text().props.onTextLayout({ nativeEvent: { lines: ["a long ", "line\n", "b"] } }));
    act(() => { row.update(React.createElement(ToolCallout, { data: call("a long line\nb\nc\nd\n"), tokens })); });
    act(() => { body.update(content()); });
    const lines = findJson(body.toJSON(), (node) => node.props.testID === "preview-lines")!;
    const gutter = findJson(lines, (node) => node.props.testID === "preview-line-numbers")!;
    expect((gutter.children as JsonNode[]).map((node) => styleOf(node).top)).toEqual([0, 2 * line, 3 * line, 4 * line]);
    const stripes = findJson(lines, (node) => node.props.testID === "preview-line-stripes")!;
    expect((stripes.children as JsonNode[]).map((node) => [styleOf(node).top, styleOf(node).height])).toEqual([[2 * line, line], [4 * line, line]]);
    // The layout that follows says the same, and draws nothing again.
    const before = commits;
    act(() => text().props.onTextLayout({ nativeEvent: { lines: ["a long ", "line\n", "b\n", "c\n", "d"] } }));
    expect(commits).toBe(before);
    act(() => text().props.onTextLayout({ nativeEvent: { lines: ["a long ", "line\n", "b\n", "c is now long\n", "d"] } }));
    expect(commits).toBe(before);
    act(() => text().props.onTextLayout({ nativeEvent: { lines: ["a long ", "line\n", "b\n", "c is now ", "long\n", "d"] } }));
    expect(commits).toBe(before + 1);
    act(() => { row.unmount(); body.unmount(); });
  });

  it("draws again only the lines a streamed chunk changed", () => {
    const renderLine = vi.fn((text: string) => text);
    const draw = (lines: string[]) => React.createElement(PreviewLines, { text: lines.join("\n"), lines, style: {}, tokens, renderLine });
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => { view = TestRenderer.create(draw(["a", "b"])); });
    expect(renderLine).toHaveBeenCalledTimes(2);
    // The old last line gains its newline, and the new one is drawn.
    renderLine.mockClear();
    act(() => view.update(draw(["a", "b", "c"])));
    expect(renderLine.mock.calls.map(([line]) => line)).toEqual(["b", "c"]);
    renderLine.mockClear();
    act(() => view.update(draw(["a", "b", "c d"])));
    expect(renderLine.mock.calls.map(([line]) => line)).toEqual(["c d"]);
    expect(textOf(view.toJSON())).toContain("a\nb\nc d");
    act(() => view.unmount());
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
  it("finds the bottom of the last laid-out line", () => {
    expect(layoutBottom([{ text: "a\n" }, { text: "b" }], 10)).toBe(20);
    expect(layoutBottom([{ text: "a\n", y: 0, height: 19 }, { text: "b", y: 19, height: 19 }], 10)).toBe(38);
    expect(layoutBottom([], 10)).toBe(0);
  });
  it("places lines past the last layout a line apart below it", () => {
    expect(placeLineTops(null, 3, 10)).toEqual([0, 10, 20]);
    expect(placeLineTops([0, 20], 4, 10)).toEqual([0, 20, 30, 40]);
    expect(placeLineTops([0, 20, 30], 2, 10)).toEqual([0, 20]);
    expect(sameLineTops([0, 20], [0, 20.2])).toBe(true);
    expect(sameLineTops([0, 20], [0, 21])).toBe(false);
    expect(sameLineTops([0, 20], [0])).toBe(false);
    expect(sameLineTops([0], null)).toBe(false);
  });
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


describe("Git diff output rendering", () => {
  beforeEach(() => resetEnhancerPreferences());
  const patch = "diff --cc x.ts\nindex 1,2..3\n--- a/x.ts\n+++ b/x.ts\n@@@ -10,2 -20,2 +30,2 @@@\n  const keep = 1;\n--const old = 2;\n++const next = 3;";

  it("renders combined markers, file line numbers and change fills with stripes disabled", async () => {
    updateEnhancerPreferences({ previewLineNumbers: true, previewStripes: false });
    const data = classifyTool({ name: "Bash", status: "completed", detail: {
      type: "shell", command: "git diff --cc; wc -l x.ts", output: `${patch}\n  99 x.ts`,
    } });
    await exercisePreview(React.createElement(ToolCallout, { data, tokens }), async (body) => {
      const previews = body.root.findAllByType(PreviewLines);
      expect(previews).toHaveLength(2);
      expect(previews[0]!.props).toMatchObject({ text: patch, diff: true });
      expect(previews[0]!.props.lineBackgrounds.slice(-3)).toEqual([undefined, tokens.syntax.diffRemoveBg, tokens.syntax.diffAddBg]);
      expect(previews[1]!.props.text).toBe("  99 x.ts");
      const gutter = previews[0]!.find((node) => (node.type as unknown) === "View" && node.props.testID === "preview-line-numbers");
      expect(gutter.children.map(textOf)).toEqual(["", "", "", "", "", "30", "11", "31"]);
      expect(textOf(body.toJSON())).toContain("--const old = 2;\n++const next = 3;");
      const copies = body.root.findByType(HoverPreviewHeader).findAllByType(ToolbarButton)
        .filter((node) => node.props.label.startsWith("Copy"));
      expect(copies.map((node) => [node.props.label, node.props.icon])).toEqual([
        ["Copy command", "SquareTerminal"], ["Copy output", "FileOutput"], ["Copy command and output", "ClipboardCopy"],
      ]);
      await press(body, "Copy output");
      expect(clipboard.copyText).toHaveBeenLastCalledWith(`${patch}\n  99 x.ts`);
    });
  });

  it("uses the diff code component in the expanded card", () => {
    const data = classifyTool({ name: "Bash", status: "completed", detail: {
      type: "shell", command: "git diff --cc", output: patch,
    } });
    let row!: ReturnType<typeof TestRenderer.create>;
    act(() => { row = TestRenderer.create(React.createElement(ToolCallout, { data, tokens, expanded: true })); });
    expect(row.root.findByType(SyntaxHighlightBlock).props).toMatchObject({ code: patch, language: "diff", filename: "x.ts", showLineNumbers: true });
    act(() => row.unmount());
  });

  it("updates a streaming combined hunk without losing the new markers", async () => {
    const data = (output: string) => classifyTool({ name: "Bash", status: "running", detail: {
      type: "shell", command: "git diff --cc", output,
    } });
    let body!: ReturnType<typeof TestRenderer.create>;
    const draw = (output: string) => React.createElement(ToolPreviewContent, { data: data(output), tokens, compact: false, resolvePath: (path: string) => path });
    await act(async () => { body = TestRenderer.create(draw(patch.slice(0, -5))); });
    await act(async () => { body.update(draw(patch)); });
    expect(textOf(body.toJSON())).toContain("++const next = 3;");
    expect(body.root.findByType(PreviewLines).props.lineBackgrounds.at(-1)).toBe(tokens.syntax.diffAddBg);
    act(() => body.unmount());
  });
});
