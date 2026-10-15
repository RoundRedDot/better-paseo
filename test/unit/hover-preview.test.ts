import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon" }));
const state = vi.hoisted(() => ({
  hover: true,
  anchors: [] as unknown[],
  onLinesFit: undefined as ((fits: boolean) => void) | undefined,
  layers: [] as Array<{
    maximized?: boolean;
    frame?: { x: number; y: number; width: number; height: number } | null;
    onLinesFit?: (fits: boolean) => void;
    onPlace?: (box: { x: number; y: number; width: number; height: number }) => void;
  }>,
  bindRowHover: vi.fn(() => () => {}),
  outside: [] as Array<() => void>,
  moves: [] as Array<() => void>,
  bindPreviewMaximize: vi.fn((_node: unknown, _maximize: () => void) => vi.fn()),
  dropSelectionIn: vi.fn(),
}));
vi.mock("../../client/ui/use-input-capabilities", () => ({ useInputCapabilities: () => ({
  hover: state.hover,
  native: ["ios", "android"].includes((globalThis as { __rnMockOS?: string }).__rnMockOS ?? ""),
}), noteHover: vi.fn() }));
vi.mock("../../client/web", () => ({
  bindRowHover: state.bindRowHover,
  bindPreviewMaximize: state.bindPreviewMaximize,
  dropSelectionIn: state.dropSelectionIn,
  bindPreviewPointer: () => () => {},
  watchNextPointerMove: (_anchor: unknown, moved: () => void) => {
    state.moves.push(moved);
    return () => { state.moves = state.moves.filter((entry) => entry !== moved); };
  },
  watchPointerOutside: (_anchor: unknown, leave: () => void) => {
    state.outside.push(leave);
    return () => { state.outside = state.outside.filter((entry) => entry !== leave); };
  },
  openPreviewLayer: (_node: unknown, _anchor: unknown, _close: unknown, options: {
    maximized?: boolean;
    frame?: { x: number; y: number; width: number; height: number } | null;
    onLinesFit?: (fits: boolean) => void;
    onPlace?: (box: { x: number; y: number; width: number; height: number }) => void;
  }) => {
    state.anchors.push(_anchor);
    state.layers.push(options);
    state.onLinesFit = options.onLinesFit;
    return () => {};
  },
}));
import { HoverPreview, HoverPreviewBody, HoverPreviewContext, HoverPreviewHeader, PREVIEW_CLOSE_MS, PREVIEW_OPEN_MS, useHoverPreview } from "../../client/ui/hover-preview";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { TOOLBAR_TOOLTIP_MS } from "../../client/ui/toolbar-button";
import { StyleSheet, View } from "./helpers/rn-mock";
import { getEnhancerPreferences, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { PREVIEW_HANDOVER_MS } from "../../client/ui/preview-memory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let preview!: ReturnType<typeof useHoverPreview>;
let renderer: ReturnType<typeof TestRenderer.create>;
function Probe({ enabled = true }: { enabled?: boolean }) {
  preview = useHoverPreview(enabled);
  return null;
}
function KeyedProbe({ memoryKey }: { memoryKey: string }) {
  preview = useHoverPreview(true, memoryKey);
  return null;
}
/** The same call drawn as a new row: a remount with the same key. */
const keyedRow = (place: string, memoryKey = "agent:thought:preview") => React.createElement(KeyedProbe, { key: place, memoryKey });
function mount(enabled = true, nested = false) {
  act(() => {
    renderer = TestRenderer.create(React.createElement(HoverPreviewContext.Provider, { value: nested }, React.createElement(Probe, { enabled })));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  resetEnhancerPreferences();
  state.hover = true;
  state.anchors = [];
  state.onLinesFit = undefined;
  state.layers = [];
  state.outside = [];
  state.moves = [];
  state.bindRowHover.mockClear();
  state.bindPreviewMaximize.mockClear();
  state.dropSelectionIn.mockClear();
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("hover preview after the reader closes it", () => {
  it("stays closed while the pointer rests, though its row scrolls back under it", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.close());
    expect(state.moves).toHaveLength(1);
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS * 2); });
    expect(preview.open).toBe(false);
    // The pointer moves: hovering opens it again.
    act(() => state.moves[0]!());
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(true);
  });
  it("watches nothing on a phone, where a long press opens it", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mount();
    act(() => preview.press!());
    act(() => preview.close());
    expect(state.moves).toHaveLength(0);
  });
});

describe("hover preview across a remount", () => {
  it.each(["hover", "maximized", "popped"])("attaches the ancestor anchor before restoring a %s panel", (kind) => {
    const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
      foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
      statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
    function Row() {
      preview = useHoverPreview(true, `agent:anchor:${kind}`);
      return React.createElement(View, { ref: preview.anchorRef }, preview.open
        ? React.createElement(HoverPreview, { preview, tokens, children: "Markdown preview" }) : null);
    }
    act(() => {
      renderer = TestRenderer.create(React.createElement(Row, { key: "live" }), {
        createNodeMock: () => ({ addEventListener() {}, removeEventListener() {} }),
      });
    });
    if (kind === "popped") act(() => preview.pop!());
    else {
      act(() => preview.enter());
      act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    }
    if (kind === "maximized") act(() => preview.maximize());
    expect(state.anchors.every((anchor) => anchor !== null)).toBe(true);
    state.anchors = [];

    act(() => renderer.update(React.createElement(Row, { key: "history" })));
    expect(preview).toMatchObject({ open: true, quiet: true, maximized: kind === "maximized" });
    expect(state.anchors.length).toBeGreaterThan(0);
    for (const anchor of state.anchors) expect(anchor).toBe(preview.anchorRef.current);
    expect(preview.anchorRef.current).not.toBeNull();
    act(() => preview.close());
    act(() => renderer.update(React.createElement(Row, { key: "closed" })));
    expect(preview.open).toBe(false);
  });

  it("reopens a hover preview on the row the host draws in its place, and closes it on the first move away", () => {
    act(() => { renderer = TestRenderer.create(keyedRow("live")); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.quiet).toBe(false);
    act(() => renderer.update(keyedRow("history")));
    expect(preview.open).toBe(true);
    expect(preview.quiet).toBe(true);
    expect(state.outside).toHaveLength(1);
    act(() => state.outside[0]!());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(false);
    act(() => renderer.update(keyedRow("again")));
    expect(preview.open).toBe(false);
  });
  it("keeps a maximized preview maximized and a closed one closed", () => {
    act(() => { renderer = TestRenderer.create(keyedRow("live")); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.maximize());
    act(() => renderer.update(keyedRow("history")));
    expect(preview).toMatchObject({ open: true, maximized: true, quiet: true });
    expect(state.outside).toHaveLength(0);
    act(() => preview.close());
    act(() => renderer.update(keyedRow("again")));
    expect(preview.open).toBe(false);
  });
  it.each(["ios", "android"])("reopens a long-pressed preview on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(keyedRow("live", `agent:${os}:preview`)); });
    act(() => preview.press!());
    act(() => renderer.update(keyedRow("history", `agent:${os}:preview`)));
    expect(preview).toMatchObject({ open: true, quiet: true });
  });
  it("does not reopen a preview for a row that mounts long after the last one let go", () => {
    act(() => { renderer = TestRenderer.create(keyedRow("live", "agent:late:preview")); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => renderer.unmount());
    act(() => { vi.advanceTimersByTime(PREVIEW_HANDOVER_MS + 1); });
    act(() => { renderer = TestRenderer.create(keyedRow("history", "agent:late:preview")); });
    expect(preview.open).toBe(false);
  });
});

describe("hover preview lifetime", () => {
  it("does not schedule previews while disabled and re-enables without remounting", () => {
    updateEnhancerPreferences({ hoverPreview: false });
    mount();
    act(() => preview.enter());
    act(() => preview.leave());
    expect(vi.getTimerCount()).toBe(0);
    expect(preview.open).toBe(false);
    act(() => { updateEnhancerPreferences({ hoverPreview: true }); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(true);
  });
  it("cancels a pending preview when disabled", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { updateEnhancerPreferences({ hoverPreview: false }); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => { updateEnhancerPreferences({ hoverPreview: true }); });
    expect(preview.open).toBe(false);
  });
  it.each([false, true])("closes an open preview when disabled (maximized: %s)", (maximized) => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    if (maximized) act(() => preview.maximize());
    act(() => { updateEnhancerPreferences({ hoverPreview: false }); });
    expect(preview.open).toBe(false);
    expect(preview.maximized).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { updateEnhancerPreferences({ hoverPreview: true }); });
    expect(preview.open).toBe(false);
  });
  it.each([0.2, 0.5, 1, 1.5, 2.3])("uses a configured delay of %s s", (hoverDelaySeconds) => {
    updateEnhancerPreferences({ hoverDelaySeconds });
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(Math.round(hoverDelaySeconds * 1000) - 1); });
    expect(preview.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview.open).toBe(true);
  });
  it("uses an updated preference on the next hover without remounting", () => {
    mount();
    act(() => { updateEnhancerPreferences({ hoverDelaySeconds: 2 }); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(1999); });
    expect(preview.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview.open).toBe(true);
  });
  it("opens after a rest without changing disclosure state", () => {
    expect(PREVIEW_OPEN_MS).toBe(1000);
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS - 1); });
    expect(preview.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview.open).toBe(true);
  });
  it("stays open across the gap and while the pointer is inside the panel", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS - 1); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(false);
  });
  it("cancels a pending opening when the pointer leaves early", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(preview.open).toBe(false);
  });
  it("pins a maximized preview, cancels pending dismissal, and resets after closing", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => preview.maximize());
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    expect(preview.maximized).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => preview.close());
    expect(preview.open).toBe(false);
    expect(preview.maximized).toBe(false);
    expect(preview.placed).toBe(false);
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(false);
  });
  it("keeps a preview open while it is dragged, and after the reader has moved it", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.hold(true));
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(true);
    expect(preview.placed).toBe(false);
    act(() => preview.hold(false));
    act(() => preview.place());
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(true);
    expect(preview.placed).toBe(true);
    act(() => preview.maximize());
    expect(preview.maximized).toBe(true);
    act(() => preview.place());
    expect(preview.open).toBe(true);
    expect(preview.maximized).toBe(false);
    expect(preview.placed).toBe(true);
    act(() => preview.close());
    expect(preview.placed).toBe(false);
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(false);
  });
  it("closes immediately when the row expands and cancels timers on unmount", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => renderer.update(React.createElement(Probe, { enabled: false })));
    expect(preview.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["ios", "android"])("does not open on hover on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
  });
  it.each(["ios", "android"])("opens on a long press on %s and stays until closed", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    mount();
    act(() => preview.press!());
    expect(preview.open).toBe(true);
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    act(() => preview.close());
    expect(preview.open).toBe(false);
  });
  it("offers no long press on web, while disabled, or inside another preview owner", () => {
    mount();
    expect(preview.press).toBeUndefined();
    act(() => renderer.unmount());
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mount(false);
    expect(preview.press).toBeUndefined();
    act(() => renderer.unmount());
    mount(true, true);
    expect(preview.press).toBeUndefined();
    act(() => renderer.unmount());
    updateEnhancerPreferences({ hoverPreview: false });
    mount();
    expect(preview.press).toBeUndefined();
  });
  it("closes a long-pressed preview when the row expands", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mount();
    act(() => preview.press!());
    act(() => renderer.update(React.createElement(Probe, { enabled: false })));
    expect(preview.open).toBe(false);
  });
  it("pops out as a pinned window, also where hover and long-press previews are off", () => {
    updateEnhancerPreferences({ hoverPreview: false });
    mount();
    act(() => preview.pop!());
    expect(preview.open).toBe(true);
    expect(preview.popped).toBe(true);
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    act(() => preview.close());
    expect(preview.open).toBe(false);
    expect(preview.popped).toBe(false);
    act(() => renderer.unmount());
    // A phone without its long-press preview still has the button.
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mount();
    expect(preview.press).toBeUndefined();
    act(() => preview.pop!());
    expect(preview.open).toBe(true);
  });
  it("offers no pop-out while disabled or inside another preview owner", () => {
    mount(false);
    expect(preview.pop).toBeUndefined();
    act(() => renderer.unmount());
    mount(true, true);
    expect(preview.pop).toBeUndefined();
  });
  it("does not open on touch-only web or inside another preview owner", () => {
    state.hover = false;
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
    act(() => renderer.unmount());
    state.hover = true;
    mount(true, true);
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
  });
});

describe("line wrap in the desktop preview", () => {
  const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
    foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
    statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
  let own!: ReturnType<typeof useHoverPreview>;
  function Panel({ wraps = true, paged = true }: { wraps?: boolean; paged?: boolean }) {
    own = useHoverPreview(true);
    const header = React.createElement(HoverPreviewHeader, { key: "header", tokens, icon: React.createElement("ToolIcon"), left: paged ? React.createElement("Pager") : undefined, children: React.createElement("Toolbar") });
    const body = React.createElement(HoverPreviewBody, { key: "body", children: React.createElement("Text", null, "a long line") });
    return React.createElement(HoverPreview, { preview: { ...own, open: true }, tokens, wraps, children: [header, body] });
  }
  const button = () => renderer.root.find((node) => (node.type as unknown) === "Pressable" &&
    ["Do not wrap lines", "Wrap lines"].includes(node.props.accessibilityLabel));
  const icon = () => button().find((node) => (node.type as unknown) === "Icon").props.name;
  const sideways = () => renderer.root.findAll((node) =>
    (node.type as unknown) === "Animated.ScrollView" && node.props.horizontal === true);

  it("keeps a disabled wrap slot before a newly added pager and retains its hover name", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel, { paged: false })); });
    const original = button();
    const size = StyleSheet.flatten(original.props.style);
    act(() => state.onLinesFit!(true));
    expect(button()).toBe(original);
    expect(button().props.disabled).toBe(true);
    expect(button().props.accessibilityState).toEqual({ disabled: true, checked: true });
    expect(button().props.onPress).toBeUndefined();
    expect(StyleSheet.flatten(button().props.style)).toMatchObject({ width: size.width, height: size.height, opacity: 0.35 });

    // Exercise the outer DOM hover binding, independent of the disabled Pressable.
    const [, enter, leave] = state.bindRowHover.mock.calls.at(-1)! as unknown as [unknown, () => void, () => void];
    act(() => enter());
    act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === "Do not wrap lines")).toHaveLength(1);
    act(() => leave());
    expect(renderer.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === "Do not wrap lines")).toHaveLength(0);

    act(() => renderer.update(React.createElement(Panel, { paged: true })));
    expect(button()).toBe(original);
    const start = renderer.root.findByProps({ testID: "hover-preview-start" });
    const [wrap, pager] = start.find((node) => (node.type as unknown) === "View").children as TestRenderer.ReactTestInstance[];
    expect(wrap!.findAll((node) => node === original)).toHaveLength(1);
    expect(StyleSheet.flatten(original.parent!.parent!.props.style).flexShrink).toBe(0);
    expect(pager!.type as unknown).toBe("Pager");
    act(() => state.onLinesFit!(false));
    expect(button()).toBe(original);
    expect(button().props.disabled).toBe(false);
    act(() => button().props.onPress());
    expect(icon()).toBe("AlignLeft");
  });

  it("preserves the unwrapped choice when short content disables the toggle", () => {
    updateEnhancerPreferences({ previewWrap: false });
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    act(() => state.onLinesFit!(true));
    expect(button().props.disabled).toBe(true);
    expect(icon()).toBe("AlignLeft");
    expect(sideways()).toHaveLength(1);
    act(() => state.onLinesFit!(false));
    expect(button().props.disabled).toBe(false);
    expect(icon()).toBe("AlignLeft");
  });

  it("omits the wrap toggle for non-text previews", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel, { wraps: false })); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === "Pressable" &&
      ["Do not wrap lines", "Wrap lines"].includes(node.props.accessibilityLabel))).toHaveLength(0);
  });

  it("wraps by default and scrolls sideways once wrap is turned off, also when maximized", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    expect(button().props.accessibilityLabel).toBe("Do not wrap lines");
    expect(icon()).toBe("WrapText");
    expect(sideways()).toHaveLength(0);

    act(() => button().props.onPress());
    expect(button().props.accessibilityLabel).toBe("Wrap lines");
    expect(icon()).toBe("AlignLeft");
    expect(sideways()).toHaveLength(1);

    // Maximize keeps the reader's choice.
    act(() => own.maximize());
    expect(own.maximized).toBe(true);
    expect(icon()).toBe("AlignLeft");
    expect(sideways()).toHaveLength(1);

    act(() => button().props.onPress());
    expect(icon()).toBe("WrapText");
    expect(sideways()).toHaveLength(0);
  });

  it("opens unwrapped when the setting is off, and the button still switches this panel", () => {
    updateEnhancerPreferences({ previewWrap: false });
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    expect(button().props.accessibilityLabel).toBe("Wrap lines");
    expect(sideways()).toHaveLength(1);
    act(() => button().props.onPress());
    expect(sideways()).toHaveLength(0);
    // The setting is the default for the next panel, not changed by the button.
    expect(getEnhancerPreferences().previewWrap).toBe(false);
  });

  it("returns Maximize after a drag and reopens the layer at that box", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    const windowButton = (label: string) => renderer.root.findAll((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
    act(() => windowButton("Maximize preview")[0]!.props.onPress());
    expect(own.maximized).toBe(true);
    const box = { x: 40, y: 80, width: 500, height: 300 };
    act(() => state.layers.at(-1)!.onPlace!(box));
    expect(own.maximized).toBe(false);
    expect(own.placed).toBe(true);
    expect(windowButton("Maximize preview")).toHaveLength(1);
    expect(windowButton("Close preview")).toHaveLength(0);
    expect(state.layers.at(-1)).toMatchObject({ maximized: false, frame: box });
    expect(renderer.root.findAll((node) => node.props.accessibilityLabel === "Expanded preview")).toHaveLength(0);
  });

  it("opens a popped-out panel as a floating window on the layer, with a close button", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    const button = (label: string) => renderer.root.findAll((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
    expect(state.layers.at(-1)).toMatchObject({ floating: false });
    expect(button("Close preview")).toHaveLength(0);
    act(() => own.pop!());
    expect(state.layers.at(-1)).toMatchObject({ floating: true });
    expect(button("Maximize preview")).toHaveLength(1);
    act(() => button("Close preview")[0]!.props.onPress());
    expect(own.open).toBe(false);
    expect(own.popped).toBe(false);
  });

  it("offers Maximize whatever the content's size, and Close once maximized", () => {
    // The layer is mocked and never reports a measurement: the button does not wait for one.
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    const windowButton = (label: string) => renderer.root.findAll((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
    expect(windowButton("Maximize preview")).toHaveLength(1);
    act(() => windowButton("Maximize preview")[0]!.props.onPress());
    expect(own.maximized).toBe(true);
    expect(windowButton("Maximize preview")).toHaveLength(0);
    expect(windowButton("Close preview")).toHaveLength(1);
  });

  it("maximizes from the toolbar, stays open on leave, and closes on the next double-click", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    act(() => own.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    const [, maximize] = state.bindPreviewMaximize.mock.calls.at(-1)!;
    const release = state.bindPreviewMaximize.mock.results.at(-1)!.value;
    act(() => maximize());
    expect(own.maximized).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    act(() => own.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(own.open).toBe(true);
    expect(renderer.root.findByProps({ accessibilityLabel: "Expanded preview" })).toBeDefined();
    const [, close] = state.bindPreviewMaximize.mock.calls.at(-1)!;
    expect(close).not.toBe(maximize);
    act(() => close());
    expect(own.open).toBe(false);
    expect(own.maximized).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // Closing clears the pin; once the pointer moves, the next hover has the normal lifetime.
    act(() => state.moves.at(-1)!());
    act(() => own.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(own.open).toBe(true);
    act(() => own.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(own.open).toBe(false);
  });

  it("drops a selection inside the panel when it closes, not when it maximizes", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    act(() => own.maximize());
    expect(own.maximized).toBe(true);
    expect(state.dropSelectionIn).not.toHaveBeenCalled();
    act(() => renderer.unmount());
    expect(state.dropSelectionIn).toHaveBeenCalledOnce();
  });

  it.each(["ios", "android"])("does not offer toolbar double-click maximization on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    expect(state.bindPreviewMaximize).not.toHaveBeenCalled();
  });

  it("puts the pager after wrap at the left and the tool icon in the centre", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    const toolbar = renderer.root.findByProps({ testID: "hover-preview-header" }).findAll((node) => (node.type as unknown) === "View")[1]!;
    const [start, center, end] = toolbar.children as TestRenderer.ReactTestInstance[];
    const [wrap, pager] = start!.find((node) => (node.type as unknown) === "View").children as TestRenderer.ReactTestInstance[];
    expect(wrap!.findAll((node) => node === button())).toHaveLength(1);
    expect((pager!.type as unknown)).toBe("Pager");
    expect(start!.findAllByProps({ testID: "hover-preview-icon" })).toHaveLength(0);
    expect(center!.findByProps({ testID: "hover-preview-icon" }).findAll((node) => (node.type as unknown) === "ToolIcon")).toHaveLength(1);
    expect(start!.findAll((node) => node === button())).toHaveLength(1);
    expect(end!.findAll((node) => (node.type as unknown) === "Toolbar")).toHaveLength(1);
    expect(end!.findAll((node) => node === button())).toHaveLength(0);
  });
});
