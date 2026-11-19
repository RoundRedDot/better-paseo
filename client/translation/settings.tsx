import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Modal } from "@getpaseo/plugin/client/ui";
import {
  DEFAULT_TRANSLATION_PROMPT,
  resolveThinkingCapability,
  TIMELINE_TRANSLATION_SETTINGS,
  translationModelsRpc,
  type TimelineTranslationSettings,
  type ThinkingOptionInfo,
} from "../../shared/timeline-translation";
import { radiusV2 } from "../components/theme-tokens";
import { resolveLanguage } from "../i18n/settings-strings";
import { useEnhancerPreferences } from "../preferences";
import { ChoiceMenuSelect, type MenuChoice } from "../settings-choice-menu";
import {
  PlainButton,
  Section,
  SectionNote,
  SettingRow,
  SettingsTips,
  Toggle,
  settingsTextStyle,
  type PageLook,
} from "../settings-controls";
import { SearchableLanguageSelect } from "./language-picker";
import {
  DEFAULT_TIMELINE_TRANSLATION_SETTINGS,
  reportTranslationSettings,
  type RemoteTranslationSettings,
} from "./settings-store";

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
  loading: boolean;
  error: string | null;
}

let catalogCache: {
  providers: string[];
  providerLabels: Record<string, string>;
  modelsByProvider: Record<string, TranslationModelEntry[]>;
} = {
  providers: [],
  providerLabels: {},
  modelsByProvider: {},
};

export function resetTranslationSettingsCatalogForTests(): void {
  catalogCache = {
    providers: [],
    providerLabels: {},
    modelsByProvider: {},
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
        ? `${modelName} 未暴露可选的思考挡位，将按模型默认方式执行。`
        : `${modelName} does not expose selectable thinking options; it runs with model defaults.`,
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
    sectionTitle: "Timeline Translation",
    enableTitle: "Enable inline translation",
    enableDescription: "Show a manual translate button on assistant replies and reasoning cards. Original text stays visible.",
    targetTitle: "Target language",
    targetDescription: "Follows the interface language by default. Search by language name or code.",
    targetPlaceholder: "Search language or code...",
    targetEmpty: "No matching language",
    customModelTitle: "Choose provider and model",
    customModelDescription: "Off uses the current conversation's provider and model.",
    providerTitle: "Provider",
    providerPlaceholder: "Select provider",
    refreshTitle: "Refresh",
    modelTitle: "Model",
    modelPlaceholder: "Select model",
    disableThinkingTitle: "Disable thinking when supported",
    disableThinkingDescription: "Applies only when the model exposes a genuine off, none, or disabled option.",
    thinkingOptionTitle: "Thinking level",
    thinkingDefaultOption: "Model default",
    promptTitle: "Translation prompt",
    promptDescription: "Sent only with the selected message or reasoning block.",
    editPrompt: "Edit prompt",
    resetPrompt: "Reset prompt",
    promptModalTitle: "Translation prompt",
    promptPlaceholder: "Enter translation instructions...",
    save: "Save",
    cancel: "Cancel",
    resetSection: "Reset translation settings",
    resetConfirm: "Press again to reset",
    saving: "Saving...",
    unavailable: "Translation settings are currently unavailable from this host.",
    tips: [
      {
        label: "Manual only",
        text: "Replies and thoughts are never translated automatically across the timeline.",
      },
      {
        label: "Privacy",
        text: "Only the clicked reply or thought, target language, and translation prompt are sent.",
      },
      {
        label: "Session cache",
        text: "Translations stay in memory for this client session and refresh when source text or settings change.",
      },
    ],
  },
  zh: {
    sectionTitle: "时间线翻译",
    enableTitle: "启用行内翻译",
    enableDescription: "在助手回复与思考过程右上角显示手动翻译按钮，并保留原文。",
    targetTitle: "目标语言",
    targetDescription: "默认跟随当前界面语言，可在下拉菜单中按语言名或代码搜索。",
    targetPlaceholder: "搜索语言名称或代码...",
    targetEmpty: "没有匹配的语言",
    customModelTitle: "指定 Provider 与模型",
    customModelDescription: "关闭时复用当前会话正在使用的 Provider 与模型。",
    providerTitle: "Provider",
    providerPlaceholder: "选择 Provider",
    refreshTitle: "刷新",
    modelTitle: "模型",
    modelPlaceholder: "选择模型",
    disableThinkingTitle: "支持时关闭思考",
    disableThinkingDescription: "仅在模型明确支持 off / none / disabled 选项时生效，不静默降档。",
    thinkingOptionTitle: "思考挡位",
    thinkingDefaultOption: "模型默认",
    promptTitle: "翻译 Prompt",
    promptDescription: "仅与当前选中的单条回复或思考内容一起发送。",
    editPrompt: "编辑 Prompt",
    resetPrompt: "重置 Prompt",
    promptModalTitle: "编辑翻译 Prompt",
    promptPlaceholder: "输入翻译提示词...",
    save: "保存",
    cancel: "取消",
    resetSection: "重置翻译设置",
    resetConfirm: "再点一次确认重置",
    saving: "正在保存...",
    unavailable: "当前无法从 Paseo 主机读取翻译设置。",
    tips: [
      {
        label: "仅手动触发",
        text: "不会自动整条时间线翻译。",
      },
      {
        label: "隐私保护",
        text: "仅将用户点击的那条回复或思考文本与翻译提示词发送给选定模型。",
      },
      {
        label: "会话缓存",
        text: "译文仅缓存在当前客户端会话内存中，原文或配置变更时自动失效。",
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

  const remote: RemoteTranslationSettings =
    state.status === "ready"
      ? { status: "ready", values: state.values, revision: state.revision }
      : state.status === "invalid"
        ? { status: "invalid", error: state.error, revision: state.revision }
        : state.status === "error"
          ? { status: "error", error: state.error }
          : { status: "loading" };
  const revision = "revision" in remote ? remote.revision : "";
  const remoteError = "error" in remote ? remote.error : "";

  useEffect(() => {
    reportTranslationSettings(remote);
  }, [remote.status, revision, remoteError]);

  const [catalog, setCatalog] = useState<TranslationCatalogState>(() => ({
    ...catalogCache,
    loading: false,
    error: null,
  }));
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(settings.prompt);
  const [confirmReset, setConfirmReset] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const loadModels = useCallback(async (provider: string) => {
    setCatalog((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetchModels({ provider });
      const targetProvider = provider || res.providers[0] || "";
      const nextModelsByProvider = { ...catalogCache.modelsByProvider };
      if (targetProvider) nextModelsByProvider[targetProvider] = res.models;
      catalogCache = {
        providers: res.providers,
        providerLabels: { ...catalogCache.providerLabels, ...res.providerLabels },
        modelsByProvider: nextModelsByProvider,
      };
      setCatalog({
        ...catalogCache,
        loading: false,
        error: res.error,
      });
    } catch (error) {
      setCatalog((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
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

  const activeProvider = settings.provider || catalog.providers[0] || "";
  const models = catalog.modelsByProvider[activeProvider] ?? [];
  const selectedModel = models.find((m) => m.id === settings.model);
  const thinkingStatus = describeThinkingStatus(settings, selectedModel, catalog.loading, lang);

  const providerChoices: MenuChoice[] = [
    ...(settings.provider ? [] : [{ value: "", name: t.providerPlaceholder, logo: null }]),
    ...catalog.providers.map((id) => ({
      value: id,
      name: catalog.providerLabels[id] ?? id,
      logo: null,
    })),
  ];

  const modelChoices: MenuChoice[] = [
    ...(settings.model ? [] : [{ value: "", name: t.modelPlaceholder, logo: null }]),
    ...models.map((m) => ({
      value: m.id,
      name: m.label || m.id,
      logo: null,
    })),
  ];

  const thinkingChoices: MenuChoice[] = [
    { value: "", name: t.thinkingDefaultOption, logo: null },
    ...(selectedModel?.thinkingOptions ?? []).map((opt) => ({
      value: opt.id,
      name: opt.label,
      logo: null,
    })),
  ];

  const writeDisabled = state.status !== "ready" || state.saving;
  const controlsDisabled = writeDisabled || !settings.enabled;

  const statusToneColor =
    thinkingStatus.tone === "warning"
      ? tokens.warning
      : thinkingStatus.tone === "accent"
        ? tokens.accent
        : tokens.foregroundMuted;

  return (
    <Section title={t.sectionTitle} look={look}>
      {state.status === "error" || state.status === "invalid" ? (
        <SectionNote text={state.error ? `${t.unavailable} (${state.error})` : t.unavailable} look={look} />
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

      {settings.customModel ? (
        <>
          <SettingRow
            title={t.providerTitle}
            control={
              <View style={styles.inlineControls}>
                <ChoiceMenuSelect
                  value={settings.provider}
                  selected={providerChoices.find((c) => c.value === settings.provider) ?? null}
                  choices={providerChoices}
                  onChange={(provider) => {
                    void savePatch({ provider, model: "", thinkingOptionId: "" });
                    if (provider) void loadModels(provider);
                  }}
                  look={look}
                  label={t.providerTitle}
                  disabled={controlsDisabled}
                />
                <PlainButton
                  label={t.refreshTitle}
                  onPress={() => void loadModels(settings.provider)}
                  look={look}
                  disabled={controlsDisabled || catalog.loading}
                  loading={catalog.loading}
                />
              </View>
            }
            look={look}
            disabled={controlsDisabled}
          />

          <SettingRow
            title={t.modelTitle}
            control={
              <ChoiceMenuSelect
                value={settings.model}
                selected={modelChoices.find((c) => c.value === settings.model) ?? null}
                choices={modelChoices}
                onChange={(model) => void savePatch({ model, thinkingOptionId: "" })}
                look={look}
                label={t.modelTitle}
                disabled={controlsDisabled}
              />
            }
            look={look}
            disabled={controlsDisabled}
          />

          {catalog.error ? (
            <View style={styles.noticeRow}>
              <Text style={[styles.noticeText, settingsTextStyle(tokens, -1), { color: tokens.danger, fontFamily: tokens.fontUi }]}>
                {catalog.error}
              </Text>
            </View>
          ) : null}
        </>
      ) : null}

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
      />

      <View
        style={[
          styles.thinkingNoticeBox,
          {
            borderColor: thinkingStatus.tone === "warning" ? tokens.warning : tokens.v2.border,
            backgroundColor: tokens.v2.surface2,
          },
        ]}
      >
        <Text style={[styles.noticeText, settingsTextStyle(tokens, -1), { color: statusToneColor, fontFamily: tokens.fontUi }]}>
          {thinkingStatus.text}
        </Text>
      </View>

      {settings.customModel && !settings.disableThinking && (selectedModel?.thinkingOptions.length ?? 0) > 0 ? (
        <SettingRow
          title={t.thinkingOptionTitle}
          control={
            <ChoiceMenuSelect
              value={settings.thinkingOptionId}
              selected={thinkingChoices.find((c) => c.value === settings.thinkingOptionId) ?? null}
              choices={thinkingChoices}
              onChange={(thinkingOptionId) => void savePatch({ thinkingOptionId })}
              look={look}
              label={t.thinkingOptionTitle}
              disabled={controlsDisabled}
            />
          }
          look={look}
          disabled={controlsDisabled}
        />
      ) : null}

      <SettingRow
        title={t.promptTitle}
        description={settings.prompt}
        control={
          <View style={styles.inlineControls}>
            <PlainButton
              label={t.editPrompt}
              onPress={() => {
                setPromptDraft(settings.prompt);
                setPromptOpen(true);
              }}
              look={look}
              disabled={controlsDisabled}
            />
            {settings.prompt !== DEFAULT_TRANSLATION_PROMPT ? (
              <PlainButton
                label={t.resetPrompt}
                onPress={() => void savePatch({ prompt: DEFAULT_TRANSLATION_PROMPT })}
                look={look}
                disabled={controlsDisabled}
              />
            ) : null}
          </View>
        }
        look={look}
        disabled={controlsDisabled}
      />

      <View style={styles.footerRow}>
        <PlainButton
          label={confirmReset ? t.resetConfirm : t.resetSection}
          onPress={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              if (resetTimer.current) clearTimeout(resetTimer.current);
              resetTimer.current = setTimeout(() => setConfirmReset(false), 3000);
              return;
            }
            setConfirmReset(false);
            if (resetTimer.current) {
              clearTimeout(resetTimer.current);
              resetTimer.current = null;
            }
            void savePatch(DEFAULT_TIMELINE_TRANSLATION_SETTINGS);
          }}
          look={look}
          disabled={writeDisabled}
        />
        {state.saving ? (
          <Text style={[styles.savingText, settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
            {t.saving}
          </Text>
        ) : null}
        {state.saveError ? (
          <Text style={[styles.savingText, settingsTextStyle(tokens, -1), { color: tokens.danger, fontFamily: tokens.fontUi }]}>
            {state.saveError}
          </Text>
        ) : null}
      </View>

      <View style={styles.tipsWrap}>
        <SettingsTips items={t.tips} look={look} inset />
      </View>

      {promptOpen ? (
        <Modal
          title={t.promptModalTitle}
          open={promptOpen}
          onOpenChange={setPromptOpen}
        >
          <Modal.Content>
            <View style={styles.modalBody}>
              <TextInput
                value={promptDraft}
                onChangeText={setPromptDraft}
                placeholder={t.promptPlaceholder}
                placeholderTextColor={tokens.foregroundSubtle ?? tokens.foregroundMuted}
                multiline
                numberOfLines={5}
                style={[
                  styles.promptInput,
                  settingsTextStyle(tokens, -1),
                  {
                    color: tokens.foreground,
                    fontFamily: tokens.fontUi,
                    borderColor: tokens.v2.border,
                    backgroundColor: tokens.v2.surface0,
                  },
                ]}
              />
              <View style={styles.modalActions}>
                <PlainButton
                  label={t.resetPrompt}
                  onPress={() => setPromptDraft(DEFAULT_TRANSLATION_PROMPT)}
                  look={look}
                />
                <View style={styles.modalSpacer} />
                <PlainButton
                  label={t.cancel}
                  onPress={() => setPromptOpen(false)}
                  look={look}
                />
                <PlainButton
                  label={t.save}
                  onPress={() => {
                    const trimmed = promptDraft.trim();
                    if (trimmed) void savePatch({ prompt: trimmed });
                    setPromptOpen(false);
                  }}
                  look={look}
                  disabled={!promptDraft.trim()}
                />
              </View>
            </View>
          </Modal.Content>
        </Modal>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  inlineControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  thinkingNoticeBox: {
    marginHorizontal: 14,
    marginBottom: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: radiusV2.block,
  },
  noticeRow: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  noticeText: {},
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  savingText: {},
  tipsWrap: {
    paddingBottom: 12,
  },
  modalBody: {
    gap: 12,
  },
  promptInput: {
    minHeight: Platform.OS === "web" ? 130 : 110,
    textAlignVertical: "top",
    padding: 10,
    borderWidth: 1,
    borderRadius: radiusV2.block,
  },
  modalActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalSpacer: {
    flex: 1,
  },
});
