import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
import TestRenderer, { act } from "react-test-renderer";

type Motion = {
  value: { setValue(value: number): void; __value: number };
  to: number;
  ms: number;
  native: boolean;
  interaction: boolean;
  stop: ReturnType<typeof vi.fn>;
  finish(finished?: boolean): void;
};
const motion = vi.hoisted(() => ({ reduced: false, runs: [] as Motion[], layouts: vi.fn() }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    LayoutAnimation: { configureNext: motion.layouts },
    Animated: {
      ...rn.Animated,
      timing: (value: Motion["value"], config: { toValue: number; duration: number; useNativeDriver: boolean; isInteraction: boolean }) => {
        let callback: ((result: { finished: boolean }) => void) | undefined;
        const run: Motion = {
          value, to: config.toValue, ms: config.duration, native: config.useNativeDriver,
          interaction: config.isInteraction,
          stop: vi.fn(() => callback?.({ finished: false })),
          finish(finished = true) {
            if (finished) value.setValue(config.toValue);
            callback?.({ finished });
          },
        };
        motion.runs.push(run);
        return { start: (done: typeof callback) => { callback = done; }, stop: run.stop };
      },
    },
  };
});

import { View } from "react-native";
import { SubtaskPanel } from "../../client/tasks/cards/subtask-panel";

let renderer: TestRenderer.ReactTestRenderer | undefined;
const element = (expanded: boolean, animated = true) => (
  <SubtaskPanel expanded={expanded} animated={animated}><View testID="rows" /></SubtaskPanel>
);
const nodes = (testID: string) => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
const panel = () => nodes("task-card-subtasks-panel")[0]!;
async function render(expanded = false, animated = true) {
  await act(async () => { renderer = TestRenderer.create(element(expanded, animated)); });
}
async function update(expanded: boolean, animated = true) {
  await act(async () => { renderer!.update(element(expanded, animated)); });
}
async function measure(height: number) {
  await act(async () => nodes("task-card-subtasks-measure")[0]!.props.onLayout({ nativeEvent: { layout: { height } } }));
}
const last = () => motion.runs.at(-1)!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  motion.reduced = false;
  motion.runs.length = 0;
  motion.layouts.mockClear();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  vi.useRealTimers();
});

describe.each(["ios", "android"])("native subtask panel motion (%s)", (os) => {
  beforeEach(() => { (globalThis as { __rnMockOS?: string }).__rnMockOS = os; });

  it("animates layout and opacity on native without measurement and retains rows through collapse", async () => {
    await render();
    expect(nodes("rows")).toHaveLength(0);
    await update(true);
    expect(panel().props.style.height).toBeUndefined();
    expect(panel().props.style.opacity.__value).toBe(0);
    expect(nodes("task-card-subtasks-measure")).toHaveLength(0);
    expect(last()).toMatchObject({ to: 1, ms: 180, native: true, interaction: false });
    expect(motion.layouts).toHaveBeenLastCalledWith({ duration: 180, update: { type: "easeOut" } });
    await act(async () => last().finish());
    expect(panel().props.style.opacity.__value).toBe(1);

    await update(false);
    expect(last()).toMatchObject({ to: 0, ms: 140 });
    expect(panel().props.style.height).toBe(0);
    expect(motion.layouts).toHaveBeenLastCalledWith({ duration: 140, update: { type: "easeOut" } });
    expect(nodes("rows")).toHaveLength(1);
    expect(panel().props).toMatchObject({ pointerEvents: "none", accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" });
    await act(async () => last().finish(false));
    expect(nodes("rows")).toHaveLength(1);
    await act(async () => last().finish());
    expect(nodes("rows")).toHaveLength(0);
  });

  it("reverses an unfinished collapse from its current progress and ignores the old completion", async () => {
    await render(true);
    await update(false);
    const closing = last();
    closing.value.setValue(0.4);
    await update(true);
    expect(closing.stop).toHaveBeenCalledOnce();
    expect(last()).toMatchObject({ to: 1 });
    expect(last().value.__value).toBe(0.4);
    // A queued native/JS completion must not unmount the reopened list.
    await act(async () => closing.finish());
    expect(nodes("rows")).toHaveLength(1);
    expect(panel().props.pointerEvents).toBe("auto");
    await act(async () => last().finish());
    expect(nodes("rows")).toHaveLength(1);
  });

  it("can close immediately after opening and reopen after a completed collapse", async () => {
    await render();
    await update(true);
    await update(false);
    await act(async () => last().finish());
    expect(nodes("rows")).toHaveLength(0);
    await update(true);
    await act(async () => last().finish());
    await update(false);
    await act(async () => last().finish());
    await update(true);
    expect(last()).toMatchObject({ to: 1 });
    expect(nodes("rows")).toHaveLength(1);
  });

  it("keeps restored expansion at natural height without measuring or replaying entrance", async () => {
    await render(true);
    expect(panel().props.style.height).toBeUndefined();
    expect(panel().props.style.opacity.__value).toBe(1);
    await update(true);
    expect(motion.runs).toHaveLength(0);
    expect(motion.layouts).not.toHaveBeenCalled();
    expect(nodes("task-card-subtasks-measure")).toHaveLength(0);
    expect(panel().props.style.opacity.__value).toBe(1);
  });

  it.each(["reduced", "static"])("shows and hides immediately for %s motion", async (mode) => {
    motion.reduced = mode === "reduced";
    const animated = mode !== "static";
    await render(false, animated);
    await update(true, animated);
    expect(nodes("rows")).toHaveLength(1);
    expect(panel().props.style.height).toBeUndefined();
    expect(panel().props.style.opacity.__value).toBe(1);
    await update(false, animated);
    expect(nodes("rows")).toHaveLength(0);
    expect(motion.runs).toHaveLength(0);
    expect(motion.layouts).not.toHaveBeenCalled();
  });

  it("settles an in-flight collapse immediately when reduced motion is enabled", async () => {
    await render(true);
    await update(false);
    const closing = last();
    motion.reduced = true;
    await update(false);
    expect(closing.stop).toHaveBeenCalledOnce();
    expect(nodes("rows")).toHaveLength(0);
  });

  it("stops its animation on unmount", async () => {
    await render(true);
    await update(false);
    const opening = last();
    await act(async () => renderer!.unmount());
    expect(opening.stop).toHaveBeenCalledOnce();
  });
});

describe("web subtask panel motion", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    vi.useFakeTimers();
  });

  it("uses CSS transitions after measurement and releases rows after the exit boundary", async () => {
    await render();
    expect(nodes("rows")).toHaveLength(0);
    expect(panel().props.style).toMatchObject({ height: 0, opacity: 0 });
    await update(true);
    expect(panel().props.style.height).toBe(0);
    await measure(160);
    expect(panel().props.style).toMatchObject({ height: 160, opacity: 1, transitionProperty: "height, opacity", transitionDuration: "180ms" });
    await update(false);
    expect(panel().props.style).toMatchObject({ height: 0, opacity: 0, transitionDuration: "140ms" });
    expect(panel().props).toMatchObject({ pointerEvents: "none", "aria-hidden": true });
    await act(async () => { vi.advanceTimersByTime(139); });
    expect(nodes("rows")).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(nodes("rows")).toHaveLength(0);
    expect(nodes("task-card-subtasks-panel")).toHaveLength(1);
    expect(motion.runs).toHaveLength(0);
    expect(motion.layouts).not.toHaveBeenCalled();
  });

  it("cancels the closing boundary when reversed and reopens after completed collapse", async () => {
    await render();
    await update(true);
    await measure(120);
    await update(false);
    await act(async () => { vi.advanceTimersByTime(60); });
    await update(true);
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(nodes("rows")).toHaveLength(1);
    expect(panel().props.style).toMatchObject({ height: 120, opacity: 1 });
    await update(false);
    await act(async () => { vi.advanceTimersByTime(140); });
    await update(true);
    await measure(240);
    expect(panel().props.style.height).toBe(240);
    expect(nodes("rows")).toHaveLength(1);
  });

  it("keeps restored expansion natural until measured and follows content resizing without JS animation", async () => {
    await render(true);
    expect(panel().props.style).toMatchObject({ height: undefined, opacity: 1 });
    await measure(120);
    await measure(240);
    expect(panel().props.style.height).toBe(240);
    expect(motion.runs).toHaveLength(0);
  });

  it.each(["reduced", "static"])("skips CSS motion and releases immediately for %s motion", async (mode) => {
    motion.reduced = mode === "reduced";
    const animated = mode !== "static";
    await render(false, animated);
    await update(true, animated);
    expect(panel().props.style).toMatchObject({ height: undefined, opacity: 1, transitionDuration: "0ms" });
    await update(false, animated);
    expect(nodes("rows")).toHaveLength(0);
  });

  it("clears its exit timer on unmount", async () => {
    await render(true);
    await measure(120);
    await update(false);
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => renderer!.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
