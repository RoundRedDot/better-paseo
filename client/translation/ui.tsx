import React, { useMemo, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { PluginIcon } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { usePaseo } from "@getpaseo/plugin/client";
import { ProviderLogo, providerBrand } from "../components/provider-logo";
import { openTranslationSettings } from "./navigation";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { MarkdownView } from "../components/markdown/markdown-view";
import { ToolbarCopyButton } from "../ui/toolbar-button";
import { useEnhancerPreferences } from "../preferences";
import { resolveLanguage } from "../i18n/settings-strings";
import { toolbarLabel } from "../i18n/toolbar-strings";
import type { TranslationSourceKind } from "./store";
import {
  SelectionTranslationContext,
  selectionViewMessage,
  selectionViewRetryable,
  selectionViewText,
  useLentTranslator,
  type SelectionTranslationView,
} from "./selection";
import { selectionViewTitle } from "./view-text";

export { selectionViewTitle } from "./view-text";

export const TRANSLATE_ICON: PluginIcon = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
};

/**
 * Marks the prose inside as one conversation's reply or thought, so a
 * selection in it can be translated. On web it also lends the selection bar
 * this tree's translator, bound to the prose's own element. A disabled scope removes the marking, for content in
 * the same row that is not the model's words (a system card).
 */
export function SelectionTranslationScope({ agentId, kind, streaming, enabled = true, children }: {
  agentId: string;
  kind: TranslationSourceKind;
  streaming: boolean;
  enabled?: boolean;
  children: ReactNode;
}) {
  const lent = useLentTranslator(enabled);
  const value = useMemo(
    () => enabled ? { agentId, kind, streaming, ...(lent ? { lent } : null) } : null,
    [agentId, kind, streaming, enabled, lent],
  );
  return <SelectionTranslationContext.Provider value={value}>{children}</SelectionTranslationContext.Provider>;
}

/**
 * A native selection menu's translation: status, the translation as it
 * streams, Copy and Retry. The body scrolls within a
 * height bounded by the window. Prose in it is not itself translatable.
 */
export function SelectionTranslationPanel({ view, tokens, onRetry, onClose }: {
  view: SelectionTranslationView;
  tokens: ExtendedThemeTokens;
  onRetry(): void;
  onClose(): void;
}) {
  const { language } = useEnhancerPreferences();
  const paseo = usePaseo();
  const lang = resolveLanguage(language ?? "system");
  const window = useWindowDimensions();
  const message = selectionViewMessage(view);
  const text = selectionViewText(view);
  const danger = tokens.danger ?? tokens.foreground;
  const muted = tokens.foregroundSubtle ?? tokens.foregroundMuted;
  const running = view.status === "running" || view.status === "config-loading" || view.status === "settings-loading";
  return (
    <View testID="selection-translation-panel" style={styles.panel}>
      <View style={styles.header}>
        <Icon icon={TRANSLATE_ICON} size={13} color={view.status === "error" ? danger : tokens.accent} />
        <Text selectable={false} numberOfLines={1}
          style={[styles.title, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {selectionViewTitle(view, lang)}
        </Text>
        {running ? <ActivityIndicator size="small" color={tokens.accent} /> : null}
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Translation settings" onPress={() => { onClose(); openTranslationSettings(paseo); }} hitSlop={8}>
          <Icon name="Settings" size={16} color={tokens.foregroundMuted} />
        </Pressable>
      </View>
      {view.modelInfo ? <View style={styles.model}>
        <ProviderLogo provider={view.modelInfo.provider} size={14} neutralColor={tokens.foregroundMuted} />
        <Text testID="translation-model" numberOfLines={1} selectable={false} style={[styles.title, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
          {providerBrand(view.modelInfo.provider).displayName} · {view.modelInfo.model}
        </Text>
      </View> : null}
      {message ? (
        <Text testID="selection-translation-message" selectable={false}
          style={[styles.message, { color: view.status === "error" ? danger : muted, fontFamily: tokens.fontUi }]}>
          {toolbarLabel(message, lang)}{view.status === "error" ? `: ${view.error}` : ""}
        </Text>
      ) : null}
      {text ? (
        <ScrollView testID="selection-translation-body" nestedScrollEnabled
          style={{ maxHeight: Math.max(120, Math.round(window.height * 0.45)) }}>
          <SelectionTranslationContext.Provider value={null}>
            <MarkdownView text={text} tokens={tokens} variant="compact" compact streaming={view.status === "running"} />
          </SelectionTranslationContext.Provider>
        </ScrollView>
      ) : null}
      {view.status === "done" || selectionViewRetryable(view) ? (
        <View style={styles.actions}>
          {view.status === "done" ? (
            <ToolbarCopyButton text={view.result.translation} tokens={tokens} label="Copy translation" />
          ) : null}
          {selectionViewRetryable(view) ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Retry" onPress={onRetry} hitSlop={6}
              style={styles.textAction}>
              <Text selectable={false} style={[styles.actionText, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>
                {toolbarLabel("Retry", lang)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: "500" },
  model: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  message: { fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 },
  textAction: { paddingHorizontal: 6, paddingVertical: 4 },
  actionText: { fontSize: 12.5, lineHeight: 16, fontWeight: "500" },
});
