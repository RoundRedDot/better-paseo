import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ copyText: vi.fn() }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { useSelectionActions } = await import("../../client/components/selection-actions");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");

// Only the DOM boundary is simulated; the hook, controller, and bar are real.
class ElementMock extends EventTarget {
  static ELEMENT_NODE = 1;
  nodeType = 1;
  dataset: Record<string, string> = {};
  children: ElementMock[] = [];
  parentElement: ElementMock | null = null;
  shadowRoot: ElementMock | null = null;
  className = "";
  offsetWidth = 180;
  offsetHeight = 30;
  private classes = new Set<string>();
  classList = {
    add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
    remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    contains: (name: string) => this.classes.has(name),
  };
  private properties = new Map<string, string>();
  style = {
    setProperty: (key: string, value: string) => this.properties.set(key, value),
    getPropertyValue: (key: string) => this.properties.get(key) ?? "",
  };
  setAttribute() {}
  toggleAttribute() {}
  attachShadow() { return this.shadowRoot = new ElementMock(); }
  appendChild(child: ElementMock) { child.parentElement = this; this.children.push(child); return child; }
  remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); }
  contains(node: unknown): boolean {
    for (let at = node as ElementMock | null; at; at = at.parentElement) if (at === this) return true;
    return false;
  }
  box = { left: 0, top: 0, right: 1024, bottom: 768 };
  getBoundingClientRect() { return this.box; }
  closest(selector: string) { return selector === "[data-bcselection]" ? this : null; }
}

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d23c3c",
});
function Actions() { useSelectionActions(tokens, true); return null; }

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let page: EventTarget;
let doc: EventTarget;
let body: ElementMock;
let selection: { isCollapsed: boolean; toString(): string };
/** The selected text's line, as the browser reports it; a scroll moves it. */
let line: { left: number; right: number; top: number; bottom: number; width: number; height: number };
/** The chat's scroller, holding the selected text. */
let scroller: ElementMock;
let captureScroll: (event: Event) => void;
const host = () => body.children[0]!;
const display = () => host().style.getPropertyValue("display");
const top = () => Number.parseFloat(host().style.getPropertyValue("top"));
function select() { doc.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(0); }
function on(target: EventTarget, type: string, from: unknown = scroller) {
  const event = new Event(type);
  Object.defineProperty(event, "target", { value: from });
  target.dispatchEvent(event);
}
type Cause = "wheel" | "touch" | "key" | "page";
/**
 * One scroll of the chat (`nested`) or the window. The reader's scrolls come
 * from a wheel, a touch, or a key just before; the page's own come alone.
 */
function scroll(nested: boolean, cause: Cause = "wheel", by = 0) {
  if (cause === "wheel") on(doc, "wheel");
  if (cause === "touch") on(doc, "touchmove");
  if (cause === "key") doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "PageDown" }));
  line = { ...line, top: line.top - by, bottom: line.bottom - by };
  const event = new Event("scroll");
  if (nested) {
    // Element scroll events do not bubble: they reach window in capture only.
    Object.defineProperty(event, "target", { value: scroller });
    captureScroll(event);
  } else page.dispatchEvent(event);
  vi.advanceTimersByTime(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("__rnMockOS", "web");
  vi.stubGlobal("Node", ElementMock);
  page = new EventTarget();
  doc = new EventTarget();
  body = new ElementMock();
  scroller = new ElementMock();
  scroller.box = { left: 0, top: 60, right: 1024, bottom: 700 };
  const text = scroller.appendChild(new ElementMock());
  line = { left: 120, right: 220, top: 200, bottom: 220, width: 100, height: 20 };
  selection = Object.assign({
    isCollapsed: false, toString: () => "selected output", rangeCount: 1,
    anchorNode: text, focusNode: text,
    getRangeAt: () => ({ commonAncestorContainer: text, getClientRects: () => [line] }),
  });
  const add = page.addEventListener.bind(page);
  vi.spyOn(page, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "scroll" && options === true) captureScroll = listener as typeof captureScroll;
    add(type, listener, options);
  });
  vi.stubGlobal("window", Object.assign(page, {
    setTimeout, clearTimeout, innerWidth: 1024, innerHeight: 768, getSelection: () => selection,
  }));
  vi.stubGlobal("document", Object.assign(doc, { body, createElement: () => new ElementMock() }));
  act(() => { renderer = TestRenderer.create(React.createElement(Actions)); });
  select();
  expect(display()).toBe("block");
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selection bar scroll dismissal", () => {
  it.each([
    [true, "wheel"], [false, "wheel"], [true, "touch"], [true, "key"],
  ] as const)("hides on the reader's scroll (nested=%s, %s), keeps the highlight, and reopens for a new selection", (nested, cause) => {
    scroll(nested, cause, 40);
    expect(display()).toBe("none");
    expect(selection.isCollapsed).toBe(false);
    page.dispatchEvent(new Event("resize"));
    scroll(nested, "page");
    expect(display()).toBe("none");
    select();
    expect(display()).toBe("block");
  });

  it("hides when the reader drags the chat's scrollbar", () => {
    on(doc, "pointerdown", scroller);
    select();
    expect(display()).toBe("block");
    scroll(true, "page", 40);
    expect(display()).toBe("none");
    on(doc, "pointerup", scroller);
  });

  it("hides when the reader drags an overlay scrollbar drawn beside the chat", () => {
    on(doc, "pointerdown", new ElementMock());
    select();
    expect(display()).toBe("block");
    scroll(true, "page", 40);
    expect(display()).toBe("none");
  });

  it("stays while the chat scrolls by itself under a press on its text", () => {
    const text = scroller.appendChild(new ElementMock());
    on(doc, "pointerdown", text);
    select();
    scroll(true, "page", 20);
    expect(display()).toBe("block");
    on(doc, "pointerup", text);
  });

  it("keeps a bar closed with Escape away while the page scrolls", () => {
    doc.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
    vi.advanceTimersByTime(100);
    expect(display()).toBe("none");
    scroll(true, "page", 10);
    expect(display()).toBe("none");
    select();
    expect(display()).toBe("block");
  });

  it("does not reopen from a selection update queued before the reader scrolls", () => {
    doc.dispatchEvent(new Event("selectionchange"));
    scroll(true, "wheel");
    expect(display()).toBe("none");
  });

  // A double-clicked word in a chat that is still writing its reply: the host
  // keeps the chat pinned to its end and scrolls it a moment after the
  // selection, with no wheel or key from the reader.
  it("stays with a double-clicked word while the chat follows its streaming output", () => {
    on(doc, "pointerdown", new ElementMock());
    vi.advanceTimersByTime(100);
    expect(display()).toBe("none");
    on(doc, "pointerup", new ElementMock());
    select();
    expect(display()).toBe("block");
    const before = top();
    scroll(true, "page", 24);
    expect(display()).toBe("block");
    expect(top()).toBe(before - 24);
    scroll(false, "page");
    expect(display()).toBe("block");
  });

  it("follows a page scroll that comes after the reader's gesture has ended", () => {
    on(doc, "wheel");
    vi.advanceTimersByTime(1000);
    scroll(true, "page", 10);
    expect(display()).toBe("block");
  });

  it("hides while the page carries the selection out of the chat, and returns with it", () => {
    scroll(true, "page", 400);
    expect(display()).toBe("none");
    scroll(true, "page", -400);
    expect(display()).toBe("block");
  });

  it("stays with a two-paragraph selection while its later line still shows in the chat", () => {
    // Chromium (checked headless): scrolled past the chat's top, the first line
    // box is outside the scroller while the next paragraph's is inside.
    const range = (selection as unknown as { getRangeAt(index: number): { commonAncestorContainer: unknown } }).getRangeAt(0);
    const next = () => ({ ...line, top: line.top + 30, bottom: line.bottom + 30 });
    selection = { ...selection, getRangeAt: () => ({ commonAncestorContainer: range.commonAncestorContainer, getClientRects: () => [line, next()] }) } as typeof selection;
    select();
    expect(top()).toBe(200 - 30 - 8);
    // The first line leaves the chat's top (60); the second, at 65, shows.
    scroll(true, "page", 165);
    expect(display()).toBe("block");
    // Above the line that still shows.
    expect(top()).toBe(65 - 30 - 8);
    // Both lines gone: the bar goes, and returns with them.
    scroll(true, "page", 40);
    expect(display()).toBe("none");
    scroll(true, "page", -205);
    expect(display()).toBe("block");
    expect(top()).toBe(200 - 30 - 8);
  });

  it("keeps a bar put away by a press elsewhere away while the page scrolls", () => {
    on(doc, "pointerdown", new ElementMock());
    on(doc, "pointerup", new ElementMock());
    vi.advanceTimersByTime(100);
    expect(display()).toBe("none");
    scroll(true, "page", 10);
    expect(display()).toBe("none");
    select();
    expect(display()).toBe("block");
  });
});
