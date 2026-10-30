import React, { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import type { output as ZodOutput } from "zod";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { space } from "../../components/theme-tokens";
import { ProviderLogo, providerBrand } from "../../components/provider-logo";
import { TITLE_GENERATION_SETTINGS, titleGenerationSettingsSchema, titleModelsRpc } from "../../../shared/title-generation";
import { PlainButton, Section, SectionNote, SettingRow, Toggle, settingsTextStyle, type PageLook } from "../../settings-controls";
import { useTasksLanguage } from "../i18n";

const WORDS = {
  en: {
    afterFirstReply: "Update title after the first reply", afterFirstReplyHint: "When the AI finishes its first reply, generate a title from the conversation automatically.",
    disableThinking: "Disable title thinking", thinkingHint: "Use off or the lowest supported level. Otherwise follow the agent or custom level.", automaticThinking: "Off or lowest supported level",
    customModel: "Custom automatic title model", followSource: "Off: follow the card agent's provider, model and thinking level. Saved settings sync across this host's clients.",
    title: "Automatic titles", provider: "Provider", model: "Model", thinkingOptionId: "Thinking level", modelDefault: "Model default", noThinking: "Not supported", choose: "Choose…", prompt: "Prompt",
    hint: "Recommended: Oh My Pi / DeepSeek Flash (deepseek/deepseek-flash), thinking low; or Claude / Haiku 5.5 (claude-haiku-5-5), thinking off. Choose a model available on this host.\nTitle tasks stay off the board, retain history and may trigger host notifications.",
    resetTitle: "Reset automatic title settings", resetHint: "Only settings in this section will be restored.", reset: "Reset titles", resetNow: "Reset now", resetCancel: "Cancel", resetConfirmHint: "This restores only automatic title settings to their defaults.", loading: "Loading…", retry: "Retry", refresh: "Refresh models", loadError: "Could not load title settings.",
    saveError: "Settings changed elsewhere or could not be saved. Reloaded the latest.",
    notRecommended: "Not recommended",
  },
  zh: {
    afterFirstReply: "首轮回复后自动更新标题", afterFirstReplyHint: "AI 完成第一轮回复后，自动根据对话内容生成标题。",
    disableThinking: "关闭标题生成思考模式", thinkingHint: "关闭思考或使用最低支持等级；关闭此开关则跟随 agent 或自定义等级。", automaticThinking: "关闭或最低支持等级",
    customModel: "自定义自动标题模型", followSource: "关闭时跟随卡片所属 agent 的 Provider、模型和思考等级；保存后同步至主机各端。",
    title: "自动更新标题", provider: "Provider", model: "模型", thinkingOptionId: "思考等级", modelDefault: "模型默认", noThinking: "不支持", choose: "请选择…", prompt: "Prompt",
    hint: "推荐 Oh My Pi / DeepSeek Flash（deepseek/deepseek-flash），思考等级 low；或 Claude / Haiku 5.5（claude-haiku-5-5），思考等级 off。请选择主机可用的模型。\n后台任务不进入看板，保留历史，可能触发宿主通知。",
    resetTitle: "恢复「自动标题」默认设置", resetHint: "只恢复本组设置，不影响其他组。", reset: "恢复自动标题", resetNow: "确认重置", resetCancel: "取消", resetConfirmHint: "这只会把自动标题设置恢复为默认值。", loading: "正在加载…", retry: "重试", refresh: "刷新模型", loadError: "标题设置加载失败。",
    saveError: "设置已在别处更改或保存失败，已重新加载最新内容。",
    notRecommended: "不推荐使用",
  },
};

type TitleModels = ZodOutput<typeof titleModelsRpc.output>;
interface TitleCatalog {
  providers: string[];
  models: TitleModels["models"];
  loading: boolean;
  error: string | null;
}

const NO_CATALOG: TitleCatalog = { providers: [], models: [], loading: false, error: null };

// The host's model catalog for automatic titles, by provider: one snapshot
// per read's start, success and failure. Module-level state is connection-local
// because Paseo evaluates this client bundle once per serverId/pluginId.
const titleCatalogs = new Map<string, TitleCatalog>();
const titleCatalogReads = new Map<string, number>();
const titleCatalogListeners = new Set<() => void>();

function publishTitleCatalog(provider: string, next: TitleCatalog): void {
  titleCatalogs.set(provider, next);
  for (const listener of titleCatalogListeners) listener();
}

function subscribeTitleCatalogs(listener: () => void): () => void {
  titleCatalogListeners.add(listener);
  return () => { titleCatalogListeners.delete(listener); };
}

/** Reads the catalog again; resolves with the result when it is still the latest read, else null. */
function readTitleCatalog(provider: string, load: () => Promise<TitleModels>): Promise<TitleModels | null> {
  const ticket = (titleCatalogReads.get(provider) ?? 0) + 1;
  titleCatalogReads.set(provider, ticket);
  const latest = () => titleCatalogReads.get(provider) === ticket;
  publishTitleCatalog(provider, { ...(titleCatalogs.get(provider) ?? NO_CATALOG), loading: true, error: null });
  return Promise.resolve().then(load).then((result) => {
    if (!latest()) return null;
    publishTitleCatalog(provider, { providers: result.providers, models: result.models, loading: false, error: result.error });
    return result;
  }, (failure: unknown) => {
    if (latest()) publishTitleCatalog(provider, { ...(titleCatalogs.get(provider) ?? NO_CATALOG), loading: false, error: failure instanceof Error ? failure.message : String(failure) });
    return null;
  });
}

/** Test seam: forget every catalog. */
export function resetTitleCatalogs(): void {
  titleCatalogs.clear();
  titleCatalogReads.clear();
}

export function TitleGenerationSettings({ look }: { look: PageLook }) {
  const words = WORDS[useTasksLanguage()];
  const settings = useSettings(TITLE_GENERATION_SETTINGS);
  const loadCatalog = useRpc(titleModelsRpc);
  const [draft, setDraft] = useState(() => settings.status === "ready" ? settings.values : titleGenerationSettingsSchema.parse({}));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [choosing, setChoosing] = useState<"provider" | "model" | "thinkingOptionId" | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const revision = settings.status === "ready" ? settings.revision : null;
  const catalogShown = revision !== null && draft.customModel;
  const readCatalog = useCallback(() => (catalogShown ? titleCatalogs.get(draft.provider) ?? NO_CATALOG : NO_CATALOG), [catalogShown, draft.provider]);
  const catalog = useSyncExternalStore(subscribeTitleCatalogs, readCatalog, readCatalog);
  const { loading, error } = catalog;
  useEffect(() => {
    if (settings.status === "ready") setDraft(settings.values);
  }, [revision]);
  useEffect(() => {
    if (settings.status !== "ready" || settings.saving || confirmingReset || (draft.customModel && (!draft.provider || !draft.model)) || !draft.prompt.trim() || JSON.stringify(draft) === JSON.stringify(settings.values)) return;
    const timer = setTimeout(() => {
      setSaveError(null);
      void settings.save(draft, settings.revision).then(async (saved) => {
        if (saved) return;
        await settings.reload();
        setSaveError(words.saveError);
      }).catch((failure: unknown) => {
        setSaveError(failure instanceof Error ? failure.message : String(failure));
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, revision, settings.status, settings.saving, confirmingReset]);
  useEffect(() => {
    if (!catalogShown) return;
    let live = true;
    const provider = draft.provider;
    void readTitleCatalog(provider, () => loadCatalog({ provider })).then((result) => {
      if (!live || !result || result.error) return;
      const firstProvider = [...result.providers].sort((a, b) => Number(a === "cursor") - Number(b === "cursor"))[0];
      const firstModel = result.models[0];
      setDraft((current) => {
        if (!current.customModel || current.provider !== provider) return current;
        if (!current.provider && firstProvider) return { ...current, provider: firstProvider, model: "", thinkingOptionId: "" };
        if (current.provider && !current.model && firstModel) return { ...current, model: firstModel.id, thinkingOptionId: "" };
        return current;
      });
    });
    return () => { live = false; };
  }, [loadCatalog, catalogShown, draft.provider, refresh]);

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
        <SettingRow title={words.afterFirstReply} description={words.afterFirstReplyHint} look={look} first disabled={settings.saving} control={
          <Toggle value={draft.afterFirstReply} label={words.afterFirstReply} look={look} onChange={(afterFirstReply) => setDraft({ ...draft, afterFirstReply })} />
        } />
        <SettingRow title={words.customModel} description={words.followSource} look={look} disabled={settings.saving} control={
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
          return <SettingRow key={field} title={words[field]} look={look} control={<View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {field === "model" ? <Pressable accessibilityRole="button" accessibilityLabel={words.refresh} accessibilityState={{ disabled: loading }} disabled={loading} onPress={() => setRefresh((value) => value + 1)} style={{ width: 40, height: 44, alignItems: "center", justifyContent: "center", opacity: loading ? 0.5 : 1 }}><Icon name="RefreshCw" size={18} color={look.tokens.foregroundMuted} /></Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={words[field]} accessibilityState={{ expanded: choosing === field, disabled }}
              disabled={disabled} onPress={() => setChoosing(field)}
              style={{ minHeight: 44, maxWidth: "100%", flexShrink: 1, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.sm, borderWidth: 1, borderRadius: 8, borderColor: look.tokens.v2.border, opacity: disabled ? 0.5 : 1 }}>
              {field === "provider" && draft.provider ? <ProviderLogo provider={draft.provider} size={18} color={providerBrand(draft.provider).monochrome ? look.tokens.foreground : undefined} /> : null}
              <Text numberOfLines={1} style={[textStyle, { flexShrink: 1 }]}>{label || words.choose}</Text>
              <Icon name="ChevronDown" size={16} color={look.tokens.foregroundMuted} />
            </Pressable></View>
          } />;
        })}
        <SettingRow title={words.prompt} look={look} below={
          <TextInput testID="title-generation-prompt" accessibilityLabel={words.prompt} multiline value={draft.prompt}
            editable={!settings.saving} maxLength={8000} onChangeText={(prompt) => setDraft({ ...draft, prompt })}
            style={[textStyle, { width: "100%", minHeight: 130, borderWidth: 1, borderRadius: 8, borderColor: look.tokens.v2.border, backgroundColor: look.tokens.v2.surface0, padding: space.md, textAlignVertical: "top" }]} />
        } />
        <SettingRow title={words.resetTitle} description={confirmingReset ? words.resetConfirmHint : words.resetHint} look={look} control={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {confirmingReset ? <PlainButton label={words.resetCancel} look={look} onPress={() => setConfirmingReset(false)} /> : null}
            <PlainButton
              label={confirmingReset ? words.resetNow : words.reset}
              accessibilityLabel={confirmingReset ? words.resetNow : words.reset}
              disabled={settings.saving}
              look={look}
              onPress={() => {
                if (!confirmingReset) return setConfirmingReset(true);
                void reset().finally(() => setConfirmingReset(false));
              }}
            />
          </View> } />
        {error || saveError || settings.saveError ? <Text accessibilityRole="alert" style={[textStyle, { color: look.tokens.warning, padding: space.lg }]}>{error || saveError || settings.saveError}</Text> : null}
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
