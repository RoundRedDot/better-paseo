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
  it("scales an absolute size to whole points within 12–26", () => {
    expect(pinchZoom(14, 1)).toBe(14);
    expect(pinchZoom(14, 1.5)).toBe(21);
    expect(pinchZoom(18, 0.5)).toBe(12);
    expect(pinchZoom(16, 3)).toBe(26);
    expect(pinchZoom(20, 1.03)).toBe(21);
    expect(pinchZoom(19, 0)).toBe(19);
  });
});

describe("zoomTokens", () => {
  it("sets body and code to one independent size, and returns stable tokens", () => {
    const up = zoomTokens(tokens, 18);
    expect(up.typography.content.size).toBe(18);
    expect(up.typography.mono.size).toBe(18);
    expect(up.typography.block.delta).toBe(0);
    expect(zoomTokens(tokens, 18)).toBe(up);
    expect(zoomTokens(tokens, 0)).toBe(tokens);
    expect(isZoomed(up)).toBe(true);
    expect(isZoomed(tokens)).toBe(false);
  });

  it("zooms tokens that are zoomed already from where they started", () => {
    const up = zoomTokens(tokens, 18);
    expect(zoomTokens(up, 18)).toBe(up);
    expect(zoomTokens(up, 20).typography.content.size).toBe(20);
  });

  it("ignores changes to the timeline's body, code and block sizes", () => {
    const changed = { ...tokens, typography: { ...tokens.typography,
      content: { size: 22, lineHeight: 33 }, mono: { ...tokens.typography.mono, size: 20 },
      block: { ...tokens.typography.block, delta: 5 } } };
    const fixed = zoomTokens(changed, 14);
    expect(fixed.typography.content).toEqual({ size: 14, lineHeight: 21 });
    expect(fixed.typography.mono.size).toBe(14);
    expect(fixed.typography.block.delta).toBe(0);
  });
});

describe("zoomTextStyle", () => {
  it("moves the size by the step and the line height in proportion", () => {
    expect(zoomTextStyle({ fontSize: 12, lineHeight: 18 }, 14)).toEqual([{ fontSize: 12, lineHeight: 18 }, { fontSize: 14, lineHeight: 21 }]);
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
    const node = inDrawer(14, React.createElement(PreviewLines, { text: lines.join("\n"), lines, tokens, style }));
    expect(sizes(node)).toContain(14);
    // Line numbers sit two points below the independent body size.
    expect(sizes(node)).toContain(12);
  });

  it("does not move a style built from zoomed tokens again", () => {
    const up = zoomTokens(tokens, 18);
    const built = { fontFamily: up.fontMono, fontSize: up.typography.mono.size, lineHeight: up.typography.mono.lineHeight };
    const node = inDrawer(18, React.createElement(PreviewLines, { text: lines.join("\n"), lines, tokens: up, style: built }));
    expect(sizes(node)).toContain(18);
    expect(sizes(node)).not.toContain(36);
  });

  it("draws Markdown prose at the zoomed body size", () => {
    const node = inDrawer(14, React.createElement(MarkdownView, { text: "A plain reply.", tokens, variant: "document" }));
    expect(sizes(node)).toEqual([14]);
  });
});

describe("detailsFontSize", () => {
  it("defaults to 14 and stores a whole absolute size within 12–26", () => {
    expect(DEFAULT_PREFERENCES.detailsFontSize).toBe(14);
    expect(parsePreferences({ detailsFontSize: 17.4 }).detailsFontSize).toBe(17);
    expect(parsePreferences({ detailsFontSize: 40 }).detailsFontSize).toBe(26);
    expect(parsePreferences({ detailsFontSize: -9 }).detailsFontSize).toBe(12);
    expect(parsePreferences({ detailsFontSize: "big" }).detailsFontSize).toBe(14);
    expect(parsePreferences({ detailsTextZoom: 3 })).not.toHaveProperty("detailsTextZoom");
  });

  it("leaves a row's tokens as they were when it is saved", () => {
    const seen: unknown[] = [];
    function Row({ preferences }: { preferences: typeof DEFAULT_PREFERENCES }) {
      seen.push(useThemeTokens({ colors } as never, preferences, "ios"));
      return null;
    }
    let node!: ReturnType<typeof TestRenderer.create>;
    act(() => { node = TestRenderer.create(React.createElement(Row, { preferences: DEFAULT_PREFERENCES })); });
    act(() => { node.update(React.createElement(Row, { preferences: { ...DEFAULT_PREFERENCES, detailsFontSize: 19 } })); });
    expect(seen[1]).toBe(seen[0]);
    act(() => { node.update(React.createElement(Row, { preferences: { ...DEFAULT_PREFERENCES, detailsFontSize: 19, blockFontSize: 15 } })); });
    expect(seen[2]).not.toBe(seen[0]);
  });
});

describe("zoomCap", () => {
  it("keeps one tall iOS text under 2^18 pixels, and never forces a smaller size", async () => {
    const { zoomCap } = await import("../../client/details/shell/pinch-zoom");
    // 2,852 output lines at 12/18 (51,336pt) at 3x: up to 19pt, 82,700pt.
    expect(zoomCap(12, 51336, 3, "ios")).toBe(19);
    // Already as tall as it may be: it stays.
    expect(zoomCap(20, 85560, 3, "ios")).toBe(20);
    expect(zoomCap(12, 2000, 3, "ios")).toBeGreaterThan(100);
    expect(zoomCap(12, 51336, 3, "android")).toBe(Infinity);
  });
});

describe("createPinch", () => {
  it("holds the touch from the body's text while two fingers are down", async () => {
    const { createPinch } = await import("../../client/details/shell/pinch-zoom");
    const calls: string[] = [];
    const pinch = createPinch({
      zoom: () => ({ base: 14, current: () => 14, preview() {}, commit() {} }),
      scroller: () => null,
      changed() {},
      hold: () => {
        calls.push("hold");
        return () => calls.push("release");
      },
    });
    const at = (...ys: number[]) => ({ nativeEvent: { touches: ys.map((pageY) => ({ pageX: 100, pageY })) } }) as never;
    pinch.start(at(500));
    expect(calls).toEqual([]);
    pinch.start(at(500, 600));
    pinch.move(at(480, 620));
    expect(calls).toEqual(["hold"]);
    pinch.end(at(480));
    expect(calls).toEqual(["hold", "release"]);
    pinch.end(at());
    expect(calls).toEqual(["hold", "release"]);
  });
});

describe("text size step buttons", () => {
  it("keeps the pill while touched, then gives a full timeout after release or cancellation", async () => {
    const { usePinchZoom, ZOOM_BADGE_MS } = await import("../../client/details/shell/pinch-zoom");
    const { ZoomBadge } = await import("../../client/details/chrome/zoom-badge");
    let controls!: ReturnType<typeof usePinchZoom>;
    function Harness() {
      const [value, setValue] = React.useState(14);
      controls = usePinchZoom({ base: 14, current: () => value, preview: setValue, commit: setValue }, null);
      return controls.badge === null ? null : React.createElement(ZoomBadge, {
        size: controls.badge, tokens, onStep: controls.step, onReset: controls.reset,
        onInteraction: controls.interaction, canDecrease: controls.canDecrease, canIncrease: controls.canIncrease,
      });
    }
    vi.useFakeTimers();
    let node!: ReturnType<typeof TestRenderer.create>;
    try {
      act(() => { node = TestRenderer.create(React.createElement(Harness)); });
      act(() => controls.reset());
      const pill = () => node.root.findAll((entry) => typeof entry.type === "string" && entry.props.testID === "details-zoom-badge")[0]!;
      const event = { stopPropagation: vi.fn(), nativeEvent: { touches: [{}] } };
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS - 1); });
      act(() => pill().props.onTouchStart(event));
      expect(event.stopPropagation).toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS * 2); });
      expect(pill()).toBeDefined();
      // One finger still rests on the pill: keep holding it.
      act(() => pill().props.onTouchEnd(event));
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS); });
      expect(pill()).toBeDefined();
      act(() => pill().props.onTouchCancel(event));
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS - 1); });
      expect(pill()).toBeDefined();
      act(() => { vi.advanceTimersByTime(1); });
      expect(node.toJSON()).toBeNull();

      act(() => controls.reset());
      act(() => pill().props.onTouchStart(event));
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS); });
      act(() => pill().props.onTouchEnd({ ...event, nativeEvent: { touches: [] } }));
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS - 1); });
      expect(pill()).toBeDefined();
      act(() => { vi.advanceTimersByTime(1); });
      expect(node.toJSON()).toBeNull();
    } finally {
      if (node) act(() => node.unmount());
      vi.useRealTimers();
    }
  });

  it("coalesces repeated steps on long text into one layout and one save", async () => {
    const { usePinchZoom, LIVE_LIMIT, ZOOM_STEP_MS } = await import("../../client/details/shell/pinch-zoom");
    const commit = vi.fn();
    const preview = vi.fn();
    let controls!: ReturnType<typeof usePinchZoom>;
    function Harness() {
      const [value, setValue] = React.useState(14);
      controls = usePinchZoom({ base: 14, current: () => value, preview,
        commit(next) { commit(next); setValue(next); } }, null);
      return null;
    }
    vi.useFakeTimers();
    let node!: ReturnType<typeof TestRenderer.create>;
    try {
      act(() => { node = TestRenderer.create(React.createElement(Harness)); });
      act(() => controls.contentSized(LIVE_LIMIT + 1));
      for (let index = 0; index < 7; index++) {
        act(() => controls.step(1));
        act(() => { vi.advanceTimersByTime(ZOOM_STEP_MS - 1); });
      }
      expect(controls.badge).toBe(21);
      expect(preview).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(commit.mock.calls).toEqual([[21]]);
      // commit applies the final size; no intermediate preview reflows occurred.
      expect(preview).not.toHaveBeenCalled();
      act(() => controls.step(-1));
    } finally {
      if (node) act(() => node.unmount());
      vi.useRealTimers();
    }
    expect(commit.mock.calls).toEqual([[21], [20]]);
  });

  it("steps and commits by one, respects limits, resets, and renews the badge timer", async () => {
    const { usePinchZoom, ZOOM_BADGE_MS, ZOOM_STEP_MS } = await import("../../client/details/shell/pinch-zoom");
    const { ZoomBadge } = await import("../../client/details/chrome/zoom-badge");
    const commit = vi.fn();
    let controls!: ReturnType<typeof usePinchZoom>;
    let current = 14;
    function Harness() {
      const [value, setValue] = React.useState(14);
      current = value;
      controls = usePinchZoom({ base: 14, current: () => value, preview: setValue,
        commit(next) { commit(next); setValue(next); } }, null);
      return controls.badge === null ? null : React.createElement(ZoomBadge, {
        size: controls.badge, tokens,
        onStep: controls.step, canDecrease: controls.canDecrease, canIncrease: controls.canIncrease,
        onReset: controls.reset, onInteraction: controls.interaction,
      });
    }
    vi.useFakeTimers();
    let node!: ReturnType<typeof TestRenderer.create>;
    try {
      act(() => { node = TestRenderer.create(React.createElement(Harness)); });
      const button = (id: string) => node.root.findAll((entry) => typeof entry.type === "string" && entry.props.testID === id)[0]!;
      const press = (id: string) => act(() => button(id).props.onPress());
      act(() => {
        const touches = [{ pageX: 100, pageY: 500 }, { pageX: 100, pageY: 600 }];
        controls.handlers!.onTouchStart({ nativeEvent: { touches } } as never);
        controls.handlers!.onTouchEnd({ nativeEvent: { touches: [] } } as never);
      });
      expect(button("details-zoom-decrease").props.disabled).toBe(false);
      expect(button("details-zoom-increase").props.disabled).toBe(false);
      expect(button("details-zoom-reset").props.disabled).not.toBe(true);
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS - 100); });
      press("details-zoom-increase");
      expect(current).toBe(15);
      expect(commit).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(100); });
      expect(button("details-zoom-increase")).toBeDefined();
      act(() => { vi.advanceTimersByTime(ZOOM_STEP_MS); });
      expect(commit).toHaveBeenLastCalledWith(15);
      for (let index = 0; index < 11; index++) press("details-zoom-increase");
      expect(current).toBe(26);
      expect(button("details-zoom-increase").props.disabled).toBe(true);
      for (let index = 0; index < 14; index++) press("details-zoom-decrease");
      expect(current).toBe(12);
      expect(button("details-zoom-decrease").props.disabled).toBe(true);
      press("details-zoom-reset");
      expect(current).toBe(14);
      act(() => { vi.advanceTimersByTime(ZOOM_STEP_MS); });
      expect(commit).toHaveBeenLastCalledWith(14);
      expect(button("details-zoom-reset").props.disabled).not.toBe(true);
      press("details-zoom-reset");
      expect(node.toJSON()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(ZOOM_BADGE_MS); });
      expect(node.toJSON()).toBeNull();
    } finally {
      if (node) act(() => node.unmount());
      vi.useRealTimers();
    }
  });

  it("disables growth for tall iOS text while still allowing a smaller size", async () => {
    const { usePinchZoom } = await import("../../client/details/shell/pinch-zoom");
    const globals = globalThis as { __rnMockOS?: string };
    const previousOS = globals.__rnMockOS;
    globals.__rnMockOS = "ios";
    let controls!: ReturnType<typeof usePinchZoom>;
    const commit = vi.fn();
    function Harness() {
      controls = usePinchZoom({ base: 14, current: () => 14, preview() {}, commit }, null);
      return null;
    }
    let node!: ReturnType<typeof TestRenderer.create>;
    try {
      act(() => { node = TestRenderer.create(React.createElement(Harness)); });
      act(() => controls.contentSized(2 ** 18));
      expect(controls.canIncrease).toBe(false);
      expect(controls.canDecrease).toBe(true);
      act(() => controls.step(1));
      expect(commit).not.toHaveBeenCalled();
      act(() => controls.step(-1));
      // The final pending size is saved even if the panel closes immediately.
    } finally {
      if (node) act(() => node.unmount());
      globals.__rnMockOS = previousOS;
    }
    expect(commit).toHaveBeenLastCalledWith(13);
  });
});
