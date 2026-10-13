/**
 * The table's copy control on a desktop pointer: hovering widens its rounded
 * square to the right into "Copy as Markdown" and "Copy as image". Touch and native keep the
 * single button (`markdown-table-copy.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const { copyText, toastShow, toastError, copyElementImage, capabilities } = vi.hoisted(() => ({
  copyText: vi.fn(async (_text: string) => {}),
  toastShow: vi.fn(),
  toastError: vi.fn(),
  copyElementImage: vi.fn(async (_element: unknown, _options: { background: string }) => {}),
  capabilities: { hover: true, touch: false },
}));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    copyText,
    useToast: () => ({ show: toastShow, error: toastError, success() {} }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  noteHover() {},
  useInputCapabilities: () => ({ ...capabilities, compact: false, native: false }),
}));
vi.mock("../../client/ui/element-image", () => ({ canCopyImage: () => true, copyElementImage }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { getEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const { StyleSheet } = await import("./helpers/rn-mock");
const { floatShadow } = await import("../../client/ui/tokens/float");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockOS = globalThis as { __rnMockOS?: string };

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});
const SOURCE = "| A | B |\n| --- | --- |\n| one | two |";
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
type TestInstance = ReturnType<typeof TestRenderer.create>["root"];
let previousLanguage = getEnhancerPreferences().language;

function render(text = SOURCE) {
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(MarkdownView, { text, tokens, variant: "document" }),
      { createNodeMock: (element) => domNode((element.props as { style?: unknown }).style) },
    );
  });
  return renderer!;
}

/** Enough of a DOM element for the hover binding, tagged with its host's style. */
type Listener = (event: { target: unknown }) => void;
interface EventTargetMock {
  listeners: Map<string, Set<Listener>>;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}
interface DomNodeMock extends EventTargetMock {
  mock: unknown;
  ownerDocument: EventTargetMock & { defaultView: EventTargetMock };
  style: { setProperty: ReturnType<typeof vi.fn> };
  contains(other: unknown): boolean;
}

/** Enough of a DOM element for the hover and dismiss bindings, tagged with its host's style. */
function domNode(style: unknown): DomNodeMock {
  const doc = { ...target(), defaultView: target() };
  const node: DomNodeMock = { mock: style, ...target(), ownerDocument: doc, style: { setProperty: vi.fn() },
    contains: (other) => other === node };
  nodes.push(node);
  return node;
}

/** Listeners by event, so a test can scroll the page or touch somewhere. */
function target(): EventTargetMock {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
}
let nodes: DomNodeMock[] = [];

/** Fires a document-wide event on every mocked window or document that listens. */
function fire(on: "window" | "document", type: string, eventTarget: unknown = {}) {
  const seen = new Set<unknown>();
  for (const node of nodes) {
    const host = on === "window" ? node.ownerDocument.defaultView : node.ownerDocument;
    if (seen.has(host)) continue;
    seen.add(host);
    for (const listener of [...(host.listeners.get(type) ?? [])]) listener({ target: eventTarget });
  }
}

function entries() {
  return renderer!.root.findAll((node) => String(node.type) === "Pressable"
    && typeof node.props.accessibilityLabel === "string"
    && /^(Copy|Copied)/.test(node.props.accessibilityLabel));
}

/** The entries a pointer or keyboard can reach: the rest sit clipped inside the closed circle. */
function reachable() {
  return entries().filter((node) => !node.props["aria-hidden"]).map((node) => node.props.accessibilityLabel);
}

function entry(label: string) {
  return entries().find((node) => node.props.accessibilityLabel === label)!;
}

beforeEach(() => {
  mockOS.__rnMockOS = "web";
  capabilities.hover = true;
  capabilities.touch = false;
  previousLanguage = getEnhancerPreferences().language;
  updateEnhancerPreferences({ language: "zh" });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  nodes = [];
  delete mockOS.__rnMockOS;
  act(() => { updateEnhancerPreferences({ language: previousLanguage }); });
  copyText.mockClear();
  toastShow.mockClear();
  toastError.mockClear();
  copyElementImage.mockReset();
});

describe("Markdown table copy menu", () => {
  it("is a rounded square until hovered, then widens into a rounded rectangle of two named entries", () => {
    render();
    const frame = () => renderer!.root.findAll((node) => String(node.type) === "View"
      && StyleSheet.flatten(node.props.style).overflow === "hidden"
      && node.findAll((child) => child.props.accessibilityLabel === "Copy as image").length > 0)[0]!;
    const row = () => frame().findAll((node) => typeof node.props.onLayout === "function")[0]!;
    // The nearest fading layer: the first entry's name on its own, the second entry whole.
    const shown = (node: TestInstance) => {
      let layer = node;
      while (!StyleSheet.flatten(layer.props.style).transform) layer = layer.parent!;
      const style = StyleSheet.flatten(layer.props.style);
      return [style.opacity, (style.transform as Array<{ translateX: number }>)[0]!.translateX];
    };
    const names = () => entries().map((node) => {
      const text = node.findAll((child) => String(child.type) === "Text")[0]!;
      return [text.children.join(""), ...shown(text)];
    });
    expect(StyleSheet.flatten(frame().props.style)).toMatchObject({
      width: 30, height: 30, borderRadius: 12, borderWidth: 1, borderColor: tokens.v2.border,
      boxShadow: floatShadow(tokens, false),
      transitionProperty: "width, box-shadow",
      transitionDuration: "160ms, 120ms",
    });
    expect(reachable()).toEqual(["Copy as Markdown"]);
    expect(names()).toEqual([["复制为 Markdown", 0, -4], ["复制为图片", 0, -4]]);

    act(() => { row().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 247.4, height: 28 } } }); });
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    // Opening widens the frame and lifts its shadow; the edge never darkens.
    expect(StyleSheet.flatten(frame().props.style)).toMatchObject({
      width: 250, borderRadius: 12, borderColor: tokens.v2.border,
      boxShadow: floatShadow(tokens),
      transitionDuration: "180ms, 180ms",
    });
    expect(reachable()).toEqual(["Copy as Markdown", "Copy as image"]);
    expect(names()).toEqual([["复制为 Markdown", 1, 0], ["复制为图片", 1, 0]]);
    expect(StyleSheet.flatten(entry("Copy as image").props.style)).toMatchObject({ transitionDelay: "40ms" });
  });

  it("opens for keyboard focus, so Tab reaches the second entry", () => {
    render();
    act(() => { entry("Copy as Markdown").props.onFocus(); });
    expect(reachable()).toEqual(["Copy as Markdown", "Copy as image"]);
    act(() => { entry("Copy as Markdown").props.onBlur(); });
    act(() => { entry("Copy as image").props.onFocus(); });
    expect(reachable()).toEqual(["Copy as Markdown", "Copy as image"]);
    act(() => { entry("Copy as image").props.onBlur(); });
    expect(reachable()).toEqual(["Copy as Markdown"]);
  });

  it("drops the transition under reduced motion", async () => {
    const { AccessibilityInfo } = await import("./helpers/rn-mock");
    const spy = vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    try {
      await act(async () => { render(); });
      const durations = renderer!.root.findAll((node) => String(node.type) === "View"
        && StyleSheet.flatten(node.props.style).transitionDuration !== undefined)
        .map((node) => StyleSheet.flatten(node.props.style).transitionDuration);
      expect(durations.length).toBeGreaterThan(0);
      expect(new Set(durations.flatMap((value) => String(value).split(", ")))).toEqual(new Set(["0ms"]));
    } finally {
      spy.mockRestore();
    }
  });

  it("copies the table's Markdown source", async () => {
    render();
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    await act(async () => { entry("Copy as Markdown").props.onPress(); });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(SOURCE);
    expect(toastShow).toHaveBeenCalledExactlyOnceWith("已复制为 Markdown");
    expect(entries().map((node) => node.props.accessibilityLabel)).toEqual(["Copied", "Copy as image"]);
    const check = entry("Copied").findAll((node) => String(node.type) === "Icon")[0]!;
    expect(check.props).toMatchObject({ name: "Check", color: tokens.success });
  });

  it("copies a picture of the table frame on the chat surface", async () => {
    render();
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    await act(async () => { entry("Copy as image").props.onPress(); });
    expect(copyText).not.toHaveBeenCalled();
    expect(copyElementImage).toHaveBeenCalledTimes(1);
    const [element, options] = copyElementImage.mock.calls[0]!;
    // The frame alone: the copy control at its corner stays out of the picture.
    const frame = renderer!.root.findAll((node) => String(node.type) === "View"
      && node.props.style === (element as { mock: unknown }).mock);
    expect(frame).toHaveLength(1);
    expect(frame[0]!.findAll((node) => node.props.accessibilityLabel === "Copy as image")).toHaveLength(0);
    expect(frame[0]!.findAll((node) => String(node.type) === "Text" && node.children[0] === "one")).toHaveLength(1);
    expect(options).toEqual({ background: tokens.surface0 });
    expect(toastShow).toHaveBeenCalledExactlyOnceWith("已复制为图片");
    expect(entries().map((node) => node.props.accessibilityLabel)).toEqual(["Copy as Markdown", "Copied"]);
  });

  it("reports a failed image copy and never shows the check", async () => {
    copyElementImage.mockRejectedValueOnce(new Error("denied"));
    render();
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    await act(async () => { entry("Copy as image").props.onPress(); });
    expect(toastShow).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledExactlyOnceWith("复制失败");
    expect(entry("Copy as image")).toBeDefined();
  });

  describe("on a touch screen", () => {
    beforeEach(() => { capabilities.hover = false; capabilities.touch = true; });

    it("copies the Markdown on a tap and stays a single button", async () => {
      render();
      await act(async () => { entry("Copy as Markdown").props.onPress(); });
      expect(copyText).toHaveBeenCalledExactlyOnceWith(SOURCE);
      // A hover a phone reports for a tap does not open it either.
      act(() => { entry("Copied").props.onHoverIn(); });
      expect(reachable()).toEqual(["Copied"]);
    });

    it("opens on a long press and closes when anything scrolls", () => {
      render();
      act(() => { entry("Copy as Markdown").props.onLongPress(); });
      expect(reachable()).toEqual(["Copy as Markdown", "Copy as image"]);
      act(() => { fire("window", "scroll"); });
      expect(reachable()).toEqual(["Copy as Markdown"]);
    });

    it("stays open for a touch on itself and closes for a touch elsewhere", async () => {
      render();
      act(() => { entry("Copy as Markdown").props.onLongPress(); });
      // The control listens for touches on its document while it is open.
      const anchor = nodes.find((node) => (node.ownerDocument.listeners.get("pointerdown")?.size ?? 0) > 0);
      expect(anchor).toBeDefined();
      act(() => { fire("document", "pointerdown", anchor); });
      expect(reachable()).toEqual(["Copy as Markdown", "Copy as image"]);
      await act(async () => { entry("Copy as image").props.onPress(); });
      expect(copyElementImage).toHaveBeenCalledTimes(1);
      act(() => { fire("document", "pointerdown", {}); });
      expect(reachable()).toEqual(["Copy as Markdown"]);
    });

    it("keeps iOS Safari's callout off a long press", () => {
      render();
      expect(nodes.some((node) => node.style.setProperty.mock.calls
        .some(([name, value]) => name === "-webkit-touch-callout" && value === "none"))).toBe(true);
    });
  });

  it("keeps the single Markdown button on native", () => {
    mockOS.__rnMockOS = "ios";
    render();
    expect(entries().map((node) => node.props.accessibilityLabel)).toEqual(["Copy Markdown table"]);
  });
});
