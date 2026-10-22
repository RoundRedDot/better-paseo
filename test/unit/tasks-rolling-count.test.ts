/**
 * A lane's count rolls to its new value when a card changes lanes, and shows
 * a new filter's count at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const motion = vi.hoisted(() => ({
  reduced: false,
  timings: [] as Array<{ config: { toValue: number; duration: number }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
}));

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Animated: {
      ...rn.Animated,
      timing: (_value: unknown, config: { toValue: number; duration: number }) => {
        const handle = { config, start: vi.fn(), stop: vi.fn() };
        motion.timings.push(handle);
        return handle;
      },
    },
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(motion.reduced),
      addEventListener: () => ({ remove() {} }),
    },
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    ScrollView: rn.ScrollView,
    copyText: async () => {},
    useToast: () => ({ show() {}, error() {} }),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { RollingCount } from "../../client/tasks/board/board-parts";
import { MOTION } from "../../client/tasks/board/board-style";

const STYLE = { fontSize: 13 };
let renderer: ReactTestRenderer | null = null;

function draw(value: number, scope: unknown) {
  const element = React.createElement(RollingCount, { value, scope, style: STYLE });
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = TestRenderer.create(element);
  });
}

/** The numbers drawn, the incoming one first. */
function numbers(): string[] {
  return renderer!.root.findAll((node) => (node.type as unknown) === "Text").map((node) => String(node.props.children));
}

/** The animated wrappers: the incoming number, then the old one. */
function wrappers() {
  return renderer!.root.findAll((node) => (node.type as unknown) === "Animated.View");
}

beforeEach(() => {
  motion.reduced = false;
  motion.timings = [];
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
});

describe("RollingCount", () => {
  it("draws the first count still", () => {
    draw(3, "filters");
    expect(numbers()).toEqual(["3"]);
    expect(motion.timings).toHaveLength(0);
  });

  it("rolls from the old count to the new one, then drops the old", () => {
    const scope = {};
    draw(3, scope);
    draw(4, scope);
    expect(numbers()).toEqual(["4", "3"]);
    expect(wrappers()).toHaveLength(2);
    expect(motion.timings).toHaveLength(1);
    const timing = motion.timings[0]!;
    expect(timing.config).toMatchObject({ toValue: 1, duration: MOTION.countMs });
    // The old number is out of the flow and hidden from screen readers.
    expect(wrappers()[1]!.props).toMatchObject({ pointerEvents: "none", accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" });
    expect(wrappers()[1]!.props.style).toMatchObject({ position: "absolute" });
    const done = timing.start.mock.calls[0]![0] as (result: { finished: boolean }) => void;
    act(() => done({ finished: true }));
    expect(numbers()).toEqual(["4"]);
  });

  it("starts a second change from the count the first was heading to", () => {
    const scope = {};
    draw(3, scope);
    draw(4, scope);
    draw(2, scope);
    expect(numbers()).toEqual(["2", "4"]);
    expect(motion.timings[0]!.stop).toHaveBeenCalled();
    // The stopped roll's late callback leaves the new one alone.
    const late = motion.timings[0]!.start.mock.calls[0]![0] as (result: { finished: boolean }) => void;
    act(() => late({ finished: true }));
    expect(numbers()).toEqual(["2", "4"]);
  });

  it("shows a new scope's count at once", () => {
    draw(3, { filter: "a" });
    draw(1, { filter: "b" });
    expect(numbers()).toEqual(["1"]);
    expect(motion.timings).toHaveLength(0);
  });

  it("does not roll under reduced motion", async () => {
    motion.reduced = true;
    const scope = {};
    draw(3, scope);
    // The setting arrives from a promise.
    await act(async () => {});
    draw(5, scope);
    expect(numbers()).toEqual(["5"]);
    expect(motion.timings).toHaveLength(0);
  });
});
