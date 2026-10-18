import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

// On a phone there is no hover: a long press on a collapsed tool or thought row
// opens the preview the desktop shows on hover, and the preview carries the
// copy actions the long press used to run.

// The host registers the UITextView pair iOS prose selects through.
vi.mock("react-native", async () => ({
  ...(await import("./helpers/rn-mock")),
  UIManager: { hasViewManagerConfig: (name: string) => name === "RNUITextView" },
}));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
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
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: () => {
    const os = (globalThis as { __rnMockOS?: string }).__rnMockOS ?? "ios";
    const native = os === "ios" || os === "android";
    return { hover: !native, touch: native, compact: native, native };
  },
}));
// The viewer's gestures need a real PanResponder; its own tests cover it.
vi.mock("../../client/components/image-viewer", async () => {
  const { createElement } = await import("react");
  return { ImageViewer: (props: { open: boolean }) => (props.open ? createElement("ImageViewer", props) : null) };
});
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolCallout } from "../../client/components/tool-callouts";
import { ImagePreview } from "../../client/components/image-preview";
import type { ImageFile } from "../../client/image-file";
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { createReasoningSegmenter } from "../../client/reasoning/segment";
import { classifyTool } from "../../client/tools/classify";
import { pressPreviewFrame, pressPreviewOrigin } from "../../client/ui/press-preview-placement";
import { MAX_UNWRAPPED_WIDTH } from "../../client/ui/hover-preview";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { Animated } from "./helpers/rn-mock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

beforeEach(() => {
  vi.clearAllMocks();
  motion.reduced = false;
  resetEnhancerPreferences();
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
});
afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

const shell = classifyTool({ name: "Bash", status: "completed", detail: {
  type: "shell", command: "printf full-command", output: "full-output\n",
} });

function render(element: React.ReactElement) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(element, {
      // Every view sits at the same spot; placement has its own tests.
      createNodeMock: () => ({ measureInWindow: (done: (...box: number[]) => void) => done(0, 300, 390, 28) }),
    });
  });
  return renderer;
}

function row(renderer: ReturnType<typeof TestRenderer.create>): ReactTestInstance {
  return renderer.root.find((node) =>
    (node.type as unknown) === "Pressable" && "aria-expanded" in node.props);
}

const panels = (renderer: ReturnType<typeof TestRenderer.create>) =>
  renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview");
const panel = (renderer: ReturnType<typeof TestRenderer.create>) => {
  const [found] = panels(renderer);
  if (!found) throw new Error("no preview panel");
  return found;
};

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  // A run of iOS prose carries its text as a prop.
  if ((node.type as unknown) === "RNUITextViewChild") return String(node.props.text);
  return node.children.map(textOf).join("");
}

describe("long-pressing a collapsed row on a phone", () => {
  it.each(["ios", "android"])("opens a tool row's preview instead of copying on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    expect(panels(renderer)).toHaveLength(0);
    act(() => row(renderer).props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(textOf(panel(renderer))).toContain("full-output");
    // The row did not open.
    expect(row(renderer).props["aria-expanded"]).toBe(false);
    act(() => renderer.unmount());
  });

  it("copies from the preview's own copy button and closes on a press outside", async () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const copy = panel(renderer).find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Copy command");
    await act(async () => { copy.props.onPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
    const backdrop = renderer.root.find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Close preview");
    act(() => backdrop.props.onPress());
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("closes on Android's back button", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const modal = renderer.root.find((node) => (node.type as unknown) === "Modal");
    act(() => modal.props.onRequestClose());
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("opens a thought row's preview", () => {
    const segmentation = createReasoningSegmenter().update("Checking the list of files. Then the tests.", { streaming: false });
    const renderer = render(React.createElement(ReasoningCard, {
      segmentation, streaming: false, durationMs: 1200, expanded: false, onToggle() {},
      tokens, compact: true, storeKey: "thought:press", copyText: "Checking the list of files. Then the tests.",
    }));
    act(() => row(renderer).props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(textOf(panel(renderer))).toContain("Checking the list of files.");
    act(() => renderer.unmount());
  });

  // A picture is opened, not previewed: a long press on its header or on an
  // image read's row opens the full-screen viewer a press on the thumbnail opens.
  const viewers = (renderer: ReturnType<typeof TestRenderer.create>) =>
    renderer.root.findAll((node) => (node.type as unknown) === "ImageViewer");

  it("opens the viewer from a long press on an image card's header", () => {
    const file = { dataUri: "data:image/png;base64,AAAA", width: 637, height: 1400, bytes: 405_000, error: null };
    const renderer = render(React.createElement(ImagePreview, { path: "/tmp/shots/a.png", file, tokens, bleed: true }));
    const header = renderer.root.find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Hide the image /tmp/shots/a.png");
    // Hidden or shown, the long press opens the picture.
    act(() => header.props.onPress());
    expect(viewers(renderer)).toHaveLength(0);
    act(() => header.props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(panels(renderer)).toHaveLength(0);
    expect(viewers(renderer)).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it("reads a collapsed image read on a long press and opens it in the viewer", () => {
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/shot.png", content: "" } });
    const requestImage = vi.fn();
    const element = (imageFile: ImageFile | null) =>
      React.createElement(ToolCallout, { data: read, tokens, compact: true, imageFile, requestImage });
    const renderer = render(element(null));
    act(() => row(renderer).props.onLongPress());
    expect(requestImage).toHaveBeenCalledTimes(1);
    expect(panels(renderer)).toHaveLength(0);
    // Nothing to show until the bytes arrive.
    expect(viewers(renderer)).toHaveLength(0);
    act(() => renderer.update(element({ dataUri: "data:image/png;base64,AAAA", width: 637, height: 1400, bytes: 405_000, error: null })));
    expect(viewers(renderer)).toHaveLength(1);
    expect(row(renderer).props["aria-expanded"]).toBe(false);
    act(() => renderer.unmount());
  });

  it("says why when a long-pressed image read cannot be read", () => {
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/gone.png", content: "" } });
    const element = (imageFile: ImageFile | null) =>
      React.createElement(ToolCallout, { data: read, tokens, compact: true, imageFile, requestImage() {} });
    const renderer = render(element(null));
    act(() => row(renderer).props.onLongPress());
    act(() => renderer.update(element({ dataUri: null, width: null, height: null, bytes: null, error: "ENOENT: no such file" })));
    expect(clipboard.error).toHaveBeenCalledWith("ENOENT: no such file");
    expect(viewers(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("opens a Read row's preview from a long press on its path, while a tap still copies the path", async () => {
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "const value = 1;" } });
    const renderer = render(React.createElement(ToolCallout, { data: read, tokens, compact: true }));
    // The path target fills most of the row, so it is what a finger lands on.
    const path = () => row(renderer).find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "/w/a.ts");
    await act(async () => { path().props.onPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("/w/a.ts");
    clipboard.copyText.mockClear();
    act(() => path().props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(textOf(panel(renderer))).toContain("const value = 1;");
    act(() => renderer.unmount());
  });

  it("still copies from an opened row, which shows no preview", async () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true, expanded: true }));
    await act(async () => { row(renderer).props.onLongPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("still copies when previews are turned off", async () => {
    updateEnhancerPreferences({ hoverPreview: false });
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    await act(async () => { row(renderer).props.onLongPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });
});

describe("where the long-press preview goes", () => {
  it.each(["ios", "android"].flatMap((os) => [false, true].map((reduced) => ({ os, reduced }))))
  ("starts the new entrance only after the modal and final layout are ready on $os (reduced=$reduced)", ({ os, reduced }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    motion.reduced = reduced;
    const timing = vi.spyOn(Animated, "timing");
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    try {
      act(() => row(renderer).props.onLongPress());
      const modal = renderer.root.findByType("Modal" as never);
      expect(modal.props.animationType).toBe("none");
      expect(timing).not.toHaveBeenCalled();
      const stage = renderer.root.findByProps({ testID: "hover-preview-stage" });
      act(() => stage.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } }));
      act(() => panel(renderer).props.onLayout({ nativeEvent: { layout: { width: 374, height: 280 } } }));
      expect(timing).not.toHaveBeenCalled();
      act(() => modal.props.onShow());
      if (reduced) expect(timing).not.toHaveBeenCalled();
      else expect(timing).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({
        duration: 140, toValue: 1, useNativeDriver: true,
      }));
      // Repeated layout and content updates must not restart the entrance.
      act(() => stage.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } }));
      expect(timing).toHaveBeenCalledTimes(reduced ? 0 : 1);
    } finally {
      act(() => renderer.unmount());
      timing.mockRestore();
      motion.reduced = false;
    }
  });

  it("sits between the header and the composer, as wide as the row", () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    // Hidden until the safe area is measured.
    expect(StyleSheetFlat(panel(renderer).props.style).opacity).toBe(0);
    const stage = renderer.root.findByProps({ testID: "hover-preview-stage" });
    act(() => stage.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 790 } } }));
    expect(StyleSheetFlat(stage.props.style)).toMatchObject({
      flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 64, paddingBottom: 104,
    });
    const style = StyleSheetFlat(panel(renderer).props.style);
    // 790, less the header (64), the composer (104) and 8 on each side.
    expect(style).toMatchObject({ width: 390, maxHeight: 606 });
    expect(style.position).toBeUndefined();
    expect(style.opacity).toBeUndefined();
    act(() => renderer.unmount());
  });

  it("leaves the header and the composer in view, covering the tab bar", () => {
    // An iPhone 16 Pro's safe area: 759 tall.
    expect(pressPreviewFrame({ width: 402, height: 759 }, 386, "ios")).toEqual({ width: 386, maxHeight: 575 });
    // Android's stage keeps the navigation bar, so its composer sits higher.
    expect(pressPreviewFrame({ width: 402, height: 759 }, 386, "android")).toEqual({ width: 386, maxHeight: 559 });
  });

  it("never asks for a negative height", () => {
    expect(pressPreviewFrame({ width: 750, height: 150 }, 734, "ios").maxHeight).toBe(0);
  });

  it("keeps the margins at the sides when the row is wider than the safe area", () => {
    expect(pressPreviewFrame({ width: 390, height: 750 }, 406, "ios").width).toBe(374);
  });

  it("centres the measured panel in the band between the header and the composer", () => {
    // 700 tall, less 64 above and 104 below, leaves 532. A 280 panel sits 126 into that band.
    expect(pressPreviewOrigin({ width: 390, height: 700 }, { width: 374, height: 280 }, "ios")).toEqual({
      x: 8, y: 190, width: 374, height: 280,
    });
  });
});

describe("dragging the long-press preview", () => {
  const at = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });

  function opened() {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const stage = renderer.root.findByProps({ testID: "hover-preview-stage" });
    act(() => stage.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } }));
    act(() => panel(renderer).props.onLayout({ nativeEvent: { layout: { x: 8, y: 190, width: 374, height: 280 } } }));
    return renderer;
  }

  it("moves with the toolbar and resizes from an edge", () => {
    const renderer = opened();
    expect(StyleSheetFlat(panel(renderer).props.style)).toMatchObject({
      position: "absolute", left: 8, top: 190, width: 374, height: 280,
    });
    const toolbar = panel(renderer).findByProps({ testID: "hover-preview-toolbar" });
    // A finger that barely moves is still a tap.
    act(() => { toolbar.props.onStartShouldSetResponderCapture(at(120, 220)); });
    expect(toolbar.props.onMoveShouldSetResponderCapture(at(122, 222))).toBe(false);
    expect(toolbar.props.onMoveShouldSetResponderCapture(at(120, 280))).toBe(true);
    act(() => { toolbar.props.onResponderGrant(at(120, 280)); });
    // The window is as wide as the stage allows, so it slides only vertically: 190 + 60.
    expect(StyleSheetFlat(panel(renderer).props.style)).toMatchObject({ left: 8, top: 250, width: 374, height: 280 });

    const east = panel(renderer).findByProps({ testID: "hover-preview-edge-e" });
    act(() => { east.props.onResponderGrant(at(370, 300)); });
    act(() => { east.props.onResponderMove(at(368, 300)); });
    expect(StyleSheetFlat(panel(renderer).props.style).width).toBe(374);
    act(() => { east.props.onResponderMove(at(330, 300)); });
    // Dragging the right edge left by 40 narrows it; the left edge stays.
    expect(StyleSheetFlat(panel(renderer).props.style)).toMatchObject({ left: 8, width: 334, height: 280 });

    const narrowed = panel(renderer).findByProps({ testID: "hover-preview-toolbar" });
    act(() => { narrowed.props.onStartShouldSetResponderCapture(at(40, 200)); });
    act(() => { narrowed.props.onResponderGrant(at(80, 200)); });
    // Now there is room beside it: 8 + 40.
    expect(StyleSheetFlat(panel(renderer).props.style)).toMatchObject({ left: 48, top: 250, width: 334 });
    act(() => renderer.unmount());
  });
});

describe("selecting text in the long-press preview", () => {
  const roots = (node: ReactTestInstance) =>
    node.findAll((child) => (child.type as unknown) === "RNUITextView");

  it("puts a cursor in the command and its output on iOS", () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const texts = roots(panel(renderer)).map((root) => ({ text: textOf(root), selectable: root.props.selectable }));
    expect(texts).toEqual([
      { text: "$ printf full-command", selectable: true },
      { text: "full-output", selectable: true },
    ]);
    act(() => renderer.unmount());
  });

  it("puts a cursor in a Read row's file on iOS", () => {
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "const value = 1;" } });
    const renderer = render(React.createElement(ToolCallout, { data: read, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    expect(roots(panel(renderer)).map((root) => textOf(root))).toEqual(["/w/a.ts", "const value = 1;"]);
    act(() => renderer.unmount());
  });

  it("keeps the opened row's body on plain selectable Text", () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true, expanded: true }));
    expect(roots(renderer.root)).toHaveLength(0);
    const command = renderer.root.find((node) =>
      (node.type as unknown) === "Text" && node.props.selectable === true && textOf(node) === "$ printf full-command");
    expect(command).toBeDefined();
    act(() => renderer.unmount());
  });

  it("selects through Android's own selectable Text", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    expect(roots(panel(renderer))).toHaveLength(0);
    const output = panel(renderer).find((node) =>
      (node.type as unknown) === "Text" && node.props.selectable === true && textOf(node) === "full-output");
    expect(output).toBeDefined();
    act(() => renderer.unmount());
  });
});

describe("wrapping lines in the long-press preview", () => {
  const wrapButton = (renderer: ReturnType<typeof TestRenderer.create>) =>
    panel(renderer).find((node) => (node.type as unknown) === "Pressable" &&
      (node.props.accessibilityLabel === "Do not wrap lines" || node.props.accessibilityLabel === "Wrap lines"));
  const icon = (button: ReactTestInstance) =>
    button.find((node) => (node.type as unknown) === "View" && typeof node.props.name === "string").props.name;
  const sideways = (renderer: ReturnType<typeof TestRenderer.create>) =>
    panel(renderer).findAll((node) => (node.type as unknown) === "Animated.ScrollView" && node.props.horizontal === true);

  it("wraps by default and scrolls sideways once wrap is turned off", () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    expect(wrapButton(renderer).props.accessibilityLabel).toBe("Do not wrap lines");
    expect(icon(wrapButton(renderer))).toBe("WrapText");
    expect(sideways(renderer)).toHaveLength(0);

    act(() => wrapButton(renderer).props.onPress());
    expect(wrapButton(renderer).props.accessibilityLabel).toBe("Wrap lines");
    expect(icon(wrapButton(renderer))).toBe("AlignLeft");
    const [scroller] = sideways(renderer);
    expect(textOf(scroller!)).toContain("full-output");

    act(() => wrapButton(renderer).props.onPress());
    expect(icon(wrapButton(renderer))).toBe("WrapText");
    expect(sideways(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("caps an unwrapped body's width, so a minified line still draws on a phone", () => {
    // A layer wider than the GPU's largest texture draws nothing on a device:
    // a 1,700-character JSON line left the whole output blank.
    const json = classifyTool({ name: "probe", status: "completed", detail: {
      type: "unknown", input: {}, output: `profiles_ids=${"legacy_favorite:codex:gpt-6-x,".repeat(60)}`,
    } });
    const renderer = render(React.createElement(ToolCallout, { data: json, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    act(() => wrapButton(renderer).props.onPress());
    const [scroller] = sideways(renderer);
    const body = scroller!.find((node) => (node.type as unknown) === "View" &&
      StyleSheetFlat(node.props.style).maxWidth !== undefined);
    expect(StyleSheetFlat(body.props.style).maxWidth).toBe(MAX_UNWRAPPED_WIDTH);
    expect(textOf(body)).toContain("legacy_favorite:codex:gpt-6-x");
    act(() => renderer.unmount());
  });

  it("keeps a command's line breaks in the native text, with stripes on", () => {
    // The UITextView takes its text from its child runs only; a bare string
    // beside them never reaches it, and every line ran into the next.
    const lines = classifyTool({ name: "Bash", status: "completed", detail: {
      type: "shell", command: "cat ids.txt", output: "short line one\nprofiles_ids=a,b\nshort line three\n",
    } });
    const renderer = render(React.createElement(ToolCallout, { data: lines, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const runs = (node: ReactTestInstance): string => node.children.map((child) => typeof child === "string" ? ""
      : (child.type as unknown) === "RNUITextViewChild" ? String(child.props.text) : runs(child)).join("");
    const output = panel(renderer).findAll((node) => (node.type as unknown) === "RNUITextView")
      .map(runs).find((text) => text.includes("profiles_ids"));
    expect(output).toBe("short line one\nprofiles_ids=a,b\nshort line three");
    act(() => renderer.unmount());
  });

  it("wraps again when the preview reopens", () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    act(() => wrapButton(renderer).props.onPress());
    const backdrop = renderer.root.find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Close preview");
    act(() => backdrop.props.onPress());
    act(() => row(renderer).props.onLongPress());
    expect(icon(wrapButton(renderer))).toBe("WrapText");
    act(() => renderer.unmount());
  });
});

function StyleSheetFlat(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(StyleSheetFlat));
  return typeof style === "object" ? (style as Record<string, unknown>) : {};
}
