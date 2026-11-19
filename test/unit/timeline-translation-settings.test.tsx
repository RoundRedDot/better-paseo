import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import {
  DEFAULT_TRANSLATION_PROMPT,
  timelineTranslationSettingsSchema,
  type TimelineTranslationSettings,
} from "../../shared/timeline-translation";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { DEFAULT_PREFERENCES, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
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
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable inline translation",
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

  it("loads custom provider/model catalog, warns honestly when off is missing, and edits/resets prompt", async () => {
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
    expect(allTexts).toContain("does not expose an off, none, or disabled thinking option");

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
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Reset translation settings",
    );
    await act(async () => {
      resetBtn.props.onPress();
    });
    // First click asks for confirmation without saving yet.
    const confirmBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Press again to reset",
    );
    await act(async () => {
      confirmBtn.props.onPress();
    });
    expect(mocks.saveSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: DEFAULT_TRANSLATION_PROMPT, enabled: true, targetLanguage: "interface" }),
      "rev-1",
    );
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
    expect(texts).toContain("时间线翻译");
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
      (n) => n.props.accessibilityRole === "switch" && n.props.accessibilityLabel === "Enable inline translation",
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
