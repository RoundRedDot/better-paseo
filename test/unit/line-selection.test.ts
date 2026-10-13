import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";
import type { View } from "react-native";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn(), useToast: () => ({ show() {}, error() {} }) }));
import { useLineSelection } from "../../client/ui/line-selection";
import { PreviewScrollerContext, type PreviewScroller } from "../../client/ui/preview-scroller";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const platform = globalThis as { __rnMockOS?: string };
afterEach(() => { delete platform.__rnMockOS; vi.useRealTimers(); vi.unstubAllGlobals(); });

// The DOM is a system boundary: only event delivery, geometry, pointer
// capture, the text's nodes and the page selection are supplied here.
// Selection and gesture state remain real.
class Surface extends EventTarget {
  style = { touchAction: "pan-y" };
  children: Surface[] = [];
  ownerDocument!: FakeDocument;
  contains(target: unknown): boolean { return target === this || this.children.some((child) => child.contains(target)); }
  getBoundingClientRect() { return { top: 100 }; }
  setPointerCapture() {}
  /** A native view's place on screen, 100pt down like its client rect. */
  measure(done: (...values: number[]) => void) { done(0, 0, 40, 50, 0, 100); }
}
class TextNode extends Surface {
  constructor(public nodeValue: string) { super(); }
}
class FakeSelection {
  anchorNode: unknown = null;
  set: unknown[] = [];
  text = "";
  setBaseAndExtent(...points: unknown[]) { this.set = points; this.anchorNode = points[0]; }
  toString() { return this.text; }
}
(globalThis as { NodeFilter?: unknown }).NodeFilter ??= { SHOW_TEXT: 4 };
class FakeDocument extends EventTarget {
  selection = new FakeSelection();
  defaultView = { getSelection: () => this.selection };
  createTreeWalker(root: Surface) {
    const nodes = root.children.filter((child): child is TextNode => child instanceof TextNode);
    let at = -1;
    return { nextNode: () => nodes[++at] ?? null };
  }
}
function fire(node: EventTarget, type: string, values: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  act(() => { node.dispatchEvent(event); });
  return event;
}

function mount(os: string, tops = [0, 10, 30, 40], scroller: PreviewScroller | null = null) {
  platform.__rnMockOS = os;
  const doc = new FakeDocument();
  const gutter = new Surface();
  const content = new Surface();
  // "first\n  wrapped\n\nlast", split across runs as a highlighter would.
  const runs = [new TextNode("first\n  wr"), new TextNode("apped\n\nlast")];
  content.children = runs;
  for (const node of [gutter, content, ...runs]) node.ownerDocument = doc;
  const contentRef = { current: content as unknown as View };
  let current!: ReturnType<typeof useLineSelection>;
  function Harness({ lines = ["first", "  wrapped", "", "last"], enabled = true }: { lines?: string[]; enabled?: boolean }) {
    current = useLineSelection({ enabled, lines, tops, bottom: 50, contentRef });
    return React.createElement("View", { ref: current.gutterRef, testID: "gutter" });
  }
  const Root = (props: { lines?: string[]; enabled?: boolean }) =>
    React.createElement(PreviewScrollerContext.Provider, { value: scroller }, React.createElement(Harness, props));
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Root), { createNodeMock: () => gutter });
  });
  return { doc, gutter, content, runs, renderer, Harness: Root, get state() { return current; },
    close() { act(() => renderer.unmount()); } };
}

describe("gutter line selection", () => {
  it("hands whole wrapped lines to the page selection, anchored where a reverse drag began", () => {
    const view = mount("web");
    try {
      fire(view.gutter, "pointerdown", { button: 0, pointerId: 1, pointerType: "mouse", clientY: 145 });
      fire(view.gutter, "pointermove", { pointerId: 1, clientY: 121 });
      fire(view.gutter, "pointerup", { pointerId: 1, clientY: 121 });
      fire(view.gutter, "lostpointercapture");
      const [second, rest] = view.runs;
      expect(view.doc.selection.set).toEqual([rest, 11, second, 6]);
      expect(view.state.range).toEqual({ from: 1, to: 3 });
      expect(view.state.selectedText).toBe("  wrapped\n\nlast");
      // The page draws and offers it: no drawn band, no menu of its own.
      expect(view.state.selectionStyle).toBeNull();
      expect(view.state.menuTop).toBeNull();
      view.doc.selection.text = "  wrapped\n\nlast";
      fire(view.doc, "selectionchange");
      expect(view.state.range).toEqual({ from: 1, to: 3 });
      view.doc.selection.text = "pp";
      fire(view.doc, "selectionchange");
      expect(view.state.range).toBeNull();
    } finally { view.close(); }
    expect(view.gutter.style.touchAction).toBe("pan-y");
  });

  it("clamps a drag past the last line and drops the mark when the selection leaves the text", () => {
    const view = mount("web");
    try {
      fire(view.gutter, "pointerdown", { button: 0, pointerId: 1, pointerType: "mouse", clientY: 101 });
      fire(view.gutter, "pointermove", { pointerId: 1, clientY: 999 });
      fire(view.gutter, "pointerup", { pointerId: 1 });
      expect(view.doc.selection.set).toEqual([view.runs[0], 0, view.runs[1], 11]);
      expect(view.state.selectedText).toBe("first\n  wrapped\n\nlast");
      view.doc.selection.text = view.state.selectedText;
      view.doc.selection.anchorNode = new Surface();
      fire(view.doc, "selectionchange");
      expect(view.state.range).toBeNull();
    } finally { view.close(); }
  });

  it.each(["ios", "android"])("waits for a hold on %s, draws the range and offers Copy beside it", (os) => {
    vi.useFakeTimers();
    const view = mount(os);
    try {
      act(() => view.state.gutterProps.onResponderGrant!({ nativeEvent: { locationY: 11, pageY: 111 } } as never));
      act(() => { vi.advanceTimersByTime(399); });
      expect(view.state.range).toBeNull();
      act(() => { vi.advanceTimersByTime(1); });
      act(() => view.state.gutterProps.onResponderMove!({ nativeEvent: { pageY: 141 } } as never));
      expect(view.state.selectedText).toBe("  wrapped\n\nlast");
      expect(view.state.selectionStyle).toEqual({ top: 10, height: 40 });
      expect(view.state.menuTop).toBeNull();
      act(() => view.state.gutterProps.onResponderRelease!({} as never));
      // No room above or below the range: Copy sits on its top.
      expect(view.state.menuTop).toBe(16);
      expect(view.doc.selection.set).toEqual([]);
    } finally { view.close(); }
  });

  it("holds the body still under a held finger and scrolls it only past the body's edge", () => {
    vi.useFakeTimers();
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => { frames.length = 0; });
    const runFrame = () => act(() => { frames.shift()?.(); });
    // The body shows 50..150 on screen and scrolls up to 9pt; the gutter is at 100.
    let offset = 0;
    const scroller: PreviewScroller = {
      hold: vi.fn(),
      measure: (done) => done(50, 100),
      offset: () => offset,
      scrollBy(delta) {
        const next = Math.max(0, Math.min(9, offset + delta));
        const moved = next - offset;
        offset = next;
        return moved;
      },
    };
    const view = mount("ios", [0, 10, 20, 60], scroller);
    try {
      act(() => view.state.gutterProps.onResponderGrant!({ nativeEvent: { locationY: 11, pageY: 111 } } as never));
      expect(scroller.hold).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(400); });
      expect(scroller.hold).toHaveBeenLastCalledWith(true);
      // Inside the body the lines stay where they are.
      act(() => view.state.gutterProps.onResponderMove!({ nativeEvent: { pageY: 139 } } as never));
      expect(frames).toHaveLength(0);
      expect(view.state.range).toEqual({ from: 1, to: 2 });
      // Just past the bottom edge it scrolls on each frame, and the range
      // takes in the line that scrolls under the finger.
      act(() => view.state.gutterProps.onResponderMove!({ nativeEvent: { pageY: 151 } } as never));
      expect(view.state.range).toEqual({ from: 1, to: 2 });
      for (let index = 0; index < 4; index++) runFrame();
      expect(offset).toBe(9);
      expect(view.state.range).toEqual({ from: 1, to: 3 });
      // At the end of the content the frames stop.
      runFrame();
      expect(frames).toHaveLength(0);
      act(() => view.state.gutterProps.onResponderRelease!({} as never));
      expect(scroller.hold).toHaveBeenLastCalledWith(false);
      expect(view.state.selectedText).toBe("  wrapped\n\nlast");
    } finally { view.close(); }
  });

  it("cancels a short scrolling gesture and allows the parent to take it", () => {
    vi.useFakeTimers();
    const view = mount("ios");
    try {
      act(() => view.state.gutterProps.onResponderGrant!({ nativeEvent: { locationY: 0, pageY: 100 } } as never));
      act(() => view.state.gutterProps.onResponderMove!({ nativeEvent: { pageY: 120 } } as never));
      act(() => { vi.advanceTimersByTime(500); });
      expect(view.state.gutterProps.onResponderTerminationRequest!({} as never)).toBe(true);
      act(() => view.state.gutterProps.onResponderRelease!({} as never));
      expect(view.state.range).toBeNull();
      expect(view.state.menuTop).toBeNull();
    } finally { view.close(); }
  });

  it("clears a held range when interrupted or when its source changes", () => {
    vi.useFakeTimers();
    const view = mount("android");
    try {
      const hold = () => {
        act(() => view.state.gutterProps.onResponderGrant!({ nativeEvent: { locationY: 11, pageY: 100 } } as never));
        act(() => { vi.advanceTimersByTime(400); });
      };
      hold();
      expect(view.state.gutterProps.onResponderTerminationRequest!({} as never)).toBe(false);
      act(() => view.state.gutterProps.onResponderTerminate!({} as never));
      expect(view.state.range).toBeNull();
      hold();
      act(() => view.renderer.update(React.createElement(view.Harness, { lines: ["changed"] })));
      expect(view.state.range).toBeNull();
      expect(view.state.menuTop).toBeNull();
    } finally { view.close(); }
  });
});
