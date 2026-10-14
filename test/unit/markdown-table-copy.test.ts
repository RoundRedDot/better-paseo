import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const { copyText, toastShow } = vi.hoisted(() => ({
  copyText: vi.fn(async (_text: string) => {}),
  toastShow: vi.fn(),
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
    useToast: () => ({ show: toastShow, error() {}, success() {} }),
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

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { StyleSheet } = await import("./helpers/rn-mock");
const { columnWidths } = await import("../../client/components/markdown/render/table");
const { TOOLBAR_TOOLTIP_MS } = await import("../../client/ui/toolbar-button");
const { variantMetrics, TABLE_DIVIDER_WIDTH } = await import("../../client/components/markdown/render/styles");
const { lexBlock } = await import("../../client/components/markdown/lex");
const { getEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
type TableToken = import("../../client/vendor/marked").Tokens.Table;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

function render(text: string, streaming = false, variant: "document" | "compact" | "terminal" = "document") {
  act(() => {
    const view = React.createElement(MarkdownView, { text, tokens, variant, streaming });
    if (renderer) renderer.update(view);
    else renderer = TestRenderer.create(view);
  });
  return renderer!;
}

function buttons() {
  return renderer!.root.findAll((node) => String(node.type) === "Pressable"
    && ["Copy Markdown table", "Copied"].includes(node.props.accessibilityLabel));
}

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  copyText.mockClear();
  toastShow.mockClear();
  vi.useRealTimers();
});

describe("Markdown table copy", () => {
  const cell = (index: number) => renderer!.root.findAll((node) => String(node.type) === "Text"
    && node.props.testID === "markdown-table-cell")[index]!;
  const selectedCopy = () => renderer!.root.findAll((node) => String(node.type) === "Pressable"
    && node.props.accessibilityLabel === "Copy selected cell");
  const touchCell = (index: number) => renderer!.root.findAll((node) => String(node.type) === "View"
    && node.props.testID === "markdown-table-touch-cell")[index]!;
  const touch = (timestamp: number, pageX = 10, pageY = 10) => ({
    nativeEvent: { timestamp, pageX, pageY, touches: [{}] },
  });
  const tap = (index: number, timestamp: number) => {
    act(() => touchCell(index).props.onTouchStart(touch(timestamp)));
    act(() => touchCell(index).props.onTouchEnd(touch(timestamp + 30)));
  };

  it.each([0, 2])("on iOS selects all rendered text of cell %s on a double tap and copies it", async (index) => {
    render("| Header words | B |\n| --- | --- |\n| **bold** and `code` | two |");
    tap(index, 100);
    expect(selectedCopy()).toHaveLength(0);
    tap(index, 230);
    expect(selectedCopy()).toHaveLength(1);
    expect(StyleSheet.flatten(cell(index).props.style).backgroundColor).toBe(tokens.accentBg);
    await act(async () => selectedCopy()[0]!.props.onPress());
    expect(copyText).toHaveBeenCalledExactlyOnceWith(index === 0 ? "Header words" : "bold and code");
    expect(selectedCopy()).toHaveLength(0);
  });

  it("on iOS does not combine taps on different cells, delayed taps, holds, or scrolling gestures", () => {
    render("| A | B |\n| --- | --- |\n| one | two |");
    tap(2, 100);
    tap(3, 230);
    expect(selectedCopy()).toHaveLength(0);
    tap(3, 700);
    expect(selectedCopy()).toHaveLength(0);
    act(() => touchCell(3).props.onTouchStart(touch(800)));
    act(() => touchCell(3).props.onTouchMove(touch(820, 30)));
    act(() => touchCell(3).props.onTouchEnd(touch(850, 30)));
    tap(3, 900);
    expect(selectedCopy()).toHaveLength(0);
    act(() => touchCell(3).props.onTouchStart(touch(1000)));
    act(() => touchCell(3).props.onTouchEnd(touch(1400)));
    tap(3, 1500);
    expect(selectedCopy()).toHaveLength(0);
  });

  it("on iOS clears the cell selection when streaming changes its source", () => {
    const source = "| A | B |\n| --- | --- |\n| one | two |";
    render(source, true);
    tap(2, 100);
    tap(2, 230);
    expect(selectedCopy()).toHaveLength(1);
    render(source + "\n| three | four |", true);
    expect(selectedCopy()).toHaveLength(0);
  });

  it.each([
    ["zh", "复制 Markdown 表格", "已复制"],
    ["en", "Copy Markdown table", "Copied"],
  ] as const)("shows a delayed hover label in %s and hides it on exit", async (language, label, copied) => {
    vi.useFakeTimers();
    const previousLanguage = getEnhancerPreferences().language;
    updateEnhancerPreferences({ language });
    try {
      render("| A | B |\n| --- | --- |\n| one | two |");
      const labels = () => renderer!.root.findAll((node) => String(node.type) === "Text"
        && (node.children[0] === label || node.children[0] === copied));
      expect(labels()).toHaveLength(0);
      expect(StyleSheet.flatten(buttons()[0]!.props.style)).toMatchObject({
        width: 30, height: 30, borderWidth: 1, borderRadius: 12, borderColor: tokens.v2.border,
      });
      act(() => { buttons()[0]!.props.onHoverIn(); });
      // The frame's edge stays light on hover: only the fill marks it.
      expect(StyleSheet.flatten(buttons()[0]!.props.style)).toMatchObject({ borderColor: tokens.v2.border, backgroundColor: tokens.v2.surface2 });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS - 1); });
      expect(labels()).toHaveLength(0);
      act(() => { vi.advanceTimersByTime(1); });
      expect(labels()[0]!.children).toEqual([label]);
      let slot = labels()[0]!.parent!;
      while (slot.props.pointerEvents !== "none") slot = slot.parent!;
      expect(StyleSheet.flatten(slot.props.style)).toMatchObject({ left: 0, top: "100%" });
      await act(async () => { buttons()[0]!.props.onPress(); });
      expect(labels()[0]!.children).toEqual([copied]);
      act(() => { buttons()[0]!.props.onHoverOut(); });
      expect(labels()).toHaveLength(0);
      expect(StyleSheet.flatten(buttons()[0]!.props.style).borderColor).toBe(tokens.v2.border);
      act(() => { buttons()[0]!.props.onHoverIn(); });
      act(() => { buttons()[0]!.props.onHoverOut(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(labels()).toHaveLength(0);
    } finally {
      act(() => { updateEnhancerPreferences({ language: previousLanguage }); });
    }
  });

  it.each([
    ["zh", "已复制 Markdown 表格"],
    ["en", "Copied Markdown table"],
  ] as const)("names the copied Markdown table in %s", async (language, message) => {
    const previousLanguage = getEnhancerPreferences().language;
    updateEnhancerPreferences({ language });
    try {
      render("| A | B |\n| --- | --- |\n| one | two |");
      await act(async () => { buttons()[0]!.props.onPress(); });
      expect(toastShow).toHaveBeenCalledExactlyOnceWith(message);
    } finally {
      act(() => { updateEnhancerPreferences({ language: previousLanguage }); });
    }
  });

  it.each(["document", "compact", "terminal"] as const)(
    "%s copies the entire table source with formatting and alignment",
    async (variant) => {
      const source = "| Name | Value |\n| :--- | ---: |\n| **bold** | `a\\|b` |\n| [link](https://example.com) | 42 |\n";
      render(source, false, variant);
      expect(buttons()).toHaveLength(1);
      const button = buttons()[0]!;
      // The copy control floats at the frame's corner, outside the header row.
      let cell = button.parent!;
      while (StyleSheet.flatten(cell.props.style).position !== "absolute") cell = cell.parent!;
      expect(StyleSheet.flatten(cell.props.style)).toMatchObject({ position: "absolute", top: 0, left: 0 });
      expect(cell.findAll((node) => String(node.type) === "Text")).toHaveLength(0);
      await act(async () => { button.props.onPress(); });
      expect(copyText).toHaveBeenCalledExactlyOnceWith(source);
      expect(buttons()[0]!.props.accessibilityLabel).toBe("Copied");
    },
  );

  it.each(["document", "compact", "terminal"] as const)(
    "%s keeps identical columns the same width without copy space",
    (variant) => {
      const source = "| Same header | Same header |\n| --- | --- |\n| x | x |";
      const table = lexBlock(source).find((token) => token.type === "table") as TableToken;
      const widths = columnWidths(table, variantMetrics(variant, tokens.typography.content.size));
      expect(widths[1]! - widths[0]!).toBe(TABLE_DIVIDER_WIDTH);
      const view = render(source, false, variant);
      const headers = view.root.findAll((node) => String(node.type) === "Text"
        && node.children[0] === "Same header");
      expect(headers).toHaveLength(2);
      expect(headers.map((node) => StyleSheet.flatten(node.props.style).width)).toEqual(widths);
      const headerRow = (node: (typeof headers)[number]) => {
        let parent = node.parent!;
        while (StyleSheet.flatten(parent.props.style).backgroundColor !== tokens.v2.surface2) parent = parent.parent!;
        return parent;
      };
      expect(headerRow(headers[0]!)).toBe(headerRow(headers[1]!));
    },
  );

  it("copies each table separately, excluding surrounding prose", async () => {
    const first = "| A | B |\n| --- | --- |\n| one | two |\n";
    const second = "| C | D |\n| --- | --- |\n| three | four |\n";
    render(`Before\n\n${first}\nBetween\n\n${second}\nAfter`);
    expect(buttons()).toHaveLength(2);
    await act(async () => { buttons()[0]!.props.onPress(); });
    await act(async () => { buttons()[1]!.props.onPress(); });
    expect(copyText.mock.calls.map(([text]) => text)).toEqual([first.trimEnd(), second.trimEnd()]);
  });

  it("copies the latest rows during streaming and after completion", async () => {
    const header = "| A | B |\n| --- | --- |\n";
    render(header, true);
    await act(async () => { buttons()[0]!.props.onPress(); });
    expect(copyText).toHaveBeenLastCalledWith(header.trimEnd());
    const updated = header + "| one | two |\n";
    render(updated, true);
    await act(async () => { buttons()[0]!.props.onPress(); });
    expect(copyText).toHaveBeenLastCalledWith(updated);
    const completed = updated + "| three | four |\n";
    render(completed);
    await act(async () => { buttons()[0]!.props.onPress(); });
    expect(copyText).toHaveBeenLastCalledWith(completed);
  });
});
