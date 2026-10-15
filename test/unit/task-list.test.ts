/**
 * The checklist on a phone and on the desktop: a tapped title wraps in full,
 * and the whole list opens in the row preview's floating panel (S7 §3.3).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
  copyText: () => Promise.resolve(true),
  useToast: () => ({ show() {}, error() {}, success() {} }),
}));
const state = vi.hoisted(() => ({
  hover: true,
  layers: [] as Array<{ floating?: boolean }>,
  pointers: [] as unknown[],
}));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: () => ({
    hover: state.hover,
    touch: !state.hover,
    native: ["ios", "android"].includes((globalThis as { __rnMockOS?: string }).__rnMockOS ?? ""),
  }),
  noteHover: vi.fn(),
}));
vi.mock("../../client/web", () => ({
  bindRowHover: () => () => {},
  bindPreviewMaximize: () => () => {},
  dropSelectionIn: () => {},
  bindPreviewPointer: (node: unknown) => {
    state.pointers.push(node);
    return () => {};
  },
  openPreviewLayer: (_node: unknown, _anchor: unknown, _close: unknown, options: { floating?: boolean }) => {
    state.layers.push(options);
    return () => {};
  },
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { TaskList, TaskListPreview, useTaskListPanel } = await import("../../client/components/task-list");
const { TaskActivityRow } = await import("../../client/components/task-activity-row");
const { DisclosureHeader } = await import("../../client/ui/disclosure-header");
const { HoverPreview, HoverPreviewContext, useHoverPreview } = await import("../../client/ui/hover-preview");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = ReturnType<typeof TestRenderer.create>;
type Node = Renderer["root"];

const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" } as never);

const LONG = "Teach the release script to skip the changelog step when the branch only touches docs and tests";
const data = {
  id: "t",
  phaseName: "Checklist Progress",
  tasks: [
    { id: "1", title: "Read the code", phase: "x", status: "completed" as const },
    { id: "2", title: LONG, phase: "x", status: "in_progress" as const },
    { id: "3", title: "Run the tests across every platform the plugin ships to", phase: "x", status: "pending" as const },
  ],
};

let renderer: Renderer | undefined;
function mount(element: React.ReactElement) {
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer!;
}

function titles(root: Node) {
  return root.findAll((node) => (node.type as unknown) === "Text" && data.tasks.some((task) => task.title === node.props.children));
}
function title(root: Node, text: string) {
  return titles(root).find((node) => node.props.children === text)!;
}
function popOut(root: Node) {
  return root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Open tasks in a window");
}
function wrapToggle(root: Node) {
  return root.findAll((node) => (node.type as unknown) === "Pressable" &&
    ["Do not wrap lines", "Wrap lines"].includes(node.props.accessibilityLabel))[0];
}
function sideways(root: Node) {
  return root.findAll((node) => (node.type as unknown) === "Animated.ScrollView" && node.props.horizontal === true);
}
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(3).filter(Boolean));
}
function panels(root: Node) {
  return root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview");
}

beforeEach(() => {
  vi.useFakeTimers();
  resetEnhancerPreferences();
  state.hover = true;
  state.layers = [];
  state.pointers = [];
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("a tapped task title", () => {
  it("wraps in full and folds again, one task at a time", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    expect(titles(root).map((node) => node.props.numberOfLines)).toEqual([1, 1, 1]);
    act(() => title(root, LONG).props.onPress());
    expect(titles(root).map((node) => node.props.numberOfLines)).toEqual([1, 0, 1]);
    expect(title(root, LONG).props.accessibilityState).toEqual({ expanded: true });
    expect(title(root, LONG).props["aria-expanded"]).toBe(true);
    act(() => title(root, "Read the code").props.onPress());
    expect(titles(root).map((node) => node.props.numberOfLines)).toEqual([0, 0, 1]);
    act(() => title(root, LONG).props.onPress());
    expect(titles(root).map((node) => node.props.numberOfLines)).toEqual([0, 1, 1]);
    expect(title(root, LONG).props.accessibilityState).toEqual({ expanded: false });
  });

  it("no longer changes the task's status; the status slot still does", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    const marks = () => root.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "Check");
    expect(marks()).toHaveLength(1);
    act(() => title(root, "Read the code").props.onPress());
    expect(marks()).toHaveLength(1);
    const slot = root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Set Read the code status");
    act(() => slot.props.onPress());
    expect(marks()).toHaveLength(0);
  });

  it("keeps a closed row at the header's height and lets an open one grow from its first line", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    const row = () => {
      let node = title(root, LONG).parent!;
      while ((node.type as unknown) !== "View") node = node.parent!;
      return node;
    };
    const rowHeight = tokens.typography.block.rowHeight.desktop;
    const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean));
    expect(flat(row().props.style)).toMatchObject({ height: rowHeight, alignItems: "center" });
    act(() => title(root, LONG).props.onPress());
    const open = flat(row().props.style);
    expect(open.height).toBeUndefined();
    expect(open).toMatchObject({ minHeight: rowHeight, alignItems: "flex-start" });
    expect(open.paddingVertical).toBe((rowHeight - tokens.typography.block.label.lineHeight) / 2);
  });

  it("does not fold when the click ends a text selection on web", () => {
    const selection = { isCollapsed: false };
    (globalThis as { getSelection?: () => unknown }).getSelection = () => selection;
    try {
      const root = mount(React.createElement(TaskList, { data, tokens })).root;
      act(() => title(root, LONG).props.onPress());
      expect(title(root, LONG).props.numberOfLines).toBe(1);
      selection.isCollapsed = true;
      act(() => title(root, LONG).props.onPress());
      expect(title(root, LONG).props.numberOfLines).toBe(0);
    } finally {
      delete (globalThis as { getSelection?: () => unknown }).getSelection;
    }
  });
});

describe("the header's progress mark", () => {
  function progress(root: Node) {
    const ring = root.findAll((node) => (node.type as unknown) === "View" && node.props.accessibilityRole === "progressbar");
    const checks = root.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "CircleCheck");
    return { ring: ring.length, checks: checks.map((node) => node.props.color) };
  }

  it("is a ring while tasks remain", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    expect(progress(root)).toEqual({ ring: 1, checks: [] });
  });

  it("turns into a checked circle once every task is done, beside the header's own", () => {
    const done = { ...data, tasks: data.tasks.map((task) => ({ ...task, status: "completed" as const })) };
    const root = mount(React.createElement(TaskList, { data: done, tokens })).root;
    expect(progress(root)).toEqual({ ring: 0, checks: [tokens.success, tokens.success] });
  });
});

describe("the checklist's floating panel", () => {
  it("draws every task in full under a 'Tasks n/m' title bar", () => {
    const root = mount(React.createElement(TaskListPreview, { data, tokens })).root;
    const heading = root.find((node) => node.props.testID === "task-list-preview-title");
    expect(heading.props.children).toBe("Tasks 1/3");
    expect(titles(root).map((node) => node.props.numberOfLines)).toEqual([0, 0, 0]);
    // No list header inside the panel, nothing to fold, and the titles are selectable.
    expect(root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === "Tasks")).toHaveLength(0);
    expect(titles(root).every((node) => node.props.onPress === undefined && node.props.selectable === true)).toBe(true);
    expect(popOut(root)).toHaveLength(0);
  });

  it("pops out from the header's button as a floating window on web", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    expect(panels(root)).toHaveLength(0);
    act(() => popOut(root)[0]!.props.onPress());
    expect(panels(root)).toHaveLength(1);
    expect(state.layers.at(-1)).toMatchObject({ floating: true });
    const inPanel = panels(root)[0]!;
    expect(titles(inPanel).map((node) => node.props.numberOfLines)).toEqual([0, 0, 0]);
    // The window's own list offers no second window.
    expect(popOut(inPanel)).toHaveLength(0);
  });

  it("keeps the button when hover previews are off", () => {
    updateEnhancerPreferences({ hoverPreview: false });
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    act(() => popOut(root)[0]!.props.onPress());
    expect(panels(root)).toHaveLength(1);
  });

  it("opens on a long press of a task or the header on a phone, where a tap still wraps", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    state.hover = false;
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    // The long press opens the panel, so the inline title does not start a selection.
    expect(title(root, LONG).props.selectable).toBe(false);
    act(() => title(root, LONG).props.onPress());
    expect(panels(root)).toHaveLength(0);
    expect(title(root, LONG).props.numberOfLines).toBe(0);
    act(() => title(root, LONG).props.onLongPress());
    expect(panels(root)).toHaveLength(1);
    act(() => renderer!.unmount());
    renderer = undefined;
    const again = mount(React.createElement(TaskList, { data, tokens })).root;
    const header = again.find((node) => (node.type as unknown) === "Pressable" && typeof node.props.onLongPress === "function" &&
      node.findAll((child) => (child.type as unknown) === "Text" && child.props.children === "Tasks").length > 0);
    act(() => header.props.onLongPress());
    expect(panels(again)).toHaveLength(1);
    // The phone keeps the window button too.
    expect(popOut(again)).toHaveLength(1);
  });

  it("binds the header's hover to a panel its caller keeps", () => {
    let shared: ReturnType<typeof useTaskListPanel> | undefined;
    function Owner() {
      shared = useTaskListPanel();
      return React.createElement(TaskList, { data, tokens, panel: shared });
    }
    const root = mount(React.createElement(Owner)).root;
    // The header binds the shared panel's hover; the shared panel is not drawn by the list.
    expect(state.pointers.length).toBeGreaterThan(0);
    act(() => popOut(root)[0]!.props.onPress());
    expect(shared!.open).toBe(true);
    expect(panels(root)).toHaveLength(0);
  });

  it("has the panel's line-wrap toggle at the top left of its title bar", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    act(() => popOut(root)[0]!.props.onPress());
    const start = panels(root)[0]!.find((node) => node.props.testID === "hover-preview-start");
    expect(wrapToggle(start)!.props.accessibilityLabel).toBe("Do not wrap lines");
    // Wrapped (the default): every title in full, wrapping in the panel's width.
    expect(sideways(root)).toHaveLength(0);
    expect(titles(panels(root)[0]!).every((node) => flat(node.props.style).flex === 1)).toBe(true);
  });

  it("puts each title on one untruncated line in a sideways scroller once wrap is off", () => {
    const root = mount(React.createElement(TaskList, { data, tokens })).root;
    act(() => popOut(root)[0]!.props.onPress());
    act(() => wrapToggle(root)!.props.onPress());
    expect(wrapToggle(root)!.props.accessibilityLabel).toBe("Wrap lines");
    const scroller = sideways(root);
    expect(scroller).toHaveLength(1);
    const inScroller = titles(scroller[0]!);
    expect(inScroller).toHaveLength(3);
    for (const node of inScroller) {
      // No ellipsis, and the title sizes to its line instead of the panel's width.
      expect(node.props.numberOfLines).toBe(0);
      const style = flat(node.props.style);
      expect(style.flex).toBeUndefined();
      expect(style).toMatchObject({ flexGrow: 1, flexShrink: 0 });
    }
    // Status marks stay in their slot, on the title's line.
    const row = inScroller[0]!.parent!.parent!;
    expect(row.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "Check").length).toBeGreaterThan(0);
  });

  it("has no hover, long press or window inside another preview", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    const root = mount(React.createElement(HoverPreviewContext.Provider, { value: true },
      React.createElement(TaskList, { data, tokens }))).root;
    expect(popOut(root)).toHaveLength(0);
    expect(title(root, LONG).props.onLongPress).toBeUndefined();
  });
});

describe("an earlier checklist update", () => {
  it("previews the list as it stood, like a tool row", () => {
    const root = mount(React.createElement(TaskActivityRow, {
      activities: [{ type: "completed", task: "Read the code" }],
      data,
      tokens,
    })).root;
    const header = root.findByType(DisclosureHeader);
    // The preview keeps its line-wrap toggle, as the live list's panel does.
    expect(header.props.previewWraps).not.toBe(false);
    const content = header.props.previewContent();
    expect(content.type).toBe(TaskListPreview);
    expect(content.props.data).toBe(data);
  });

  it("draws the wrap toggle at the top left of its preview, and the list follows it", () => {
    const row = mount(React.createElement(TaskActivityRow, {
      activities: [{ type: "completed", task: "Read the code" }],
      data,
      tokens,
    })).root;
    const { previewContent, previewWraps } = row.findByType(DisclosureHeader).props;
    act(() => renderer!.unmount());
    function Preview() {
      const preview = useHoverPreview(true);
      return React.createElement(HoverPreview, { preview: { ...preview, open: true }, tokens, wraps: previewWraps, children: previewContent() });
    }
    const root = mount(React.createElement(Preview)).root;
    act(() => wrapToggle(root)!.props.onPress());
    expect(wrapToggle(root)!.props.accessibilityLabel).toBe("Wrap lines");
    expect(titles(sideways(root)[0]!).map((node) => node.props.numberOfLines)).toEqual([0, 0, 0]);
  });
});
