import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { space } from "../../components/theme-tokens";
import { ProviderLogo, providerBrand } from "../../components/provider-logo";
import { TITLE_GENERATION_SETTINGS, titleGenerationSettingsSchema, titleModelsRpc } from "../../../shared/title-generation";
import { PlainButton, Section, SectionNote, SettingRow, settingsTextStyle, type PageLook } from "../../settings-controls";
import { useTasksLanguage } from "../i18n";

const WORDS = {
  en: {
    title: "Automatic titles", provider: "Provider", model: "Model", thinkingOptionId: "Thinking level", modelDefault: "Model default", noThinking: "Not supported", choose: "Choose…", prompt: "prompt",
    hint: "Recommended: Oh My Pi / DeepSeek Flash (deepseek/deepseek-flash), thinking low. Alternative: Claude / Haiku 5.5 (claude-haiku-5-5), thinking off.\nAppend to the default prompt: Use the language of firstPrompt. Limit the title to 80 characters including spaces.\nChoose models available on this host; actual speed also depends on agent startup and host load. The background task stays off the board, retains history and may trigger host notifications.",
    save: "Save title settings", saving: "Saving…", loading: "Loading…", retry: "Retry", refresh: "Refresh models", loadError: "Could not load title settings.",
    saveError: "Settings changed elsewhere or could not be saved. Reloaded the latest.",
    notRecommended: "Not recommended",
  },
  zh: {
    title: "自动更新标题", provider: "Provider", model: "模型", thinkingOptionId: "思考等级", modelDefault: "模型默认", noThinking: "不支持", choose: "请选择…", prompt: "prompt",
    hint: "推荐：Oh My Pi / DeepSeek Flash（deepseek/deepseek-flash），思考等级 low；备选：Claude / Haiku 5.5（claude-haiku-5-5），思考等级 off。\n建议在默认 prompt 末尾补充：Use the language of firstPrompt. Limit the title to 80 characters including spaces.\n请选择当前主机可用的模型；实际速度也受 agent 启动和主机负载影响。后台任务不进入看板，仍保留历史，并可能触发宿主通知。",
    save: "保存标题设置", saving: "正在保存…", loading: "正在加载…", retry: "重试", refresh: "刷新模型", loadError: "标题设置加载失败。",
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
    if (revision === null) return;
    let live = true;
    setLoading(true);
    setError(null);
    void Promise.resolve().then(() => loadCatalog({ provider: draft.provider })).then((result) => {
      if (!live) return;
      setCatalog({ providers: result.providers, models: result.models });
      setError(result.error);
    }).catch((failure: unknown) => {
      if (live) setError(failure instanceof Error ? failure.message : String(failure));
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [loadCatalog, draft.provider, revision !== null, refresh]);

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
  const canSave = draft.provider && draft.model && draft.prompt.trim() && !settings.saving;
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
        {(["provider", "model", "thinkingOptionId"] as const).map((field) => {
          const disabled = settings.saving || loading || (field === "model" && !draft.provider) || (field === "thinkingOptionId" && thinkingOptions.length === 0);
          const label = field === "provider" ? providers.find((provider) => provider.id === draft.provider)?.label
            : field === "model" ? models.find((model) => model.id === draft.model)?.label
              : draft.thinkingOptionId ? thinkingOptions.find((option) => option.id === draft.thinkingOptionId)?.label ?? draft.thinkingOptionId
                : thinkingOptions.length > 0 ? modelDefault : draft.model && selectedModel ? words.noThinking : words.choose;
          return <SettingRow key={field} title={words[field]} look={look} first={field === "provider"} control={
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
            <PlainButton label={error ? words.retry : words.refresh} disabled={loading} look={look} onPress={() => setRefresh((value) => value + 1)} />
            <PlainButton label={settings.saving ? words.saving : words.save} disabled={!canSave} look={look} onPress={() => void save()} />
          </View>
        </View>
      </Section>
      <SectionNote text={words.hint} look={look} />
      {choosing ? <Modal title={words[choosing]} open onOpenChange={(open) => { if (!open) setChoosing(null); }}>
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
