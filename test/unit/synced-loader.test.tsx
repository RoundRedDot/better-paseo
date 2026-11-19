import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));

import { SyncedLoader, SYNCED_LOADER_FRAMES } from "../../client/ui/synced-loader";

let renderer: TestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  motion.reduced = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function opacities() {
  const grid = renderer!.root.find((node) => String(node.type) === "View" && node.props.testID === "grid");
  return grid.children.map((node) => (node as TestRenderer.ReactTestInstance).props.style.opacity);
}

describe("Paseo synced reply loader", () => {
  it("follows the shared six-step clock and releases its timer", () => {
    act(() => { renderer = TestRenderer.create(<SyncedLoader color="#123" gridTestID="grid" />); });
    expect(opacities()).toEqual(SYNCED_LOADER_FRAMES[0]);
    act(() => { vi.advanceTimersByTime(160); });
    expect(opacities()).toEqual(SYNCED_LOADER_FRAMES[1]);
    act(() => { vi.advanceTimersByTime(160); });
    expect(opacities()).toEqual(SYNCED_LOADER_FRAMES[2]);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the first frame still when reduced motion is enabled", () => {
    motion.reduced = true;
    act(() => { renderer = TestRenderer.create(<SyncedLoader color="#123" gridTestID="grid" />); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(opacities()).toEqual(SYNCED_LOADER_FRAMES[0]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
