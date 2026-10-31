import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { Animated, Pressable, StyleSheet } from "react-native";
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

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({
  useReducedMotion: () => motion.reduced,
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
  motion.reduced = false;
  device.tablet = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mobile card action feedback", () => {
  it("holds feedback until touch end, including reduced motion and cancellation", async () => {
    const timing = vi.spyOn(Animated, "timing");
    const props = { tokens, compact: true, look: "plain" as const, label: "Action", onPress: vi.fn() };
    const root = await render(<CardButton {...props} />);
    const button = () => root.findByType(Pressable);
    act(() => { button().props.onTouchStart({}); button().props.onPressIn({}); });
    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1.03, duration: 100 }));
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeTruthy();
    timing.mockClear();
    act(() => button().props.onPressOut({}));
    expect(timing).not.toHaveBeenCalled();
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeTruthy();
    act(() => button().props.onTouchEnd({}));
    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1 }));
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeFalsy();
    motion.reduced = true;
    await act(async () => renderer.update(<CardButton {...props} />));
    timing.mockClear();
    act(() => { button().props.onTouchStart({}); button().props.onPressIn({}); });
    expect(timing).not.toHaveBeenCalled();
    const current = StyleSheet.flatten(button().props.style);
    expect(current.transform[0].scale.__value).toBe(1.03);
    expect(current.boxShadow).toBeFalsy();
    act(() => button().props.onTouchCancel({}));
    expect(StyleSheet.flatten(button().props.style).transform[0].scale.__value).toBe(1);
    await act(async () => renderer.update(<CardButton {...props} disabled />));
    act(() => button().props.onPressIn({}));
    expect(timing).not.toHaveBeenCalled();
  });

  it.each(["plain", "primary", "danger", "answer", "archive", "read"] as const)("tints %s on press, releases, and leaves disabled actions unchanged", async (look) => {
    const props = { tokens, compact: true, look, label: "Action", onPress: vi.fn() };
    const root = await render(<CardButton {...props} />);
    const button = () => root.findByType(Pressable);
    expect(style(button(), false).backgroundColor).toBe("transparent");
    expect(style(button(), true).backgroundColor).not.toBe("transparent");
    expect(style(button(), false).backgroundColor).toBe("transparent");
    expect(props.onPress).not.toHaveBeenCalled();
    button().props.onPress();
    expect(props.onPress).toHaveBeenCalledOnce();
    for (const state of [{ disabled: true }, { busy: true }]) {
      await act(async () => renderer.update(<CardButton {...props} {...state} />));
      expect(button().props.disabled).toBe(true);
      expect(style(button(), true).backgroundColor).toBe("transparent");
    }
  });

  it.each([false, true])("tints Stop, its menu trigger and Mark read, including pending states (compact=%s)", async (compact) => {
    const props = {
      card: sample("sample-running"), theme, compact,
      fields: { ...CARD_PRESETS.standard.fields, labelLimit: CARD_PRESETS.standard.labelLimit },
      permissionButtons: [], stopPhase: "idle" as const, focused: false, highlighted: false,
      now, language: "en" as const, onReveal() {}, onStop() {}, onRead() {},
    };
    const root = await render(<TaskCardView {...props} />);
    const button = (label: string) => root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === label)!;
    for (const label of ["Stop", "Stop options"]) {
      expect(style(button(label), false).backgroundColor).toBe("transparent");
      expect(style(button(label), true).backgroundColor).toBe(tokens.card.dangerHover);
    }
    await act(async () => renderer.update(<TaskCardView {...props} stopPhase="stopping" />));
    for (const label of ["Stop", "Stop options"]) {
      expect(button(label).props.disabled).toBe(true);
      expect(style(button(label), true).backgroundColor).toBe("transparent");
    }
    const card = { ...sample("sample-unread"), readable: true };
    await act(async () => renderer.update(<TaskCardView {...props} card={card} />));
    expect(style(button("Mark as read"), true).backgroundColor).toBe(tokens.card.readHover);
    expect(style(button("Mark as read"), false).backgroundColor).toBe("transparent");
    await act(async () => renderer.update(<TaskCardView {...props} card={card} readPending />));
    expect(button("Mark as read").props.disabled).toBe(true);
    expect(style(button("Mark as read"), true).backgroundColor).toBe("transparent");
  });
});

describe("phone sheet action size", () => {
  it.each([
    { os: "web", sidebar: true, font: 14 },
    { os: "web", sidebar: false, font: 12 },
    { os: "ios", sidebar: true, font: 12 },
  ])("sizes archive and open labels for $os sidebar=$sidebar", async ({ os, sidebar, font }) => {
    vi.stubGlobal("__rnMockOS", os);
    device.tablet = os === "ios";
    const card = sample("sample-done");
    const root = await render(<DetailActionBar card={card} theme={theme} language="zh" strings={BOARD_STRINGS.zh.sidebar}
      sidebar={sidebar} archive={{ pending: () => false, press() {} }} onOpen={() => {}} />);
    const buttons = root.findAllByType(Pressable);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const label = button.find((node) => (node.type as unknown) === "Text");
      expect(StyleSheet.flatten(label.props.style).fontSize).toBe(font);
    }
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
      expect(style(button, false)).toMatchObject({ height: Math.round(36 * factor), borderRadius: 8, paddingHorizontal: 10, gap: 5 });
      expect(button.findAll((node) => (node.type as unknown) === "Icon").every((icon) => icon.props.size === 14)).toBe(true);
      const label = button.find((node) => (node.type as unknown) === "Text");
      expect(StyleSheet.flatten(label.props.style).fontSize).toBe(Math.round(12 * factor));
      button.props.onPress();
    }
    expect(archive.press).toHaveBeenCalledWith(card.id);
    expect(onOpen).toHaveBeenCalledWith(card.id);
  });

  it("animates each sheet action and skips animation with reduced motion", async () => {
    const timing = vi.spyOn(Animated, "timing");
    const card = sample("sample-input");
    const element = <DetailActionBar card={card} theme={theme} language="en" strings={BOARD_STRINGS.en.sidebar}
      onOpen={() => {}} onPermission={() => {}} permissionButtons={permissionButtons(card.permission!, "en")} />;
    const root = await render(element);
    for (const button of root.findAllByType(Pressable)) {
      timing.mockClear();
      act(() => button.props.onPressIn({}));
      expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1.03 }));
    }
    motion.reduced = true;
    await act(async () => renderer.update(React.cloneElement(element)));
    timing.mockClear();
    for (const button of root.findAllByType(Pressable)) act(() => button.props.onPressIn({}));
    expect(timing).not.toHaveBeenCalled();
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
    for (const button of buttons) {
      expect(style(button, false)).toMatchObject({ height: Math.round((tablet ? 36 : 40) * factor), borderRadius: tablet ? 8 : 10 });
      expect(style(button, true).backgroundColor).not.toBe(style(button, false).backgroundColor);
      const icons = button.findAll((node) => (node.type as unknown) === "Icon");
      expect(icons.every((icon) => icon.props.size === (tablet ? 14 : 16))).toBe(true);
    }
    const open = buttons.find((button) => button.props.testID === "detail-bar-open")!;
    expect(style(open, false).width).toBe(Math.round((tablet ? 36 : 40) * factor));
    const allow = buttons.find((button) => button.props.accessibilityLabel === "Allow")!;
    expect(style(allow, false).paddingHorizontal).toBe(tablet ? 10 : 12);
    const label = allow.find((node) => (node.type as unknown) === "Text");
    expect(StyleSheet.flatten(label.props.style).fontSize).toBe(Math.round(12 * factor));
  });
});
