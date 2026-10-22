/**
 * The preview content drawn in the block details chrome: the same content the
 * hover panel draws, its `HoverPreviewHeader` turned into the details header
 * and toolbar (docs/prototypes/block-details-sheet.md, tables 5.2, 5.8, 5.9).
 * The shell is stubbed: slice B provides `DetailsShellContext` in the app.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
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
import { TaskListPreview } from "../../client/components/task-list";
import { ImageMeta } from "../../client/components/image-preview";
import { DisclosureHeader } from "../../client/ui/disclosure-header";
import {
  AlwaysWrapPreview, HoverPreviewBody, HoverPreviewContext, HoverPreviewHeader, PreviewActionsContext, PreviewChromeContext,
  type PreviewActions,
} from "../../client/ui/hover-preview";
import { ToolbarButton, ToolbarCopyButton } from "../../client/ui/toolbar-button";
import { DetailsShellContext, type BlockEntry, type DetailsShellValue } from "../../client/details/contracts";
import { copySlots, foldCopies } from "../../client/details/chrome/copy-overflow";
import { backToLatestText } from "../../client/details/chrome/back-to-latest";
import { classifyTool } from "../../client/tools/classify";
import { resetEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = React.createElement;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  resetEnhancerPreferences();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

function entry(overrides: Partial<BlockEntry> = {}): BlockEntry {
  return {
    id: "agent:tool:1:preview", agentId: "agent", at: 1, kind: "tool", seq: 1, navigable: true, hasBody: true, mounted: true,
    title: "npm run build", titleMono: true, subtitle: ["Exit code 1", "2.1s"], tone: "danger",
    icon: "SquareTerminal", readsImage: false, render: () => null, copies: () => [],
    ...overrides,
  };
}

function shell(overrides: Partial<DetailsShellValue> = {}): DetailsShellValue {
  return {
    agentId: "agent", entry: entry(), form: "drawer", detent: "fit", fullscreen: false, pointer: false,
    index: 6, count: 15, canStep: { previous: true, next: true },
    step: vi.fn(), close: vi.fn(), toggleFullscreen: vi.fn(),
    ...overrides,
  };
}

const wrapOn = { on: true, disabled: false, toggle: vi.fn(), tokens };

/** The content as the details shell draws it, with the shell's actions and wrap. */
function details(content: React.ReactNode, value: DetailsShellValue = shell(), wrap: PreviewActions["wrap"] | null = wrapOn) {
  const actions: PreviewActions = { maximizable: false, maximized: false, maximize() {}, close() {}, fill: true, wrap: wrap ?? undefined };
  return h(PreviewChromeContext.Provider, { value: "details" },
    h(DetailsShellContext.Provider, { value },
      h(HoverPreviewContext.Provider, { value: true },
        h(PreviewActionsContext.Provider, { value: actions }, content))));
}

const callout = (data: ReturnType<typeof classifyTool>) => h(ToolCallout, { data, tokens });

/** A timeline row's preview content, the thunk its row hands the panel. */
function rowPreview(element: React.ReactElement): React.ReactNode {
  let row!: ReturnType<typeof TestRenderer.create>;
  act(() => { row = TestRenderer.create(element); });
  const content = row.root.findByType(DisclosureHeader).props.previewContent() as React.ReactNode;
  act(() => row.unmount());
  return content;
}

function mount(element: React.ReactElement) {
  act(() => { renderer = TestRenderer.create(element); });
  return renderer!.root;
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}
const byId = (root: ReactTestInstance, testID: string) => root.findByProps({ testID });
/** Drawn elements only: a mocked primitive and the element it renders share their props. */
const hosts = (root: ReactTestInstance, testID: string) => root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
const buttons = (root: ReactTestInstance) => root.findAll((node) => (node.type as unknown) === "Pressable" && typeof node.props.accessibilityLabel === "string");
const labels = (root: ReactTestInstance) => buttons(root).map((node) => node.props.accessibilityLabel as string);
const copyLabels = (root: ReactTestInstance) => labels(byId(root, "details-toolbar-end")).filter((label) => label.startsWith("Copy"));
function find(root: ReactTestInstance, label: string) {
  return root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}
/** The toolbar's measured width, and its left group's. */
function layout(root: ReactTestInstance, width: number, left: number) {
  act(() => {
    byId(root, "details-toolbar").props.onLayout({ nativeEvent: { layout: { width, height: 44 } } });
    byId(root, "details-toolbar-start").props.onLayout({ nativeEvent: { layout: { width: left, height: 36 } } });
  });
}
function wrapButton(root: ReactTestInstance) {
  return byId(root, "details-toolbar-start").findAllByType(ToolbarButton)
    .find((node) => node.props.label === "Wrap lines" || node.props.label === "Do not wrap lines");
}

const bash = classifyTool({ name: "Bash", status: "completed", detail: {
  type: "shell", command: "npm run build", output: "vite v5.4.8 building for production...\n",
} });

describe("details header", () => {
  it("names the block from the shell: icon tile, mono title, status in its tone, place, then ‹ › ×", () => {
    const root = mount(details(rowPreview(callout(bash))));
    const header = byId(root, "details-header");
    expect(header.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 52 })]));
    expect(byId(root, "details-header-icon").props.style).toEqual(expect.arrayContaining([
      expect.objectContaining({ width: 28, height: 28, borderRadius: 7 }), { backgroundColor: tokens.v2.surface1 }]));
    const title = byId(root, "details-header-title").findByType("Text" as never);
    expect(textOf(title)).toBe("npm run build");
    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ fontFamily: tokens.fontMono, fontSize: 13 })]));
    const subtitle = byId(root, "details-header-subtitle");
    expect(textOf(subtitle)).toBe("Exit code 1 · 2.1s · 6 / 15");
    const status = subtitle.findAll((node) => (node.type as unknown) === "Text" && textOf(node) === "Exit code 1");
    expect(status.at(-1)!.props.style).toEqual({ color: tokens.danger });
    expect(labels(header).slice(-3)).toEqual(["Previous block", "Next block", "Close details"]);
    // 36 buttons on touch.
    expect(find(header, "Close details").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 36, height: 36 })]));
    // The hover bar's centre title is not repeated in the toolbar.
    expect(hosts(root, "hover-preview-center")).toHaveLength(0);
    expect(hosts(root, "hover-preview-header")).toHaveLength(0);
  });

  it("opens the title to four lines on a tap, and back to one on another block", () => {
    const value = shell();
    const content = rowPreview(callout(bash));
    const root = mount(details(content, value));
    act(() => byId(root, "details-header-title").props.onPress());
    expect(byId(root, "details-header-title").findByType("Text" as never).props.numberOfLines).toBe(4);
    act(() => renderer!.update(details(content, { ...value, entry: entry({ id: "other" }) })));
    expect(byId(renderer!.root, "details-header-title").findByType("Text" as never).props.numberOfLines).toBe(1);
  });

  it("steps and closes through the shell, disabled at the ends, and spreads its header handlers", () => {
    const onResponderGrant = vi.fn();
    const value = shell({ canStep: { previous: false, next: true }, headerHandlers: { onResponderGrant } });
    const root = mount(details(rowPreview(callout(bash)), value));
    expect(find(root, "Previous block").props.disabled).toBe(true);
    act(() => find(root, "Next block").props.onPress());
    act(() => find(root, "Close details").props.onPress());
    expect(value.step).toHaveBeenCalledWith(1);
    expect(value.close).toHaveBeenCalledOnce();
    expect(byId(root, "details-header").props.onResponderGrant).toBe(onResponderGrant);
  });

  it("uses pointer sizes: header 44, buttons 28, toolbar 36", () => {
    const root = mount(details(rowPreview(callout(bash)), shell({ pointer: true })));
    expect(byId(root, "details-header").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 44 })]));
    expect(find(root, "Close details").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 28, height: 28 })]));
    expect(byId(root, "details-toolbar").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 36 })]));
  });

  it("leaves out ‹ › and the place for a block outside the sequence (a code block)", () => {
    const root = mount(details(rowPreview(callout(bash)), shell({ index: 0, count: 15 })));
    expect(labels(byId(root, "details-header"))).not.toContain("Previous block");
    expect(textOf(byId(root, "details-header-subtitle"))).toBe("Exit code 1 · 2.1s");
  });

  it("leads the subtitle with the streaming dot while the block writes", () => {
    const running = classifyTool({ name: "Bash", status: "running", detail: { type: "shell", command: "npm test", output: "" } });
    const root = mount(details(rowPreview(callout(running)),
      shell({ entry: entry({ title: "npm test", subtitle: ["Running"], tone: "accent" }) })));
    const subtitle = byId(root, "details-header-subtitle");
    expect((hosts(root, "details-header-subtitle")[0]!.children[0] as ReactTestInstance).props.testID).toBe("details-header-streaming");
    expect(subtitle.findAll((node) => (node.type as unknown) === "Text" && textOf(node) === "Running").at(-1)!.props.style)
      .toEqual({ color: tokens.accent });
  });
});

describe("details toolbar", () => {
  it("draws a Bash call's three copies, then full screen, with wrap at the left", async () => {
    const root = mount(details(rowPreview(callout(bash))));
    expect(copyLabels(root)).toEqual(["Copy command", "Copy output", "Copy command and output"]);
    expect(labels(byId(root, "details-toolbar-end")).at(-1)).toBe("Full screen");
    expect(wrapButton(root)!.props).toMatchObject({ checked: true, disabled: false });
    expect(byId(root, "details-toolbar").props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 44 })]));
    await act(async () => find(root, "Copy output").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(expect.stringContaining("vite v5.4.8 building for production..."));
    // The check shows in the success colour.
    expect(byId(root, "details-toolbar-end").findAllByType(ToolbarButton).find((node) => node.props.icon === "Check")!.props.color)
      .toBe(tokens.success);
  });

  it.each([
    ["Read", { type: "read", filePath: "/w/src/a.ts", content: "const a = 1;" }, ["Copy path", "Copy file content"]],
    ["Edit", { type: "edit", filePath: "/w/src/a.ts", oldString: "old", newString: "new" }, ["Copy path", "Copy patch", "Copy new content"]],
  ] as const)("draws a %s call's copies (design 5.9)", (name, detail, expected) => {
    const data = classifyTool({ name, status: "completed", detail: { ...detail } });
    const root = mount(details(rowPreview(callout(data)),
      shell({ entry: entry({ title: "src/a.ts", subtitle: ["Done"], tone: "success" }) })));
    expect(copyLabels(root)).toEqual(expected);
    expect(textOf(byId(root, "details-header-title"))).toBe("src/a.ts");
  });

  it("keeps a merged row's pager at the left, and pages it", () => {
    const calls = Array.from({ length: 6 }, (_, index) => classifyTool({ callId: `r${index}`, name: "Read", status: "completed",
      detail: { type: "read", filePath: `/w/src/file-${index}.ts`, content: `const value = ${index};` } }));
    const root = mount(details(rowPreview(h(ToolCallout, { data: calls[0]!, groupCalls: calls, tokens })),
      shell({ entry: entry({ title: "Read 6 files", titleMono: false, subtitle: ["340ms"], tone: undefined }) })));
    const start = byId(root, "details-toolbar-start");
    expect(textOf(start)).toBe("1 / 6");
    expect(labels(start)).toEqual(["Do not wrap lines", "Previous operation", "Next operation"]);
    act(() => find(root, "Next operation").props.onPress());
    expect(textOf(byId(root, "details-toolbar-start"))).toBe("2 / 6");
    expect(copyLabels(root)).toEqual(["Copy path", "Copy file content"]);
    expect(textOf(byId(root, "details-header-title"))).toBe("Read 6 files");
  });

  it("gives a question its raw toggle and pager, with wrap shown on and disabled", () => {
    const questions = [
      { header: "Scope", question: "Which platforms?", multiSelect: true, options: [{ label: "iOS" }, { label: "Web" }] },
      { header: "Height", question: "How tall?", multiSelect: false, options: [{ label: "Fit" }, { label: "Full" }] },
    ];
    const data = classifyTool({ name: "AskUserQuestion", callId: "ask", status: "completed", detail: { type: "unknown", input: { questions } } });
    const root = mount(details(rowPreview(callout(data)),
      shell({ entry: entry({ title: "Questions", titleMono: false, subtitle: ["Answered"], tone: "success" }) })));
    expect(labels(byId(root, "details-toolbar-start"))).toEqual(["Do not wrap lines", "Show raw data", "Previous question", "Next question"]);
    expect(wrapButton(root)!.props).toMatchObject({ checked: true, disabled: true });
    act(() => find(root, "Show raw data").props.onPress());
    expect(labels(byId(root, "details-toolbar-start"))).toEqual(["Do not wrap lines", "Show questions"]);
    expect(copyLabels(root)).toEqual(expect.arrayContaining(["Copy arguments"]));
  });

  it("disables wrap for a checklist", () => {
    const data = { id: "t", phaseName: "Tasks", tasks: [
      { id: "1", title: "Read the code", phase: "x", status: "completed" as const },
      { id: "2", title: "Write the chrome", phase: "x", status: "in_progress" as const },
    ] };
    const root = mount(details(h(TaskListPreview, { data, tokens }),
      shell({ entry: entry({ kind: "todo", title: "Tasks 1/2", titleMono: false, subtitle: ["1 done", "1 in progress"], tone: undefined }),
        toggleFullscreen: undefined })));
    expect(wrapButton(root)!.props).toMatchObject({ checked: true, disabled: true });
    expect(textOf(byId(root, "details-header-title"))).toBe("Tasks 1/2");
    // The content fits: no full screen.
    expect(labels(byId(root, "details-toolbar-end"))).not.toContain("Full screen");
  });

  it("draws a Markdown code block: render / raw at the left, copy code, wrap disabled while rendered", () => {
    function CodeBlock() {
      const [raw, setRaw] = React.useState(false);
      return h(React.Fragment, null,
        h(HoverPreviewHeader, { tokens, icon: "FileText", left: h(ToolbarButton, { icon: raw ? "FileText" : "Code",
          label: raw ? "Render Markdown" : "Show raw text", onPress: () => setRaw((value) => !value), tokens }) },
        h(ToolbarCopyButton, { text: "const a = 1;", label: "Copy code", tokens })),
        h(HoverPreviewBody, null, raw ? "raw" : "rendered"));
    }
    const root = mount(details(h(AlwaysWrapPreview, { keepControl: true, children: h(CodeBlock) }),
      shell({ index: 0, entry: entry({ kind: "code", navigable: false, title: "Code block · tsx", titleMono: false, subtitle: ["22 lines"] }) })));
    expect(labels(byId(root, "details-toolbar-start"))).toEqual(["Do not wrap lines", "Show raw text"]);
    expect(wrapButton(root)!.props.disabled).toBe(true);
    expect(copyLabels(root)).toEqual(["Copy code"]);
    expect(labels(byId(root, "details-header"))).toEqual(["Code block · tsx", "Close details"]);
  });

  it("titles an agent card in words with its status tone, falling back to the card's own label", () => {
    const data = classifyTool({ name: "Task", status: "running", detail: {
      type: "sub_agent", subAgentType: "Explore", description: "Find x", log: "", prompt: "Look for x",
    } });
    const root = mount(details(rowPreview(callout(data)),
      shell({ entry: entry({ title: "", titleMono: false, subtitle: ["Running", "1m 12s"], tone: "accent", icon: "Bot", iconColor: tokens.accent }) })));
    const title = textOf(byId(root, "details-header-title"));
    expect(title.length).toBeGreaterThan(0);
    expect(title).toContain("Find x");
    expect(byId(root, "details-header-icon").findByProps({ name: "Bot" }).props.color).toBe(tokens.accent);
    expect(byId(root, "details-header-subtitle").findAll((node) => (node.type as unknown) === "Text" && textOf(node) === "Running")
      .at(-1)!.props.style).toEqual({ color: tokens.accent });
  });

  it("moves a picture's size from the bar's middle to the subtitle", () => {
    const file = { dataUri: "data:image/png;base64,AA", width: 1440, height: 900, bytes: 214_000, error: null };
    const root = mount(details(
      h(HoverPreviewHeader, { tokens, icon: "Image", center: h(ImageMeta, { file, tokens }) },
        h(ToolbarCopyButton, { text: "/w/docs/preview.png", icon: "Link", tokens, label: "Copy path" })),
      shell({ entry: entry({ title: "docs/preview.png", subtitle: ["Done"], tone: undefined }) }), null));
    const subtitle = byId(root, "details-header-subtitle");
    expect(subtitle.findAllByType(ImageMeta)).toHaveLength(1);
    expect(textOf(subtitle)).toContain("1440 × 900");
    expect(byId(root, "details-toolbar").findAllByType(ImageMeta)).toHaveLength(0);
    // A picture has no lines: no wrap toggle.
    expect(wrapButton(root)).toBeUndefined();
  });

  it("widens the side panel instead of going full screen", () => {
    const value = shell({ form: "side", pointer: true });
    const content = rowPreview(callout(bash));
    const root = mount(details(content, value));
    expect(labels(byId(root, "details-toolbar-end")).at(-1)).toBe("Widen panel");
    act(() => find(root, "Widen panel").props.onPress());
    expect(value.toggleFullscreen).toHaveBeenCalledOnce();
    act(() => renderer!.update(details(content, { ...value, fullscreen: true })));
    expect(labels(byId(renderer!.root, "details-toolbar-end")).at(-1)).toBe("Restore panel width");
    act(() => renderer!.update(details(content, shell({ fullscreen: true }))));
    expect(labels(byId(renderer!.root, "details-toolbar-end")).at(-1)).toBe("Exit full screen");
  });
});

describe("copy overflow", () => {
  it("folds from the last copy into ⋯ at 360 with a wide left group, and fits all three at 390", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const root = mount(details(rowPreview(callout(bash))));
    // Wrap, a pager and a raw toggle: 200 wide.
    layout(root, 360, 200);
    expect(copyLabels(root)).toEqual(["Copy command"]);
    expect(labels(byId(root, "details-toolbar-end"))).toEqual(["Copy command", "More", "Full screen"]);
    act(() => find(root, "More").props.onPress());
    const menu = byId(root, "details-copy-menu");
    expect(labels(menu)).toEqual(["Copy output", "Copy command and output"]);
    await act(async () => find(menu, "Copy output").props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(expect.stringContaining("vite v5.4.8 building for production..."));
    expect(hosts(root, "details-copy-menu")).toHaveLength(0);

    layout(root, 390, 200);
    // The copy from the menu still shows its check, now that its button has room.
    expect(labels(byId(root, "details-toolbar-end"))).toEqual(["Copy command", "Copied", "Copy command and output", "Full screen"]);
    expect(hosts(root, "details-copy-overflow")).toHaveLength(0);
  });

  it("keeps the first copy even with no room, and fits a plain toolbar at 360", () => {
    const root = mount(details(rowPreview(callout(bash))));
    layout(root, 360, 36);
    expect(copyLabels(root)).toHaveLength(3);
    layout(root, 360, 330);
    expect(copyLabels(root)).toEqual(["Copy command"]);
  });

  it("drops empty and repeated copies", () => {
    const root = mount(details(
      h(HoverPreviewHeader, { tokens }, h(React.Fragment, null,
        h(ToolbarCopyButton, { text: "prompt text", label: "Copy prompt", tokens }),
        h(ToolbarCopyButton, { text: "prompt text", label: "Copy result", tokens }),
        h(ToolbarCopyButton, { text: "", label: "Copy output", tokens }),
        h(ToolbarCopyButton, { text: "{}", label: "Copy prompt", tokens }),
        h(ToolbarCopyButton, { text: () => "built", label: "Copy arguments", tokens }))),
    ));
    expect(copyLabels(root)).toEqual(["Copy prompt", "Copy arguments"]);
  });

  it("folds by order and counts slots", () => {
    const items = ["a", "b", "c", "d"].map((label) => ({ label, text: label }));
    expect(foldCopies(items, 4).folded).toEqual([]);
    expect(foldCopies(items, 3)).toEqual({ shown: items.slice(0, 2), folded: items.slice(2) });
    expect(foldCopies(items, 1)).toEqual({ shown: items.slice(0, 1), folded: items.slice(1) });
    expect(foldCopies([{ label: "x", text: " " }, { label: "y", text: undefined }], 3).shown.map((item) => item.label)).toEqual(["y"]);
    expect(copySlots(null, 36, 4)).toBe(Number.POSITIVE_INFINITY);
    expect(copySlots(116, 36, 4)).toBe(3);
    expect(copySlots(115, 36, 4)).toBe(2);
    expect(copySlots(0, 36, 4)).toBe(1);
  });
});

describe("details body", () => {
  function streamingBody(output: string) {
    return h(React.Fragment, null,
      h(HoverPreviewHeader, { tokens }, h(ToolbarCopyButton, { text: output, label: "Copy output", tokens })),
      h(HoverPreviewBody, { streaming: true, children: output }));
  }
  const scrolled = (offset: number, viewport: number, content: number) => ({ nativeEvent: {
    contentOffset: { y: offset }, layoutMeasurement: { height: viewport }, contentSize: { height: content } } });

  it("fills the panel, lets a stream go past 48 from the end, and offers Back to latest with the new lines", () => {
    const scrolls: unknown[] = [];
    act(() => {
      renderer = TestRenderer.create(details(streamingBody("one")), { createNodeMock: () => ({
        scrollTo: (options: unknown) => scrolls.push(options), scrollToEnd: (options: unknown) => scrolls.push(["end", options]) }) });
    });
    const root = renderer!.root;
    expect(byId(root, "details-body").props.style).toMatchObject({ flexGrow: 1, flexShrink: 1, minHeight: 0 });
    const body = () => hosts(root, "hover-preview-body")[0]!;
    act(() => body().props.onLayout({ nativeEvent: { layout: { height: 200 } } }));
    act(() => body().props.onContentSizeChange(0, 1000));
    act(() => body().props.onScroll(scrolled(800, 200, 1000)));
    // 30 from the end: still following (the hover panel would let go past 24).
    act(() => body().props.onScroll(scrolled(770, 200, 1000)));
    expect(hosts(root, "details-back-to-latest")).toHaveLength(0);
    act(() => body().props.onScroll(scrolled(740, 200, 1000)));
    expect(textOf(byId(root, "details-back-to-latest").findByType("Text" as never))).toBe("Back to latest");
    const lineHeight = tokens.typography.mono.lineHeight;
    act(() => body().props.onContentSizeChange(0, 1000 + 3 * lineHeight));
    expect(textOf(byId(root, "details-back-to-latest").findByType("Text" as never))).toBe("Back to latest · 3 new lines");
    // 20 from the end is not yet back: following resumes within 8.
    act(() => body().props.onScroll(scrolled(800 + 3 * lineHeight - 20, 200, 1000 + 3 * lineHeight)));
    expect(hosts(root, "details-back-to-latest")).toHaveLength(1);
    act(() => byId(root, "details-back-to-latest").props.onPress());
    expect(hosts(root, "details-back-to-latest")).toHaveLength(0);
    expect(scrolls.at(-1)).toEqual({ y: 800 + 3 * lineHeight, animated: true });
  });

  it("words the pill", () => {
    expect(backToLatestText(0)).toBe("Back to latest");
    expect(backToLatestText(1)).toBe("Back to latest · 1 new line");
    expect(backToLatestText(12)).toBe("Back to latest · 12 new lines");
  });

  it("draws no pill and keeps the hover panel's body outside the details chrome", () => {
    const actions: PreviewActions = { maximizable: false, maximized: false, maximize() {}, close() {}, fill: false, wrap: wrapOn };
    const root = mount(h(PreviewActionsContext.Provider, { value: actions }, streamingBody("one")));
    expect(hosts(root, "details-body")).toHaveLength(0);
    expect(hosts(root, "details-chrome")).toHaveLength(0);
    expect(hosts(root, "hover-preview-header")).toHaveLength(1);
    const body = hosts(root, "hover-preview-body")[0]!;
    act(() => body.props.onLayout({ nativeEvent: { layout: { height: 200 } } }));
    act(() => body.props.onContentSizeChange(0, 1000));
    act(() => body.props.onScroll(scrolled(700, 200, 1000)));
    expect(hosts(root, "details-back-to-latest")).toHaveLength(0);
  });
});
