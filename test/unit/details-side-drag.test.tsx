import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { StyleSheet } from "react-native";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { SidePanel, resetSideWidth, sideWidth } from "../../client/details/shell/side-panel";

// The details side panel's edge drag on desktop web: a move writes the width
// to the page at most once a frame, and the panel renders once, on release.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

type Listener = (event: { button?: number; clientX?: number; preventDefault(): void }) => void;

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  resetSideWidth();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  delete (globalThis as { __rnMockIsPad?: boolean }).__rnMockIsPad;
});

it("writes a dragged width to the page once a frame and renders the panel once, on release", () => {
  const frames: (() => void)[] = [];
  const docListeners = new Map<string, Listener>();
  const doc = {
    defaultView: {
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: (id: number) => { frames[id - 1] = () => {}; },
    },
    addEventListener: (name: string, handler: Listener) => docListeners.set(name, handler),
    removeEventListener: (name: string) => docListeners.delete(name),
  };
  const edgeListeners = new Map<string, Listener>();
  const panelStyle: Record<string, string> = {};
  const createNodeMock = (element: React.ReactElement) => {
    const id = (element.props as { testID?: string }).testID;
    if (id === "details-side") return { style: Object.assign(panelStyle, { setProperty() {}, removeProperty() {} }) };
    if (id === "details-side-edge") return { ownerDocument: doc, addEventListener: (name: string, handler: Listener) => edgeListeners.set(name, handler), removeEventListener() {} };
    return null;
  };
  let renders = 0;
  function Body() {
    renders++;
    return null;
  }
  const panel = (
    <SidePanel tokens={tokens} stage={{ width: 1600, height: 1000, sideSpace: 600 }} insets={{ top: 0, bottom: 0 }} reduced entrance="none" leaving={false} onExited={() => {}} wide={false} resizable onOutside={() => {}}>
      <Body />
    </SidePanel>
  );
  act(() => { renderer = TestRenderer.create(panel, { createNodeMock }); });
  const drawnWidth = () => StyleSheet.flatten(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-side").props.style).width;
  const start = drawnWidth();
  expect(start).toBe(576);
  const edge = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-side-edge");
  const line = () => StyleSheet.flatten(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-side-hover-line").props.style);
  expect(line().opacity).toBe(0);
  expect(StyleSheet.flatten(edge.props.style).cursor).toBe("col-resize");
  expect(renderer!.root.findAll((node) => node.props.testID === "details-side-grabber")).toHaveLength(0);
  act(() => edge.props.onPointerEnter());
  expect(line().opacity).toBe(0.9);
  act(() => edge.props.onPointerLeave());
  expect(line().opacity).toBe(0);
  const before = renders;
  const event = (clientX: number) => ({ button: 0, clientX, preventDefault() {} });
  act(() => edgeListeners.get("pointerdown")!(event(1000)));
  // Three moves in one frame: one write, the last.
  act(() => {
    docListeners.get("pointermove")!(event(990));
    docListeners.get("pointermove")!(event(980));
    docListeners.get("pointermove")!(event(950));
  });
  expect(frames).toHaveLength(1);
  expect(panelStyle.width).toBeUndefined();
  act(() => frames.shift()!());
  expect(panelStyle.width).toBe(`${start + 50}px`);
  act(() => docListeners.get("pointermove")!(event(900)));
  act(() => frames.shift()!());
  expect(panelStyle.width).toBe(`${start + 100}px`);
  // Nothing rendered while dragging.
  expect(drawnWidth()).toBe(start);
  expect(renders).toBe(before);
  // A move still waiting for its frame lands with the release, then the panel renders at that width.
  act(() => docListeners.get("pointermove")!(event(880)));
  act(() => docListeners.get("pointerup")!(event(880)));
  expect(panelStyle.width).toBe(`${start + 120}px`);
  expect(drawnWidth()).toBe(start + 120);
  expect(drawnWidth()).toBeGreaterThan(600);
  expect(docListeners.size).toBe(0);
  // The session keeps it: a new panel opens at the dragged width.
  act(() => renderer!.update(<React.Fragment key="again">{panel}</React.Fragment>));
  expect(drawnWidth()).toBe(start + 120);
  act(() => edgeListeners.get("pointerdown")!(event(1000)));
  act(() => docListeners.get("pointermove")!(event(0)));
  act(() => docListeners.get("pointerup")!(event(0)));
  expect(drawnWidth()).toBe(960);
  act(() => edgeListeners.get("pointerdown")!(event(1000)));
  act(() => docListeners.get("pointermove")!(event(2000)));
  act(() => docListeners.get("pointerup")!(event(2000)));
  expect(drawnWidth()).toBe(360);
});

it("shows a native iPad grabber and commits a bounded width only on release", () => {
  (globalThis as { __rnMockOS?: string; __rnMockIsPad?: boolean }).__rnMockOS = "ios";
  (globalThis as { __rnMockIsPad?: boolean }).__rnMockIsPad = true;
  const onResizeStart = vi.fn();
  const panel = <SidePanel tokens={tokens} stage={{ width: 1200, height: 800 }} insets={{ top: 0, bottom: 0 }}
    reduced entrance="none" leaving={false} onExited={() => {}} wide={false} resizable onResizeStart={onResizeStart} onOutside={() => {}}><div /></SidePanel>;
  act(() => { renderer = TestRenderer.create(panel); });
  const edge = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-side-native-edge");
  const width = () => {
    const value = StyleSheet.flatten(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-side").props.style).width;
    return typeof value === "number" ? value : (value as { __value: number }).__value;
  };
  const event = (pageX: number) => ({ nativeEvent: { pageX } });
  expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "details-side-grabber")).toHaveLength(1);
  expect(width()).toBe(432);
  act(() => { edge().props.onStartShouldSetPanResponderCapture(event(800)); edge().props.onPanResponderGrant(); });
  act(() => edge().props.onPanResponderMove(event(600)));
  expect(width()).toBe(632);
  expect(onResizeStart).not.toHaveBeenCalled();
  act(() => edge().props.onPanResponderTerminate());
  expect(width()).toBe(432);
  expect(onResizeStart).not.toHaveBeenCalled();
  act(() => { edge().props.onStartShouldSetPanResponderCapture(event(800)); edge().props.onPanResponderGrant(); });
  act(() => edge().props.onPanResponderMove(event(0)));
  expect(width()).toBe(720);
  act(() => edge().props.onPanResponderRelease(event(0)));
  expect(width()).toBe(720);
  expect(onResizeStart).toHaveBeenCalledOnce();
  act(() => renderer!.update(<React.Fragment key="again">{panel}</React.Fragment>));
  expect(width()).toBe(720);
  act(() => { edge().props.onStartShouldSetPanResponderCapture(event(800)); edge().props.onPanResponderGrant(); });
  act(() => edge().props.onPanResponderRelease(event(1600)));
  expect(width()).toBe(360);
});

it("keeps landscape phone sizing while allowing an iPad in a short window to resize", () => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  expect(sideWidth({ width: 1200, height: 400 }, false)).toBe(400);
  (globalThis as { __rnMockIsPad?: boolean }).__rnMockIsPad = true;
  expect(sideWidth({ width: 1200, height: 400 }, false)).toBe(432);
});

it("starts dragging from the visible expanded width and leaves expanded mode", () => {
  const docListeners = new Map<string, Listener>();
  const edgeListeners = new Map<string, Listener>();
  const doc = {
    defaultView: null,
    addEventListener: (name: string, handler: Listener) => docListeners.set(name, handler),
    removeEventListener: (name: string) => docListeners.delete(name),
  };
  const panelStyle: Record<string, string> = {};
  const createNodeMock = (element: React.ReactElement) => {
    const id = (element.props as { testID?: string }).testID;
    if (id === "details-side") return { style: Object.assign(panelStyle, { setProperty() {}, removeProperty() {} }) };
    if (id === "details-side-edge") return { ownerDocument: doc, addEventListener: (name: string, handler: Listener) => edgeListeners.set(name, handler), removeEventListener() {} };
    return null;
  };
  const onResizeStart = vi.fn();
  const panel = (wide: boolean) => <SidePanel tokens={tokens} stage={{ width: 1600, height: 1000, sideSpace: 700 }}
    insets={{ top: 0, bottom: 0 }} reduced entrance="none" leaving={false} onExited={() => {}} wide={wide} resizable
    onResizeStart={onResizeStart} onOutside={() => {}}><div /></SidePanel>;
  act(() => { renderer = TestRenderer.create(panel(true), { createNodeMock }); });
  const event = (clientX: number) => ({ button: 0, clientX, preventDefault() {} });
  act(() => edgeListeners.get("pointerdown")!(event(1000)));
  expect(onResizeStart).not.toHaveBeenCalled();
  act(() => docListeners.get("pointermove")!(event(1050)));
  expect(onResizeStart).toHaveBeenCalledOnce();
  expect(panelStyle.width).toBe("650px");
  act(() => renderer!.update(panel(false)));
  act(() => docListeners.get("pointerup")!(event(1050)));
  const width = StyleSheet.flatten(renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-side").props.style).width;
  expect(width).toBe(650);
});
