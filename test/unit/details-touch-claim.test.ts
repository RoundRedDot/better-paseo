import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";
import type { View } from "react-native";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: vi.fn(), useToast: () => ({ show() {}, error() {} }) }));
import { claimContentTouch, contentOwnsTouch, resetContentTouches } from "../../client/details/touch-claim";
import { useLineSelection } from "../../client/ui/line-selection";
import { useTableCellSelection } from "../../client/components/markdown/render/table-touch-selection";

// The content's gesture zones claim their touch for its whole life, so the
// block details drawer never takes it (client/details/touch-claim.ts).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const platform = globalThis as { __rnMockOS?: string };
beforeEach(() => resetContentTouches());
afterEach(() => { delete platform.__rnMockOS; vi.useRealTimers(); });

describe("content touch claims", () => {
  it("stands while any claim does, and a release counts once", () => {
    const first = claimContentTouch();
    const second = claimContentTouch();
    first();
    first();
    expect(contentOwnsTouch()).toBe(true);
    second();
    expect(contentOwnsTouch()).toBe(false);
  });
});

/** A gutter whose pointer listeners the test calls directly. */
class Gutter extends EventTarget {
  style = { touchAction: "pan-y" };
  ownerDocument = Object.assign(new EventTarget(), { defaultView: { getSelection: () => null } });
  getBoundingClientRect() { return { top: 0 }; }
  setPointerCapture() {}
  measure(done: (...values: number[]) => void) { done(0, 0, 40, 50, 0, 0); }
}
function fire(node: EventTarget, type: string, values: Record<string, unknown> = {}) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value });
  act(() => { node.dispatchEvent(event); });
}

function mountGutter(os: string) {
  platform.__rnMockOS = os;
  const gutter = new Gutter();
  const contentRef = { current: new Gutter() as unknown as View };
  let state!: ReturnType<typeof useLineSelection>;
  function Harness() {
    state = useLineSelection({ enabled: true, lines: ["a", "b", "c"], tops: [0, 10, 20], bottom: 30, contentRef });
    return React.createElement("View", { ref: state.gutterRef });
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness), { createNodeMock: () => gutter }); });
  return { gutter, renderer, get state() { return state; } };
}

describe("the line-number gutter", () => {
  it.each(["ios", "android"])("on %s claims its touch from the start to the end, before the hold too", (os) => {
    vi.useFakeTimers();
    const view = mountGutter(os);
    const props = () => view.state.gutterProps;
    act(() => props().onTouchStart!({} as never));
    act(() => props().onResponderGrant!({ nativeEvent: { locationY: 5, pageY: 5 } } as never));
    expect(contentOwnsTouch()).toBe(true);
    // A move past the slop gives the gesture up; the touch stays the gutter's.
    act(() => props().onResponderMove!({ nativeEvent: { pageY: 40 } } as never));
    act(() => props().onResponderTerminate!({} as never));
    expect(contentOwnsTouch()).toBe(true);
    act(() => props().onTouchEnd!({} as never));
    expect(contentOwnsTouch()).toBe(false);
    act(() => props().onTouchStart!({} as never));
    act(() => props().onTouchCancel!({} as never));
    expect(contentOwnsTouch()).toBe(false);
    act(() => props().onTouchStart!({} as never));
    act(() => view.renderer.unmount());
    expect(contentOwnsTouch()).toBe(false);
  });

  it("on web claims a pointer from its press to its release", () => {
    const view = mountGutter("web");
    fire(view.gutter, "pointerdown", { button: 0, pointerId: 1, pointerType: "touch", clientY: 5 });
    expect(contentOwnsTouch()).toBe(true);
    fire(view.gutter, "pointerup", { pointerId: 1, clientY: 5 });
    expect(contentOwnsTouch()).toBe(false);
    fire(view.gutter, "pointerdown", { button: 0, pointerId: 2, pointerType: "mouse", clientY: 5 });
    expect(contentOwnsTouch()).toBe(true);
    fire(view.gutter, "lostpointercapture");
    expect(contentOwnsTouch()).toBe(false);
    act(() => view.renderer.unmount());
  });
});

function mountTable(os: string) {
  platform.__rnMockOS = os;
  const frame = {
    measure: (done: (...values: number[]) => void) => done(0, 0, 200, 60, 0, 0),
  };
  const geometry = { frame: { current: frame as unknown as View }, rows: { current: [] as (View | null)[] }, columns: [0, 100] };
  let state!: ReturnType<typeof useTableCellSelection>;
  function Harness() {
    state = useTableCellSelection("| a | b |", geometry);
    return null;
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
  return { renderer, get state() { return state; } };
}

describe("a table's cell range", () => {
  const touch = (timestamp: number, pageY = 10) => ({ nativeEvent: { timestamp, pageX: 10, pageY, touches: [{}] } });

  it.each(["ios", "android"])("on %s claims the touch once the hold goes through, until the finger lifts", (os) => {
    vi.useFakeTimers();
    const view = mountTable(os);
    act(() => view.state.frameProps.onTouchStart!(touch(0) as never));
    // Before the hold a move is a scroll, or the drawer's pull.
    expect(contentOwnsTouch()).toBe(false);
    act(() => { vi.advanceTimersByTime(350); });
    expect(contentOwnsTouch()).toBe(true);
    act(() => view.state.frameProps.onTouchMove!(touch(400, 50) as never));
    act(() => view.state.frameProps.onTouchEnd!(touch(500, 50) as never));
    expect(contentOwnsTouch()).toBe(false);
    act(() => view.state.frameProps.onTouchStart!(touch(1000) as never));
    act(() => { vi.advanceTimersByTime(350); });
    act(() => view.state.frameProps.onTouchCancel!(touch(1400) as never));
    expect(contentOwnsTouch()).toBe(false);
    act(() => view.state.frameProps.onTouchStart!(touch(2000) as never));
    act(() => { vi.advanceTimersByTime(350); });
    act(() => view.renderer.unmount());
    expect(contentOwnsTouch()).toBe(false);
  });

  it("on web claims the range the pointer draws, from its start to its end", () => {
    const view = mountTable("web");
    act(() => view.state.begin({ row: 1, column: 0 }));
    expect(contentOwnsTouch()).toBe(true);
    act(() => view.state.extend({ row: 1, column: 1 }));
    act(() => view.state.end());
    expect(contentOwnsTouch()).toBe(false);
    // A double click's single cell is no drag.
    act(() => view.state.select({ row: 1, column: 0 }));
    expect(contentOwnsTouch()).toBe(false);
    act(() => view.state.begin({ row: 1, column: 0 }));
    act(() => view.state.dismiss());
    expect(contentOwnsTouch()).toBe(false);
    act(() => view.renderer.unmount());
  });
});
