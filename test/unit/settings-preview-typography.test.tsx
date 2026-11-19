import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", async (original) => {
  const rpc = async () => ({ state: "idle", entries: [], error: null });
  return {
    ...await original<object>(),
    useRpc: () => rpc,
    useSettings: () => ({ status: "loading", saving: false, saveError: null, save: async () => true, reset: async () => true }),
  };
});
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, TextInput: rn.TextInput, ScrollView: rn.ScrollView };
});
vi.mock("../../client/state/preference-sync-slot", () => ({ usePreferenceSettings: () => ({ status: "ready", failed: false }) }));
vi.mock("../../client/settings-preview", () => ({ SettingsPreview: () => null }));
vi.mock("../../client/tasks/chunk/load", () => ({ TasksSettingsPanel: () => null }));
vi.mock("../../client/ui/wide-host-column", () => ({ useWideHostColumn() {} }));

import { Section, SettingRow } from "../../client/settings-controls";
import { BetterPaseoSettingsPage } from "../../client/settings-page";
import { SettingsPreview } from "../../client/settings-preview";
import { resetEnhancerPreferences } from "../../client/preferences";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import { StyleSheet } from "./helpers/rn-mock";
import { setSettingsTab } from "../../client/settings-tab";
import { openTranslationSettings, registerTranslationSettingsOpener } from "../../client/translation/navigation";
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

function textStyle(text: string) {
  return StyleSheet.flatten(renderer!.root.find((node) => (node.type as unknown) === "Text" && node.props.children === text).props.style);
}

function expectSettingsSizes(base: number) {
  const t = SETTINGS_STRINGS.en;
  const titles = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === t.pageTitle);
  expect(titles.some((node) => StyleSheet.flatten(node.props.style).fontSize === base + 2)).toBe(true);
  expect(textStyle(t.languageTitle)).toMatchObject({ fontSize: base, lineHeight: Math.round(base * 1.4) });
  expect(textStyle(t.languageTips[0]!.text).fontSize).toBe(base - 1);
  expect(textStyle(t.sectionGeneral).fontSize).toBe(base - 1);
  expect(textStyle(t.previewHide).fontSize).toBe(base - 1);
  expect(textStyle(t.languageEnglish).fontSize).toBe(base - 1);
}

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  resetHostAppearanceForTests();
  vi.restoreAllMocks();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("translation settings placement", () => {
  it("opens at the translation section when requested from the popup", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    resetEnhancerPreferences();
    const paseo = {};
    const open = vi.fn();
    const release = registerTranslationSettingsOpener(paseo, open);
    openTranslationSettings(paseo as never);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform: "ios", compact: true }, host: { id: "host" },
      } as never));
    });
    const sections = renderer!.root.findAllByType(Section);
    expect(sections[0]?.props.title).toBe("Timeline Translation");
    expect(sections.filter((section) => section.props.title === "Timeline Translation")).toHaveLength(1);
    expect(open).toHaveBeenCalledWith("chat-presentation");
    release();
  });

  it("places its own section immediately after the timeline mode", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    resetEnhancerPreferences();
    setSettingsTab("display");
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform: "web", compact: false }, host: { id: "host" },
      } as never));
    });
    const sections = renderer!.root.findAllByType(Section);
    const generalIndex = sections.findIndex((section) => section.props.title === SETTINGS_STRINGS.en.sectionGeneral);
    expect(generalIndex).toBeGreaterThanOrEqual(0);
    const general = sections[generalIndex]!;
    expect(general.findAllByType(SettingRow).at(-1)?.props.title).toBe(SETTINGS_STRINGS.en.timelineTitle);
    expect(sections[generalIndex + 1]?.props.title).toBe("Timeline Translation");
  });
});

describe("settings preview host typography", () => {
  it.each(["ios", "android"] as const)("reads and updates Paseo's content size on %s tablets", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    resetEnhancerPreferences();
    setSettingsTab("display");
    resetHostAppearanceForTests();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    let uiBaseFontSize = 14;
    let contentFontSize = 12;
    setNativeSettingsReaderForTests(async () => ({
      current: JSON.stringify({ uiBaseFontSize, contentFontSize }), legacy: null,
    }));
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: { colors }, layout: { platform, compact: false }, host: { id: "host" },
      } as never));
    });
    const content = () => renderer!.root.findByType(SettingsPreview).props.tokens.typography.content;
    expect(content()).toEqual({ size: 12, lineHeight: 18 });
    expectSettingsSizes(14);

    contentFontSize = 15;
    now.mockReturnValue(1000 + RECHECK_MS);
    await act(async () => triggerHostAppearanceCheck());
    expect(content()).toEqual({ size: 15, lineHeight: 23 });
    expectSettingsSizes(14);

    uiBaseFontSize = 13;
    now.mockReturnValue(1000 + RECHECK_MS * 2);
    await act(async () => triggerHostAppearanceCheck());
    expectSettingsSizes(13);
    expect(content()).toEqual({ size: 15, lineHeight: 23 });
  });

  it.each(["web", "ios", "android"] as const)("uses UI size for settings independently of preview content on %s", (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    resetEnhancerPreferences();
    setSettingsTab("display");
    for (const compact of [false, true]) {
      for (const content of [10, 14, 21]) {
        const page = (ui: number) => React.createElement(BetterPaseoSettingsPage, {
          theme: { colors, typography: { fontSize: { ui, content } } },
          layout: { platform, compact }, host: { id: "host" },
        } as never);
        act(() => { renderer = TestRenderer.create(page(19)); });
        expectSettingsSizes(19);
        expect(renderer!.root.findByType(SettingsPreview).props.tokens.typography.content.size).toBe(content);
        act(() => renderer!.update(page(11)));
        expectSettingsSizes(11);
        expect(renderer!.root.findByType(SettingsPreview).props.tokens.typography.content.size).toBe(content);
        act(() => renderer!.unmount());
        renderer = undefined;
      }
    }
  });
});
