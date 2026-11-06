import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

const motion = vi.hoisted(() => ({ reduced: false }));
const timings = vi.hoisted(() => [] as { toValue: number; duration: number; easing?: (t: number) => number; useNativeDriver: boolean }[]);
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Animated: {
      ...rn.Animated,
      Value: class {
        constructor(public __value: number) {}
        setValue(value: number) { this.__value = value; }
        interpolate(config: { inputRange: number[]; outputRange: number[] }) { return config; }
      },
      // Keep entry in its first frame until unmount; clicks must already work.
      timing: (_value: unknown, config: typeof timings[number]) => {
        timings.push(config);
        return { start() {}, stop() {} };
      },
    },
  };
});
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
vi.mock("../../client/ui/use-copy", () => ({ useCopy: () => ({ copy: vi.fn() }) }));
vi.mock("@getpaseo/plugin/client/react-native", async () => ({ Icon: (await import("./helpers/rn-mock")).View }));

import { StyleSheet } from "react-native";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { usePreviewEntrance } from "../../client/ui/use-preview-entrance";
import { DESKTOP_OVERLAY } from "../../client/ui/tokens/motion";
import { RowMenu } from "../../client/details/row-menu";
import { SidePanel } from "../../client/details/shell/side-panel";
import { BottomPanel, type BottomPanelProps } from "../../client/details/shell/bottom-panel";
import { createBodyScroll } from "../../client/details/shell/body-handover";
import { CopyOverflowMenu } from "../../client/details/chrome/copy-overflow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#ffffff", surface1: "#eeeeee", surface2: "#dddddd", border: "#cccccc",
  foreground: "#111111", foregroundMuted: "#666666", accent: "#0000ff", accentForeground: "#ffffff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.stubGlobal("__rnMockOS", "web");
  motion.reduced = false;
  timings.length = 0;
});
afterEach(() => {
  act(() => tree?.unmount());
  vi.unstubAllGlobals();
});

function Preview(props: { ready: boolean; quiet?: boolean }) {
  return <div style={usePreviewEntrance(props) as never} />;
}
const previewStyle = () => tree.root.findByType("div").props.style;
const host = (testID: string) => tree.root.find((node) => typeof node.type === "string" && node.props.testID === testID);

describe("desktop overlay entry", () => {
  it("matches the CSS easing without overshoot and reaches most of its travel early", () => {
    expect(DESKTOP_OVERLAY.ease(0)).toBe(0);
    expect(DESKTOP_OVERLAY.ease(1)).toBe(1);
    expect(DESKTOP_OVERLAY.ease(0.5)).toBeGreaterThan(0.95);
    let previous = 0;
    for (let step = 0; step <= 100; step++) {
      const value = DESKTOP_OVERLAY.ease(step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("waits for placement, then starts already readable with only 2px of travel", () => {
    act(() => { tree = TestRenderer.create(<Preview ready={false} />); });
    expect(previewStyle().opacity).toBe(0);
    expect(timings).toHaveLength(0);
    act(() => tree.update(<Preview ready />));
    expect(previewStyle().opacity.__value).toBe(0.9);
    expect(previewStyle().transform).toEqual([{ translateY: { inputRange: [0.9, 1], outputRange: [2, 0] } }]);
    expect(timings).toEqual([{ toValue: 1, duration: 100, easing: DESKTOP_OVERLAY.ease, useNativeDriver: false }]);
  });

  it.each(["quiet", "reduced"])("shows %s previews at rest without an entry animation", (mode) => {
    motion.reduced = mode === "reduced";
    act(() => { tree = TestRenderer.create(<Preview ready quiet={mode === "quiet"} />); });
    expect(previewStyle().opacity.__value).toBe(1);
    expect(previewStyle().transform).toEqual([{ translateY: 0 }]);
    expect(timings).toHaveLength(0);
  });

  it.each(["ios", "android"])("preserves the native preview entrance on %s", (os) => {
    vi.stubGlobal("__rnMockOS", os);
    act(() => { tree = TestRenderer.create(<Preview ready />); });
    expect(timings[0]).toMatchObject({ duration: 140, useNativeDriver: true });
    expect(previewStyle().transform).toEqual([{ translateY: { inputRange: [0, 1], outputRange: [4, 0] } }]);
  });

  it("opens a row menu without scale and lets its action close it during entry", () => {
    const close = vi.fn();
    const open = vi.fn();
    act(() => { tree = TestRenderer.create(<RowMenu anchor={{ x: 10, y: 20, width: 30, height: 24 }} title="Tool"
      hasBody copyItems={[]} tokens={tokens} onOpen={open} onToggle={vi.fn()} onClose={close} />); });
    const style = host("details-row-menu").props.style;
    expect(style.opacity.__value).toBe(0.9);
    expect(style.transform).toEqual([{ translateY: { inputRange: [0.9, 1], outputRange: [-2, 0] } }]);
    expect(timings[0]).toMatchObject({ duration: 100, easing: DESKTOP_OVERLAY.ease, useNativeDriver: false });
    const item = tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Open details");
    act(() => item.props.onPress());
    expect(close).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it("keeps a side panel's first frame near opaque and closes without waiting", () => {
    const exited = vi.fn();
    const panel = (leaving: boolean) => <SidePanel tokens={tokens} stage={{ width: 1400, height: 900 }} insets={{ top: 0, bottom: 0 }}
      reduced={false} entrance="slide" leaving={leaving} onExited={exited} wide={false} resizable={false} onOutside={vi.fn()}><div /></SidePanel>;
    act(() => { tree = TestRenderer.create(panel(false)); });
    const style = StyleSheet.flatten(host("details-side").props.style);
    expect(style.opacity.__value).toBe(0.9);
    expect(style.transform[0].translateX.__value).toBe(2);
    expect(timings).toHaveLength(2);
    expect(timings.every((entry) => entry.duration === 100 && entry.easing === DESKTOP_OVERLAY.ease)).toBe(true);
    act(() => tree.update(panel(true)));
    expect(exited).toHaveBeenCalledOnce();
  });

  it("replays a copy dropdown's entrance on every opening and closes immediately on selection", () => {
    const copy = vi.fn();
    act(() => { tree = TestRenderer.create(<CopyOverflowMenu tokens={tokens} items={[{ label: "Copy output", icon: "Copy", text: "output", copy }]} />); });
    const trigger = () => tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "More");
    for (let opening = 1; opening <= 2; opening++) {
      act(() => trigger().props.onPress());
      const style = StyleSheet.flatten(host("details-copy-dropdown").props.style);
      expect(style.opacity.__value).toBe(0.9);
      expect(style.transform[0].translateY.outputRange).toEqual([-2, 0]);
      expect(timings).toHaveLength(opening);
      const item = tree.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Copy output");
      act(() => item.props.onPress());
      expect(copy).toHaveBeenCalledTimes(opening);
      expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "details-copy-dropdown")).toHaveLength(0);
    }
  });

  it.each(["web", "ios"])("keeps floating panel layout and native travel intact on %s", (os) => {
    vi.stubGlobal("__rnMockOS", os);
    const exited = vi.fn();
    const props: Omit<BottomPanelProps, "children"> = {
      form: "floating", blockId: "one", tokens, stage: { width: 800, height: 900 },
      insets: { top: 0, bottom: 0 }, detent: "fit", reduced: false,
      entrance: "slide", leaving: false, onExited: exited, onDetent() {}, onClose() {}, onTop() {},
      dragRef: { current: null }, hold: () => () => {}, bodyAtTop: () => true,
      body: createBodyScroll(),
      testID: "panel", frame: { left: 20, width: 760, bottom: 12 }, corners: "all", bottomPad: 0, available: 888,
    };
    act(() => { tree = TestRenderer.create(<BottomPanel {...props}><div /></BottomPanel>); });
    expect(StyleSheet.flatten(host("panel-frame").props.style).opacity.__value).toBe(0);
    act(() => host("panel").props.onLayout({ nativeEvent: { layout: { height: 300 } } }));
    const style = StyleSheet.flatten(host("panel-frame").props.style);
    expect(style.opacity.__value).toBe(os === "web" ? 0.9 : 1);
    expect(style.transform[0].translateY.__value).toBe(os === "web" ? 2 : 300);
    expect(timings.some((entry) => entry.duration === (os === "web" ? 100 : 280))).toBe(true);
    act(() => tree.update(<BottomPanel {...props} leaving><div /></BottomPanel>));
    expect(exited).toHaveBeenCalledTimes(os === "web" ? 1 : 0);
  });
});
