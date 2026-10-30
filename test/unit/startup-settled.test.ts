import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import {
  AFTER_ROW_MS,
  MAX_WAIT_MS,
  afterStartup,
  noteTimelineRowShown,
  resetStartupSettled,
  type StartupTimers,
} from "../../client/state/startup-settled";
import { loadMarks, resetLoadMarks } from "../../client/debug/load-marks";

// Work held back until the chat has drawn (`startup-settled.ts`): the Tasks
// chunk's background fetch waits for it.

/** Real timers from vitest's fake clock; interactions run at once unless held. */
function timers(holdInteractions = false) {
  const held: Array<() => void> = [];
  const cancelled = vi.fn();
  const value: StartupTimers = {
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    afterInteractions: (run) => {
      if (holdInteractions) held.push(run);
      else run();
      return { cancel: cancelled };
    },
  };
  return { value, held, cancelled };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStartupSettled();
  resetLoadMarks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("afterStartup", () => {
  it("runs AFTER_ROW_MS after the first chat row, off the row's own effect", () => {
    const run = vi.fn();
    afterStartup(run, timers().value);
    vi.advanceTimersByTime(500);
    noteTimelineRowShown();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AFTER_ROW_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs after MAX_WAIT_MS when no chat row shows", () => {
    const run = vi.fn();
    afterStartup(run, timers().value);
    vi.advanceTimersByTime(MAX_WAIT_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("counts from the row when it showed before the request", () => {
    noteTimelineRowShown();
    vi.advanceTimersByTime(AFTER_ROW_MS + 200);
    const run = vi.fn();
    afterStartup(run, timers().value);
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for running interactions before it runs", () => {
    const run = vi.fn();
    const t = timers(true);
    afterStartup(run, t.value);
    noteTimelineRowShown();
    vi.advanceTimersByTime(AFTER_ROW_MS);
    expect(run).not.toHaveBeenCalled();
    t.held[0]!();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs nothing once cancelled, before or after the interactions wait", () => {
    const early = vi.fn();
    afterStartup(early, timers().value)();
    vi.advanceTimersByTime(MAX_WAIT_MS * 2);
    noteTimelineRowShown();
    vi.advanceTimersByTime(AFTER_ROW_MS * 2);
    expect(early).not.toHaveBeenCalled();

    const late = vi.fn();
    const t = timers(true);
    const cancel = afterStartup(late, t.value);
    vi.advanceTimersByTime(AFTER_ROW_MS);
    cancel();
    expect(t.cancelled).toHaveBeenCalledTimes(1);
  });

  it("marks the first row once", () => {
    noteTimelineRowShown();
    const first = loadMarks()["row.first"];
    vi.advanceTimersByTime(50);
    noteTimelineRowShown();
    expect(loadMarks()["row.first"]).toBe(first);
  });
});
