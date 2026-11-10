import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { StyleSheet, TurboModuleRegistry } from "react-native";
import { BoardSheet } from "../../client/tasks/board/board-sheet";
import { ANDROID_NAV_FALLBACK } from "../../client/details/shell/safe-area";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// React Native's runtime has frame callbacks and Node does not: here a frame is a 16 ms timer, so fake timers drive it.
Object.assign(globalThis, {
  requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 16),
  cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
});

const theme = { colors: { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111", foregroundMuted: "#777" } } as never;

describe("board sheet bottom spacing", () => {
  const originalGet = TurboModuleRegistry.get;
  afterEach(() => {
    TurboModuleRegistry.get = originalGet;
    delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  });

  function render(os: string) {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<BoardSheet area={600} open detent="half" onDetent={() => {}} onClose={() => {}} theme={theme} labels={{ grow: "Grow", shrink: "Shrink" }}><></></BoardSheet>);
    });
    const content = renderer.root.findByProps({ testID: "board-sheet-content" });
    const paddingBottom = StyleSheet.flatten(content.props.style).paddingBottom;
    act(() => renderer.unmount());
    return paddingBottom;
  }

  it("keeps the design pad on iOS and web", () => {
    expect(render("ios")).toBe(4);
    expect(render("web")).toBe(4);
  });

  it("pads an Android sheet by the system bottom inset", () => {
    TurboModuleRegistry.get = ((name: string) => name === "RNCSafeAreaContext"
      ? { getConstants: () => ({ initialWindowMetrics: { insets: { bottom: 48 } } }) }
      : null) as typeof TurboModuleRegistry.get;
    expect(render("android")).toBe(48);
  });

  it("keeps the gesture bar clear when Android has no safe-area reading", () => {
    expect(render("android")).toBe(ANDROID_NAV_FALLBACK);
  });
});
