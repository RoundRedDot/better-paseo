/**
 * The running dot pulses without React. React Native Web has no native driver,
 * so an `Animated` opacity loop there re-renders the dot, and commits its row,
 * on every frame. On web the pulse is a CSS animation instead. Native steps the
 * opacity on the shared step clock: a native-driver loop changed the dot on every
 * vsync, and many Android devices redraw the whole window for that. Reduced
 * motion draws a still dot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(os: "web" | "ios", reducedMotion = false) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  vi.resetModules();
  vi.doMock("react-native", async () => {
    const rn = await import("./helpers/rn-mock");
    const loop = vi.fn(() => ({ start() {}, stop() {}, reset() {} }));
    return {
      ...rn,
      Animated: { ...rn.Animated, loop },
      AccessibilityInfo: {
        isReduceMotionEnabled: () => Promise.resolve(reducedMotion),
        addEventListener: () => ({ remove() {} }),
      },
    };
  });
  await import("./helpers/quiet-renderer");
  const TestRenderer = (await import("react-test-renderer")).default;
  const { act } = await import("react-test-renderer");
  const rn = (await import("react-native")) as unknown as { Animated: { loop: ReturnType<typeof vi.fn> } };
  const { RunningDot } = await import("../../client/ui/running-dot");
  const { activeStepClocks } = await import("../../client/ui/step-clock");
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(RunningDot, { color: "#4f8cff" }));
  });
  const node = renderer.root.findAll((n) => {
    const type = n.type as unknown as string;
    return type === "View" || type === "Animated.View";
  })[0]!;
  const style = Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
  const clocks = activeStepClocks();
  await act(async () => renderer.unmount());
  return { type: node.type, style, loops: rn.Animated.loop.mock.calls.length, clocks, clocksAfter: activeStepClocks() };
}

afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("RunningDot", () => {
  it("pulses with a CSS animation on web, without an Animated loop", async () => {
    const dot = await render("web");
    expect(dot.type).toBe("View");
    expect(dot.loops).toBe(0);
    expect(dot.style.animationIterationCount).toBe("infinite");
    expect(dot.style.animationDuration).toBe("1200ms");
    expect(dot.style.animationKeyframes).toEqual([
      { "0%": { opacity: 1 }, "50%": { opacity: 0.3 }, "100%": { opacity: 1 } },
    ]);
  });

  it("is still on web under reduced motion", async () => {
    const dot = await render("web", true);
    expect(dot.style.animationKeyframes).toBeUndefined();
    expect(dot.style.opacity ?? 1).toBe(1);
  });

  it("steps the opacity on the shared clock on native, without a frame loop", async () => {
    const dot = await render("ios");
    expect(dot.type).toBe("Animated.View");
    expect(dot.loops).toBe(0);
    expect(dot.clocks).toBe(1);
    expect(dot.clocksAfter).toBe(0);
    expect([1, 0.65, 0.3]).toContain((dot.style.opacity as { __value: number }).__value);
    expect(dot.style.animationKeyframes).toBeUndefined();
  });

  it("is still on native under reduced motion", async () => {
    const dot = await render("ios", true);
    expect(dot.clocks).toBe(0);
    expect((dot.style.opacity as { __value: number }).__value).toBe(1);
  });
});

describe("runningDotOpacity", () => {
  it("pulses 1.0, 0.65, 0.3, 0.65 over one period", async () => {
    const { runningDot, runningDotOpacity } = await import("../../client/ui/tokens/motion");
    expect(runningDot.steps).toBe(4);
    expect([0, 1, 2, 3].map(runningDotOpacity)).toEqual([1, 0.65, 0.3, 0.65]);
  });
});
