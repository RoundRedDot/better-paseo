import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { measureHostTree } from "./helpers/yoga-host-layout";
import {
  DEFAULT_TRANSLATION_PROMPT,
  TRANSLATION_PROMPT_MAX_LENGTH,
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";
import { ProviderLogo } from "../../client/components/provider-logo";
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
      ? { providers: ["claude", "codex"], providerLabels: { codex: "Codex" }, models: [], error: "Catalog unavailable" }
      : { providers: ["claude", "codex"], providerLabels: { codex: "Codex" }, models: [], error: null });
    await act(async () => { renderer = TestRenderer.create(React.createElement(TimelineTranslationSettingsSection, { look: makeLook() })); });
    const trigger = renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Provider");
    await act(async () => { trigger.props.onPress(); });
    const option = renderer!.root.find((n) => n.props.accessibilityRole === "radio" && n.props.accessibilityLabel === "Codex");
    await act(async () => { option.props.onPress(); });
    expect(mocks.saveSpy).not.toHaveBeenCalled();
    expect(textValues(renderer!.root)).toContain("Catalog unavailable");
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
