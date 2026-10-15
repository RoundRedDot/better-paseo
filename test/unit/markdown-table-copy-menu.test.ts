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
const { ChatComposerContext } = await import("../../client/ui/chat-composer");
const { getEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const { StyleSheet, Animated } = await import("./helpers/rn-mock");
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

function render(text = SOURCE, composer?: { appendText(text: string): boolean }) {
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(ChatComposerContext.Provider, { value: composer },
        React.createElement(MarkdownView, { text, tokens, variant: "document" })),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const selectionRow = () => renderer!.root.findAll((node) => String(node.type) === "View"
  && node.props.testID === "table-selection-menu-row")[0]!;

/** The same textarea setter and input event boundary the host composer uses. */
function desktopComposer(available = true) {
  class TextArea extends EventTarget {
    private text = "Existing draft";
    selectionStart = this.text.length;
    selectionEnd = this.text.length;
    get value() { return this.text; }
    set value(text: string) { this.text = text; }
    focus = vi.fn();
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
    getClientRects() { return [{}]; }
  }
  vi.stubGlobal("HTMLTextAreaElement", TextArea);
  vi.stubGlobal("HTMLInputElement", class {});
  vi.stubGlobal("document", { execCommand: vi.fn(() => false) });
  const input = new TextArea();
  const published = vi.fn();
  input.addEventListener("input", () => published(input.value));
  const scope = { parentElement: null, querySelectorAll: () => available ? [input] : [] };
  for (const node of nodes) Object.assign(node, { querySelectorAll: () => [], parentElement: scope });
  return { input, published };
}

describe("Markdown table copy menu", () => {
  it("binds cell selection to the frame and marks only header and body cells", () => {
    render();
    const cells = renderer!.root.findAll((node) => String(node.type) === "Text"
      && node.props.testID === "markdown-table-cell");
    expect(cells.map((node) => node.children.join(""))).toEqual(["A", "B", "one", "two"]);
    expect(cells.every((node) => node.props.selectable)).toBe(true);
    const frames = nodes.filter((node) => node.listeners.get("dblclick")?.size);
    expect(frames).toHaveLength(1);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(frames[0]!.listeners.get("dblclick")?.size).toBe(0);
  });

  function doubleClick(index: number) {
    const frame = nodes.find((node) => node.listeners.get("dblclick")?.size)!;
    const props = renderer!.root.findAll((node) => String(node.type) === "Text"
      && node.props.testID === "markdown-table-cell")[index]!.props;
    const cell = { getAttribute: (name: string) => name === "data-table-cell-key"
      ? props.dataSet.tableCellKey : props.dataSet.tableCellText };
    frame.contains = (other) => other === cell;
    const removeAllRanges = vi.fn();
    Object.assign(frame.ownerDocument.defaultView, { getSelection: () => ({ removeAllRanges }) });
    const event = {
      target: { closest: () => cell },
      button: 0, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(),
    };
    act(() => { for (const listener of frame.listeners.get("dblclick")!) listener(event); });
    expect(removeAllRanges).toHaveBeenCalledOnce();
    return cell;
  }

  const selectedCopy = () => entry("Copy selected cell");
  const selectedCells = () => renderer!.root.findAll((node) => String(node.type) === "Text"
    && node.props.testID === "markdown-table-cell"
    && StyleSheet.flatten(node.props.style).backgroundColor === tokens.accentBg);

  it("adds a double-clicked cell through the desktop input with an icon and translated label", () => {
    const appendText = vi.fn(() => true);
    render(SOURCE, { appendText });
    doubleClick(2);
    const { input, published } = desktopComposer();
    const add = renderer!.root.findAll((node) => String(node.type) === "Pressable"
      && node.props.accessibilityLabel === "Add to chat")[0]!;
    expect(add.findAll((node) => String(node.type) === "Text")[0]!.children).toEqual(["添加到对话"]);
    expect(add.findAll((node) => String(node.type) === "Icon")[0]!.props.name).toBe("MessageSquarePlus");
    act(() => add.props.onPress());
    expect(input.value).toBe("Existing draft\n\n> one\n\n");
    expect(published).toHaveBeenCalledExactlyOnceWith(input.value);
    expect(input.focus).toHaveBeenCalledOnce();
    expect(appendText).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
    expect(selectedCells()).toHaveLength(0);
  });

  it("shows both actions on desktop without the unreleased host composer capability", () => {
    render();
    doubleClick(2);
    const { input, published } = desktopComposer();
    const add = renderer!.root.findAll((node) => String(node.type) === "Pressable"
      && node.props.accessibilityLabel === "Add to chat");
    expect(add).toHaveLength(1);
    act(() => add[0]!.props.onPress());
    expect(input.value).toBe("Existing draft\n\n> one\n\n");
    expect(published).toHaveBeenCalledExactlyOnceWith(input.value);
    expect(selectedCells()).toHaveLength(0);
  });

  it("keeps the desktop selection when no composer is available without copying instead", () => {
    render();
    doubleClick(2);
    desktopComposer(false);
    act(() => renderer!.root.findAll((node) => String(node.type) === "Pressable"
      && node.props.accessibilityLabel === "Add to chat")[0]!.props.onPress());
    expect(selectedCells()).toHaveLength(1);
    expect(copyText).not.toHaveBeenCalled();
  });

  it.each([0, 2])("double-clicks cell %s with the native highlight and animated copy menu", async (index) => {
    const runs: Array<{ toValue: number; duration: number }> = [];
    vi.spyOn(Animated, "timing").mockImplementation((...args: unknown[]) => {
      runs.push(args[1] as (typeof runs)[number]);
      return { start() {}, stop() {}, reset() {} };
    });
    render("| Header words | B |\n| --- | --- |\n| **bold** and `code` | two |");
    doubleClick(index);
    expect(selectedCells()).toHaveLength(1);
    expect(selectedCells()[0]!.props.dataSet.tableCellText).toBe(index === 0 ? "Header words" : "bold and code");
    act(() => selectionRow().props.onLayout({ nativeEvent: { layout: { width: 96 } } }));
    expect(runs.at(-2)).toMatchObject({ toValue: 98, duration: 180 });
    expect(runs.at(-1)).toMatchObject({ toValue: 1, duration: 140 });
    await act(async () => selectedCopy().props.onPress());
    expect(copyText).toHaveBeenCalledExactlyOnceWith(index === 0 ? "Header words" : "bold and code");
    expect(selectedCells()).toHaveLength(0);
    expect(runs.at(-2)).toMatchObject({ toValue: 30, duration: 160 });
    expect(runs.at(-1)).toMatchObject({ toValue: 0, duration: 80 });
  });

  it("clears the highlight when the page scrolls or the reader clicks elsewhere", () => {
    render();
    doubleClick(2);
    expect(selectedCells()).toHaveLength(1);
    act(() => fire("window", "scroll"));
    expect(selectedCells()).toHaveLength(0);
    doubleClick(3);
    expect(selectedCells()).toHaveLength(1);
    act(() => fire("document", "pointerdown"));
    expect(selectedCells()).toHaveLength(0);
  });

  it("keeps the selection when copying fails", async () => {
    copyText.mockRejectedValueOnce(new Error("denied"));
    render();
    doubleClick(2);
    await act(async () => selectedCopy().props.onPress());
    expect(selectedCells()).toHaveLength(1);
    expect(selectedCopy()).toBeDefined();
    expect(toastError).toHaveBeenCalledExactlyOnceWith("复制失败");
  });

  it("copies with Cmd/Ctrl+C, leaves editable targets alone, and dismisses with Escape", async () => {
    render();
    doubleClick(2);
    const keydown = async (key: string, metaKey = false, ctrlKey = false, editable = false) => {
      const event = { key, metaKey, ctrlKey, altKey: false, defaultPrevented: false,
        target: { closest: () => editable ? {} : null }, preventDefault: vi.fn() };
      await act(async () => {
        for (const node of nodes) {
          for (const listener of [...(node.ownerDocument.listeners.get("keydown") ?? [])]) listener(event);
        }
      });
      return event;
    };
    await keydown("c", true);
    await keydown("c", false, true);
    expect(copyText.mock.calls).toEqual([["one"], ["one"]]);
    const editable = await keydown("c", true, false, true);
    expect(copyText).toHaveBeenCalledTimes(2);
    expect(editable.preventDefault).not.toHaveBeenCalled();
    await keydown("Escape");
    expect(selectedCells()).toHaveLength(0);
    expect(nodes.every((node) => !node.ownerDocument.listeners.get("keydown")?.size)).toBe(true);
  });

  it("clears a selected cell when streaming changes the table source", () => {
    render();
    doubleClick(2);
    act(() => renderer!.update(React.createElement(MarkdownView, {
      text: SOURCE + "\n| three | four |", tokens, variant: "document",
    })));
    expect(selectedCells()).toHaveLength(0);
    expect(selectedCopy()).toBeUndefined();
  });

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
