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
    title: "Automatic titles", provider: "Provider", model: "Model", choose: "Choose…", prompt: "prompt",
    hint: "Choose a fast model configured on this host. The background task stays off the board, retains history and may trigger host notifications.",
    save: "Save title settings", saving: "Saving…", loading: "Loading…", retry: "Retry", refresh: "Refresh models", loadError: "Could not load title settings.",
    saveError: "Settings changed elsewhere or could not be saved. Reloaded the latest.",
    notRecommended: "Not recommended",
  },
  zh: {
    title: "自动更新标题", provider: "Provider", model: "模型", choose: "请选择…", prompt: "prompt",
    hint: "选择这台主机已配置的快速模型。后台任务不进入看板，仍保留历史，并可能触发宿主通知。",
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
  const [catalog, setCatalog] = useState<{ providers: string[]; models: Array<{ id: string; label: string }> }>({ providers: [], models: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [choosing, setChoosing] = useState<"provider" | "model" | null>(null);
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
  const choices = choosing === "provider" ? providers : models;
  return (
    <View style={{ gap: space.sm }}>
      <Section title={words.title} look={look}>
        {(["provider", "model"] as const).map((field) => {
          const disabled = settings.saving || loading || (field === "model" && !draft.provider);
          const label = field === "provider" ? providers.find((provider) => provider.id === draft.provider)?.label : models.find((model) => model.id === draft.model)?.label;
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
                setDraft(choosing === "provider" ? { ...draft, provider: choice.id, model: choice.id === draft.provider ? draft.model : "" } : { ...draft, model: choice.id });
                setChoosing(null);
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
