import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const state = vi.hoisted(() => ({
  open: vi.fn(), close: vi.fn(), register: vi.fn(), update: vi.fn(), release: vi.fn(), copy: vi.fn(async (_text: string) => {}),
  current: null as string | null, form: "side", marker: "off", reduced: false,
  handlers: new Map<string, Set<(event: unknown) => void>>(), showPopover: vi.fn(), hidePopover: vi.fn(),
}));
vi.mock("../../client/details/block-registry", () => ({ registerBlock: (entry: unknown) => {
  state.register(entry); return { update: state.update, release: state.release };
} }));
vi.mock("../../client/details/details-store", () => ({
  detailsApi: { open: state.open, close: state.close },
  useDetails: () => ({ openId: state.current, form: state.form }),
  useMarkerPhase: () => state.marker,
}));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => state.reduced }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ useInputCapabilities: () => {
  const native = (globalThis as { __rnMockOS?: string }).__rnMockOS !== "web";
  return { native, hover: !native, touch: native, compact: native };
} }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: state.copy, useToast: () => ({ show() {}, error() {} }), useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}), useSettings: () => ({ status: "loading" }),
}));
vi.mock("../../client/components/image-viewer", () => ({ ImageViewer: (props: { open: boolean }) => props.open ? React.createElement("ImageViewer", props) : null }));
vi.mock("../../client/web", async (original) => ({
  ...await original<typeof import("../../client/web")>(),
  openPreviewLayer: () => () => {},
}));
import { DisclosureHeader, type DisclosureHeaderProps } from "../../client/ui/disclosure-header";
import { PathText } from "../../client/ui/path-text";
import { CurrentMarker } from "../../client/details/current-marker";
import { BlockPlacementContext, type BlockEntry } from "../../client/details/contracts";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolCallout, toolRowCopyItems } from "../../client/components/tool-callouts";
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { TaskActivityRow } from "../../client/components/task-activity-row";
import { TaskList } from "../../client/components/task-list";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { classifyTool, type ToolCallView } from "../../client/tools/classify";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { Animated, StyleSheet } from "./helpers/rn-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({ surface0: "#ffffff", surface1: "#eeeeee", surface2: "#dddddd", border: "#cccccc",
  foreground: "#111111", foregroundMuted: "#666666", accent: "#0000ff", accentForeground: "#ffffff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
const placement = { agentId: "agent", at: 100, kind: "tool" as const };
const wrap = (element: React.ReactElement, placed = true) => placed
  ? <BlockPlacementContext.Provider value={placement}>{element}</BlockPlacementContext.Provider> : element;
function render(element: React.ReactElement, placed = true) {
  act(() => { renderer = TestRenderer.create(wrap(element, placed), { createNodeMock: () => ({
    measureInWindow: (done: (...box: number[]) => void) => done(20, 200, 350, 28),
    addEventListener: (key: string, fn: (event: unknown) => void) => {
      if (!state.handlers.has(key)) state.handlers.set(key, new Set()); state.handlers.get(key)!.add(fn);
    },
    removeEventListener: (key: string, fn: (event: unknown) => void) => state.handlers.get(key)?.delete(fn),
    setAttribute() {}, showPopover: state.showPopover, hidePopover: state.hidePopover,
    ownerDocument: { addEventListener() {}, removeEventListener() {} },
  }) }); });
  return renderer!;
}
function row() { return renderer!.root.find((node) => String(node.type) === "Pressable" && "aria-expanded" in node.props); }
function buttons(label?: string) { return renderer!.root.findAll((node) => String(node.type) === "Pressable" && (!label || node.props.accessibilityLabel === label)); }
function menuLabels() { return renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "menuitem").map((node) => node.props.accessibilityLabel); }
const body = () => <React.Fragment>Full output</React.Fragment>;
function header(props: Partial<DisclosureHeaderProps> = {}) {
  return <DisclosureHeader expanded={false} onToggle={vi.fn()} tokens={tokens} verb="Bash" target="npm test"
    previewKey="call:preview" previewContent={body} detailsIcon="SquareTerminal"
    copyItems={() => [{ id: "command", label: "Copy command", icon: "SquareTerminal", text: "npm test" }]} {...props} />;
}
function textOf(node: ReactTestInstance | string): string { return typeof node === "string" ? node : node.children.map(textOf).join(""); }

beforeEach(() => {
  vi.clearAllMocks(); state.handlers.clear(); state.current = null; state.form = "side"; state.marker = "off"; state.reduced = false;
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  resetEnhancerPreferences(); updateEnhancerPreferences({ blockDetails: true, language: "en" });
});
afterEach(() => {
  act(() => renderer?.unmount()); renderer = undefined;
  vi.useRealTimers(); resetEnhancerPreferences(); delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("details row press zones and registration", () => {
  it("registers, updates the render thunk and releases only on unmount", () => {
    render(header());
    expect(state.register).toHaveBeenCalledTimes(1);
    expect(state.register.mock.calls[0]![0]).toMatchObject({ id: "call:preview", agentId: "agent", at: 100, hasBody: true, navigable: true, mounted: true });
    act(() => renderer!.update(wrap(header({ detailsTitle: { text: "new command", mono: true }, previewContent: () => <>new output</> }))));
    const entry = state.update.mock.calls.at(-1)![0] as BlockEntry;
    expect(entry.title).toBe("new command"); expect(entry.titleMono).toBe(true);
    expect((entry.render() as React.ReactElement<{ children: string }>).props.children).toBe("new output");
    expect(state.release).not.toHaveBeenCalled();
    act(() => renderer!.unmount()); renderer = undefined;
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("opens details from the body on touch, and expands from a %s touch zone", (touch) => {
    if (!touch) (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const toggle = vi.fn(); render(header({ onToggle: toggle }));
    act(() => row().props.onPress());
    if (touch) {
      expect(state.open).toHaveBeenCalledWith("agent", "call:preview"); expect(toggle).not.toHaveBeenCalled();
    } else {
      // A pointer click expands in place; the panel opens from the menu or the hover preview.
      expect(state.open).not.toHaveBeenCalled(); expect(toggle).toHaveBeenCalledOnce(); toggle.mockClear();
    }
    const chevron = renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "details-chevron");
    expect(StyleSheet.flatten(chevron.props.style)).toMatchObject({ width: touch ? 44 : 28, top: 0, bottom: 0 });
    const event = { stopPropagation: vi.fn() };
    act(() => chevron.props.onPress(event)); expect(event.stopPropagation).toHaveBeenCalled(); expect(toggle).toHaveBeenCalledOnce();
  });
  it("routes a PathText body press and long press to its row", () => {
    render(header({ verb: "Read", target: <PathText path="/w/a.ts" tokens={tokens} /> }));
    const path = () => buttons("/w/a.ts")[0]!;
    act(() => path().props.onPress()); expect(state.open).toHaveBeenCalledWith("agent", "call:preview");
    act(() => path().props.onLongPress()); expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy command"]);
    expect(state.copy).not.toHaveBeenCalled();
  });
  it("gives an inert row only a 120 ms press and Copy title", () => {
    vi.useFakeTimers(); const toggle = vi.fn(); render(header({ inert: true, onToggle: toggle, detailsTitle: "No output" }));
    expect(buttons().some((node) => node.props.testID === "details-chevron")).toBe(false);
    act(() => row().props.onPress());
    expect(state.open).not.toHaveBeenCalled(); expect(toggle).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(row().props.style).backgroundColor).toBe(tokens.v2.surface2);
    act(() => { vi.advanceTimersByTime(120); }); expect(StyleSheet.flatten(row().props.style).backgroundColor).toBeUndefined();
    expect(state.register.mock.calls[0]![0]).toMatchObject({ hasBody: false, navigable: false });
    act(() => row().props.onLongPress()); expect(menuLabels()).toEqual(["Copy title"]);
  });
  it("expands on every pointer click, Cmd/Ctrl and the panel's current row included", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const toggle = vi.fn(); render(header({ onToggle: toggle }));
    act(() => row().props.onPress({ nativeEvent: { metaKey: true } })); expect(toggle).toHaveBeenCalledOnce();
    act(() => row().props.onPress({ nativeEvent: { ctrlKey: true } })); expect(toggle).toHaveBeenCalledTimes(2);
    // Opened on purpose from the menu, the panel marks this row; a click on it expands, the panel stays.
    act(() => row().props.onLongPress()); act(() => buttons("Open details")[0]!.props.onPress());
    expect(state.open).toHaveBeenCalledWith("agent", "call:preview");
    act(() => { state.current = "call:preview"; renderer!.update(wrap(header({ onToggle: toggle }))); });
    act(() => row().props.onPress()); expect(toggle).toHaveBeenCalledTimes(3);
    expect(state.close).not.toHaveBeenCalled(); expect(state.open).toHaveBeenCalledOnce();
  });
  it.each(["flag off", "no placement"])("preserves the legacy toggle for %s", (mode) => {
    if (mode === "flag off") updateEnhancerPreferences({ blockDetails: false });
    const toggle = vi.fn(); render(header({ onToggle: toggle }), mode !== "no placement");
    act(() => row().props.onPress()); expect(toggle).toHaveBeenCalledOnce();
    expect(state.register).not.toHaveBeenCalled(); expect(state.open).not.toHaveBeenCalled();
    expect(buttons().some((node) => node.props.testID === "details-chevron")).toBe(false);
  });
  it("cancels a long press at 10 px and keeps the row pressed while its menu is open", () => {
    render(header()); expect(row().props.delayLongPress).toBe(500);
    act(() => row().props.onTouchStart({ nativeEvent: { pageX: 50, pageY: 200 } }));
    act(() => row().props.onTouchMove({ nativeEvent: { pageX: 50, pageY: 210 } }));
    act(() => row().props.onLongPress()); expect(menuLabels()).toEqual([]);
    act(() => row().props.onTouchStart({ nativeEvent: { pageX: 50, pageY: 200 } }));
    act(() => row().props.onLongPress()); expect(menuLabels()).toHaveLength(3);
    expect(StyleSheet.flatten(row().props.style).backgroundColor).toBe(tokens.v2.surface2);
    expect(renderer!.root.findByType("Modal" as never).props.animationType).toBe("none");
    act(() => buttons("Close menu")[0]!.props.onPress());
    expect(menuLabels()).toEqual([]);
  });
  it("opens the same top-layer menu on right click and releases its listener", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; render(header());
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => state.handlers.get("contextmenu")!.forEach((fn) => fn(event)));
    expect(event.preventDefault).toHaveBeenCalled(); expect(state.showPopover).toHaveBeenCalledOnce();
    expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy command"]);
    act(() => buttons("Close menu")[0]!.props.onPress()); expect(state.hidePopover).toHaveBeenCalledOnce();
    act(() => renderer!.unmount()); renderer = undefined;
    expect(state.handlers.get("contextmenu")!.size).toBe(0);
  });
  it("copies the requested item and expands a menu row only when folded", async () => {
    const toggle = vi.fn(); render(header({ onToggle: toggle }));
    act(() => row().props.onLongPress());
    await act(async () => buttons("Copy command")[0]!.props.onPress()); expect(state.copy).toHaveBeenCalledWith("npm test");
    act(() => row().props.onLongPress()); act(() => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "menuitem" && node.props.accessibilityLabel === "Expand in timeline").props.onPress()); expect(toggle).toHaveBeenCalledOnce();
    act(() => renderer!.update(wrap(header({ expanded: true, onToggle: toggle }))));
    act(() => row().props.onLongPress()); act(() => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "menuitem" && node.props.accessibilityLabel === "Expand in timeline").props.onPress()); expect(toggle).toHaveBeenCalledOnce();
  });
});

const call = (name: string, detail: Record<string, unknown>) => classifyTool({ name, status: "completed", detail });
const fixtures: Array<[string, ToolCallView, string[]]> = [
  ["Bash", call("Bash", { type: "shell", command: "npm test", output: "done" }), ["Copy command", "Copy output", "Copy command and output"]],
  ["Read", call("Read", { type: "read", filePath: "/w/a.ts", content: "const x = 1;" }), ["Copy path", "Copy file content"]],
  ["Edit", call("Edit", { type: "edit", filePath: "/w/a.ts", oldString: "old", newString: "new", diff: "@@ -1 +1 @@\n-old\n+new" }), ["Copy path", "Copy patch", "Copy new content"]],
  ["Search", call("Grep", { type: "search", query: "needle", annotations: ["found it"], filePaths: ["/w/a.ts"] }), ["Copy query", "Copy summary", "Copy file list"]],
  ["Fetch", call("Fetch", { type: "fetch", url: "https://example.com", result: "result text" }), ["Copy URL", "Copy result"]],
  ["MCP", call("mcp__server__tool", { type: "mcp", server: "server", tool: "tool", arguments: { x: 1 }, result: "result text" }), ["Copy result", "Copy arguments"]],
  ["worktree", call("worktree_setup", { type: "worktree_setup", worktreePath: "/w/tree", commands: [], log: "setup log" }), ["Copy path", "Copy log"]],
  ["sub-agent", call("Task", { type: "sub_agent", description: "Explore", prompt: "Find the target", log: "found target", subAgentType: "explore" }), ["Copy description", "Copy prompt", "Copy log"]],
  ["thought tool", call("Thinking", { type: "thinking", content: "A sufficiently long thought to explain what this operation is about and how we should proceed." }), ["Copy"]],
  ["plan", call("plan", { type: "plan", text: "A plan with several steps to carry out in the new implementation.\nSecond step in this plan." }), ["Copy"]],
  ["plain text", call("message", { type: "plain_text", text: "A sufficiently long message to explain what this operation is about and how we should proceed." }), ["Copy"]],
  ["question", classifyTool({ name: "ask_user_question", status: "completed", detail: { type: "plain_text", text: "Selected A" }, questionData: {
    questions: [{ question: "Choose?", options: ["A", "B"] }], answers: { "0": ["A"] },
  } }), ["Copy result", "Copy arguments"]],
];
describe("tool menu copy order", () => {
  it.each(fixtures)("renders %s copies in design order", (_name, data, expected) => {
    render(<ToolCallout data={data} tokens={tokens} previewKey="tool:preview" />);
    act(() => row().props.onLongPress());
    expect(menuLabels()).toEqual(["Open details", "Expand in timeline", ...expected]);
  });
  it("adds send-agent prompt first and gives create-agent only its prompt", () => {
    const base = fixtures[5]![1];
    const send = { ...base, tool: "paseo", paseo: { tool: "send_agent_prompt", sendAgentPrompt: {
      prompt: "Fix the bug", result: { sent: true }, arguments: { agentId: "target" },
    } } } as unknown as ToolCallView;
    const create = { ...base, tool: "paseo", paseo: { tool: "create_agent", createAgent: { initialPrompt: "Build the feature" } } } as unknown as ToolCallView;
    expect(toolRowCopyItems(send, (path) => path).map((item) => item.label)).toEqual(["Copy prompt", "Copy result", "Copy arguments"]);
    expect(toolRowCopyItems(create, (path) => path)).toEqual([{ id: "prompt", label: "Copy prompt", icon: "FileText", text: "Build the feature" }]);
  });
  it.each([
    ["send_agent_prompt", { agentId: "target", prompt: "Fix the bug" }, { success: true, disposition: "turn_started", status: "running" }, ["Copy prompt", "Copy result", "Copy arguments"]],
    ["create_agent", { title: "Reviewer", provider: "codex", initialPrompt: "Review this feature" }, { agentId: "target" }, ["Copy prompt"]],
  ] as const)("renders Paseo %s menu", (name, input, output, labels) => {
    const data = classifyTool({ name: `paseo.${name}`, status: "completed", detail: { type: "unknown", input, output } });
    render(<ToolCallout data={data} tokens={tokens} previewKey="paseo:preview" />);
    act(() => row().props.onLongPress());
    expect(menuLabels()).toEqual(["Open details", "Expand in timeline", ...labels]);
  });
  it("opens an image viewer on tap and puts metadata above View image", () => {
    const data = call("Read", { type: "read", filePath: "/w/screen.png" });
    render(<ToolCallout data={data} tokens={tokens} previewKey="image:preview" imageFile={{ dataUri: "data:image/png;base64,AA", width: 1440, height: 900, bytes: 219136, error: null }} />);
    act(() => row().props.onPress()); expect(state.open).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("ImageViewer" as never)).toHaveLength(1);
    act(() => row().props.onLongPress()); expect(menuLabels()[0]).toBe("View image");
    expect(textOf(renderer!.root)).toContain("1440 × 900 · PNG · 214 KB");
  });
  it("registers only the merged head and copies the head's command", () => {
    const head = fixtures[0]![1]; render(<ToolCallout data={head} groupCalls={[head, head]} tokens={tokens} previewKey="merged:preview" />);
    expect(state.register).toHaveBeenCalledTimes(1);
    act(() => row().props.onLongPress()); expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy command", "Copy output", "Copy command and output"]);
  });
});

const todo = { id: "todo", phaseName: "Checklist Progress", tasks: [{ id: "t", title: "Fix the bug", status: "pending" as const, phase: "" }] };
describe("other detail callers", () => {
  it("registers a thought and its Copy item", () => {
    render(<ReasoningCard segmentation={{ kind: "prose", body: "Long thought ".repeat(20) }} streaming={false} durationMs={2000}
      expanded={false} onToggle={() => {}} tokens={tokens} storeKey="thought" copyText="Full thought" />);
    act(() => row().props.onLongPress()); expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy"]);
    expect(state.register.mock.calls[0]![0].copies()[0].text).toBe("Full thought");
  });
  it("registers a todo checklist and copies its plain checklist", () => {
    render(<TaskList data={todo} tokens={tokens} />);
    const entry = state.register.mock.calls[0]![0] as BlockEntry;
    expect(entry.kind).toBe("todo"); expect(entry.copies()[0]!.text).toBe("- [ ] Fix the bug");
    act(() => row().props.onLongPress()); expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy"]);
  });
  it("opens the checklist row menu from a task title instead of the old press preview", () => {
    render(<TaskList data={todo} tokens={tokens} />);
    const title = renderer!.root.find((node) => String(node.type) === "Text" && node.props.onLongPress && textOf(node) === "Fix the bug");
    expect(title.props.delayLongPress).toBe(500);
    act(() => title.props.onLongPress());
    expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy"]);
    expect(StyleSheet.flatten(row().props.style).backgroundColor).toBe(tokens.v2.surface2);
    expect(renderer!.root.findAll((node) => node.props.testID === "hover-preview")).toHaveLength(0);
  });
  it("keeps a task activity key stable across data updates", () => {
    render(<TaskActivityRow activities={[{ type: "added", task: "Fix the bug" }]} data={todo} tokens={tokens} />);
    const id = state.register.mock.calls[0]![0].id;
    act(() => renderer!.update(wrap(<TaskActivityRow activities={[{ type: "completed", task: "Fix the bug" }]} data={todo} tokens={tokens} />)));
    expect(state.register).toHaveBeenCalledOnce(); expect(state.update.mock.calls.at(-1)![0].id).toBe(id);
    act(() => row().props.onLongPress()); expect(menuLabels()).toEqual(["Open details", "Expand in timeline", "Copy"]);
  });
  it("opens a touch Markdown block at full detent, outside navigation", () => {
    render(<MarkdownView text={'```markdown\n# Title\n```'} tokens={tokens} variant="document" />);
    const entry = state.register.mock.calls[0]![0] as BlockEntry;
    expect(entry.kind).toBe("code"); expect(entry.navigable).toBe(false); expect(entry.copies()).toEqual([{ id: "code", label: "Copy code", icon: "Code", text: "# Title" }]);
    act(() => buttons("Open Markdown in a window")[0]!.props.onPress());
    expect(state.open).toHaveBeenCalledWith("agent", entry.id, { detent: "full", navigable: false });
  });
  it("keeps pop and maximize for a desktop code block with details enabled", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    render(<MarkdownView text={'```markdown\n# Desktop\n```'} tokens={tokens} variant="document" />);
    act(() => buttons("Open Markdown in a window")[0]!.props.onPress());
    expect(state.open).not.toHaveBeenCalled();
    expect(renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "hover-preview")).toHaveLength(1);
    expect(buttons("Close preview")).toHaveLength(1);
  });

});

describe("current marker", () => {
  it("keeps on and linger, then fades for 200 ms on off", () => {
    vi.useFakeTimers(); state.marker = "on";
    const timing = vi.spyOn(Animated, "timing");
    render(<CurrentMarker agentId="agent" id="row" tokens={tokens} />);
    const marker = () => renderer!.root.findAll((node) => String(node.type) === "Animated.View" && node.props.testID === "details-current-marker");
    expect(marker()).toHaveLength(1); expect(StyleSheet.flatten(marker()[0]!.props.style)).toMatchObject({ backgroundColor: "#e6e6ff", borderRadius: 6 });
    act(() => { state.marker = "linger"; renderer!.update(wrap(<CurrentMarker agentId="agent" id="row" tokens={tokens} />)); });
    expect(marker()).toHaveLength(1); expect(timing).not.toHaveBeenCalled();
    act(() => { state.marker = "off"; renderer!.update(wrap(<CurrentMarker agentId="agent" id="row" tokens={tokens} />)); });
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 200, toValue: 0 }));
    act(() => { vi.advanceTimersByTime(199); }); expect(marker()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1); }); expect(marker()).toHaveLength(0); timing.mockRestore();
  });
});
