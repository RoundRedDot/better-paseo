import React from "react";
import { expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null, copyText: vi.fn() }));
import { AnchoredToolbarDetails } from "../../client/ui/toolbar-button";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { DEFAULT_PREFERENCES } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("moves the translation window from its header and resizes from its edge", () => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  const events = new Map<string, (event: any) => void>();
  const documentEvents = new Map<string, (event: any) => void>();
  const doc = { defaultView: {}, documentElement: { style: {} }, addEventListener: (name: string, fn: any) => documentEvents.set(name, fn), removeEventListener: (name: string) => documentEvents.delete(name) };
  const header = { contains: (node: unknown) => node === title };
  const title = { closest: () => null };
  const panel = { ownerDocument: doc, style: {}, addEventListener: (name: string, fn: any) => events.set(name, fn), removeEventListener: (name: string) => events.delete(name), getBoundingClientRect: () => ({ left: 100, top: 100, width: 420, height: 300 }), querySelector: () => header, setPointerCapture() {}, matches: () => true };
  const stage = { measureInWindow: (fn: any) => fn(0, 0, 1000, 800) };
  const anchor = { current: { measureInWindow: (fn: any) => fn(100, 450, 20, 20) } } as any;
  const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#880", statusDanger: "#f00" }, DEFAULT_PREFERENCES, { platform: "web" });
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<AnchoredToolbarDetails anchor={anchor} close={() => {}} tokens={tokens} width={420} movable><div /></AnchoredToolbarDetails>, { createNodeMock: (element) => {
    const props = element.props as { testID?: string };
    return props.testID === "toolbar-details-stage" ? stage : props.testID === "toolbar-details-panel" ? panel : null;
  } }); });
  act(() => { renderer.root.findByProps({ testID: "toolbar-details-stage" }).props.onLayout(); renderer.root.findByProps({ testID: "toolbar-details-panel" }).props.onLayout({ nativeEvent: { layout: { width: 420, height: 300 } } }); });
  const pointer = (x: number, y: number) => ({ button: 0, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, target: title, preventDefault() {} });
  act(() => { events.get("pointerdown")!(pointer(200, 120)); documentEvents.get("pointermove")!(pointer(250, 150)); documentEvents.get("pointerup")!(pointer(250, 150)); });
  expect(renderer.root.findByProps({ testID: "toolbar-details-panel" }).props.style).toMatchObject({ left: 150, top: 130 });
  act(() => { events.get("pointerdown")!(pointer(519, 399)); documentEvents.get("pointermove")!(pointer(569, 449)); documentEvents.get("pointerup")!(pointer(569, 449)); });
  expect(renderer.root.findByProps({ testID: "toolbar-details-panel" }).props.style).toMatchObject({ width: 470, height: 350 });
  act(() => renderer.unmount());
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});
