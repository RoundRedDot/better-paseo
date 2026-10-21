/**
 * Looping indicators on native step on one wall-clock timer instead of running
 * a frame loop. Many Android devices redraw the whole window for any changed
 * view, so a native-driver loop kept an idle foldable repainting at 61 fps for a
 * 6 px dot; a step repaints only when it changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeStepClocks, holdStepClock, stepAt } from "../../client/ui/step-clock";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("step clock", () => {
  it("derives the step from the wall clock", () => {
    expect([0, 74, 75, 899, 900, 975].map((ms) => stepAt(ms, 900, 12))).toEqual([0, 0, 1, 11, 0, 1]);
  });

  it("publishes each step once, on its boundary", () => {
    const steps: number[] = [];
    const release = holdStepClock(900, 12, (step) => steps.push(step));
    expect(steps).toEqual([0]);
    vi.advanceTimersByTime(74);
    expect(steps).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(steps).toEqual([0, 1]);
    vi.advanceTimersByTime(825);
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
    release();
  });

  it("shares one timer per period and stops it with the last holder", () => {
    const first: number[] = [];
    const second: number[] = [];
    const releaseFirst = holdStepClock(900, 12, (step) => first.push(step));
    vi.advanceTimersByTime(150);
    const releaseSecond = holdStepClock(900, 12, (step) => second.push(step));
    expect(activeStepClocks()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(second).toEqual([2]);
    vi.advanceTimersByTime(75);
    expect(first.at(-1)).toBe(3);
    expect(second.at(-1)).toBe(3);

    releaseFirst();
    releaseFirst();
    expect(vi.getTimerCount()).toBe(1);
    releaseSecond();
    expect(activeStepClocks()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
