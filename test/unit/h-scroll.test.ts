/**
 * The sideways scroller under a table or a code block commits a new width only
 * when its indicator shows the change: content that widens chunk by chunk and
 * still fits draws nothing again.
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("react-native", () => import("./helpers/rn-mock"));

await import("./helpers/quiet-renderer");
const TestRenderer = (await import("react-test-renderer")).default;
const { act } = await import("react-test-renderer");
const { HScroll } = await import("../../client/ui/h-scroll");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tokens = buildThemeTokens({
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ececee",
  border: "#e2e2e6",
  foreground: "#1b1b1f",
  foregroundMuted: "#6b6b75",
  accent: "#3b6fe0",
  accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b",
  statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});

describe("HScroll", () => {
  it("uses the platform indicator without a persistent track when requested", () => {
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      view = TestRenderer.create(React.createElement(HScroll,
        { tokens, indicatorOnScroll: true, children: React.createElement("Content") }));
    });
    const scroller = view.root.find((node) => (node.type as unknown) === "Animated.ScrollView");
    expect(scroller.props.showsHorizontalScrollIndicator).toBe(true);
    expect(scroller.props.onLayout).toBeUndefined();
    expect(view.root.findAll((node) => (node.type as unknown) === "Animated.View")).toHaveLength(0);
    act(() => view.unmount());
  });

  it("commits a width only when the indicator shows it", () => {
    let commits = 0;
    let view!: ReturnType<typeof TestRenderer.create>;
    act(() => {
      view = TestRenderer.create(
        React.createElement(React.Profiler, { id: "scroll", onRender: () => { commits++; } },
          React.createElement(HScroll, { tokens, children: React.createElement("Content") })),
      );
    });
    const scroller = () => view.root.find((node) => (node.type as unknown) === "Animated.ScrollView");
    const track = () => view.root.findAll((node) => (node.type as unknown) === "Animated.View");
    const layout = (width: number) => act(() => scroller().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } }));
    const contentSize = (width: number) => act(() => scroller().props.onContentSizeChange(width, 40));

    layout(300);
    contentSize(120);
    const fitted = commits;
    // A line growing inside the column changes nothing drawn.
    for (const width of [140, 180, 240, 300]) contentSize(width);
    expect(commits).toBe(fitted);
    expect(track()).toHaveLength(0);

    // Past the column, the indicator appears and follows the width.
    contentSize(600);
    expect(commits).toBe(fitted + 1);
    expect(track()).toHaveLength(1);
    contentSize(900);
    expect(commits).toBe(fitted + 2);
    const thumb = track()[0]!;
    expect((thumb.props.style as Array<{ width?: number }>).find((part) => part?.width !== undefined)?.width).toBe(100);

    // A wider column that fits it again takes the indicator away.
    layout(1000);
    expect(track()).toHaveLength(0);
    // A width reported while it fitted is the one used once it overflows.
    contentSize(950);
    layout(500);
    expect((track()[0]!.props.style as Array<{ width?: number }>).find((part) => part?.width !== undefined)?.width).toBe(263);
    act(() => view.unmount());
  });
});
