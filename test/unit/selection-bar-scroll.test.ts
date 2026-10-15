import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn() }));

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
let captureScroll: (event: Event) => void;
const display = () => body.children[0]!.style.getPropertyValue("display");
function select() { doc.dispatchEvent(new Event("selectionchange")); vi.advanceTimersByTime(0); }
function scroll(nested: boolean) {
  const event = new Event("scroll");
  if (nested) {
    // Element scroll events do not bubble: they reach window in capture only.
    Object.defineProperty(event, "target", { value: new ElementMock() });
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
  const text = new ElementMock();
  selection = Object.assign({
    isCollapsed: false, toString: () => "selected output", rangeCount: 1,
    anchorNode: text, focusNode: text,
    getRangeAt: () => ({ commonAncestorContainer: text,
      getClientRects: () => [{ left: 120, top: 200, bottom: 220, width: 100, height: 20 }],
    }),
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
  it.each([true, false])("hides on scroll (nested=%s), keeps the highlight, and reopens for a new selection", (nested) => {
    scroll(nested);
    expect(display()).toBe("none");
    expect(selection.isCollapsed).toBe(false);
    page.dispatchEvent(new Event("resize"));
    scroll(nested);
    expect(display()).toBe("none");
    select();
    expect(display()).toBe("block");
  });

  it("does not reopen from a selection update queued before scrolling", () => {
    doc.dispatchEvent(new Event("selectionchange"));
    scroll(true);
    expect(display()).toBe("none");
  });
});
