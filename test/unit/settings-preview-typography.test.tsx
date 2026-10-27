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
vi.mock("../../client/ui/wide-host-column", () => ({ useWideHostColumn() {} }));

import { BetterPaseoSettingsPage } from "../../client/settings-page";
import { SettingsPreview } from "../../client/settings-preview";
import { resetEnhancerPreferences } from "../../client/preferences";
import { setSettingsTab } from "../../client/settings-tab";
import {
  RECHECK_MS,
  resetHostAppearanceForTests,
  setNativeSettingsReaderForTests,
  triggerHostAppearanceCheck,
} from "../../client/ui/tokens/host-appearance-shim";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const colors = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
  foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#d00" };
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  resetHostAppearanceForTests();
  vi.restoreAllMocks();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("settings preview host typography", () => {
  it.each(["ios", "android"] as const)("reads and updates Paseo's content size on %s tablets", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    resetEnhancerPreferences();
    setSettingsTab("display");
    resetHostAppearanceForTests();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    let contentFontSize = 12;
    setNativeSettingsReaderForTests(async () => ({
      current: JSON.stringify({ uiBaseFontSize: 14, contentFontSize }), legacy: null,
    }));
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform, compact: false }, host: { id: "host" },
      } as never));
    });
    const content = () => renderer!.root.findByType(SettingsPreview).props.tokens.typography.content;
    expect(content()).toEqual({ size: 12, lineHeight: 18 });

    contentFontSize = 15;
    now.mockReturnValue(1000 + RECHECK_MS);
    await act(async () => triggerHostAppearanceCheck());
    expect(content()).toEqual({ size: 15, lineHeight: 23 });
  });
});
