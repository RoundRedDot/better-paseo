import React, { useContext, useMemo, useState, type ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useMarkBitmap } from "../components/marks";
import type { PluginIcon } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/ui";
import { usePaseo } from "@getpaseo/plugin/client";
import { openTranslationSettings, TranslationSettingsParentCloseContext } from "./navigation";
import { SyncedLoader } from "../ui/synced-loader";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { MarkdownView } from "../components/markdown/markdown-view";
import { lexBlockTokens } from "../components/markdown/lex";
import { ResizedToolbarDetailsContext, ToolbarButton, ToolbarCopyButton, ToolbarItem, ToolbarMetricsContext, TooltipAlignContext, TooltipSideContext } from "../ui/toolbar-button";
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

export const SHOW_ORIGINAL_ICON: PluginIcon = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 7.5V5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M6.5 7h6"/><path d="M6.5 10.5h5"/><path d="M6.5 14h3.5"/><path d="m12 21 4.5-10 4.5 10"/><path d="M13.5 18h6"/></svg>',
};

/**
 * Marks content as belonging to one conversation, so a selection in it can
 * be translated. On web it also lends the selection bar
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
export function TranslationSheet({ close, children }: { close(): void; children: ReactNode }) {
  const closeParent = useContext(TranslationSettingsParentCloseContext);
  const { language } = useEnhancerPreferences();
  return <Modal title={toolbarLabel("Translate", language)} open onOpenChange={(open) => { if (!open) close(); }}>
    <Modal.Content scrollable={false} contentContainerStyle={{ flex: 1, minHeight: 0, padding: 0, gap: 0 }}>
      <TranslationSettingsParentCloseContext.Provider value={closeParent}>{children}</TranslationSettingsParentCloseContext.Provider>
    </Modal.Content>
  </Modal>;
}

export function SelectionTranslationPanel({ view, original, tokens, onRetry, onClose, sheet = false }: {
  view: SelectionTranslationView;
  original: string;
  tokens: ExtendedThemeTokens;
  onRetry(): void;
  onClose(): void;
  sheet?: boolean;
}) {
  const { language } = useEnhancerPreferences();
  const paseo = usePaseo();
  const resized = useContext(ResizedToolbarDetailsContext);
  const closeParent = useContext(TranslationSettingsParentCloseContext);
  const lang = resolveLanguage(language ?? "system");
  const window = useWindowDimensions();
  const [showingOriginal, setShowingOriginal] = useState(false);
  const text = showingOriginal && view.status === "done" ? original : selectionViewText(view);
  const message = text ? null : selectionViewMessage(view);
  const danger = tokens.danger ?? tokens.foreground;
  const muted = tokens.foregroundSubtle ?? tokens.foregroundMuted;
  const running = view.status === "running" || view.status === "settings-loading";
  return (
    <View testID="selection-translation-panel" style={[styles.panel, (resized || sheet) && { flex: 1, minHeight: 0 }]}>
      <View testID="translation-header" style={styles.header}>
        <View style={{ flex: 1 }} />
        <ToolbarMetricsContext.Provider value={TRANSLATION_TOOLBAR_METRICS}>
          <TooltipAlignContext.Provider value="end">
            {view.status === "done" ? <ToolbarItem label={showingOriginal ? "Show translation" : "Show original"} onPress={() => setShowingOriginal(!showingOriginal)} tokens={tokens} hitSlop={8}>
              <Icon icon={showingOriginal ? TRANSLATE_ICON : SHOW_ORIGINAL_ICON} size={16} color={tokens.foregroundMuted} />
            </ToolbarItem> : null}
            <ToolbarItem label="Translation settings" onPress={() => {
              onClose();
              if (!closeParent) { openTranslationSettings(paseo); return; }
              closeParent();
              requestAnimationFrame(() => openTranslationSettings(paseo));
            }} tokens={tokens} hitSlop={8}>
              <Icon name="Settings" size={16} color={tokens.foregroundMuted} />
            </ToolbarItem>
          </TooltipAlignContext.Provider>
        </ToolbarMetricsContext.Provider>
      </View>
      <View testID="translation-header-divider" style={[styles.divider, { backgroundColor: tokens.v2.border }]} />
      {message ? (
        <View style={styles.messageRow}>
          {running ? <SyncedLoader color={tokens.foreground} gridTestID="translation-loading" /> : null}
          <Text testID="selection-translation-message" selectable={false}
            style={[styles.message, { color: view.status === "error" ? danger : muted, fontFamily: tokens.fontUi }]}>
            {toolbarLabel(message, lang)}{view.status === "error" ? `: ${view.error}` : ""}
          </Text>
        </View>
      ) : null}
      {text ? (
        <ScrollView testID="selection-translation-body" nestedScrollEnabled
          style={resized || sheet ? { flex: 1, minHeight: 0 } : { maxHeight: Math.max(120, Math.round(window.height * 0.45)) }}>
          <SelectionTranslationContext.Provider value={null}>
            <MarkdownView text={sheet ? withoutLeadingRule(text) : text} tokens={tokens} variant="compact" compact blockSelection={false} streaming={view.status === "running"} />
          </SelectionTranslationContext.Provider>
        </ScrollView>
      ) : null}
      <View testID="translation-footer" style={styles.actions}>
        <View testID="translation-footer-info" style={styles.headerInfo}>
          <Icon icon={TRANSLATE_ICON} size={12} color={muted} />
          <Text testID="translation-language" selectable={false} numberOfLines={1}
            style={[styles.title, { color: muted, fontFamily: tokens.fontUi }]}>
            {selectionViewTitle(view, lang)}
          </Text>
          {view.modelInfo ? <View style={styles.model}>
            {view.modelInfo.mark ? <ModelMark id={view.modelInfo.mark} /> : null}
            <Text testID="translation-model" numberOfLines={1} selectable={false} style={[styles.title, { color: muted, fontFamily: tokens.fontUi }]}>
              {view.modelInfo.model}
            </Text>
          </View> : <View style={{ flex: 1 }} />}
        </View>
        {view.status === "done" || selectionViewRetryable(view) ? (
        <View style={styles.actionButtons}>
          <ToolbarMetricsContext.Provider value={TRANSLATION_TOOLBAR_METRICS}>
            <TooltipSideContext.Provider value="above"><TooltipAlignContext.Provider value="end">
            {view.status === "done" ? (
              <ToolbarCopyButton text={text!} tokens={tokens} label={showingOriginal ? "Copy original" : "Copy translation"} />
            ) : null}
            {selectionViewRetryable(view) ? (
              <ToolbarButton icon="RefreshCw" label="Retry" onPress={() => { setShowingOriginal(false); onRetry(); }} tokens={tokens} />
            ) : null}
            </TooltipAlignContext.Provider></TooltipSideContext.Provider>
          </ToolbarMetricsContext.Provider>
        </View>
        ) : null}
      </View>
    </View>
  );
}

const TRANSLATION_TOOLBAR_METRICS = { button: 28, icon: 16 };

function withoutLeadingRule(text: string) {
  const firstLine = text.match(/^(?:[ \t]*\r?\n)*[^\r\n]*(?:\r?\n|$)/)?.[0] ?? "";
  if (!lexBlockTokens(firstLine, false).some((token) => token.type === "hr")) return text;
  return text.slice(firstLine.length).replace(/^(?:[ \t]*\r?\n)*/, "");
}

/** The translator's greyscale logo; faded so it sits at the weight of the muted text beside it. */
function ModelMark({ id }: { id: string }) {
  const uri = useMarkBitmap(id);
  return <View testID="translation-model-mark" style={styles.modelMark}>
    {uri ? <Image accessible={false} source={{ uri }} resizeMode="contain" style={[styles.modelMark, { opacity: 0.7 }]} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  header: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, zIndex: 1 },
  headerInfo: { height: 24, flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  divider: { height: 0.5, marginHorizontal: -12 },
  title: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: "500", includeFontPadding: false, textAlignVertical: "center" },
  model: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: 4, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  modelMark: { width: 12, height: 12, flexShrink: 0 },
  messageRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  message: { flexShrink: 1, fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionButtons: { flexDirection: "row", alignItems: "center", gap: 6 },
});
