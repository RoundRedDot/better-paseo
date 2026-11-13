import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { Animated, Platform, Pressable, StyleSheet } from "react-native";
import "./helpers/quiet-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const device = vi.hoisted(() => ({ tablet: false }));
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { ...rn, Platform: { ...rn.Platform, get OS() { return rn.Platform.OS; }, get isPad() { return device.tablet; } } };
});
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
  copyText: async () => {},
  useToast: () => ({ show() {}, error() {} }),
}));

import { CardButton } from "../../client/tasks/cards/action-buttons";
import { TaskCardView } from "../../client/tasks/cards/task-card";
import { DetailActionBar } from "../../client/tasks/cards/detail-cards";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { permissionButtons } from "../../client/tasks/actions";
import { TasksTypographyScale } from "../../client/tasks/typography";
import { RoundButton } from "../../client/tasks/board/board-parts";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({
  useReducedMotion: () => motion.reduced,
  getReducedMotion: () => motion.reduced,
}));

const theme = { colors: {
  surface0: "#ffffff", surface1: "#f7f7f8", surface2: "#efeff1", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
} };
const tokens = taskTokens(theme);
const now = Date.parse("2026-10-20T09:00:00.000Z");
const sample = (id: string) => previewSampleCards(now).find((card) => card.id === id)!;
let renderer: TestRenderer.ReactTestRenderer;

async function render(element: React.ReactElement) {
  await act(async () => { renderer = TestRenderer.create(element); });
  return renderer.root;
}

function style(button: ReactTestInstance, pressed: boolean) {
  if (typeof button.props.style === "function") return StyleSheet.flatten(button.props.style({ pressed }));
  act(() => {
    if (pressed) button.props.onPressIn?.({});
    else button.props.onPressOut?.({});
  });
  return StyleSheet.flatten(button.props.style);
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  motion.reduced = false;
  device.tablet = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Native responder dispatch precedes touch-start bubbling; web dispatches touch-start first. */
function touchDown(button: ReactTestInstance) {
  const event = { nativeEvent: { pageX: 100, pageY: 100, identifier: 0 } };
  act(() => {
    if (Platform.OS !== "web") button.props.onPressIn?.(event);
    button.props.onTouchStart?.(event);
    if (Platform.OS === "web") button.props.onPressIn?.(event);
  });
}

/** A finger: down, held past the cue delay, nothing hovered first. */
function hold(button: ReactTestInstance, ms = 100) {
  touchDown(button);
  act(() => { vi.advanceTimersByTime(ms); });
}

function release(button: ReactTestInstance) {
  act(() => { button.props.onPressOut?.({}); button.props.onTouchEnd?.({}); });
}

describe("mobile toolbar feedback", () => {
  it.each(["ios", "android"])("keeps the shadow without scaling under reduced motion on %s", async (os) => {
    vi.stubGlobal("__rnMockOS", os);
    vi.useFakeTimers();
    motion.reduced = true;
    const onPress = vi.fn();
    const root = await render(<RoundButton icon="Search" label="Search" theme={theme} borderless onPress={onPress} />);
    const button = root.findByType(Pressable);
    hold(button);
    expect(StyleSheet.flatten(button.props.style).transform).toBeUndefined();
    expect(StyleSheet.flatten(button.find((node) => (node.type as unknown) === "View").props.style).boxShadow).toBe(tokens.card.buttonShadowHover);
    release(button);
    expect(StyleSheet.flatten(button.find((node) => (node.type as unknown) === "View").props.style).boxShadow).toBeFalsy();
  });
});

describe("mobile card action feedback", () => {
  it.each(["scroll", "pan", "cancel"])("suppresses a %s gesture and accepts the next quick tap", async (kind) => {
    vi.useFakeTimers();
    const onPress = vi.fn();
    const root = await render(<CardButton tokens={tokens} compact look="plain" label="Action" onPress={onPress} />);
    const button = () => root.findByType(Pressable);
    act(() => {
      touchDown(button());
      if (kind === "cancel") button().props.onTouchCancel({});
      else button().props.onTouchMove({ nativeEvent: { pageX: kind === "pan" ? 115 : 100, pageY: kind === "scroll" ? 108 : 100 } });
      button().props.onPressOut({});
      button().props.onTouchEnd?.({});
      button().props.onPress({ nativeEvent: { identifier: 0, detail: 1 } });
    });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onPress).not.toHaveBeenCalled();
    act(() => {
      touchDown(button());
      button().props.onPressOut({});
      button().props.onTouchEnd?.({});
      button().props.onPress({});
    });
    expect(onPress).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(200); });
    vi.useRealTimers();
  });

  it.each(["android", "web"].flatMap((os) => ["scroll", "pan", "cancel"].map((kind) => ({ os, kind }))))("accepts accessibility clicks after a $kind on $os without reviving the cancelled gesture", async ({ os, kind }) => {
    vi.stubGlobal("__rnMockOS", os);
    const onPress = vi.fn();
    const root = await render(<CardButton tokens={tokens} compact look="plain" label="Action" onPress={onPress} />);
    const button = root.findByType(Pressable);
    act(() => {
      touchDown(button);
      if (kind === "cancel") button.props.onTouchCancel({});
      else button.props.onTouchMove({ nativeEvent: { pageX: kind === "pan" ? 115 : 100, pageY: kind === "scroll" ? 108 : 100 } });
      button.props.onPressOut({});
      button.props.onTouchEnd?.({});
    });
    // Pressability invokes onPress directly for accessibility, without a new onPressIn.
    button.props.onPress({ nativeEvent: os === "web" ? { detail: 0 } : {} });
    expect(onPress).toHaveBeenCalledOnce();
    button.props.onPress({ nativeEvent: { identifier: 0, detail: 1 } });
    expect(onPress).toHaveBeenCalledOnce();
    button.props.onPress({ nativeEvent: os === "web" ? { detail: 0 } : {} });
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it.each(["ios", "android", "web"].flatMap((os) => ["end", "cancel"].map((finish) => ({ os, finish }))))("restores card long-press feedback after a nested scroll finishes with $finish on $os", async ({ os, finish }) => {
    vi.useFakeTimers();
    vi.stubGlobal("__rnMockOS", os);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const onSelect = vi.fn();
    const onStop = vi.fn();
    const onLongPress = vi.fn(() => false);
    const root = await render(<TaskCardView card={sample("sample-running")} theme={theme} compact
      fields={{ ...CARD_PRESETS.standard.fields, labelLimit: CARD_PRESETS.standard.labelLimit }}
      permissionButtons={[]} stopPhase="idle" focused={false} highlighted={false} now={now} language="en"
      onReveal={() => {}} onSelect={onSelect} onStop={onStop} onLongPress={onLongPress} />);
    const card = root.findAllByType(Pressable).find((node) => node.props.testID === "task-card-sample-running")!;
    const stop = root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === "Stop")!;
    const surface = () => StyleSheet.flatten(card.props.style);
    act(() => {
      touchDown(stop);
      // Only touch events bubble to the parent; the child owns the responder callbacks.
      card.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } });
      const moved = { nativeEvent: { pageX: 100, pageY: 120, identifier: 0, detail: 1 } };
      stop.props.onTouchMove(moved);
      card.props.onTouchMove(moved);
      if (finish === "cancel") {
        stop.props.onTouchCancel(moved);
        card.props.onTouchCancel(moved);
      }
      stop.props.onPressOut(moved);
      if (finish === "end") {
        stop.props.onTouchEnd?.(moved);
        card.props.onTouchEnd?.(moved);
      }
      stop.props.onPress(moved);
      card.props.onPress(moved);
      card.props.onLongPress(moved);
    });
    expect(onStop).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
    touchDown(card);
    act(() => { vi.advanceTimersByTime(99); });
    expect(surface().boxShadow).not.toBe(tokens.card.shadowHover);
    act(() => { vi.advanceTimersByTime(1); });
    expect(surface().boxShadow).toBe(tokens.card.shadowHover);
    act(() => { vi.advanceTimersByTime(350); card.props.onLongPress({ nativeEvent: { pageX: 100, pageY: 100, identifier: 1 } }); });
    expect(onLongPress).toHaveBeenCalledOnce();
    expect(surface().boxShadow).toBe(tokens.card.shadowHover);
    release(card);
    expect(surface().boxShadow).not.toBe(tokens.card.shadowHover);
    vi.useRealTimers();
  });

  it("covers a card button under a finger, insets it under a trackpad, and skips the inset with reduced motion", async () => {
    vi.useFakeTimers();
    const timing = vi.spyOn(Animated, "timing");
    const props = { tokens, compact: true, look: "plain" as const, label: "Action", onPress: vi.fn() };
    const root = await render(<CardButton {...props} />);
    const button = () => root.findByType(Pressable);
    const flat = () => StyleSheet.flatten(button().props.style);
    // A finger: no scale, no line, no shadow, however long it stays.
    hold(button(), 300);
    expect(timing).not.toHaveBeenCalled();
    expect(flat().boxShadow).toBeFalsy();
    expect(flat().borderColor).toBe(tokens.card.buttonBorder);
    release(button());
    act(() => { vi.advanceTimersByTime(100); });
    // A trackpad: its hover arrives first, so the press insets at once and steps the line.
    act(() => button().props.onHoverIn({}));
    act(() => button().props.onPressIn({}));
    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.96, duration: 80 }));
    expect(flat().borderColor).toBe(tokens.borderStrong);
    expect(flat().boxShadow).toBeFalsy();
    timing.mockClear();
    release(button());
    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 160 }));
    expect(flat().borderColor).toBe(tokens.card.buttonBorder);
    motion.reduced = true;
    await act(async () => renderer.update(<CardButton {...props} />));
    timing.mockClear();
    act(() => button().props.onPressIn({}));
    expect(timing).not.toHaveBeenCalled();
    expect(flat().transform[0].scale.__value).toBe(1);
    expect(flat().borderColor).toBe(tokens.borderStrong);
    release(button());
    await act(async () => renderer.update(<CardButton {...props} disabled />));
    act(() => button().props.onPressIn({}));
    expect(timing).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each(["plain", "primary", "danger", "answer", "archive", "read"] as const)("keeps %s clear under a finger, and steps only its line under a trackpad", async (look) => {
    vi.useFakeTimers();
    const props = { tokens, compact: true, look, label: "Action", onPress: vi.fn() };
    const root = await render(<CardButton {...props} />);
    const button = () => root.findByType(Pressable);
    const flat = () => StyleSheet.flatten(button().props.style);
    const rest = flat();
    expect(rest.backgroundColor).toBe("transparent");
    expect(rest.boxShadow).toBeFalsy();
    hold(button());
    expect(flat().backgroundColor).toBe("transparent");
    expect(flat().boxShadow).toBeFalsy();
    expect(flat().borderColor).toBe(rest.borderColor);
    release(button());
    act(() => button().props.onHoverIn({}));
    act(() => button().props.onPressIn({}));
    expect(flat().backgroundColor).toBe("transparent");
    expect(flat().boxShadow).toBeFalsy();
    // A plain line steps to borderStrong; a hued one keeps its hue on a light theme.
    expect(flat().borderColor).toBe(look === "plain" ? tokens.borderStrong : rest.borderColor);
    release(button());
    expect(props.onPress).not.toHaveBeenCalled();
    button().props.onPress();
    expect(props.onPress).toHaveBeenCalledOnce();
    for (const state of [{ disabled: true }, { busy: true }]) {
      await act(async () => renderer.update(<CardButton {...props} {...state} />));
      expect(button().props.disabled).toBe(true);
      act(() => button().props.onPressIn({}));
      expect(flat().backgroundColor).toBe("transparent");
      expect(flat().boxShadow).toBeFalsy();
      release(button());
    }
    vi.useRealTimers();
  });

  it.each([false, true])("keeps Stop, its menu trigger and Mark read clear under a finger, and insets them under a trackpad (compact=%s)", async (compact) => {
    vi.useFakeTimers();
    const timing = vi.spyOn(Animated, "timing");
    const props = {
      card: sample("sample-running"), theme, compact,
      fields: { ...CARD_PRESETS.standard.fields, labelLimit: CARD_PRESETS.standard.labelLimit },
      permissionButtons: [], stopPhase: "idle" as const, focused: false, highlighted: false,
      now, language: "en" as const, onReveal() {}, onStop() {}, onRead() {},
    };
    const root = await render(<TaskCardView {...props} />);
    const button = (label: string) => root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === label)!;
    const outline = () => StyleSheet.flatten(root.findByProps({ testID: "task-card-stop-outline" }).props.style);
    const flat = (label: string) => {
      const value = button(label).props.style;
      return StyleSheet.flatten(typeof value === "function" ? value({ pressed: false }) : value);
    };
    for (const label of ["Stop", "Stop options"]) {
      timing.mockClear();
      hold(button(label));
      expect(flat(label).backgroundColor).toBe("transparent");
      expect(outline().boxShadow).toBeFalsy();
      expect(timing).not.toHaveBeenCalled();
      release(button(label));
      act(() => button(label).props.onHoverIn({}));
      act(() => button(label).props.onPressIn({}));
      expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.96 }));
      expect(outline().boxShadow).toBeFalsy();
      release(button(label));
      act(() => button(label).props.onHoverOut({}));
    }
    await act(async () => renderer.update(<TaskCardView {...props} stopPhase="stopping" />));
    for (const label of ["Stop", "Stop options"]) {
      expect(button(label).props.disabled).toBe(true);
      expect(outline().boxShadow).toBeFalsy();
    }
    const card = { ...sample("sample-unread"), readable: true };
    await act(async () => renderer.update(<TaskCardView {...props} card={card} />));
    hold(button("Mark as read"));
    expect(flat("Mark as read").backgroundColor).toBe("transparent");
    expect(flat("Mark as read").boxShadow).toBeFalsy();
    release(button("Mark as read"));
    await act(async () => renderer.update(<TaskCardView {...props} card={card} readPending />));
    expect(button("Mark as read").props.disabled).toBe(true);
    vi.useRealTimers();
  });
});

describe("phone sheet action size", () => {
  it.each([
    { os: "web", sidebar: true, font: 12, height: 34, radius: 8, icon: 14 },
    { os: "web", sidebar: false, font: 12, height: 34, radius: 10, icon: 14 },
    { os: "ios", sidebar: true, font: 12, height: 36, radius: 8, icon: 16 },
    { os: "android", sidebar: true, smallTablet: true, font: 12, height: 36, radius: 10, icon: 16 },
    { os: "android", sidebar: true, smallTablet: false, font: 12, height: 36, radius: 10, icon: 16 },
    { os: "android", sidebar: false, font: 12, height: 36, radius: 10, icon: 16 },
  ])("sizes archive and open labels for $os sidebar=$sidebar", async ({ os, sidebar, smallTablet, font, height, radius, icon }) => {
    vi.stubGlobal("__rnMockOS", os);
    device.tablet = os === "ios";
    const card = sample("sample-done");
    const root = await render(<DetailActionBar card={card} theme={theme} language="zh" strings={BOARD_STRINGS.zh.sidebar}
      sidebar={sidebar} smallTablet={smallTablet} archive={{ pending: () => false, press() {} }} onOpen={() => {}} />);
    const buttons = root.findAllByType(Pressable);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(style(button, false)).toMatchObject({ height, borderRadius: radius });
      if (os === "android" && button.props.testID === "detail-bar-open") expect(style(button, false)).toMatchObject({ flexGrow: 1, paddingHorizontal: 12 });
      expect(button.findAll((node) => (node.type as unknown) === "Icon").every((mark) => mark.props.size === icon)).toBe(true);
      const label = button.find((node) => (node.type as unknown) === "Text");
      expect(StyleSheet.flatten(label.props.style).fontSize).toBe(font);
    }
  });

  it("keeps the Android sidebar's icon-only open action at the touch size", async () => {
    vi.stubGlobal("__rnMockOS", "android");
    const card = sample("sample-input");
    const root = await render(<DetailActionBar card={card} theme={theme} language="en" strings={BOARD_STRINGS.en.sidebar}
      sidebar smallTablet onOpen={() => {}} onPermission={() => {}} permissionButtons={permissionButtons(card.permission!, "en")} />);
    const open = root.findAllByType(Pressable).find((button) => button.props.testID === "detail-bar-open")!;
    expect(style(open, false)).toMatchObject({ width: 36, height: 36 });
  });

  it.each([1, 1.5])("uses smaller iPad archive and open actions at font scale %s", async (factor) => {
    device.tablet = true;
    const card = sample("sample-done");
    const archive = { pending: () => false, press: vi.fn() };
    const onOpen = vi.fn();
    const root = await render(<TasksTypographyScale factor={factor}>
      <DetailActionBar card={card} theme={theme} language="zh" strings={BOARD_STRINGS.zh.sidebar}
        sidebar archive={archive} onOpen={onOpen} />
    </TasksTypographyScale>);
    const buttons = root.findAllByType(Pressable);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(style(button, false)).toMatchObject({ height: Math.round(36 * factor), borderRadius: 8, paddingHorizontal: 10, gap: 4 });
      expect(button.findAll((node) => (node.type as unknown) === "Icon").every((icon) => icon.props.size === 16)).toBe(true);
      const label = button.find((node) => (node.type as unknown) === "Text");
      expect(StyleSheet.flatten(label.props.style).fontSize).toBe(Math.round(12 * factor));
      button.props.onPress();
    }
    expect(archive.press).toHaveBeenCalledWith(card.id);
    expect(onOpen).toHaveBeenCalledWith(card.id);
  });

  it("insets each sheet action under a trackpad, never under a finger, and skips the inset with reduced motion", async () => {
    vi.useFakeTimers();
    const timing = vi.spyOn(Animated, "timing");
    const card = sample("sample-input");
    const element = <DetailActionBar card={card} theme={theme} language="en" strings={BOARD_STRINGS.en.sidebar}
      onOpen={() => {}} onPermission={() => {}} permissionButtons={permissionButtons(card.permission!, "en")} />;
    const root = await render(element);
    for (const button of root.findAllByType(Pressable)) {
      timing.mockClear();
      hold(button);
      expect(timing).not.toHaveBeenCalled();
      release(button);
      act(() => button.props.onHoverIn({}));
      act(() => button.props.onPressIn({}));
      expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0.96, duration: 80 }));
      release(button);
      act(() => button.props.onHoverOut({}));
    }
    motion.reduced = true;
    await act(async () => renderer.update(React.cloneElement(element)));
    timing.mockClear();
    for (const button of root.findAllByType(Pressable)) {
      act(() => button.props.onHoverIn({}));
      act(() => button.props.onPressIn({}));
    }
    expect(timing).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it.each([
    { tablet: false, factor: 1 }, { tablet: false, factor: 1.5 },
    { tablet: true, factor: 1 }, { tablet: true, factor: 1.5 },
  ])("keeps permission actions and square buttons scaled for %j", async ({ tablet, factor }) => {
    device.tablet = tablet;
    const card = sample("sample-input");
    const root = await render(<TasksTypographyScale factor={factor}>
      <DetailActionBar card={card} theme={theme} language="en" strings={BOARD_STRINGS.en.sidebar}
        onOpen={() => {}} onPermission={() => {}} permissionButtons={permissionButtons(card.permission!, "en")} />
    </TasksTypographyScale>);
    const buttons = root.findAllByType(Pressable);
    expect(buttons).toHaveLength(3);
    vi.useFakeTimers();
    for (const button of buttons) {
      const rest = StyleSheet.flatten(button.props.style);
      expect(rest).toMatchObject({ height: Math.round(36 * factor), borderRadius: tablet ? 8 : 10 });
      expect(rest.boxShadow).toBeFalsy();
      // A finger held still: a bar button wider than it shows the raised shadow; the square Open is covered.
      hold(button);
      const held = StyleSheet.flatten(button.props.style);
      expect(held.backgroundColor).toBe(rest.backgroundColor);
      expect(held.boxShadow).toBe(button.props.testID === "detail-bar-open" ? undefined : tokens.card.buttonShadowHover);
      release(button);
      expect(StyleSheet.flatten(button.props.style).boxShadow).toBeFalsy();
      const icons = button.findAll((node) => (node.type as unknown) === "Icon");
      expect(icons.every((icon) => icon.props.size === 16)).toBe(true);
    }
    vi.useRealTimers();
    const open = buttons.find((button) => button.props.testID === "detail-bar-open")!;
    expect(style(open, false).width).toBe(Math.round(36 * factor));
    const allow = buttons.find((button) => button.props.accessibilityLabel === "Allow")!;
    expect(style(allow, false).paddingHorizontal).toBe(tablet ? 10 : 12);
    const label = allow.find((node) => (node.type as unknown) === "Text");
    expect(StyleSheet.flatten(label.props.style).fontSize).toBe(Math.round(12 * factor));
  });
});
