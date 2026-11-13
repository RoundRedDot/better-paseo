import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", async (original) => {
  const rpc = async () => ({ state: "idle" });
  return { ...await original<object>(), useRpc: () => rpc };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, TextInput: rn.TextInput, ScrollView: rn.ScrollView };
});
vi.mock("../../client/state/preference-sync-slot", () => ({ usePreferenceSettings: () => ({ status: "ready", failed: false }) }));
vi.mock("../../client/settings-preview", () => ({ SettingsPreview: () => null }));
vi.mock("../../client/tasks/chunk/load", () => ({ TasksSettingsPanel: () => null }));
vi.mock("../../client/ui/tokens/host-appearance-shim", async (original) => ({
  ...await original<object>(), useHostAppearance: () => null,
}));
vi.mock("../../client/ui/wide-host-column", () => ({ useWideHostColumn() {} }));

import { BetterPaseoSettingsPage } from "../../client/settings-page";
import { ACCENT_PRESETS, getEnhancerPreferences, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { setSettingsTab } from "../../client/settings-tab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("independent details size in settings", () => {
  it("shows and saves the Paseo theme colours in a wrapping mobile control", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    resetEnhancerPreferences();
    updateEnhancerPreferences({ language: "en" });
    setSettingsTab("display");
    const colors = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
      foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#d00" };
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform: "ios", compact: true }, host: { id: "host" },
      } as never));
    });
    const t = SETTINGS_STRINGS.en;
    const group = renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === t.accentTitle)[0]!;
    expect(group.props.style.flexWrap).toBe("wrap");
    // The same hue order as the inline code row, so the two rows line up.
    const accentLabels = [...new Set(group.findAll((node) => node.props.accessibilityRole === "radio").map((node) => node.props.accessibilityLabel))];
    expect(accentLabels).toEqual([
      t.accentHost, t.accentRose, t.accentClaude, t.accentAmber, t.accentJade,
      t.accentZinc, t.accentMidnight, t.accentGhostty, t.accentViolet, t.accentPureBlack,
    ].map((label) => t.accentOption(label)));
    for (const [id, label] of [["zinc", "Zinc"], ["midnight", "Midnight"], ["claude", "Claude"], ["ghostty", "Ghostty"], ["pureBlack", "Pure black"]] as const) {
      const swatch = renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === `Accent: ${label}`)[0]!;
      expect(swatch.props.style[1].backgroundColor).toBe(ACCENT_PRESETS[id]);
      act(() => swatch.props.onPress());
      expect(getEnhancerPreferences().accent).toBe(id);
    }
  });
  it("shows and saves the additional inline code colours in a wrapping control", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    resetEnhancerPreferences();
    updateEnhancerPreferences({ language: "en" });
    setSettingsTab("display");
    const colors = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
      foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#d00" };
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform: "ios", compact: true }, host: { id: "host" },
      } as never));
    });
    const t = SETTINGS_STRINGS.en;
    const group = renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === t.inlineCodeTitle)[0]!;
    expect(group.props.style.flexWrap).toBe("wrap");
    // One shade per hue: the palette no longer repeats blue, red or grey.
    const labels = [...new Set(group.findAll((node) => node.props.accessibilityRole === "radio").map((node) => node.props.accessibilityLabel))];
    expect(labels).toEqual([
      t.inlineCodeGrey, t.inlineCodeCoral, t.accentClaude, t.accentAmber, t.accentJade,
      t.inlineCodeGreen, t.accentMidnight, t.inlineCodeBlue, t.inlineCodeViolet, t.accentPureBlack,
    ].map((label) => t.inlineCodeOption(label)));
    for (const [id, label] of [
      ["grey", t.inlineCodeGrey], ["coral", t.inlineCodeCoral], ["claude", t.accentClaude],
      ["amber", t.accentAmber], ["jade", t.accentJade], ["green", t.inlineCodeGreen],
      ["midnight", t.accentMidnight], ["blue", t.inlineCodeBlue], ["violet", t.inlineCodeViolet],
      ["pureBlack", t.accentPureBlack],
    ] as const) {
      const swatch = renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === t.inlineCodeOption(label))[0]!;
      act(() => swatch.props.onPress());
      expect(getEnhancerPreferences().inlineCodeColor).toBe(id);
      expect(swatch.props.accessibilityState.checked).toBe(true);
    }
  });
  it.each(["en", "zh"] as const)("changes, clamps and resets the same saved setting in %s", async (language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    resetEnhancerPreferences();
    updateEnhancerPreferences({ language });
    setSettingsTab("display");
    const colors = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
      foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#d00" };
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform: "ios", compact: true }, host: { id: "host" },
      } as never));
    });
    const t = SETTINGS_STRINGS[language];
    const control = (label: string) => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === label)[0]!;
    const press = (label: string) => act(() => control(label).props.onPress());
    expect(control(t.detailsSizeValue(14))).toBeDefined();
    press(t.detailsSizeLarger);
    expect(getEnhancerPreferences().detailsFontSize).toBe(15);
    act(() => updateEnhancerPreferences({ detailsFontSize: 18 }));
    expect(control(t.detailsSizeValue(18))).toBeDefined();
    press(t.codeSizeLarger);
    press(t.blockSizeLarger);
    expect(getEnhancerPreferences().detailsFontSize).toBe(18);
    act(() => updateEnhancerPreferences({ detailsFontSize: 26 }));
    expect(control(t.detailsSizeLarger).props.disabled).toBe(true);
    act(() => updateEnhancerPreferences({ detailsFontSize: 12 }));
    expect(control(t.detailsSizeSmaller).props.disabled).toBe(true);
    press(t.detailsSizeReset);
    expect(getEnhancerPreferences().detailsFontSize).toBe(14);
    expect(control(t.detailsSizeReset).props.disabled).toBe(false);
  });
});
