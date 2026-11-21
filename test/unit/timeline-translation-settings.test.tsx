import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { measureHostTree } from "./helpers/yoga-host-layout";
import {
  DEFAULT_TRANSLATION_PROMPT,
  describeTranslationLimitation,
  TRANSLATION_PROMPT_MAX_LENGTH,
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";
import { ProviderLogo } from "../../client/components/provider-logo";
import { ModelSettingsControls } from "../../client/model-settings-controls";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { DEFAULT_PREFERENCES, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { Section, SectionFooter, SettingRow } from "../../client/settings-controls";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
import {
  getTranslationSettingsState,
  reportTranslationSettings,
  resetTranslationSettingsStoreForTests,
} from "../../client/translation/settings-store";

const mocks = vi.hoisted(() => ({
  settingsState: null as unknown,
  modelsRpc: vi.fn(),
  saveSpy: vi.fn<(next: TimelineTranslationSettings, rev: string) => Promise<boolean>>(async () => true),
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => mocks.settingsState,
  useRpc: () => mocks.modelsRpc,
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const ReactModule = await import("react");
  const Modal = Object.assign(
    (props: { open?: boolean; title?: string; children?: React.ReactNode }) =>
      props.open ? ReactModule.createElement("Modal", { title: props.title }, props.children) : null,
    {
      Content: (props: { children?: React.ReactNode }) =>
        ReactModule.createElement("ModalContent", null, props.children),
    },
  );
  return {
    Icon: (props: Record<string, unknown>) => ReactModule.createElement("Icon", props),
    Modal,
    TextInput: "TextInput",
    ScrollView: "ScrollView",
  };
});

import { placeLanguageMenu } from "../../client/translation/language-picker";
import {
  TimelineTranslationSettings as TimelineTranslationSettingsSection,
  describeThinkingStatus,
  resetTranslationSettingsCatalogForTests,
} from "../../client/translation/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f7",
    surface2: "#ededef",
    border: "#e2e2e6",
    foreground: "#18181b",
    foregroundMuted: "#62626b",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d92d20",
  },
};

function makeLook(compact = false, lang: "en" | "zh" = "en") {
  const tokens = buildThemeTokens(theme.colors, { ...DEFAULT_PREFERENCES, language: lang }, { platform: "web" });
  return { compact, tokens, t: SETTINGS_STRINGS[lang] };
}

function makeReadySettings(values: Partial<TimelineTranslationSettings> = {}, options?: { saveResult?: boolean; reload?: () => Promise<void> }) {
  const parsed = timelineTranslationSettingsSchema.parse(values);
  return {
    status: "ready" as const,
    values: parsed,
    revision: "rev-1",
    saving: false,
    saveError: null,
    save: vi.fn(async (next: TimelineTranslationSettings, rev: string) => {
      await mocks.saveSpy(next, rev);
      return options?.saveResult ?? true;
    }),
    reset: vi.fn(async () => true),
    reload: options?.reload ?? vi.fn(async () => {}),
  };
}

function textValues(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => {
      const children = node.props.children;
      if (typeof children === "string") return children;
      if (Array.isArray(children)) return children.filter((c) => typeof c === "string").join("");
      return "";
    })
    .filter(Boolean);
}

let renderer: ReturnType<typeof TestRenderer.create> | undefined;

beforeEach(() => {
  resetEnhancerPreferences();
  updateEnhancerPreferences({ language: "en" });
  resetTranslationSettingsStoreForTests();
  resetTranslationSettingsCatalogForTests();
  mocks.saveSpy.mockReset();
  mocks.modelsRpc.mockReset();
  mocks.modelsRpc.mockResolvedValue({
    providers: ["claude", "codex"],
    providerLabels: { claude: "Claude", codex: "Codex" },
    models: [
      {
        id: "claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        thinkingOptions: [
          { id: "minimal", label: "Minimal" },
          { id: "high", label: "High" },
        ],
        defaultThinkingOptionId: "high",
      },
      {
        id: "claude-opus-4-1",
        label: "Claude Opus 4.1",
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "high", label: "High" },
        ],
        defaultThinkingOptionId: "high",
      },
    ],
    error: null,
  });
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("timeline translation settings", () => {
  it("defaults translation to off while preserving saved choices", () => {
    expect(timelineTranslationSettingsSchema.parse({}).enabled).toBe(false);
    expect(timelineTranslationSettingsSchema.parse({ enabled: false }).enabled).toBe(false);
    expect(timelineTranslationSettingsSchema.parse({ enabled: true }).enabled).toBe(true);
  });

  it("describes thinking capability honestly without claiming unsupported models disable thinking", () => {
    const base = timelineTranslationSettingsSchema.parse({
      customModel: true,
      disableThinking: true,
      provider: "claude",
      model: "claude-sonnet-4-5",
    });

    const supported = describeThinkingStatus(
      base,
      {
        id: "claude-sonnet-4-5",
        label: "Sonnet",
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "high", label: "High" },
        ],
        defaultThinkingOptionId: "high",
      },
      false,
      "en",
    );
    expect(supported.tone).toBe("accent");
    expect(supported.text).toContain("off");

    const unsupported = describeThinkingStatus(
      base,
      {
        id: "claude-sonnet-4-5",
        label: "Sonnet",
        thinkingOptions: [
          { id: "minimal", label: "Minimal" },
          { id: "low", label: "Low" },
        ],
        defaultThinkingOptionId: "low",
      },
      false,
      "en",
    );
    expect(unsupported.tone).toBe("warning");
    expect(unsupported.text).toContain("NOT silently downgrade");

    const none = describeThinkingStatus(
      base,
      {
        id: "plain",
        label: "Plain",
        thinkingOptions: [],
        defaultThinkingOptionId: null,
      },
      false,
      "en",
    );
    expect(none.tone).toBe("neutral");
    expect(none.text).toContain("no selectable thinking switch");
    expect(none.text).not.toContain("thinking is disabled");
  });

  it("toggles master switch, searches 119 languages, and saves selected target language", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, targetLanguage: "interface" });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }),
      );
    });

    const masterSwitch = renderer!.root.find(
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable selection translation",
    );
    await act(async () => {
      masterSwitch.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }), "rev-1");

    // Open target language picker, search by code and select Serbian (Latin).
    const langTrigger = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Target language",
    );
    await act(async () => {
      langTrigger.props.onPress();
    });

    const searchInput = renderer!.root.find((n) => (n.type as unknown) === "TextInput");
    await act(async () => {
      searchInput.props.onChangeText("sr-latn");
    });

    const textsAfterFilter = textValues(renderer!.root);
    expect(textsAfterFilter.some((t) => t.includes("Serbian (Latin)"))).toBe(true);
    expect(textsAfterFilter.some((t) => t.includes("Japanese"))).toBe(false);

    const srLatnOption = renderer!.root.find(
      (n) =>
        n.props.accessibilityRole === "button" &&
        n.props.accessibilityState?.selected === false &&
        n.findAll((c) => (c.type as unknown) === "Text" && c.props.children === "sr-Latn").length > 0,
    );
    await act(async () => {
      srLatnOption.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetLanguage: "sr-Latn" }),
      "rev-1",
    );
  });

  it("places the web language menu beside its control, sized to the side it opens on", () => {
    const chrome = 60;
    const viewport = { width: 1024, height: 768 };
    for (const top of [8, 100, 300, 420, 520, 600, 690, 724]) {
      const rect = { top, bottom: top + 36, right: 600, width: 200 };
      const place = placeLanguageMenu(rect, viewport);
      const height = place.listMaxHeight + chrome;
      const menuTop = place.top ?? viewport.height - place.bottom! - height;
      const menuBottom = place.top !== undefined ? place.top + height : viewport.height - place.bottom!;
      // Never over the control, and inside the window whenever that side holds a short list.
      expect(menuBottom <= rect.top || menuTop >= rect.bottom, `top ${top}`).toBe(true);
      const room = place.top !== undefined ? viewport.height - rect.bottom - 14 : rect.top - 14;
      if (room >= chrome + 96) expect(menuTop >= 8 && menuBottom <= viewport.height - 8, `top ${top}`).toBe(true);
    }
    // Opening upward anchors the menu's bottom to the control, so a filtered, shorter list stays attached.
    expect(placeLanguageMenu({ top: 600, bottom: 636, right: 600, width: 200 }, viewport)).toEqual({ bottom: 174, left: 320, width: 280, listMaxHeight: 340 });
    expect(placeLanguageMenu({ top: 212, bottom: 248, right: 600, width: 200 }, { width: 1024, height: 300 })).toMatchObject({ bottom: 94, listMaxHeight: 138 });
  });

  it("keeps the web language menu on its control while the page scrolls", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const listeners = new Map<string, (event: Event) => void>();
    vi.stubGlobal("window", {
      innerWidth: 1024, innerHeight: 768,
      addEventListener: (type: string, listener: (event: Event) => void) => { listeners.set(type, listener); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    });
    try {
      let rect = { top: 100, bottom: 136, right: 600, width: 200, left: 400, height: 36 };
      class BrowserNode extends EventTarget {}
      vi.stubGlobal("Node", BrowserNode);
      const menuChild = new BrowserNode();
      const measure = vi.fn(() => rect);
      mocks.settingsState = makeReadySettings({ enabled: true });
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }), {
          createNodeMock: () => ({ getBoundingClientRect: measure, contains: (node: unknown) => node === menuChild }),
        });
      });
      const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Target language");
      await act(async () => { trigger.props.onPress(); });
      const menuPlacement = () => renderer!.root.find((n) => String(n.type) === "View" && n.findAll((c) => (c.type as unknown) === "TextInput").length > 0 &&
        JSON.stringify(n.props.style).includes("fixed")).props.style.flat().find((part: { top?: number }) => part && "top" in part);
      const initialPlacement = menuPlacement();
      expect(initialPlacement).toMatchObject({ top: 142, bottom: "auto", right: "auto", margin: 0 });
      measure.mockClear();
      await act(async () => { listeners.get("scroll")!({ target: menuChild } as unknown as Event); });
      expect(measure).not.toHaveBeenCalled();
      await act(async () => { listeners.get("scroll")!(new Event("scroll")); });
      expect(menuPlacement()).toBe(initialPlacement);
      rect = { ...rect, top: 40, bottom: 76 };
      await act(async () => { listeners.get("scroll")!(new Event("scroll")); });
      expect(menuPlacement().top).toBe(82);
      // Near the window's bottom it opens upward. `top: auto` releases a popover's
      // UA `inset: 0`, which otherwise pins it to the top (checked in Chromium).
      rect = { ...rect, top: 600, bottom: 636 };
      await act(async () => { listeners.get("scroll")!(new Event("scroll")); });
      expect(menuPlacement()).toMatchObject({ top: "auto", right: "auto", bottom: 174 });
      await act(async () => renderer!.unmount());
      renderer = undefined;
      expect(listeners.has("scroll")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows provider logos in the shared menu and refreshes beside the model", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5", thinkingOptionId: "high" });
    const originalModels = await mocks.modelsRpc({ provider: "claude" });
    mocks.modelsRpc.mockClear();
    mocks.modelsRpc.mockImplementation(async ({ provider }: { provider: string }) => provider === "codex"
      ? { ...originalModels, models: [{ id: "gpt-first", label: "GPT First", thinkingOptions: [{ id: "high", label: "High" }, { id: "low", label: "Low" }], defaultThinkingOptionId: "high" }, { id: "gpt-second", label: "GPT Second", thinkingOptions: [], defaultThinkingOptionId: null }] }
      : originalModels);
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const provider = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    expect(provider.findAllByType(ProviderLogo).length).toBe(1);
    await act(async () => { provider.props.onPress(); });
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex");
    expect(option.findAllByType(ProviderLogo).length).toBe(1);
    await act(async () => { option.props.onPress(); });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "codex", model: "gpt-first", thinkingOptionId: "high" }), "rev-1");
    const refresh = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Refresh models");
    expect(refresh.findAll((n) => n.props.name === "RefreshCw").length).toBeGreaterThan(0);
    await act(async () => { refresh.props.onPress(); });
    expect(mocks.modelsRpc).toHaveBeenCalledWith({ provider: "claude" });
  });

  it.each([
    { current: "", expected: "low" },
    { current: "ultra", expected: "low" },
    { current: "high", expected: "high" },
  ])("picks a supported thinking level on provider change: $current → $expected", async ({ current, expected }) => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5", thinkingOptionId: current });
    mocks.modelsRpc.mockResolvedValue({
      providers: ["claude", "codex"], providerLabels: { claude: "Claude", codex: "Codex" },
      models: [{ id: "first", label: "First", thinkingOptions: [{ id: "high", label: "High" }, { id: "low", label: "Low" }], defaultThinkingOptionId: "high" }], error: null,
    });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const provider = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { provider.props.onPress(); });
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex");
    await act(async () => { option.props.onPress(); });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "codex", model: "first", thinkingOptionId: expected }), "rev-1");
  });

  it.each([
    { current: "high", expected: "high" },
    { current: "", expected: "minimal" },
    { current: "ultra", expected: "minimal" },
  ])("keeps or picks a supported level when the model changes: $current → $expected", async ({ current, expected }) => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-opus-4-1", thinkingOptionId: current });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Model");
    await act(async () => { trigger.props.onPress(); });
    const model = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Claude Sonnet 4.5");
    await act(async () => { model.props.onPress(); });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ model: "claude-sonnet-4-5", thinkingOptionId: expected }), "rev-1");
  });

  it("saves the new provider with no model when its catalog is empty", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5", thinkingOptionId: "high" });
    mocks.modelsRpc.mockResolvedValue({ providers: ["claude", "codex"], providerLabels: { codex: "Codex" }, models: [], error: null });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { trigger.props.onPress(); });
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex");
    await act(async () => { option.props.onPress(); });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "codex", model: "", thinkingOptionId: "" }), "rev-1");
  });

  it("keeps the current provider when its new model catalog fails to load", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5" });
    mocks.modelsRpc.mockImplementation(async ({ provider }: { provider: string }) => provider === "codex"
      ? { providers: ["claude", "codex", "cursor"], providerLabels: { codex: "Codex", cursor: "Cursor" }, models: [], error: "Catalog unavailable" }
      : { providers: ["claude", "codex"], providerLabels: { codex: "Codex" }, models: [], error: null });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { trigger.props.onPress(); });
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex");
    await act(async () => { option.props.onPress(); });
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    expect(textValues(renderer!.root)).toContain("Catalog unavailable");
    await act(async () => { trigger.props.onPress(); });
    expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio" &&
      n.props.accessibilityLabel?.startsWith("Cursor")).length).toBeGreaterThan(0);
  });

  it("shows why the provider list is empty on a Paseo without one-shot text generation", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "", model: "" });
    const error = "Translation needs a Paseo version that can generate text with no tools. This Paseo does not provide it, so nothing was sent.";
    mocks.modelsRpc.mockResolvedValue({ providers: [], providerLabels: {}, models: [], error, reason: "host_unsupported", uncheckedProviders: [] });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    // The host's reason, localized, instead of claiming no provider qualifies.
    expect(textValues(renderer!.root)).toContain("This Paseo cannot generate text with no tools, so translation is unavailable. Update Paseo. The saved choice is kept.");
    expect(textValues(renderer!.root)).not.toContain("No provider on this Paseo can translate with no tools, so there is nothing to choose and nothing is sent. The saved choice is kept.");
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { trigger.props.onPress(); });
    expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio")).toHaveLength(0);
    expect(mocks.saveSpy).not.toHaveBeenCalled();
  });

  it("says the provider check failed instead of claiming no provider qualifies", async () => {
    // Regression: a failed check read as "no provider on this Paseo can translate".
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "", model: "" });
    mocks.modelsRpc.mockResolvedValue({ providers: [], providerLabels: {}, models: [], error: "Paseo could not check opencode", reason: "check_failed", uncheckedProviders: ["opencode"] });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    expect(textValues(renderer!.root)).toContain("Paseo could not check OpenCode for translation with no tools, so the list may be incomplete. Refresh to try again.");
    expect(textValues(renderer!.root)).not.toContain("No provider on this Paseo can translate with no tools, so there is nothing to choose and nothing is sent. The saved choice is kept.");
  });

  it.each(["en", "zh"] as const)("describes the gateway route's limitations in words (%s)", (lang) => {
    expect(describeTranslationLimitation("prompt_sent_to_configured_gateway", lang)).toBe(lang === "zh"
      ? "文本会从 Paseo 宿主发送到该 Provider 配置的网关。"
      : "The text goes from your Paseo host to the gateway this provider is configured for.");
    expect(describeTranslationLimitation("credential_read_from_host_keychain", lang)).not.toBe("credential_read_from_host_keychain");
  });

  it("shows the host's limitations for the chosen provider before anything is sent", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "opencode", model: "mock/mock-model" });
    mocks.modelsRpc.mockResolvedValue({ providers: ["opencode"], providerLabels: { opencode: "OpenCode" },
      models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions: [], defaultThinkingOptionId: null }],
      error: null, reason: null, uncheckedProviders: [], limitations: ["provider_runtime_builtin_hooks_unobserved", "future_unknown_limitation"] });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    expect(textValues(renderer!.root)).toContain("Paseo could not confirm how the provider runtime's built-in model hooks handle this request.");
    // One Paseo does not know is still shown.
    expect(textValues(renderer!.root)).toContain("future_unknown_limitation");
  });

  it("keeps the providers that answered and names the ones that could not be checked", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "" });
    mocks.modelsRpc.mockResolvedValue({ providers: ["claude"], providerLabels: { claude: "Claude" }, models: [], error: null, reason: null, uncheckedProviders: ["opencode"] });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    expect(textValues(renderer!.root)).toContain("Paseo could not check OpenCode for translation with no tools, so the list may be incomplete. Refresh to try again.");
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { trigger.props.onPress(); });
    expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio").map((n) => n.props.accessibilityLabel)).toContain("Claude");
  });

  it.each(["en", "zh"] as const)("lists no provider and says why when this Paseo runs none with no tools, keeping the saved one (%s)", async (lang) => {
    updateEnhancerPreferences({ language: lang });
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "omp", model: "omp-model", thinkingOptionId: "high" });
    mocks.modelsRpc.mockResolvedValue({ providers: [], providerLabels: {}, models: [], error: null, reason: null, uncheckedProviders: [] });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook(false, lang) })); });
    const texts = () => textValues(renderer!.root);
    // The saved provider still names the control, but is not a choice.
    expect(texts()).toContain("Oh My Pi");
    for (const label of [lang === "zh" ? "Provider" : "Provider", lang === "zh" ? "模型" : "Model"]) {
      const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === label);
      await act(async () => { trigger.props.onPress(); });
      expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio")).toHaveLength(0);
    }
    expect(texts()).toContain(lang === "zh"
      ? "当前没有能以无工具方式翻译的 Provider，所以没有可选项，也不会发送任何内容。已保存的选择保持不变。"
      : "No provider on this Paseo can translate with no tools, so there is nothing to choose and nothing is sent. The saved choice is kept.");
    expect(mocks.saveSpy).not.toHaveBeenCalled();
  });

  it.each(["en", "zh"] as const)("offers only tool-free providers when the saved one is not among them (%s)", async (lang) => {
    updateEnhancerPreferences({ language: lang });
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "omp", model: "omp-model", thinkingOptionId: "high" });
    const good = await mocks.modelsRpc({ provider: "claude" });
    mocks.modelsRpc.mockReset().mockImplementation(async ({ provider }: { provider: string }) => provider === "omp"
      ? { providers: ["claude"], providerLabels: { claude: "Claude" }, models: [], error: 'Provider "omp" cannot run translation with no tools. Choose another provider.' }
      : { ...good, providers: ["claude"], providerLabels: { claude: "Claude" } });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook(false, lang) })); });
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { trigger.props.onPress(); });
    expect([...new Set(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio").map((n) => n.props.accessibilityLabel))]).toEqual(["Claude"]);
    expect(textValues(renderer!.root)).toContain(lang === "zh"
      ? "已保存的 Provider「Oh My Pi」在当前 Paseo 上不能以无工具方式翻译，保存值保持不变。请从列表中选择其他 Provider。"
      : "The saved provider Oh My Pi cannot translate with no tools on this Paseo. It stays saved; choose another provider from the list.");
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Claude");
    await act(async () => { option.props.onPress(); });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ provider: "claude", model: "claude-sonnet-4-5" }), "rev-1");
  });

  it("stops offering a provider's cached models once the host no longer lists that provider", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "omp", model: "omp-model", thinkingOptionId: "" });
    const ompModels = [{ id: "omp-model", label: "OMP Model", thinkingOptions: [], defaultThinkingOptionId: null }, { id: "omp-other", label: "OMP Other", thinkingOptions: [], defaultThinkingOptionId: null }];
    let supported = ["claude", "omp"];
    mocks.modelsRpc.mockReset().mockImplementation(async ({ provider }: { provider: string }) => supported.includes(provider) || !provider
      ? { providers: supported, providerLabels: { claude: "Claude" }, models: provider === "omp" ? ompModels : [], error: null }
      : { providers: supported, providerLabels: { claude: "Claude" }, models: [], error: `Provider "${provider}" cannot run translation with no tools. Choose another provider.` });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const radios = () => [...new Set(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio").map((n) => n.props.accessibilityLabel))];
    const open = async (label: string) => {
      const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === label);
      await act(async () => { trigger.props.onPress(); });
    };
    await open("Model");
    expect(radios()).toEqual(["OMP Model", "OMP Other"]);
    act(() => renderer!.unmount());

    // The host stops reporting omp; its models are still in the page's cache.
    supported = ["claude"];
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const refresh = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Refresh models");
    await act(async () => { refresh.props.onPress(); });
    await open("Model");
    expect(radios()).toEqual([]);
    // The saved model still names the control; nothing was cleared or saved.
    expect(textValues(renderer!.root)).toContain("omp-model");
    expect(mocks.saveSpy).not.toHaveBeenCalled();
  });

  it("still offers a saved provider and model the catalog lacks by default, as title generation expects", async () => {
    const noop = () => {};
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(ModelSettingsControls, {
        look: makeLook(), language: "en", provider: "omp", model: "omp-model", thinkingOptionId: "", disableThinking: false,
        disabledThinkingLabel: "", disabled: false, loading: false, providers: ["claude"], providerLabels: { claude: "Claude" }, models: [],
        onProvider: noop, onModel: noop, onThinking: noop, onRefresh: noop,
      }));
    });
    const radios = () => [...new Set(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio").map((n) => n.props.accessibilityLabel))];
    for (const [label, expected] of [["Provider", ["Claude", "Oh My Pi"]], ["Model", ["omp-model"]]] as const) {
      const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === label);
      await act(async () => { trigger.props.onPress(); });
      expect(radios()).toEqual(expected);
      await act(async () => { trigger.props.onPress(); });
    }
  });

  describe("a saved thinking level the model no longer offers", () => {
    const noop = () => {};
    const radios = () => renderer!.root.findAll((n) => n.props.accessibilityRole === "radio").map((n) => n.props.accessibilityLabel);
    const thinkingTrigger = () => renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Thinking level");
    function controls(props: { disableThinking: boolean; thinkingOptions: Array<{ id: string; label: string }>; staleThinking?: boolean; disabledThinkingLabel?: string; onThinking?: (value: string) => void }) {
      return React.createElement(ModelSettingsControls, {
        look: makeLook(), language: "en", provider: "opencode", model: "mock/mock-model", thinkingOptionId: "high",
        disableThinking: props.disableThinking, disabledThinkingLabel: props.disabledThinkingLabel ?? "Disabled", disabled: false, loading: false,
        providers: ["opencode"], providerLabels: {},
        models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions: props.thinkingOptions, defaultThinkingOptionId: null }],
        staleThinking: props.staleThinking, onProvider: noop, onModel: noop, onThinking: props.onThinking ?? noop, onRefresh: noop,
      });
    }

    it.each([false, true])("can only be cleared when the caller marks it stale (disableThinking=%s, no options)", async (disableThinking) => {
      // Regression: with no options, or with thinking disabled, the menu stayed closed and the
      // saved level translation refuses could not be removed.
      const onThinking = vi.fn();
      await act(async () => { renderer = TestRenderer.create(controls({ disableThinking, thinkingOptions: [], staleThinking: true, onThinking })); });
      expect(thinkingTrigger().props.disabled).toBe(false);
      expect(textValues(renderer!.root)).toContain("high");
      await act(async () => { thinkingTrigger().props.onPress(); });
      expect([...new Set(radios())]).toEqual(["Clear saved level"]);
      const clear = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Clear saved level");
      await act(async () => { clear.props.onPress(); });
      expect(onThinking).toHaveBeenCalledWith("");
    });

    it("keeps title generation's automatic level closed and labelled automatic", async () => {
      // Regression: the shared control reopened the whole menu in automatic mode, where the
      // title service picks the level itself and a chosen one would not apply.
      await act(async () => { renderer = TestRenderer.create(controls({ disableThinking: true, thinkingOptions: [{ id: "low", label: "Low" }], disabledThinkingLabel: "Automatic" })); });
      expect(thinkingTrigger().props.disabled).toBe(true);
      expect(textValues(renderer!.root)).toContain("Automatic");
      expect(textValues(renderer!.root)).not.toContain("high");
    });

    it.each([
      { name: "is offered by nothing and would be used", disableThinking: true, thinkingOptions: [], stale: true },
      { name: "would be used without an off option", disableThinking: true, thinkingOptions: [{ id: "low", label: "Low" }], stale: true },
      { name: "is never read because thinking is disabled with an off option", disableThinking: true, thinkingOptions: [{ id: "off", label: "Off" }], stale: false },
      { name: "would be used as the custom level", disableThinking: false, thinkingOptions: [{ id: "low", label: "Low" }], stale: true },
    ])("is offered for clearing in translation settings only when it $name", async ({ disableThinking, thinkingOptions, stale }) => {
      mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "opencode", model: "mock/mock-model", thinkingOptionId: "high", disableThinking });
      mocks.modelsRpc.mockReset().mockResolvedValue({ providers: ["opencode"], providerLabels: {}, models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions, defaultThinkingOptionId: null }],
        error: null, reason: null, uncheckedProviders: [], limitations: [] });
      await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
      expect(textValues(renderer!.root).includes("high")).toBe(stale);
      expect(thinkingTrigger().props.disabled).toBe(!stale && disableThinking);
    });
  });

  it("reads a provider's catalog again on the next visit after it failed", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5" });
    const good = await mocks.modelsRpc({ provider: "claude" });
    mocks.modelsRpc.mockReset().mockResolvedValueOnce({ ...good, models: [], error: "Catalog unavailable" }).mockResolvedValue(good);
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    expect(textValues(renderer!.root)).toContain("Catalog unavailable");
    act(() => renderer!.unmount());
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    expect(mocks.modelsRpc).toHaveBeenCalledTimes(2);
    expect(textValues(renderer!.root)).not.toContain("Catalog unavailable");
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Model");
    await act(async () => { trigger.props.onPress(); });
    expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Claude Opus 4.1").length).toBeGreaterThan(0);
  });

  it("checks the host again when the page reopens, so a provider the host dropped is no longer offered", async () => {
    // Regression: a reopened page reused the cached catalog and skipped the read.
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "opencode", model: "mock/mock-model" });
    const offered = { providers: ["opencode"], providerLabels: {}, models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions: [], defaultThinkingOptionId: null }],
      error: null, reason: null, uncheckedProviders: [], limitations: ["prompt_sent_to_configured_gateway"] };
    mocks.modelsRpc.mockReset().mockResolvedValueOnce(offered)
      .mockResolvedValue({ providers: [], providerLabels: {}, models: [], error: null, reason: null, uncheckedProviders: [], limitations: [] });
    const page = () => React.createElement(TimelineTranslationSettingsSection, { look: makeLook(), hostId: "host-a" });
    await act(async () => { renderer = TestRenderer.create(page()); });
    expect(textValues(renderer!.root)).toContain("The text goes from your Paseo host to the gateway this provider is configured for.");
    act(() => renderer!.unmount());
    await act(async () => { renderer = TestRenderer.create(page()); });
    expect(mocks.modelsRpc).toHaveBeenCalledTimes(2);
    expect(textValues(renderer!.root)).not.toContain("The text goes from your Paseo host to the gateway this provider is configured for.");
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Model");
    await act(async () => { trigger.props.onPress(); });
    expect(renderer!.root.findAll((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Mock")).toHaveLength(0);
  });

  it("never shows one host's cached providers on another host's page", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "opencode", model: "mock/mock-model" });
    mocks.modelsRpc.mockReset().mockResolvedValueOnce({ providers: ["opencode"], providerLabels: { opencode: "Host A Gateway" },
      models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions: [], defaultThinkingOptionId: null }], error: null, reason: null, uncheckedProviders: [], limitations: [] })
      .mockImplementation(() => new Promise(() => {}));
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook(), hostId: "host-a" })); });
    expect(textValues(renderer!.root)).toContain("Host A Gateway");
    act(() => renderer!.unmount());
    // Host B's read has not answered: its page shows nothing of host A's.
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook(), hostId: "host-b" })); });
    expect(textValues(renderer!.root)).not.toContain("Host A Gateway");
  });

  it("keeps the newest catalog when an earlier page's read answers after a later page's", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5" });
    const good = await mocks.modelsRpc({ provider: "claude" });
    const older = { ...good, models: [{ id: "old-model", label: "Old Model", thinkingOptions: [], defaultThinkingOptionId: null }] };
    let answerFirst!: (value: unknown) => void;
    mocks.modelsRpc.mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValue(good);
    const page = () => React.createElement(TimelineTranslationSettingsSection, { look: makeLook() });
    // The page opens and closes while its read hangs; the next page reads again and answers first.
    await act(async () => { renderer = TestRenderer.create(page()); });
    act(() => renderer!.unmount());
    await act(async () => { renderer = TestRenderer.create(page()); });
    act(() => renderer!.unmount());
    await act(async () => { answerFirst(older); });
    await act(async () => { renderer = TestRenderer.create(page()); });
    // Every page checks the host again when it opens.
    expect(mocks.modelsRpc).toHaveBeenCalledTimes(3);
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Model");
    await act(async () => { trigger.props.onPress(); });
    const radio = (label: string) => renderer!.root.findAll((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === label).length;
    expect(radio("Claude Opus 4.1")).toBeGreaterThan(0);
    expect(radio("Old Model")).toBe(0);
  });

  it.each([false, true])("ignores a provider selection overtaken by a catalog read (unmounted=%s)", async (unmount) => {
    const cached = makeReadySettings({ enabled: true, customModel: true, provider: "claude" });
    mocks.settingsState = cached;
    const good = await mocks.modelsRpc({ provider: "claude" });
    let finish!: (value: unknown) => void;
    mocks.modelsRpc.mockReset().mockResolvedValueOnce(good)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(good);
    const page = () => React.createElement(TimelineTranslationSettingsSection, { look: makeLook() });
    await act(async () => { renderer = TestRenderer.create(page()); });
    const provider = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { provider.props.onPress(); });
    await act(async () => { renderer!.root.findAll((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex")[0]!.props.onPress(); });
    if (unmount) {
      await act(async () => renderer!.unmount());
      renderer = undefined;
    } else {
      // The settings query can change the current provider independently of this page.
      mocks.settingsState = { ...makeReadySettings({ enabled: true, customModel: true, provider: "cursor" }), revision: "rev-2" };
      await act(async () => { renderer!.update(page()); });
      expect(mocks.modelsRpc).toHaveBeenLastCalledWith({ provider: "cursor" });
    }
    await act(async () => { finish(good); });
    expect(mocks.saveSpy).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "cursor" }, { customModel: false }, { enabled: false }, { targetLanguage: "ja" },
  ])("ignores a provider selection after settings change to %j without another catalog read", async (patch) => {
    const good = await mocks.modelsRpc({ provider: "claude" });
    let finish!: (value: unknown) => void;
    mocks.modelsRpc.mockReset().mockResolvedValueOnce(good).mockResolvedValueOnce(good)
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const original = { enabled: true, customModel: true, provider: "claude" };
    const page = () => React.createElement(TimelineTranslationSettingsSection, { look: makeLook() });
    mocks.settingsState = makeReadySettings({ ...original, provider: "cursor" });
    await act(async () => { renderer = TestRenderer.create(page()); });
    mocks.settingsState = makeReadySettings(original);
    await act(async () => { renderer!.update(page()); });
    const provider = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { provider.props.onPress(); });
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex");
    await act(async () => { option.props.onPress(); });
    mocks.settingsState = { ...makeReadySettings({ ...original, ...patch }), revision: "rev-2" };
    await act(async () => { renderer!.update(page()); });
    expect(mocks.modelsRpc.mock.calls).toEqual([[{ provider: "cursor" }], [{ provider: "claude" }], [{ provider: "codex" }]]);
    await act(async () => { finish(good); });
    expect(mocks.saveSpy).not.toHaveBeenCalled();
  });

  it("fetches the active provider's models after previously fetching only the provider list", async () => {
    const good = await mocks.modelsRpc({ provider: "claude" });
    mocks.modelsRpc.mockReset().mockResolvedValueOnce({ ...good, models: [] }).mockResolvedValueOnce(good);
    const page = () => React.createElement(TimelineTranslationSettingsSection, { look: makeLook() });
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "" });
    await act(async () => { renderer = TestRenderer.create(page()); });
    mocks.settingsState = { ...makeReadySettings({ enabled: true, customModel: true, provider: "claude" }), revision: "rev-2" };
    await act(async () => { renderer!.update(page()); });
    expect(mocks.modelsRpc.mock.calls).toEqual([[{ provider: "" }], [{ provider: "claude" }]]);
  });

  it("shows only the latest catalog read's error and loading state", async () => {
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: "claude-sonnet-4-5" });
    const good = await mocks.modelsRpc({ provider: "claude" });
    let failFirst!: (error: Error) => void;
    mocks.modelsRpc.mockReset()
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = reject; }))
      .mockResolvedValue(good);
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const refresh = () => renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Refresh models");
    expect(refresh().props.disabled).toBe(true);
    // The reader refreshes while the first read hangs; the refresh answers first.
    await act(async () => { refresh().props.onPress(); });
    expect(refresh().props.disabled).toBe(false);
    await act(async () => { failFirst(new Error("offline")); });
    expect(textValues(renderer!.root)).not.toContain("offline");
    expect(refresh().props.disabled).toBe(false);
  });

  it("loads the model catalog without an unsupported-thinking warning and edits/resets prompt", async () => {
    mocks.settingsState = makeReadySettings({
      enabled: true,
      customModel: true,
      provider: "claude",
      model: "claude-sonnet-4-5",
      disableThinking: true,
    });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }),
      );
    });
    await act(async () => {});

    expect(mocks.modelsRpc).toHaveBeenCalledWith({ provider: "claude" });
    const allTexts = textValues(renderer!.root).join("\n");
    expect(allTexts).not.toContain("does not expose an off, none, or disabled thinking option");
    expect(allTexts).toContain("Disable thinking when supported");
    const section = renderer!.root.findByType(Section);
    expect(section.findAllByType(SettingRow).map((row) => row.props.title)).toEqual([
      "Enable selection translation", "Target language", "Choose provider and model",
      "Provider", "Model", "Thinking level", "Disable thinking when supported",
      "Translation prompt", "Restore default translation settings",
    ]);
    expect(section.findByType(SectionFooter)).toBeDefined();

    // Open prompt modal, change prompt, save, then test 2-step reset.
    const editBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Edit prompt",
    );
    await act(async () => {
      editBtn.props.onPress();
    });

    const modalInput = renderer!.root.find(
      (n) => (n.type as unknown) === "TextInput" && n.props.multiline === true,
    );
    expect(modalInput.props.maxLength).toBe(8000);
    await act(async () => {
      modalInput.props.onChangeText("Keep identifiers exact. Translate cleanly.");
    });

    const saveBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Save",
    );
    await act(async () => {
      saveBtn.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: "Keep identifiers exact. Translate cleanly." }),
      "rev-1",
    );

    const resetBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Reset · Restore default translation settings",
    );
    await act(async () => {
      resetBtn.props.onPress();
    });
    // First click asks for confirmation without saving yet.
    const confirmBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Confirm · Restore default translation settings",
    );
    await act(async () => {
      confirmBtn.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: DEFAULT_TRANSLATION_PROMPT, enabled: false, targetLanguage: "interface" }),
      "rev-1",
    );
  });

  it("shows an untouched earlier default prompt as the default and saves the current text", async () => {
    const legacyDefault =
      "Translate the supplied text into the target language. Preserve Markdown, code blocks, inline code, commands, paths, links, and technical identifiers. Return only the translation, without explanations.";
    const button = (label: string) => renderer!.root.find(
      (node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === label,
    );
    const promptInput = () => renderer!.root.find(
      (node) => typeof node.type === "string" && node.props.multiline === true,
    );
    const render = async (prompt: string) => {
      mocks.settingsState = makeReadySettings({ enabled: true, prompt });
      await act(async () => { renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={makeLook()} />); });
    };

    await render("Keep it terse.");
    expect(textValues(renderer!.root)).not.toContain("Keep it terse.");
    await act(async () => button("Edit prompt").props.onPress());
    expect(promptInput().props.value).toBe("Keep it terse.");
    expect(button("Save").props.disabled).toBe(true);
    await act(async () => button("Reset prompt").props.onPress());
    expect(promptInput().props.value).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    await act(async () => button("Save").props.onPress());
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: DEFAULT_TRANSLATION_PROMPT }), "rev-1");
    act(() => renderer!.unmount());

    // The host parses saved settings before exposing them to the page.
    await render(legacyDefault);
    await act(async () => button("Edit prompt").props.onPress());
    expect(promptInput().props.value).toBe(DEFAULT_TRANSLATION_PROMPT);
    expect(button("Save").props.disabled).toBe(true);
    await act(async () => button("Cancel").props.onPress());

    const masterSwitch = renderer!.root.find(
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable selection translation",
    );
    await act(async () => {
      masterSwitch.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false, prompt: DEFAULT_TRANSLATION_PROMPT }),
      "rev-1",
    );
  });

  it("keeps the editor limit aligned with the translation schema", () => {
    const longestPrompt = "a".repeat(TRANSLATION_PROMPT_MAX_LENGTH);
    expect(timelineTranslationSettingsSchema.parse({ prompt: ` ${longestPrompt} ` }).prompt).toBe(longestPrompt);
    expect(timelineTranslationSettingsSchema.parse({ prompt: `${longestPrompt}a` }).prompt).toBe(DEFAULT_TRANSLATION_PROMPT);
  });

  it("keeps the footer in place while saving and shows errors in context", async () => {
    const ready = makeReadySettings({ enabled: true, customModel: true, provider: "claude" });
    mocks.settingsState = ready;
    mocks.modelsRpc.mockResolvedValue({ providers: ["claude"], models: [], error: "Model catalog offline" });
    const look = makeLook();
    const page = <TimelineTranslationSettingsSection look={look} />;
    await act(async () => { renderer = TestRenderer.create(page); });
    const root = () => renderer!.root.findByType(Section).find((node) => (node.type as unknown) === "View" && "aria-busy" in node.props);
    const footerTop = () => {
      const footer = renderer!.root.findByType(SectionFooter).findAll((node) => (node.type as unknown) === "View")[0]!;
      return measureHostTree(root(), { width: 320, wrapText: true }).get(footer)!.top;
    };
    const updateState = async (next: unknown) => {
      mocks.settingsState = next;
      await act(async () => renderer!.update(React.cloneElement(page)));
    };
    const alerts = () => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert");
    const topBeforeSave = footerTop();
    await updateState({ ...ready, saving: true });
    expect(root().props["aria-busy"]).toBe(true);
    expect(footerTop()).toBe(topBeforeSave);
    const enabled = renderer!.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Enable selection translation");
    expect(enabled.props.disabled).toBe(true);
    await updateState({ ...ready, saveError: "Write rejected" });
    expect(root().props["aria-busy"]).toBe(false);
    expect(alerts().map((node) => node.children.join(""))).toEqual(["Model catalog offline", "Write rejected"]);
    for (const alert of alerts()) expect(alert.props.style).toContainEqual(expect.objectContaining({ color: look.tokens.danger }));
    const texts = textValues(renderer!.root);
    expect(texts.indexOf("Model catalog offline")).toBeGreaterThan(texts.indexOf("Thinking level"));
    expect(texts.indexOf("Model catalog offline")).toBeLessThan(texts.lastIndexOf("Disable thinking when supported"));
    expect(texts.indexOf("Write rejected")).toBeGreaterThan(texts.indexOf("Restore default translation settings"));
    expect(texts.indexOf("Write rejected")).toBeLessThan(texts.indexOf("Manual only"));
    await updateState({ ...ready, status: "error", error: "Host offline" });
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.children.join("")).toContain("Host offline");
    const failedTexts = textValues(renderer!.root);
    expect(failedTexts.findIndex((text) => text.includes("Host offline"))).toBeLessThan(failedTexts.indexOf("Enable selection translation"));
  });

  it.each([[false, 280, 32], [false, 320, 32], [false, 440, 32], [true, 320, 44]])("fits the dropdowns at a large text size (compact %s, width %i)", async (compact, width, refreshSize) => {
    const model = { id: "model", label: "A model with a very long display name", thinkingOptions: [], defaultThinkingOptionId: null };
    mocks.modelsRpc.mockResolvedValue({ providers: ["claude"], models: [model], error: null });
    mocks.settingsState = makeReadySettings({ enabled: true, customModel: true, provider: "claude", model: model.id });
    await act(async () => {
      renderer = TestRenderer.create(<TimelineTranslationSettingsSection look={makeLook(compact)} />);
    });
    const root = renderer!.root.findByType(Section).findAll((node) => node.type === ("View" as React.ElementType))[0]!;
    const frames = measureHostTree(root, { width, wrapText: true, textScale: 1.4 });
    const buttonFrame = (label: string) => frames.get(root.find((node) =>
      typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === label,
    ))!;
    for (const label of ["Target language", "Provider", "Model", "Thinking level"]) {
      const frame = buttonFrame(label);
      if (label === "Target language") expect(frame.width).toBeGreaterThanOrEqual(168);
      if (label === "Provider") expect(frame.width).toBeLessThan(168);
      expect(frame.left + frame.width, label).toBeLessThanOrEqual(width - 16);
    }
    const target = root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Target language");
    const chevron = target.findByType("Icon" as never);
    expect(frames.get(chevron)?.width).toBe(14);
    expect(buttonFrame("Refresh models")).toMatchObject({ width: refreshSize, height: refreshSize });
  });

  it("renders natively in Chinese and uses Modal for language picker on iOS", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    updateEnhancerPreferences({ language: "zh" });
    mocks.settingsState = makeReadySettings({ enabled: true });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook(true, "zh") }),
      );
    });

    const texts = textValues(renderer!.root).join("\n");
    expect(renderer!.root.findByType(Section).props.title).toBe("翻译");
    expect(texts).toContain("跟随界面语言");

    const trigger = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "目标语言",
    );
    await act(async () => {
      trigger.props.onPress();
    });
    expect(renderer!.root.findAll((n) => (n.type as unknown) === "Modal")).toHaveLength(1);
  });

  it("syncs through useSettings without optimistic overwrite on conflict and surfaces invalid/error states", async () => {
    const reload = vi.fn(async () => {});
    mocks.settingsState = makeReadySettings({ enabled: true, targetLanguage: "interface" }, { saveResult: false, reload });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }),
      );
    });

    expect(getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "rev-1", values: { enabled: true } });

    const masterSwitch = renderer!.root.find(
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable selection translation",
    );
    await act(async () => {
      masterSwitch.props.onPress();
    });
    // Failed save must not leave store diverged from daemon; triggers reload instead.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getTranslationSettingsState().values.enabled).toBe(true);

    // External host change updates revision cleanly.
    const rev2 = timelineTranslationSettingsSchema.parse({ enabled: true, targetLanguage: "ja" });
    await act(async () => {
      mocks.settingsState = { ...makeReadySettings(rev2), revision: "rev-2" };
      renderer!.update(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }));
    });
    expect(getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "rev-2", values: { targetLanguage: "ja" } });

    // Stale/duplicate error & invalid states surface explicitly without swallowing.
    await act(async () => {
      reportTranslationSettings({ status: "invalid", error: "Corrupt JSON schema", revision: "rev-3" });
      mocks.settingsState = {
        status: "invalid",
        error: "Corrupt JSON schema",
        revision: "rev-3",
        saving: false,
        saveError: null,
        save: vi.fn(async () => false),
        reset: vi.fn(async () => true),
        reload: vi.fn(async () => {}),
      };
      renderer!.update(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() }));
    });
    expect(getTranslationSettingsState()).toMatchObject({ status: "invalid", error: "Corrupt JSON schema" });
    expect(textValues(renderer!.root).join("\n")).toContain("Corrupt JSON schema");
  });
});
