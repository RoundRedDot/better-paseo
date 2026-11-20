import React from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ModelCatalog } from "../shared/model-catalog";
import { ProviderLogo, providerBrand } from "./components/provider-logo";
import { space } from "./components/theme-tokens";
import { ChoiceMenuSelect, type MenuChoice } from "./settings-choice-menu";
import { SettingRow, type PageLook } from "./settings-controls";

const WORDS = {
  en: { provider: "Provider", model: "Model", thinking: "Thinking level", choose: "Choose…", modelDefault: "Model default", unsupported: "Not supported", refresh: "Refresh models", notRecommended: "Not recommended" },
  zh: { provider: "Provider", model: "模型", thinking: "思考等级", choose: "请选择…", modelDefault: "模型默认", unsupported: "不支持", refresh: "刷新模型", notRecommended: "不推荐使用" },
};

export function ModelSettingsControls({ look, language, provider, model, thinkingOptionId, disableThinking, disabledThinkingLabel, disabled, loading, providers, providerLabels, models, onProvider, onModel, onThinking, onRefresh }: {
  look: PageLook; language: "en" | "zh"; provider: string; model: string; thinkingOptionId: string;
  disableThinking: boolean; disabledThinkingLabel: string; disabled: boolean; loading: boolean;
  providers: string[]; providerLabels: Record<string, string>; models: ModelCatalog["models"];
  onProvider(value: string): void; onModel(value: string): void; onThinking(value: string): void; onRefresh(): void;
}) {
  const words = WORDS[language];
  const providerChoices: MenuChoice[] = [...new Set([...providers, ...(provider ? [provider] : [])])]
    .sort((a, b) => Number(a === "cursor") - Number(b === "cursor"))
    .map((id) => ({ value: id, name: `${providerLabels[id] || providerBrand(id).displayName}${id === "cursor" ? ` · ${words.notRecommended}` : ""}`,
      logo: <ProviderLogo provider={id} size={20} color={providerBrand(id).monochrome ? look.tokens.foreground : undefined} /> }));
  const selectedModel = models.find((item) => item.id === model);
  const modelChoices: MenuChoice[] = models.map((item) => ({ value: item.id, name: item.label || item.id, logo: null }));
  if (model && !selectedModel) modelChoices.push({ value: model, name: model, logo: null });
  const options = selectedModel?.thinkingOptions ?? [];
  const modelDefault = `${words.modelDefault}${selectedModel?.defaultThinkingOptionId ? ` · ${selectedModel.defaultThinkingOptionId}` : ""}`;
  const thinkingChoices: MenuChoice[] = [{ value: "", name: modelDefault, logo: null }, ...options.map((item) => ({ value: item.id, name: item.label, logo: null }))];
  const chosenThinking = thinkingChoices.find((item) => item.value === thinkingOptionId);
  const thinkingLabel = disableThinking ? disabledThinkingLabel
    : selectedModel && !options.length ? words.unsupported
      : chosenThinking?.name ?? (thinkingOptionId || words.choose);
  const blocked = disabled || loading;
  const refreshSize = look.compact ? 44 : 32;
  const menu = (label: string, value: string, selected: MenuChoice | null, choices: MenuChoice[], onChange: (value: string) => void, unavailable = false) =>
    <ChoiceMenuSelect label={label} value={value} selected={selected} choices={choices} onChange={onChange} look={look}
      disabled={blocked || unavailable}
    />;
  return <>
    <SettingRow title={words.provider} look={look} wrapControl disabled={disabled} control={menu(words.provider, provider, providerChoices.find((item) => item.value === provider) ?? { value: "", name: words.choose, logo: null }, providerChoices, onProvider)} />
    <SettingRow title={words.model} look={look} wrapControl disabled={disabled} control={<View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: space.sm, maxWidth: "100%" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={words.refresh} accessibilityState={{ disabled: blocked }} disabled={blocked} onPress={onRefresh} style={{ width: refreshSize, height: refreshSize, alignItems: "center", justifyContent: "center", opacity: blocked ? 0.5 : 1 }}><Icon name="RefreshCw" size={18} color={look.tokens.foregroundMuted} /></Pressable>
      {menu(words.model, model, modelChoices.find((item) => item.value === model) ?? { value: "", name: words.choose, logo: null }, modelChoices, (next) => { if (next !== model) onModel(next); }, !provider)}
    </View>} />
    <SettingRow title={words.thinking} look={look} wrapControl disabled={disabled} control={menu(words.thinking, thinkingOptionId, { value: thinkingOptionId, name: thinkingLabel, logo: null }, thinkingChoices, onThinking, disableThinking || !options.length)} />
  </>;
}
