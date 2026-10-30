import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
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
import { getEnhancerPreferences, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
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
  it.each(["en", "zh"] as const)("changes, clamps and resets the same saved setting in %s", (language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    resetEnhancerPreferences();
    updateEnhancerPreferences({ language });
    setSettingsTab("display");
    const colors = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
      foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#d00" };
    act(() => {
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
