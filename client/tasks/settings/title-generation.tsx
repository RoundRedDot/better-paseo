import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { space } from "../../components/theme-tokens";
import { ProviderLogo, providerBrand } from "../../components/provider-logo";
import { TITLE_GENERATION_SETTINGS, titleGenerationSettingsSchema, titleModelsRpc } from "../../../shared/title-generation";
import { PlainButton, Section, SectionNote, SettingRow, Toggle, settingsTextStyle, type PageLook } from "../../settings-controls";
import { useTasksLanguage } from "../i18n";

const WORDS = {
  en: {
    disableThinking: "Disable title thinking", thinkingHint: "Disable thinking when supported; otherwise use the lowest supported level. Turn off to follow the agent or custom thinking level.", automaticThinking: "Off or lowest supported level",
    customModel: "Custom automatic title model", followSource: "Off: follow the card agent's provider, model and thinking level. Save to sync these settings across devices connected to this host.",
    title: "Automatic titles", provider: "Provider", model: "Model", thinkingOptionId: "Thinking level", modelDefault: "Model default", noThinking: "Not supported", choose: "Choose…", prompt: "Prompt",
    hint: "Recommended custom model: Oh My Pi / DeepSeek Flash (deepseek/deepseek-flash), thinking low. Alternative: Claude / Haiku 5.5 (claude-haiku-5-5), thinking off.\nChoose models available on this host; actual speed also depends on agent startup and host load. The background task stays off the board, retains history and may trigger host notifications.",
    save: "Save title settings", reset: "Reset title settings", saving: "Saving…", loading: "Loading…", retry: "Retry", refresh: "Refresh models", loadError: "Could not load title settings.",
    saveError: "Settings changed elsewhere or could not be saved. Reloaded the latest.",
    notRecommended: "Not recommended",
  },
  zh: {
    disableThinking: "关闭标题生成思考模式", thinkingHint: "模型支持时关闭思考，否则使用支持的最低等级。关闭此开关后，跟随 agent 或自定义的思考等级。", automaticThinking: "关闭或最低支持等级",
    customModel: "自定义自动标题模型", followSource: "关闭时跟随卡片所属 agent 的 Provider、模型和思考等级。保存后，设置同步至连接此主机的各端。",
    title: "自动更新标题", provider: "Provider", model: "模型", thinkingOptionId: "思考等级", modelDefault: "模型默认", noThinking: "不支持", choose: "请选择…", prompt: "Prompt",
    hint: "自定义模型推荐：Oh My Pi / DeepSeek Flash（deepseek/deepseek-flash），思考等级 low；备选：Claude / Haiku 5.5（claude-haiku-5-5），思考等级 off。\n请选择当前主机可用的模型；实际速度也受 agent 启动和主机负载影响。后台任务不进入看板，仍保留历史，并可能触发宿主通知。",
    save: "保存标题设置", reset: "重置标题设置", saving: "正在保存…", loading: "正在加载…", retry: "重试", refresh: "刷新模型", loadError: "标题设置加载失败。",
    saveError: "设置已在别处更改或保存失败，已重新加载最新内容。",
    notRecommended: "不推荐使用",
  },
};

export function TitleGenerationSettings({ look }: { look: PageLook }) {
  const words = WORDS[useTasksLanguage()];
  const settings = useSettings(TITLE_GENERATION_SETTINGS);
  const loadCatalog = useRpc(titleModelsRpc);
  const [draft, setDraft] = useState(() => settings.status === "ready" ? settings.values : titleGenerationSettingsSchema.parse({}));
  const [catalog, setCatalog] = useState<{ providers: string[]; models: Array<{ id: string; label: string; thinkingOptions: Array<{ id: string; label: string }>; defaultThinkingOptionId: string | null }> }>({ providers: [], models: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [choosing, setChoosing] = useState<"provider" | "model" | "thinkingOptionId" | null>(null);
  const revision = settings.status === "ready" ? settings.revision : null;
  useEffect(() => {
    if (settings.status === "ready") setDraft(settings.values);
  }, [revision]);
  useEffect(() => {
    setError(null);
    setLoading(false);
    if (revision === null || !draft.customModel) return;
    let live = true;
    setLoading(true);
    setError(null);
    void Promise.resolve().then(() => loadCatalog({ provider: draft.provider })).then((result) => {
      if (!live) return;
      setCatalog({ providers: result.providers, models: result.models });
      setError(result.error);
      const firstModel = result.models[0];
      if (!result.error && draft.provider && firstModel) {
        setDraft((current) => current.customModel && current.provider === draft.provider && !current.model
          ? { ...current, model: firstModel.id, thinkingOptionId: "" } : current);
      }
    }).catch((failure: unknown) => {
      if (live) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [loadCatalog, draft.customModel, draft.provider, revision !== null, refresh]);

  const textStyle = { ...settingsTextStyle(look.tokens), color: look.tokens.foreground, fontFamily: look.tokens.fontUi };
  if (settings.status !== "ready") {
    return (
      <View style={{ gap: space.sm }}>
        <Section title={words.title} look={look}>
          <View style={{ padding: space.lg }}>
            <PlainButton label={words.retry} look={look} onPress={() => void settings.reload()} />
          </View>
        </Section>
        <SectionNote text={settings.status === "loading" ? words.loading : words.loadError} look={look} />
      </View>
    );
  }
  const save = async () => {
    setSaveError(null);
    try {
      if (await settings.save(draft, settings.revision)) return;
      await settings.reload();
      setSaveError(words.saveError);
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const canSave = (!draft.customModel || draft.provider && draft.model) && draft.prompt.trim() && !settings.saving;
  const reset = async () => {
    setSaveError(null);
    if (!await settings.reset()) return;
    setChoosing(null);
    setDraft(titleGenerationSettingsSchema.parse({}));
  };
  const providers = [...new Set([...catalog.providers, ...(draft.provider ? [draft.provider] : [])])]
    .sort((a, b) => Number(a === "cursor") - Number(b === "cursor"))
    .map((provider) => ({ id: provider, label: `${providerBrand(provider).displayName}${provider === "cursor" ? ` · ${words.notRecommended}` : ""}` }));
  const models = catalog.models.some((model) => model.id === draft.model) || !draft.model ? catalog.models : [...catalog.models, { id: draft.model, label: draft.model }];
  const selectedModel = catalog.models.find((model) => model.id === draft.model);
  const thinkingOptions = selectedModel?.thinkingOptions ?? [];
  const modelDefault = `${words.modelDefault}${selectedModel?.defaultThinkingOptionId ? ` · ${selectedModel.defaultThinkingOptionId}` : ""}`;
  const thinkingChoices = [{ id: "", label: modelDefault }, ...thinkingOptions];
  const choices = choosing === "provider" ? providers : choosing === "model" ? models : thinkingChoices;
  return (
    <View style={{ gap: space.sm }}>
      <Section title={words.title} look={look}>
        <SettingRow title={words.customModel} description={words.followSource} look={look} first disabled={settings.saving} control={
          <Toggle value={draft.customModel} label={words.customModel} look={look} onChange={(customModel) => {
            setChoosing(null);
            setDraft({ ...draft, customModel });
          }} />
        } />
        <SettingRow title={words.disableThinking} description={words.thinkingHint} look={look} disabled={settings.saving} control={
          <Toggle value={draft.disableThinking} label={words.disableThinking} look={look} onChange={(disableThinking) => {
            setChoosing(null);
            setDraft({ ...draft, disableThinking });
          }} />
        } />
        {draft.customModel && (["provider", "model", "thinkingOptionId"] as const).map((field) => {
          const disabled = settings.saving || loading || (field === "model" && !draft.provider) || (field === "thinkingOptionId" && (draft.disableThinking || thinkingOptions.length === 0));
          const label = field === "provider" ? providers.find((provider) => provider.id === draft.provider)?.label
            : field === "model" ? models.find((model) => model.id === draft.model)?.label
              : draft.disableThinking ? words.automaticThinking
              : draft.thinkingOptionId ? thinkingOptions.find((option) => option.id === draft.thinkingOptionId)?.label ?? draft.thinkingOptionId
                : thinkingOptions.length > 0 ? modelDefault : draft.model && selectedModel ? words.noThinking : words.choose;
          return <SettingRow key={field} title={words[field]} look={look} control={
            <Pressable accessibilityRole="button" accessibilityLabel={words[field]} accessibilityState={{ expanded: choosing === field, disabled }}
              disabled={disabled} onPress={() => setChoosing(field)}
              style={{ minHeight: 44, maxWidth: "100%", flexShrink: 1, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: 8, borderColor: look.tokens.v2.border, opacity: disabled ? 0.5 : 1 }}>
              {field === "provider" && draft.provider ? <ProviderLogo provider={draft.provider} size={18} color={providerBrand(draft.provider).monochrome ? look.tokens.foreground : undefined} /> : null}
              <Text numberOfLines={1} style={[textStyle, { flexShrink: 1 }]}>{label || words.choose}</Text>
              <Icon name="ChevronDown" size={16} color={look.tokens.foregroundMuted} />
            </Pressable>
          } />;
        })}
        <SettingRow title={words.prompt} look={look} below={
          <TextInput testID="title-generation-prompt" accessibilityLabel={words.prompt} multiline value={draft.prompt}
            editable={!settings.saving} maxLength={8000} onChangeText={(prompt) => setDraft({ ...draft, prompt })}
            style={[textStyle, { width: "100%", minHeight: 130, borderWidth: 1, borderRadius: 8, borderColor: look.tokens.v2.border, backgroundColor: look.tokens.v2.surface0, padding: space.md, textAlignVertical: "top" }]} />
        } />
        <View style={{ marginLeft: look.compact ? space.lg : 0, paddingLeft: look.compact ? 0 : space.lg, paddingRight: space.lg, paddingVertical: 14, gap: space.sm, borderTopWidth: 1, borderTopColor: look.tokens.v2.border }}>
          {error || saveError || settings.saveError ? <Text accessibilityRole="alert" style={[textStyle, { color: look.tokens.warning }]}>{error || saveError || settings.saveError}</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {draft.customModel ? <PlainButton label={error ? words.retry : words.refresh} disabled={loading} look={look} onPress={() => setRefresh((value) => value + 1)} /> : null}
            <PlainButton label={settings.saving ? words.saving : words.save} disabled={!canSave} look={look} onPress={() => void save()} />
            <PlainButton label={words.reset} disabled={settings.saving} look={look} onPress={() => void reset()} />
          </View>
        </View>
      </Section>
      <SectionNote text={words.hint} look={look} />
      {draft.customModel && choosing ? <Modal title={words[choosing]} open onOpenChange={(open) => { if (!open) setChoosing(null); }}>
        <Modal.Content>
          <View accessibilityRole="radiogroup" accessibilityLabel={words[choosing]}>
            {choices.map((choice) => <Pressable key={choice.id} accessibilityRole="radio" accessibilityLabel={choice.label}
              accessibilityState={{ checked: draft[choosing] === choice.id }} aria-checked={draft[choosing] === choice.id}
              onPress={() => {
                setChoosing(null);
                if (choosing === "provider") {
                  setDraft(choice.id === draft.provider ? draft : { ...draft, provider: choice.id, model: "", thinkingOptionId: "" });
                  return;
                }
                if (choosing === "model") {
                  const nextModel = catalog.models.find((model) => model.id === choice.id);
                  setDraft({ ...draft, model: choice.id, thinkingOptionId: nextModel?.thinkingOptions.some((option) => option.id === draft.thinkingOptionId) ? draft.thinkingOptionId : "" });
                  return;
                }
                setDraft({ ...draft, thinkingOptionId: choice.id });
              }}
              style={{ minHeight: 48, padding: space.md, flexDirection: "row", alignItems: "center", gap: 10 }}>
              {choosing === "provider" ? <ProviderLogo provider={choice.id} size={20} color={providerBrand(choice.id).monochrome ? look.tokens.foreground : undefined} /> : null}
              <Text style={[textStyle, { flex: 1 }]}>{choice.label}</Text>
              {draft[choosing] === choice.id ? <Icon name="Check" size={18} color={look.tokens.accent} /> : null}
            </Pressable>)}
          </View>
        </Modal.Content>
      </Modal> : null}
    </View>
  );
}
