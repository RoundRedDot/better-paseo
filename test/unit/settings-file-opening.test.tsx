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

describe("file-viewer switch in settings", () => {
  it.each(["en", "zh"] as const)("toggles the saved renderer in %s", (language) => {
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
    const toggle = () => renderer!.root.find((node) => typeof node.type === "string" &&
      node.props.accessibilityRole === "switch" && node.props.accessibilityLabel === SETTINGS_STRINGS[language].fileOpeningTitle);
    expect(toggle().props.accessibilityState.checked).toBe(false);
    act(() => toggle().props.onPress());
    expect(getEnhancerPreferences().fileOpeningMode).toBe("paseo");
    expect(toggle().props.accessibilityState.checked).toBe(true);
    act(() => toggle().props.onPress());
    expect(getEnhancerPreferences().fileOpeningMode).toBe("better-paseo");
    expect(toggle().props.accessibilityState.checked).toBe(false);
  });
});
