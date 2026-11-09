import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import { StyleSheet } from "react-native";
import { BoardSheet } from "../../client/tasks/board/board-sheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { colors: { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111", foregroundMuted: "#777" } } as never;

describe("board sheet bottom spacing", () => {
  afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

  it.each([["android", 32], ["ios", 4], ["web", 4]])("keeps the content inset on %s", (os, paddingBottom) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<BoardSheet area={600} open detent="half" onDetent={() => {}} onClose={() => {}} theme={theme} labels={{ grow: "Grow", shrink: "Shrink" }}><></></BoardSheet>);
    });
    const content = renderer!.root.findByProps({ testID: "board-sheet-content" });
    expect(StyleSheet.flatten(content.props.style).paddingBottom).toBe(paddingBottom);
    act(() => renderer!.unmount());
  });
});
