/**
 * The phone drawer's pinch zoom (`client/ui/text-zoom.ts`): the step a pinch
 * reaches, tokens and caller styles moved once and only once, the saved
 * value's range, and rows that keep their tokens when it is saved.
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

await import("./helpers/quiet-renderer");
const TestRenderer = (await import("react-test-renderer")).default;
const { act } = await import("react-test-renderer");
const { buildThemeTokens, useThemeTokens } = await import("../../client/components/theme-tokens");
const { DEFAULT_PREFERENCES, parsePreferences } = await import("../../client/preferences");
const { TextZoomContext, isZoomed, pinchZoom, zoomTextStyle, zoomTokens } = await import("../../client/ui/text-zoom");
const { PreviewLines } = await import("../../client/ui/preview-lines");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const colors = {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d23c3c",
};
const tokens = buildThemeTokens(colors, DEFAULT_PREFERENCES, { platform: "ios", theme: { colors } });

function sizes(node: ReturnType<typeof TestRenderer.create>): number[] {
  const found = new Set<number>();
  for (const element of node.root.findAll((found) => typeof found.type === "string")) {
    const style = [element.props?.style].flat(Infinity) as Array<Record<string, unknown> | null | undefined>;
    let size: number | undefined;
    for (const entry of style) if (entry && typeof entry.fontSize === "number") size = entry.fontSize;
    if (size !== undefined) found.add(size);
  }
  return [...found].sort((a, b) => a - b);
}

function inDrawer(zoom: number, child: React.ReactElement) {
  let node!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    node = TestRenderer.create(React.createElement(TextZoomContext.Provider, { value: zoom }, child));
  });
  return node;
}

describe("pinchZoom", () => {
  it("scales the body size to whole points, within -4 and +10", () => {
    expect(pinchZoom(16, 0, 1)).toBe(0);
    expect(pinchZoom(16, 0, 1.5)).toBe(8);
    expect(pinchZoom(16, 2, 0.5)).toBe(-4);
    expect(pinchZoom(16, 0, 3)).toBe(10);
    expect(pinchZoom(16, 4, 1.03)).toBe(5);
    expect(pinchZoom(16, 3, 0)).toBe(3);
  });
});

describe("zoomTokens", () => {
  it("moves the body and code sizes by the step, and the same tokens come back", () => {
    const up = zoomTokens(tokens, 4);
    expect(up.typography.content.size).toBe(tokens.typography.content.size + 4);
    expect(up.typography.mono.size).toBe(tokens.typography.mono.size + 4);
    expect(up.typography.block).toBe(tokens.typography.block);
    expect(zoomTokens(tokens, 4)).toBe(up);
    expect(zoomTokens(tokens, 0)).toBe(tokens);
    expect(isZoomed(up)).toBe(true);
    expect(isZoomed(tokens)).toBe(false);
  });

  it("zooms tokens that are zoomed already from where they started", () => {
    const up = zoomTokens(tokens, 4);
    expect(zoomTokens(up, 4)).toBe(up);
    expect(zoomTokens(up, 2).typography.content.size).toBe(tokens.typography.content.size + 2);
  });

  it("never draws below 9", () => {
    expect(zoomTokens(tokens, -4).typography.mono.size).toBeGreaterThanOrEqual(9);
  });
});

describe("zoomTextStyle", () => {
  it("moves the size by the step and the line height in proportion", () => {
    expect(zoomTextStyle({ fontSize: 12, lineHeight: 18 }, 4)).toEqual([{ fontSize: 12, lineHeight: 18 }, { fontSize: 16, lineHeight: 24 }]);
    const style = { color: "red" };
    expect(zoomTextStyle(style, 4)).toBe(style);
    expect(zoomTextStyle({ fontSize: 12 }, 0)).toEqual({ fontSize: 12 });
  });
});

describe("in the drawer", () => {
  const lines = ["const a = 1;", "const b = 2;"];
  const mono = tokens.typography.mono;
  const style = { fontFamily: tokens.fontMono, fontSize: mono.size, lineHeight: mono.lineHeight };

  it("moves a preview's text that its caller built from the row's tokens", () => {
    const node = inDrawer(3, React.createElement(PreviewLines, { text: lines.join("\n"), lines, tokens, style }));
    expect(sizes(node)).toContain(mono.size + 3);
    expect(sizes(node)).not.toContain(mono.size);
  });

  it("does not move a style built from zoomed tokens again", () => {
    const up = zoomTokens(tokens, 3);
    const built = { fontFamily: up.fontMono, fontSize: up.typography.mono.size, lineHeight: up.typography.mono.lineHeight };
    const node = inDrawer(3, React.createElement(PreviewLines, { text: lines.join("\n"), lines, tokens: up, style: built }));
    expect(sizes(node)).toContain(mono.size + 3);
    expect(sizes(node)).not.toContain(mono.size + 6);
  });

  it("draws Markdown prose at the zoomed body size", () => {
    const node = inDrawer(2, React.createElement(MarkdownView, { text: "A plain reply.", tokens, variant: "document" }));
    expect(sizes(node)).toEqual([tokens.typography.content.size + 2]);
  });
});

describe("detailsTextZoom", () => {
  it("is 0 by default, whole and within -4 and +10 when read", () => {
    expect(DEFAULT_PREFERENCES.detailsTextZoom).toBe(0);
    expect(parsePreferences({ detailsTextZoom: 3.4 }).detailsTextZoom).toBe(3);
    expect(parsePreferences({ detailsTextZoom: 40 }).detailsTextZoom).toBe(10);
    expect(parsePreferences({ detailsTextZoom: -9 }).detailsTextZoom).toBe(-4);
    expect(parsePreferences({ detailsTextZoom: "big" }).detailsTextZoom).toBe(0);
  });

  it("leaves a row's tokens as they were when it is saved", () => {
    const seen: unknown[] = [];
    function Row({ preferences }: { preferences: typeof DEFAULT_PREFERENCES }) {
      seen.push(useThemeTokens({ colors } as never, preferences, "ios"));
      return null;
    }
    let node!: ReturnType<typeof TestRenderer.create>;
    act(() => { node = TestRenderer.create(React.createElement(Row, { preferences: DEFAULT_PREFERENCES })); });
    act(() => { node.update(React.createElement(Row, { preferences: { ...DEFAULT_PREFERENCES, detailsTextZoom: 5 } })); });
    expect(seen[1]).toBe(seen[0]);
    act(() => { node.update(React.createElement(Row, { preferences: { ...DEFAULT_PREFERENCES, detailsTextZoom: 5, blockFontSize: 15 } })); });
    expect(seen[2]).not.toBe(seen[0]);
  });
});
