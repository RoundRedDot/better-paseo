/**
 * What one table costs a native renderer: every host view it creates is a
 * `createNode` and a slot in every `completeRoot` while the reply is on
 * screen. A cell is one Text; the table's chrome is the scroller, the frame
 * and the closed copy control.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    copyText: () => Promise.resolve(true),
    useToast: () => ({ show() {}, error() {}, success() {} }),
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

const { countHostViews } = await import("./helpers/host-count");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});

/** Three columns, a header and five body rows: 18 cells. */
const TABLE = [
  "| Platform | Runtime | Notes |",
  "| --- | --- | --- |",
  "| Desktop | Electron | **Primary** target |",
  "| Web | Vite | Same bundle |",
  "| iOS | Hermes | [Expo](https://example.com) build |",
  "| Android | Hermes | `adb` over USB |",
  "| Relay | Cloud | n/a |",
].join("\n");
const CELLS = 18;

const view = (text: string) => React.createElement(MarkdownView, { text, tokens, variant: "document" });

/**
 * The same table at 6a76c56, before the frame took the touches: a touch View
 * around every cell, a wrapper around the scroller, a padding View inside it,
 * and a corner View and a backing View around the copy control.
 */
const BEFORE = 55;

describe("a native table's host views", () => {
  for (const os of ["ios", "android"]) {
    it(`${os}: one Text per cell and a fixed chrome`, () => {
      const count = countHostViews(view(TABLE), os);
      // The reply's root, the table's outer View, its scroller and frame, a
      // View per row, a Text per cell, and the copy control's slot, button
      // anchor, Pressable and icon.
      expect(count.byType).toEqual({ View: 1 + 1 + 1 + 6 + 2, ScrollView: 1, Text: CELLS, Pressable: 1, Icon: 1 });
      expect(count.views).toBe(32);
      expect(count.views).toBeLessThan(BEFORE);
    });
  }

  it("draws a cell as a Text straight in its row", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(view(TABLE)); });
    const cells = renderer.root.findAll((node) => String(node.type) === "Text"
      && node.props.testID === "markdown-table-cell");
    expect(cells).toHaveLength(CELLS);
    for (const cell of cells) {
      // The row's host View, through the mock's composite View.
      const row = cell.parent!.parent!;
      expect(String(row.type)).toBe("View");
      expect(row.props.onTouchStart).toBeUndefined();
      expect(row.props.style).toBeDefined();
    }
    act(() => renderer.unmount());
    delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  });

  it("alternates body row backgrounds without changing the header", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(view(TABLE)); });
    const cells = renderer.root.findAll((node) => String(node.type) === "Text"
      && node.props.testID === "markdown-table-cell");
    const backgrounds = Array.from({ length: 6 }, (_, row) =>
      Object.assign({}, ...cells[row * 3]!.parent!.parent!.props.style.filter(Boolean)).backgroundColor);
    expect(backgrounds[0]).toBeDefined();
    expect(backgrounds.slice(1)).toEqual([undefined, tokens.v2.surface1, undefined, tokens.v2.surface1, undefined]);
    act(() => renderer.unmount());
  });
});
