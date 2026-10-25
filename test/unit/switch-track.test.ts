import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

const system = vi.hoisted(() => ({
  reduced: false,
  listener: null as ((reduced: boolean) => void) | null,
  remove: vi.fn(),
}));
vi.mock("react-native", async () => ({
  ...(await import("./helpers/rn-mock")),
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(system.reduced),
    addEventListener: (event: string, listener: (reduced: boolean) => void) => {
      expect(event).toBe("reduceMotionChanged");
      system.listener = listener;
      return { remove: () => { system.listener = null; system.remove(); } };
    },
  },
}));

import { Animated, StyleSheet } from "react-native";
import { SwitchTrack } from "../../client/ui/switch-track";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const globals = globalThis as { __rnMockOS?: string };
const colors = { accent: "#00f", accentForeground: "#fff", surface0: "#eee", surface2: "#ddd", border: "#ccc" };
const element = (value: boolean) => React.createElement(SwitchTrack, { value, colors });
let renderer: TestRenderer.ReactTestRenderer | undefined;
const animations: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> }> = [];
let timing: MockInstance<typeof Animated.timing>;

async function mount(value: boolean) {
  await act(async () => { renderer = TestRenderer.create(element(value)); });
  return renderer!;
}

function setReduced(reduced: boolean) {
  act(() => {
    system.reduced = reduced;
    system.listener!(reduced);
  });
}

beforeEach(() => {
  system.reduced = false;
  system.remove.mockClear();
  animations.length = 0;
  globals.__rnMockOS = "ios";
  // Leave timing in flight so interruption/cleanup assertions cannot pass
  // merely because a synchronous mock completed the animation already.
  timing = vi.spyOn(Animated, "timing").mockImplementation(() => {
    const animation = { start: vi.fn(), stop: vi.fn(), reset: vi.fn() };
    animations.push(animation);
    return animation;
  });
});

afterEach(() => {
  if (renderer) {
    setReduced(false);
    act(() => renderer!.unmount());
    renderer = undefined;
  }
  vi.restoreAllMocks();
  delete globals.__rnMockOS;
});

describe("SwitchTrack motion", () => {
  it.each(["ios", "android", "web"])("keeps the 140ms on/off timing and driver on %s", async (os) => {
    globals.__rnMockOS = os;
    const tree = await mount(false);
    const position = timing.mock.calls[0]![0];
    act(() => tree.update(element(true)));
    expect(animations[0]!.stop).toHaveBeenCalledOnce();
    expect(timing).toHaveBeenLastCalledWith(position, {
      toValue: 1, duration: 140, useNativeDriver: os !== "web",
    });
    expect(animations[1]!.start).toHaveBeenCalledOnce();
    act(() => tree.update(element(false)));
    expect(animations[1]!.stop).toHaveBeenCalledOnce();
    expect(timing).toHaveBeenLastCalledWith(position, {
      toValue: 0, duration: 140, useNativeDriver: os !== "web",
    });
  });

  it.each([false, true])("stops an in-flight animation and snaps to %s when the system enables reduced motion", async (target) => {
    const tree = await mount(!target);
    act(() => tree.update(element(target)));
    const position = timing.mock.calls.at(-1)![0] as Animated.Value;
    position.setValue(0.4);
    const setValue = vi.spyOn(position, "setValue");
    const active = animations.at(-1)!;
    const count = timing.mock.calls.length;
    // Exercise the real shared hook's system subscription, without a prop update.
    setReduced(true);
    expect(active.stop).toHaveBeenCalledOnce();
    expect(setValue).toHaveBeenLastCalledWith(target ? 1 : 0);
    expect(active.stop.mock.invocationCallOrder[0]).toBeLessThan(setValue.mock.invocationCallOrder[0]!);
    expect(timing).toHaveBeenCalledTimes(count);
    act(() => tree.update(element(!target)));
    expect(setValue).toHaveBeenLastCalledWith(target ? 0 : 1);
    expect(timing).toHaveBeenCalledTimes(count);
    setReduced(false);
    expect(timing).toHaveBeenLastCalledWith(position, {
      toValue: target ? 0 : 1, duration: 140, useNativeDriver: true,
    });
  });

  it("honors an initially enabled system setting and subsequent value changes immediately", async () => {
    system.reduced = true;
    const tree = await mount(false);
    // The shared hook's initial asynchronous read stops any initial animation.
    for (const animation of animations) expect(animation.stop).toHaveBeenCalledOnce();
    const count = timing.mock.calls.length;
    const position = timing.mock.calls[0]![0] as Animated.Value;
    const setValue = vi.spyOn(position, "setValue");
    act(() => tree.update(element(true)));
    expect(timing).toHaveBeenCalledTimes(count);
    expect(setValue).toHaveBeenLastCalledWith(1);
    act(() => tree.update(element(false)));
    expect(setValue).toHaveBeenLastCalledWith(0);
  });

  it("stops the current animation and releases the shared system subscription on unmount", async () => {
    const tree = await mount(false);
    act(() => tree.update(element(true)));
    const active = animations.at(-1)!;
    act(() => tree.unmount());
    renderer = undefined;
    expect(active.stop).toHaveBeenCalledOnce();
    expect(system.remove).toHaveBeenCalledOnce();
    expect(system.listener).toBeNull();
  });

  it.each([false, true])("keeps geometry and colors without adding a role or press target (value=%s)", async (value) => {
    const tree = await mount(value);
    const track = tree.root.findByType("View" as never);
    const knob = tree.root.findByType("Animated.View" as never);
    expect(StyleSheet.flatten(track.props.style)).toMatchObject({
      width: 40, height: 24, borderRadius: 12, borderWidth: 1,
      backgroundColor: value ? colors.accent : colors.surface2,
      borderColor: value ? colors.accent : colors.border,
    });
    expect(StyleSheet.flatten(knob.props.style)).toMatchObject({
      width: 18, height: 18, borderRadius: 9,
      backgroundColor: value ? colors.accentForeground : colors.surface0,
      borderColor: value ? colors.accentForeground : colors.border,
    });
    expect(tree.root.findAll((node) => node.props.accessibilityRole || node.props.role || node.props.onPress)).toHaveLength(0);
  });
});
