import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Glyph } from "../components/glyph";
import { usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  DEFAULT_TRANSLATION_PROMPT,
  TIMELINE_TRANSLATION_SETTINGS,
  TRANSLATION_API_KEY_MAX_LENGTH,
  TRANSLATION_ENDPOINT_MAX_LENGTH,
  TRANSLATION_MODEL_MAX_LENGTH,
  TRANSLATION_PROMPT_MAX_LENGTH,
  translationApiKeyRpc,
  translationRevealKeyRpc,
  translationEndpointStatusRpc,
  translationTestRpc,
  type TimelineTranslationSettings,
  type TranslationEndpointProblem,
} from "../../shared/timeline-translation";
import { radiusV2, space } from "../components/theme-tokens";
import { TYPE } from "../ui/tokens/typography";
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
  settingsTextStyle,
  Toggle,
  type PageLook,
} from "../settings-controls";
import { PromptEditorModal } from "../settings-prompt-editor";
import { SearchableLanguageSelect } from "./language-picker";
import { endpointStatusFor, useEndpointStatus, type EndpointStatusSnapshot, type EndpointStatusStore } from "./endpoint-status";
import { DEFAULT_TIMELINE_TRANSLATION_SETTINGS, useTranslationSettingsReport } from "./settings-store";

const STRINGS = {
  en: {
    sectionTitle: "Translation",
    enableTitle: "Enable translation",
    enableDescription: "Translate selected text or a whole reply or thought. The original text stays as it is.",
    targetTitle: "Target language",
    targetDescription: "Follows the interface language by default. Search by language name or code.",
    targetPlaceholder: "Search language or code...",
    targetEmpty: "No matching language",
    testConnection: "Test connection",
    saveConfiguration: "Save configuration",
    testSuccess: "Connection successful. The model responded.",
    testFailed: "Connection failed: ",
    saveSuccess: "Configuration saved.",
    testing: "Testing connection...",
    testMissing: "Enter the API URL and model first.",
    saveFailed: "Could not save configuration.",
    showKey: "Show API key",
    hideKey: "Hide API key",
    endpointTitle: "API Base URL",
    endpointDescription: "Enter the API address from your service. Remote endpoints require HTTPS.",
    endpointPlaceholder: "https://api.example.com/v1",
    endpointEmpty: "No endpoint set: nothing is translated or sent.",
    endpointTarget: (url: string) => `The Paseo daemon sends selected text to POST ${url}.`,
    endpointChecking: "Checking the endpoint...",
    endpointCheckFailed: (error: string) => `Could not check the endpoint: ${error}`,
    problems: {
      invalid_url: "Not a valid URL.",
      unsupported_protocol: "Use https:// (or http:// on this machine).",
      insecure_remote: "A remote endpoint must use https://. http:// is allowed only for localhost, 127.0.0.1 and ::1.",
      embedded_credentials: "Remove the user name or password from the URL; save the API key below instead.",
      query_or_fragment: "Remove the query string or fragment from the URL.",
    } satisfies Record<TranslationEndpointProblem, string>,
    modelTitle: "Model",
    modelDescription: "The model id the endpoint expects, exactly as the service names it.",
    modelPlaceholder: "model-id",
    modelMissing: "Set a model: nothing is sent without one.",
    keyTitle: "API key",
    keyDescription: "Used to connect to your translation service. Optional for local servers.",
    keyPlaceholder: "Paste a new key",
    saveKey: "Save key",
    clearKey: "Clear key",
    keyNone: "No key saved: requests carry no Authorization header.",
    keySaved: (origin: string) => `A key is saved for ${origin}.`,
    keyMismatch: (origin: string) => `The saved key belongs to ${origin}. Translation is blocked until you save a key for this endpoint or clear it.`,
    keyNeedsEndpoint: "Set a valid endpoint before saving a key.",
    keyEndpointPending: "The endpoint above is not saved yet. Leave the field or press Enter to save it, then save the key; the key is bound to the saved address.",
    promptTitle: "Translation prompt",
    promptDescription: "Instructions the model follows when translating. Open the editor to view or change them.",
    editPrompt: "Edit prompt",
    resetPrompt: "Reset prompt",
    promptModalTitle: "Translation prompt",
    promptPlaceholder: "Enter translation instructions...",
    save: "Save",
    cancel: "Cancel",
    resetSection: "Restore default translation settings",
    resetHint: "Restores translation settings only and clears the endpoint. A saved API key stays until you clear it.",
    resetConfirmHint: "Confirm to restore this section’s defaults.",
    unavailable: "Translation settings are currently unavailable from this host.",
    tips: [
      {
        label: "Manual only",
        text: "Nothing is translated until you press Translate on selected text or a whole reply or thought.",
      },
      {
        label: "Where text goes",
        text: "Translate sends the selected text, target language and translation prompt from the Paseo daemon directly to the endpoint above as one chat completions request. The request offers no tools, and Better Paseo never runs a tool call; a reply with one is refused. What the service does with the text is up to that service and its policies.",
      },
      {
        label: "API key",
        text: "Stored unencrypted on the daemon host, protected by its file permissions; not in the Keychain. Sent only to the saved origin. You can reveal it in these settings. Translation does not use the conversation's provider, model or account.",
      },
      {
        label: "Session cache",
        text: "Translations stay in memory for this client session; selecting the same text again reuses one until the translation settings change.",
      },
    ],
  },
  zh: {
    sectionTitle: "翻译",
    enableTitle: "启用翻译",
    enableDescription: "可翻译选中的文本，也可翻译整条回复或思考内容。原文保持不变。",
    targetTitle: "目标语言",
    targetDescription: "默认跟随当前界面语言，可在下拉菜单中按语言名或代码搜索。",
    targetPlaceholder: "搜索语言名称或代码...",
    targetEmpty: "没有匹配的语言",
    testConnection: "测试连接",
    saveConfiguration: "保存配置",
    testSuccess: "连接成功，模型响应正常。",
    testFailed: "连接失败：",
    saveSuccess: "配置已保存。",
    testing: "正在测试连接...",
    testMissing: "请先填写 API 地址和模型。",
    saveFailed: "配置保存失败。",
    showKey: "显示 API Key",
    hideKey: "隐藏 API Key",
    endpointTitle: "API Base URL",
    endpointDescription: "填写服务商提供的 API 地址。远程服务需要使用 HTTPS。",
    endpointPlaceholder: "https://api.example.com/v1",
    endpointEmpty: "未设置端点：不会翻译，也不会发送任何内容。",
    endpointTarget: (url: string) => `Paseo daemon 会把选中的文本发送到 POST ${url}。`,
    endpointChecking: "正在检查端点...",
    endpointCheckFailed: (error: string) => `无法检查端点：${error}`,
    problems: {
      invalid_url: "不是有效的 URL。",
      unsupported_protocol: "请使用 https://（本机可用 http://）。",
      insecure_remote: "远程端点必须使用 https://。http:// 仅限 localhost、127.0.0.1 和 ::1。",
      embedded_credentials: "请从 URL 中去掉用户名或密码，改在下方保存 API Key。",
      query_or_fragment: "请从 URL 中去掉查询参数或片段。",
    } satisfies Record<TranslationEndpointProblem, string>,
    modelTitle: "模型",
    modelDescription: "端点要求的模型 ID，按服务方给出的名称原样填写。",
    modelPlaceholder: "model-id",
    modelMissing: "请设置模型：未设置时不会发送。",
    keyTitle: "API Key",
    keyDescription: "用于连接翻译服务，本机服务可不填。",
    keyPlaceholder: "粘贴新的 Key",
    saveKey: "保存 Key",
    clearKey: "清除 Key",
    keyNone: "未保存 Key：请求不带 Authorization 头。",
    keySaved: (origin: string) => `已为 ${origin} 保存 Key。`,
    keyMismatch: (origin: string) => `已保存的 Key 属于 ${origin}。在为当前端点保存 Key 或清除它之前，翻译会被拒绝。`,
    keyNeedsEndpoint: "请先设置有效端点再保存 Key。",
    keyEndpointPending: "上方端点尚未保存。请先离开输入框或按回车保存端点，再保存 Key；Key 只绑定已保存的地址。",
    promptTitle: "翻译 Prompt",
    promptDescription: "模型翻译时遵循的指令，打开编辑器即可查看或修改。",
    editPrompt: "编辑 Prompt",
    resetPrompt: "重置 Prompt",
    promptModalTitle: "编辑翻译 Prompt",
    promptPlaceholder: "输入翻译提示词...",
    save: "保存",
    cancel: "取消",
    resetSection: "恢复默认翻译设置",
    resetHint: "只恢复本组设置并清空端点；已保存的 API Key 需单独清除。",
    resetConfirmHint: "再点一次「确认」恢复本组默认值。",
    unavailable: "当前无法从 Paseo 主机读取翻译设置。",
    tips: [
      {
        label: "仅手动触发",
        text: "只有对选中文本或整条回复、思考内容点击「翻译」时才会翻译，不会自动翻译时间线。",
      },
      {
        label: "数据去向",
        text: "点击「翻译」时，Paseo daemon 会把选中的文本、目标语言和翻译提示词作为一次 chat completions 请求直接发送到上方端点。请求不提供任何工具，Better Paseo 也不会执行工具调用，带工具调用的回复会被拒绝。服务方如何处理这些文本取决于该服务及其政策。",
      },
      {
        label: "API Key",
        text: "以明文保存在 daemon 所在机器的文件中，受主机文件权限保护，不是钥匙串。只发送给保存时绑定的 origin，可在此设置中显示。翻译不使用会话的 Provider、模型或账号。",
      },
      {
        label: "会话缓存",
        text: "译文仅缓存在当前客户端会话内存中；再次选中相同文本时直接复用，翻译设置变更后失效。",
      },
    ],
  },
} as const;

type Strings = (typeof STRINGS)["en" | "zh"];

function endpointNotice(t: Strings, settings: TimelineTranslationSettings, status: EndpointStatusSnapshot):
  { text: string; tone: "neutral" | "warning" | "danger" } | null {
  if (!settings.endpoint) return { text: t.endpointEmpty, tone: "neutral" };
  if (status.status !== "ready" && status.status !== "error") return { text: t.endpointChecking, tone: "neutral" };
  if (status.status === "error") return { text: t.endpointCheckFailed(status.error), tone: "danger" };
  const check = status.value.endpoint;
  if (check.status === "invalid") return { text: t.problems[check.problem], tone: "danger" };
  if (check.status === "ok") return { text: t.endpointTarget(check.requestUrl), tone: "neutral" };
  return { text: t.endpointEmpty, tone: "neutral" };
}

function keyNotice(t: Strings, status: EndpointStatusSnapshot): { text: string; tone: "neutral" | "warning" | "danger" } | null {
  if (status.status !== "ready") return null;
  const key = status.value.key;
  if (key.status === "error") return { text: key.error, tone: "danger" };
  if (key.status === "none") return { text: t.keyNone, tone: "neutral" };
  if (!key.matches && status.value.endpoint.status === "ok") return { text: t.keyMismatch(key.origin), tone: "warning" };
  return { text: t.keySaved(key.origin), tone: "neutral" };
}

export function TimelineTranslationSettings({ look }: { look: PageLook }) {
  // One plugin installation, so one `PaseoApi`, per host. The key status and
  // every draft and pending key write belong to that host: switching hosts
  // remounts the page with the other host's store, and a write still in flight
  // for the first host can only land in the first host's store.
  const store = endpointStatusFor(usePaseo());
  return <TranslationSettingsBody key={store.id} look={look} store={store} />;
}

function TranslationSettingsBody({ look, store }: { look: PageLook; store: EndpointStatusStore }) {
  const { tokens } = look;
  const preferences = useEnhancerPreferences();
  const lang = resolveLanguage(preferences.language);
  const t = STRINGS[lang];
  const state = useSettings(TIMELINE_TRANSLATION_SETTINGS);
  const readStatus = useRpc(translationEndpointStatusRpc);
  const writeKey = useRpc(translationApiKeyRpc);
  const revealKey = useRpc(translationRevealKeyRpc);
  const testConnection = useRpc(translationTestRpc);
  const endpointStatus = useEndpointStatus(store);

  const settings = state.status === "ready" ? state.values : DEFAULT_TIMELINE_TRANSLATION_SETTINGS;

  useTranslationSettingsReport(state);

  const [promptOpen, setPromptOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState<string | null>(null);
  const [modelDraft, setModelDraft] = useState<string | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [revealed, setRevealed] = useState<{ snapshot: EndpointStatusSnapshot; key: string } | null>(null);
  const revealSequence = useRef(0);
  const [focused, setFocused] = useState<"endpoint" | "key" | "model" | null>(null);
  const [testing, setTesting] = useState(false);
  const [noticeLine, setNoticeLine] = useState<{ text: string; tone: "neutral" | "accent" | "danger" } | null>(null);

  const endpoint = settings.endpoint;
  const ready = state.status === "ready";
  const refreshStatus = useCallback(() => {
    void store.read(endpoint, () => readStatus({ endpoint }));
  }, [store, endpoint, readStatus]);
  useEffect(() => {
    if (ready) refreshStatus();
  }, [ready, refreshStatus]);

  const savePatch = useCallback(async (patch: Partial<TimelineTranslationSettings>) => {
    if (state.status !== "ready") return;
    const next = { ...state.values, ...patch };
    const ok = await state.save(next, state.revision);
    if (!ok) {
      void state.reload?.();
    }
  }, [state]);

  const clearKey = async () => {
    revealSequence.current++;
    setRevealed(null);
    setKeyVisible(false);
    setKeyBusy(true);
    setKeyError(null);
    try {
      const outcome = await store.write(endpoint, () => writeKey({ action: "clear", endpoint }));
      if (outcome.kind === "failed") setKeyError(outcome.error);
    } finally {
      setKeyBusy(false);
    }
  };
  const inputTextStyle = Platform.OS === "web" ? settingsTextStyle(tokens, -1) : { fontSize: settingsTextStyle(tokens, -1).fontSize, textAlignVertical: "center" as const };
  const apiEndpoint = endpointDraft ?? settings.endpoint;
  const apiModel = modelDraft ?? settings.endpointModel;
  const test = async () => {
    if (!apiEndpoint.trim() || !apiModel.trim()) {
      setNoticeLine({ text: t.testMissing, tone: "danger" });
      return;
    }
    setTesting(true);
    setNoticeLine({ text: t.testing, tone: "neutral" });
    try {
      await testConnection({ endpoint: apiEndpoint.trim(), model: apiModel.trim(), ...(keyDraft.trim() ? { apiKey: keyDraft.trim() } : {}) });
      setNoticeLine({ text: t.testSuccess, tone: "accent" });
    } catch (error) {
      setNoticeLine({ text: `${t.testFailed}${error instanceof Error ? error.message : String(error)}`, tone: "danger" });
    } finally {
      setTesting(false);
    }
  };
  const saveConfiguration = async () => {
    if (state.status !== "ready") return;
    setKeyBusy(true);
    setKeyError(null);
    setNoticeLine(null);
    try {
      const nextEndpoint = apiEndpoint.trim();
      const nextModel = apiModel.trim();
      const saved = await state.save({ ...state.values, endpoint: nextEndpoint, endpointModel: nextModel }, state.revision);
      if (!saved) {
        void state.reload?.();
        setNoticeLine({ text: t.saveFailed, tone: "danger" });
        return;
      }
      setEndpointDraft(null);
      setModelDraft(null);
      if (keyDraft.trim()) {
        const outcome = await store.write(nextEndpoint, () => writeKey({ action: "save", endpoint: nextEndpoint, apiKey: keyDraft.trim() }));
        if (outcome.kind === "failed") {
          setKeyError(outcome.error);
          return;
        }
        setKeyDraft("");
        setKeyVisible(false);
      }
      setNoticeLine({ text: t.saveSuccess, tone: "accent" });
    } catch (error) {
      setNoticeLine({ text: error instanceof Error ? error.message : t.saveFailed, tone: "danger" });
    } finally {
      setKeyBusy(false);
    }
  };

  const writeDisabled = state.status !== "ready" || state.saving;
  const controlsDisabled = writeDisabled || !settings.enabled;
  const formDisabled = controlsDisabled || keyBusy || testing;
  const current = endpointStatus.status === "ready" && endpointStatus.endpoint === endpoint ? endpointStatus : null;
  const keySaved = current?.value.key.status === "saved";
  const savedKey = current?.value.key.status === "saved" ? current.value.key : null;
  const shownKey = revealed?.snapshot === current ? revealed.key : null;
  const toggleKey = async () => {
    const sequence = ++revealSequence.current;
    if (keyVisible) {
      setKeyVisible(false);
      setRevealed(null);
      return;
    }
    if (keyDraft || !savedKey || !current) {
      setKeyVisible(true);
      return;
    }
    setKeyError(null);
    try {
      const result = await revealKey({});
      if (sequence !== revealSequence.current || store.snapshot() !== current) return;
      if (!result || result.origin !== savedKey.origin) {
        refreshStatus();
        return;
      }
      setRevealed({ snapshot: current, key: result.apiKey });
      setKeyVisible(true);
    } catch (error) {
      if (sequence === revealSequence.current) setKeyError(error instanceof Error ? error.message : String(error));
    }
  };
  const endpointLine = endpointNotice(t, settings, current ?? (endpointStatus.status === "error" && endpointStatus.endpoint === endpoint ? endpointStatus : { status: "loading", endpoint }));
  const keyLine = keyError ? { text: keyError, tone: "danger" as const } : current ? keyNotice(t, current) : null;
  const notice = (line: { text: string; tone: "neutral" | "warning" | "danger" } | null) => line ? (
    <View style={{ backgroundColor: tokens.v2.surface2, borderRadius: radiusV2.block, paddingVertical: space.sm, paddingHorizontal: space.md }}>
      <RowNotice look={look} text={line.text} tone={line.tone} />
    </View>
  ) : null;

  const saveError = state.saveError ? <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
    <RowNotice look={look} text={state.saveError} tone="danger" alert />
  </View> : null;

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

      {settings.enabled ? <>
      <SettingRow
        stacked title={t.endpointTitle} description={t.endpointDescription}
        control={<TextInput accessibilityLabel={t.endpointTitle} value={apiEndpoint}
          onChangeText={(value) => { setEndpointDraft(value); setNoticeLine(null); }}
          placeholder={t.endpointPlaceholder} placeholderTextColor={tokens.foregroundSubtle} maxLength={TRANSLATION_ENDPOINT_MAX_LENGTH}
          autoCapitalize="none" autoCorrect={false} editable={!formDisabled}
          onFocus={() => setFocused("endpoint")} onBlur={() => setFocused(null)}
          style={[styles.input, inputTextStyle, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null, { color: tokens.foreground, borderColor: focused === "endpoint" ? tokens.foregroundMuted : tokens.v2.border, backgroundColor: tokens.v2.surface0, fontFamily: tokens.fontMono, width: look.compact ? "100%" : 380, maxWidth: "100%" }]}
        />}
        look={look} disabled={formDisabled} below={endpointDraft === null ? notice(endpointLine) : null}
      />

      <SettingRow
        stacked title={t.keyTitle} description={t.keyDescription}
        control={<View style={[styles.keyRow, { width: look.compact ? "100%" : 380, maxWidth: "100%" }]}>
          <View style={[styles.keyInput, { borderColor: focused === "key" ? tokens.foregroundMuted : tokens.v2.border, backgroundColor: tokens.v2.surface0 }]}>
            <TextInput accessibilityLabel={t.keyTitle} value={keyDraft}
              onChangeText={(value) => { revealSequence.current++; setRevealed(null); setKeyDraft(value); setNoticeLine(null); }} secureTextEntry={!keyVisible}
              onFocus={() => setFocused("key")} onBlur={() => setFocused(null)}
              placeholder={savedKey ? (keyVisible && shownKey ? shownKey : savedKey.masked) : t.keyPlaceholder} placeholderTextColor={savedKey ? tokens.foreground : tokens.foregroundSubtle} maxLength={TRANSLATION_API_KEY_MAX_LENGTH}
              autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" editable={!formDisabled}
              style={[styles.keyField, inputTextStyle, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null, { color: tokens.foreground, fontFamily: tokens.fontMono }]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={keyVisible ? t.hideKey : t.showKey} disabled={formDisabled}
              onPress={() => void toggleKey()} style={[styles.eye, { borderColor: tokens.v2.border }]}>
              <Glyph name={keyVisible ? "EyeOff" : "Eye"} size={16} color={tokens.foregroundMuted} />
            </Pressable>
          </View>
          {keySaved ? <PlainButton label={t.clearKey} look={look} disabled={formDisabled} onPress={() => void clearKey()} /> : null}
        </View>}
        look={look} disabled={formDisabled} below={notice(keyLine)}
      />

      <SettingRow
        stacked title={t.modelTitle} description={t.modelDescription}
        control={<TextInput accessibilityLabel={t.modelTitle} value={apiModel}
          onChangeText={(value) => { setModelDraft(value); setNoticeLine(null); }}
          placeholder={t.modelPlaceholder} placeholderTextColor={tokens.foregroundSubtle} maxLength={TRANSLATION_MODEL_MAX_LENGTH}
          autoCapitalize="none" autoCorrect={false} editable={!formDisabled}
          onFocus={() => setFocused("model")} onBlur={() => setFocused(null)}
          style={[styles.input, inputTextStyle, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null, { color: tokens.foreground, borderColor: focused === "model" ? tokens.foregroundMuted : tokens.v2.border, backgroundColor: tokens.v2.surface0, fontFamily: tokens.fontMono, width: look.compact ? "100%" : 380, maxWidth: "100%" }]}
        />}
        look={look} disabled={formDisabled}
      />

      <SettingRow title={t.testConnection}
        control={<View style={[styles.keyRow, { width: look.compact ? "100%" : 380, maxWidth: "100%" }]}>
          <PlainButton label={t.testConnection} look={look} loading={testing} disabled={formDisabled} onPress={() => void test()} />
          <PlainButton label={t.saveConfiguration} look={look} loading={keyBusy} disabled={formDisabled} onPress={() => void saveConfiguration()} />
        </View>}
        look={look} wrapControl disabled={formDisabled}
        below={noticeLine ? <RowNotice look={look} text={noticeLine.text} tone={noticeLine.tone} /> : null}
      />

      <SettingRow wrapControl title={t.targetTitle} description={t.targetDescription}
        control={<SearchableLanguageSelect value={settings.targetLanguage} onChange={(targetLanguage) => void savePatch({ targetLanguage })}
          language={lang} look={look} disabled={controlsDisabled} label={t.targetTitle} searchPlaceholder={t.targetPlaceholder} emptyLabel={t.targetEmpty} />}
        look={look} disabled={controlsDisabled}
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
      {saveError}
      <SectionFooter look={look}><SettingsTips items={t.tips} look={look} /></SectionFooter>
      </> : saveError}
    </Section>

    {settings.enabled && promptOpen ? <PromptEditorModal look={look} title={t.promptModalTitle} label={t.promptTitle}
      value={settings.prompt} defaultValue={DEFAULT_TRANSLATION_PROMPT} maxLength={TRANSLATION_PROMPT_MAX_LENGTH}
      reset={t.resetPrompt} cancel={t.cancel} save={t.save} placeholder={t.promptPlaceholder} trim
      onClose={() => setPromptOpen(false)} onSave={(prompt) => void savePatch({ prompt })}
    /> : null}
  </>;
}

const styles = StyleSheet.create({
  input: {
    ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : null),
    alignSelf: "stretch",
    minHeight: 32,
    borderWidth: 1,
    borderRadius: radiusV2.block,
    paddingHorizontal: space.sm,
    fontSize: TYPE.button.size,
  },
  keyRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  keyInput: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: radiusV2.block },
  keyField: { ...(Platform.OS === "web" ? { outlineStyle: "none" } as object : null), flex: 1, minWidth: 0, minHeight: 32, paddingHorizontal: space.sm, fontSize: TYPE.button.size },
  eye: { width: 38, minHeight: 32, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
});
