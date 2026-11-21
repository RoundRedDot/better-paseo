import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  DEFAULT_TRANSLATION_PROMPT,
  resolveThinkingCapability,
  TIMELINE_TRANSLATION_SETTINGS,
  TRANSLATION_PROMPT_MAX_LENGTH,
  translationModelsRpc,
  type TimelineTranslationSettings,
  type ThinkingOptionInfo,
} from "../../shared/timeline-translation";
import { ModelSettingsControls } from "../model-settings-controls";
import { providerBrand } from "../components/provider-logo";
import { modelSelection } from "../../shared/model-catalog";
import { radiusV2, space } from "../components/theme-tokens";
import { resolveLanguage } from "../i18n/settings-strings";
import { useEnhancerPreferences } from "../preferences";
import {
  PlainButton,
  Section,
  ResetRow,
  RowNotice,
  SectionFooter,
  SettingRow,
  SettingsTips,
  Toggle,
  type PageLook,
} from "../settings-controls";
import { PromptEditorModal } from "../settings-prompt-editor";
import { SearchableLanguageSelect } from "./language-picker";
import { DEFAULT_TIMELINE_TRANSLATION_SETTINGS, useTranslationSettingsReport } from "./settings-store";

export interface TranslationModelEntry {
  id: string;
  label: string;
  thinkingOptions: ThinkingOptionInfo[];
  defaultThinkingOptionId: string | null;
}

export interface TranslationCatalogState {
  providers: string[];
  providerLabels: Record<string, string>;
  modelsByProvider: Record<string, TranslationModelEntry[]>;
  /** A catalog read has answered: an empty provider list is the host's answer, not a pending one. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

let catalogCache: {
  providers: string[];
  providerLabels: Record<string, string>;
  modelsByProvider: Record<string, TranslationModelEntry[]>;
  loaded: boolean;
} = {
  providers: [],
  providerLabels: {},
  modelsByProvider: {},
  loaded: false,
};

/** The latest catalog read of any settings page: only it writes the cache and the shown state. */
let latestCatalogRead = 0;

export function resetTranslationSettingsCatalogForTests(): void {
  latestCatalogRead = 0;
  catalogCache = {
    providers: [],
    providerLabels: {},
    modelsByProvider: {},
    loaded: false,
  };
}

export interface ThinkingStatusDescription {
  tone: "neutral" | "accent" | "warning";
  text: string;
}

export function describeThinkingStatus(
  settings: TimelineTranslationSettings,
  selectedModel: TranslationModelEntry | undefined,
  loading: boolean,
  lang: "en" | "zh",
): ThinkingStatusDescription {
  if (!settings.customModel) {
    if (!settings.disableThinking) {
      return {
        tone: "neutral",
        text: lang === "zh"
          ? "遵循当前对话模型默认的思考设置。"
          : "Uses the active conversation model's normal thinking setting.",
      };
    }
    return {
      tone: "neutral",
      text: lang === "zh"
        ? "仅当当前对话模型提供明确的 off / none / disabled 思考挡位时才会关闭思考；不支持完全关闭的模型会保持默认思考，不会静默降档或虚报已关闭。"
        : "Turns off thinking only if the active conversation model provides an explicit off, none, or disabled option. Models without one keep their normal reasoning instead of silently downgrading.",
    };
  }

  if (!settings.provider || !settings.model) {
    return {
      tone: "neutral",
      text: lang === "zh"
        ? "选择 Provider 与模型后，将显示该模型是否支持真正关闭思考。"
        : "Choose a provider and model to inspect whether thinking can be turned off.",
    };
  }

  if (loading && !selectedModel) {
    return {
      tone: "neutral",
      text: lang === "zh" ? "正在读取模型思考能力..." : "Loading model thinking options...",
    };
  }

  const modelName = selectedModel?.label || settings.model;
  const capability = resolveThinkingCapability(selectedModel?.thinkingOptions);

  if (settings.disableThinking) {
    if (capability.status === "supported") {
      return {
        tone: "accent",
        text: lang === "zh"
          ? `将使用 "${capability.offOption.label}" (${capability.offOption.id}) 关闭思考。`
          : `Thinking will be disabled via "${capability.offOption.label}" (${capability.offOption.id}).`,
      };
    }
    if (capability.status === "unsupported_off") {
      const available = capability.options.map((opt) => opt.id).join(", ");
      return {
        tone: "warning",
        text: lang === "zh"
          ? `${modelName} 未提供 off / none / disabled 思考挡位（仅提供：${available}）。翻译时不会静默降档为 low/minimal，也不会宣称已关闭思考。`
          : `${modelName} does not expose an off, none, or disabled thinking option (available: ${available}). Translation will NOT silently downgrade thinking or claim thinking is disabled.`,
      };
    }
    return {
      tone: "neutral",
      text: lang === "zh"
        ? `${modelName} 未提供可选的思考开关挡位，无法显式关闭或确认其是否关闭思考。`
        : `${modelName} exposes no selectable thinking switch, so thinking cannot be explicitly toggled off or guaranteed off.`,
    };
  }

  if (capability.status === "none") {
    return {
      tone: "neutral",
      text: lang === "zh"
        ? `${modelName} 未暴露思考挡位配置。`
        : `${modelName} exposes no configurable thinking options.`,
    };
  }

  return {
    tone: "neutral",
    text: lang === "zh"
      ? `${modelName} 将按所选或默认思考挡位运行。`
      : `${modelName} will run with the selected or default thinking option.`,
  };
}

const STRINGS = {
  en: {
    sectionTitle: "Translation",
    enableTitle: "Enable selection translation",
    enableDescription: "Adds Translate to the menu for text you select in a reply or thought: the floating selection bar on desktop and web, the double-tap block menu on iOS and Android. The original text stays as it is.",
    targetTitle: "Target language",
    targetDescription: "Follows the interface language by default. Search by language name or code.",
    targetPlaceholder: "Search language or code...",
    targetEmpty: "No matching language",
    customModelTitle: "Choose provider and model",
    customModelDescription: "Off uses the current conversation's provider and model. Either way, translation runs only on a provider that Paseo can run with no tools; the list shows only those.",
    noToolFreeProviders: "No provider on this Paseo can run translation with no tools, so there is nothing to choose. The saved choice is kept.",
    savedProviderNotToolFree: (name: string) => `The saved provider ${name} cannot run translation with no tools. It stays saved; choose another provider from the list.`,
    disableThinkingTitle: "Disable thinking when supported",
    disableThinkingDescription: "Applies only when the model exposes a genuine off, none, or disabled option.",
    promptTitle: "Translation prompt",
    promptDescription: "Instructions the model follows when translating. Open the editor to view or change them.",
    editPrompt: "Edit prompt",
    resetPrompt: "Reset prompt",
    promptModalTitle: "Translation prompt",
    promptPlaceholder: "Enter translation instructions...",
    save: "Save",
    cancel: "Cancel",
    resetSection: "Restore default translation settings",
    resetHint: "Restores translation settings only.",
    resetConfirmHint: "Confirm to restore this section’s defaults.",
    unavailable: "Translation settings are currently unavailable from this host.",
    tips: [
      {
        label: "Manual only",
        text: "Nothing is translated until you select text and press Translate.",
      },
      {
        label: "Privacy",
        text: "Translate sends the selected text or reply, the target language, and the translation prompt to the translation provider through a helper agent that Paseo runs with no tools. When Paseo or the provider cannot confirm that, nothing is sent and an error is shown.",
      },
      {
        label: "Session cache",
        text: "Translations stay in memory for this client session; selecting the same text again reuses one until the settings or the conversation model change.",
      },
    ],
  },
  zh: {
    sectionTitle: "翻译",
    enableTitle: "启用选中文本翻译",
    enableDescription: "在回复或思考过程中选中文本后，菜单里提供「翻译」：桌面端和网页端在浮动选择栏里，iOS 和 Android 在双击选中段落后的菜单里。原文保持不变。",
    targetTitle: "目标语言",
    targetDescription: "默认跟随当前界面语言，可在下拉菜单中按语言名或代码搜索。",
    targetPlaceholder: "搜索语言名称或代码...",
    targetEmpty: "没有匹配的语言",
    customModelTitle: "指定 Provider 与模型",
    customModelDescription: "关闭时复用当前会话正在使用的 Provider 与模型。两种方式都只在 Paseo 能以无工具方式运行的 Provider 上翻译，列表只显示这些 Provider。",
    noToolFreeProviders: "当前没有能以无工具方式运行翻译的 Provider，所以没有可选项。已保存的选择保持不变。",
    savedProviderNotToolFree: (name: string) => `已保存的 Provider「${name}」不能以无工具方式运行翻译，保存值保持不变。请从列表中选择其他 Provider。`,
    disableThinkingTitle: "支持时关闭思考",
    disableThinkingDescription: "仅在模型明确支持 off / none / disabled 选项时生效，不静默降档。",
    promptTitle: "翻译 Prompt",
    promptDescription: "模型翻译时遵循的指令，打开编辑器即可查看或修改。",
    editPrompt: "编辑 Prompt",
    resetPrompt: "重置 Prompt",
    promptModalTitle: "编辑翻译 Prompt",
    promptPlaceholder: "输入翻译提示词...",
    save: "保存",
    cancel: "取消",
    resetSection: "恢复默认翻译设置",
    resetHint: "只恢复本组设置，不影响其他组。",
    resetConfirmHint: "再点一次「确认」恢复本组默认值。",
    unavailable: "当前无法从 Paseo 主机读取翻译设置。",
    tips: [
      {
        label: "仅手动触发",
        text: "只有选中文本并点击「翻译」时才会翻译，不会自动翻译时间线。",
      },
      {
        label: "隐私保护",
        text: "点击「翻译」时，把选中的文本或整条回复、目标语言与翻译 Prompt 发给翻译所用的 Provider，由 Paseo 以不带任何工具的辅助 agent 运行。Paseo 或 Provider 无法确认这一点时，不发送任何内容并显示错误。",
      },
      {
        label: "会话缓存",
        text: "译文仅缓存在当前客户端会话内存中；再次选中相同文本时直接复用，翻译设置或对话模型变更后失效。",
      },
    ],
  },
} as const;

export function TimelineTranslationSettings({ look }: { look: PageLook }) {
  const { tokens } = look;
  const preferences = useEnhancerPreferences();
  const lang = resolveLanguage(preferences.language);
  const t = STRINGS[lang];
  const state = useSettings(TIMELINE_TRANSLATION_SETTINGS);
  const fetchModels = useRpc(translationModelsRpc);

  const settings = useMemo<TimelineTranslationSettings>(() => {
    if (state.status === "ready") return state.values;
    return DEFAULT_TIMELINE_TRANSLATION_SETTINGS;
  }, [state]);

  useTranslationSettingsReport(state);

  const [catalog, setCatalog] = useState<TranslationCatalogState>(() => ({
    ...catalogCache,
    loading: false,
    error: null,
  }));
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const committedSettings = useRef<typeof state | null>(null);
  useLayoutEffect(() => {
    committedSettings.current = state;
    return () => { committedSettings.current = null; };
  }, [state]);

  // Only the latest read, also across page mounts, writes the cache and shows
  // its loading state and error: an earlier one may answer last.
  const loadModels = useCallback(async (provider: string) => {
    const read = ++latestCatalogRead;
    setCatalog((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetchModels({ provider });
      if (!committedSettings.current || read !== latestCatalogRead) return null;
      const nextModelsByProvider = { ...catalogCache.modelsByProvider };
      // The provider snapshot succeeds independently of the model lookup.
      // A model error must not be cached as an empty catalog.
      if (provider && !res.error) nextModelsByProvider[provider] = res.models;
      catalogCache = {
        providers: res.providers,
        providerLabels: { ...catalogCache.providerLabels, ...res.providerLabels },
        modelsByProvider: nextModelsByProvider,
        loaded: true,
      };
      setCatalog({ ...catalogCache, loading: false, error: res.error });
      return res.error ? null : { read, models: res.models };
    } catch (error) {
      if (committedSettings.current && read === latestCatalogRead) {
        setCatalog((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return null;
    }
  }, [fetchModels]);

  useEffect(() => {
    if (state.status !== "ready" || !settings.customModel) return;
    const activeProvider = settings.provider;
    if (catalogCache.providers.length === 0 || (activeProvider && !catalogCache.modelsByProvider[activeProvider])) {
      void loadModels(activeProvider);
    }
  }, [state.status, settings.customModel, settings.provider, loadModels]);

  const savePatch = useCallback(async (patch: Partial<TimelineTranslationSettings>) => {
    if (state.status !== "ready") return;
    const next = { ...state.values, ...patch };
    const ok = await state.save(next, state.revision);
    if (!ok) {
      void state.reload?.();
    }
  }, [state]);

  const selectProvider = async (provider: string) => {
    if (state.status !== "ready" || provider === settings.provider || switchingProvider) return;
    setSwitchingProvider(true);
    try {
      const catalogRead = await loadModels(provider);
      if (!catalogRead || catalogRead.read !== latestCatalogRead) return;
      const current = committedSettings.current;
      if (current?.status !== "ready" || current.saving || current.revision !== state.revision) return;
      const firstModel = catalogRead.models[0];
      await savePatch({ provider, ...modelSelection(firstModel, settings.thinkingOptionId) });
    } finally {
      if (committedSettings.current) setSwitchingProvider(false);
    }
  };

  // The list holds only providers this host runs with no tools; a saved one outside it stays saved.
  const answered = catalog.loaded && !catalog.loading;
  const catalogNotice = answered && catalog.providers.length === 0 ? t.noToolFreeProviders
    : answered && settings.provider && !catalog.providers.includes(settings.provider)
      ? t.savedProviderNotToolFree(catalog.providerLabels[settings.provider] || providerBrand(settings.provider).displayName)
      : catalog.error;
  const activeProvider = settings.provider || catalog.providers[0] || "";
  // A provider the host no longer lists offers none of its cached models; the saved model only names the control.
  const models = catalog.providers.includes(activeProvider) ? catalog.modelsByProvider[activeProvider] ?? [] : [];
  const selectedModel = models.find((m) => m.id === settings.model);
  const thinkingStatus = describeThinkingStatus(settings, selectedModel, catalog.loading, lang);

  const writeDisabled = state.status !== "ready" || state.saving;
  const controlsDisabled = writeDisabled || !settings.enabled;

  return <>
    <Section title={t.sectionTitle} look={look} busy={state.saving}>
      {state.status === "error" || state.status === "invalid" ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <RowNotice look={look} tone="danger" alert text={state.error ? `${t.unavailable} (${state.error})` : t.unavailable} />
        </View>
      ) : null}

      <SettingRow
        first
        title={t.enableTitle}
        description={t.enableDescription}
        control={
          <Toggle
            value={settings.enabled}
            onChange={(enabled) => void savePatch({ enabled })}
            label={t.enableTitle}
            look={look}
            disabled={writeDisabled}
          />
        }
        look={look}
      />

      <SettingRow
        wrapControl
        title={t.targetTitle}
        description={t.targetDescription}
        control={
          <SearchableLanguageSelect
            value={settings.targetLanguage}
            onChange={(targetLanguage) => void savePatch({ targetLanguage })}
            language={lang}
            look={look}
            disabled={controlsDisabled}
            label={t.targetTitle}
            searchPlaceholder={t.targetPlaceholder}
            emptyLabel={t.targetEmpty}
          />
        }
        look={look}
        disabled={controlsDisabled}
      />

      <SettingRow
        title={t.customModelTitle}
        description={t.customModelDescription}
        control={
          <Toggle
            value={settings.customModel}
            onChange={(customModel) => void savePatch({ customModel })}
            label={t.customModelTitle}
            look={look}
            disabled={controlsDisabled}
          />
        }
        look={look}
        disabled={controlsDisabled}
      />

      {settings.customModel ? <>
        <ModelSettingsControls look={look} language={lang} provider={settings.provider} model={settings.model} thinkingOptionId={settings.thinkingOptionId}
          disableThinking={settings.disableThinking} disabledThinkingLabel={t.disableThinkingTitle} disabled={controlsDisabled || switchingProvider} loading={catalog.loading}
          providers={catalog.providers} providerLabels={catalog.providerLabels} models={models} offerSavedChoices={false}
          onProvider={(provider) => void selectProvider(provider)}
          onModel={(model) => void savePatch(modelSelection(models.find((entry) => entry.id === model), settings.thinkingOptionId))}
          onThinking={(thinkingOptionId) => void savePatch({ thinkingOptionId })} onRefresh={() => void loadModels(settings.provider)} />
        {catalogNotice ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}><RowNotice look={look} text={catalogNotice} tone="danger" alert /></View> : null}
      </> : null}

      <SettingRow
        title={t.disableThinkingTitle}
        description={t.disableThinkingDescription}
        control={
          <Toggle
            value={settings.disableThinking}
            onChange={(disableThinking) => void savePatch({ disableThinking })}
            label={t.disableThinkingTitle}
            look={look}
            disabled={controlsDisabled}
          />
        }
        look={look}
        disabled={controlsDisabled}
        below={thinkingStatus.tone !== "warning" ? (
          <View style={{ backgroundColor: tokens.v2.surface2, borderRadius: radiusV2.block, paddingVertical: space.sm, paddingHorizontal: space.md }}>
            <RowNotice look={look} text={thinkingStatus.text} tone={thinkingStatus.tone} />
          </View>
        ) : null}
      />

      <SettingRow
        title={t.promptTitle}
        description={t.promptDescription}
        control={<PlainButton label={t.editPrompt} look={look} onPress={() => setPromptOpen(true)} disabled={controlsDisabled} />}
        look={look}
        wrapControl
        disabled={controlsDisabled}
      />

      <ResetRow look={look} title={t.resetSection} description={t.resetHint} confirmDescription={t.resetConfirmHint}
        disabled={writeDisabled} onReset={() => savePatch(DEFAULT_TIMELINE_TRANSLATION_SETTINGS)}
      />
      {state.saveError ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <RowNotice look={look} text={state.saveError} tone="danger" alert />
      </View> : null}

      <SectionFooter look={look}><SettingsTips items={t.tips} look={look} /></SectionFooter>
    </Section>

    {promptOpen ? <PromptEditorModal look={look} title={t.promptModalTitle} label={t.promptTitle}
      value={settings.prompt} defaultValue={DEFAULT_TRANSLATION_PROMPT} maxLength={TRANSLATION_PROMPT_MAX_LENGTH}
      reset={t.resetPrompt} cancel={t.cancel} save={t.save} placeholder={t.promptPlaceholder} trim
      onClose={() => setPromptOpen(false)} onSave={(prompt) => void savePatch({ prompt })}
    /> : null}
  </>;
}
