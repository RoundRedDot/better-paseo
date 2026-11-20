import React, { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { radiusV2, useThemeTokens } from "../components/theme-tokens";
import { ToolbarItem, TooltipSideContext } from "../ui/toolbar-button";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import { useEnhancerPreferences } from "../preferences";
import { selectionViewMessage, selectionViewRetryable, createSelectionTranslation, type SelectionTranslationView } from "./selection";
import { useTranslationSettingsState } from "./settings-store";
import { translationAgentConfigStoreFor, useTranslateCaller, type TranslationSourceKind } from "./store";
import { TRANSLATE_ICON } from "./ui";
import { useHover } from "../ui/use-hover";
import { hoverFill } from "../tasks/hover-fill";
import { iconHoverSize } from "../ui/icon-hover-size";
import { SyncedLoader } from "../ui/synced-loader";
import { tipProps } from "../tasks/cards/card-hints";

export type InlineTranslationState = { view: SelectionTranslationView | null; active: boolean; toggle(): void };

export function InlineTranslation({ agentId, kind, text, streaming, children }: {
  agentId: string; kind: TranslationSourceKind; text: string; streaming: boolean;
  children(state: InlineTranslationState): ReactNode;
}) {
  return <InlineTranslationSession agentId={agentId} kind={kind} text={text} streaming={streaming}>{children}</InlineTranslationSession>;
}

function InlineTranslationSession({ agentId, kind, text, streaming, children }: {
  agentId: string; kind: TranslationSourceKind; text: string; streaming: boolean;
  children(state: InlineTranslationState): ReactNode;
}) {
  const caller = useTranslateCaller();
  const paseo = usePaseo();
  const translation = useMemo(() => createSelectionTranslation({ agentId, kind, text, streaming, translator: caller,
    configStore: paseo ? translationAgentConfigStoreFor(paseo) : undefined, host: paseo ?? undefined }), [agentId, kind, text, paseo]);
  useEffect(() => { translation.setStreaming(streaming); }, [translation, streaming]);
  useEffect(() => { translation.setTranslator(caller); }, [translation, caller]);
  useEffect(() => () => translation.dispose(), [translation]);
  const view = useSyncExternalStore(translation.subscribe, translation.view, translation.view);
  const [choice, setChoice] = useState({ translation, active: false });
  const active = choice.translation === translation && choice.active;
  const setActive = (active: boolean) => setChoice({ translation, active });
  const start = translation.start;
  const toggle = () => {
    if (!active) { setActive(true); if (view?.status !== "done") start(); return; }
    if (view && selectionViewRetryable(view) && view.status !== "done") { start(); return; }
    setActive(false);
  };
  return <>{children({ view, active, toggle })}</>;
}

export function InlineTranslateButton({ state, theme, testID, base, timeline = false }: { state: InlineTranslationState; theme: PluginTheme; testID: string; base?: string; timeline?: boolean }) {
  const settings = useTranslationSettingsState();
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences);
  const { hovered, hoverProps } = useHover();
  if (settings.status === "ready" && !settings.values.enabled) return null;
  // While the translation is shown, the button restores the original, and its
  // glyph says so; otherwise it translates (or retries) with the translate mark.
  const showingTranslation = state.active && state.view?.status === "done";
  const label = showingTranslation ? (resolveLanguage(preferences.language ?? "system") === "zh" ? "显示原文" : "Show original") : state.active && state.view && selectionViewRetryable(state.view) ? toolbarLabel("Retry", preferences.language) : toolbarLabel("Translate", preferences.language);
  if (timeline) return <TooltipSideContext.Provider value="auto"><ToolbarItem testID={testID} label={label} tokens={tokens} align="end"
    buttonStyle={{ width: 32, height: 32, borderRadius: radiusV2.block }}
    onPress={(event) => { event.stopPropagation(); state.toggle(); }}>
    <View pointerEvents="none" testID={`${testID}-fill`}>{showingTranslation
      ? <Icon name="Undo2" size={14} color={tokens.foregroundMuted} />
      : <Icon icon={TRANSLATE_ICON} size={14} color={tokens.foregroundMuted} />}</View>
  </ToolbarItem></TooltipSideContext.Provider>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={4} {...tipProps(label)} {...hoverProps}
    onPress={(event) => { event.stopPropagation(); state.toggle(); }}
    style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
    {({ pressed }) => <View pointerEvents="none" testID={`${testID}-fill`} style={{ width: iconHoverSize(14), height: iconHoverSize(14), borderRadius: iconHoverSize(14) / 2, alignItems: "center", justifyContent: "center", backgroundColor: hoverFill(base ?? tokens.surface0, tokens.foreground, hovered, pressed, "transparent") }}>{showingTranslation
      ? <Icon name="Undo2" size={14} color={tokens.foregroundMuted} />
      : <Icon icon={TRANSLATE_ICON} size={14} color={tokens.foregroundMuted} />}</View>}
  </Pressable>;
}

export function InlineTranslationNotice({ state, theme, showLoader = true }: { state: InlineTranslationState; theme: PluginTheme; showLoader?: boolean }) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences);
  if (!state.active || !state.view) return null;
  const message = selectionViewMessage(state.view);
  if (!message) return null;
  return <View style={{ paddingHorizontal: 6, paddingTop: 4, flexDirection: "row", alignItems: "center", gap: 6 }}>{showLoader && ["running", "settings-loading", "config-loading"].includes(state.view.status) ? <SyncedLoader color={tokens.foregroundMuted} gridTestID="inline-translation-loading" /> : null}<Text testID="inline-translation-status" style={{ color: tokens.foregroundMuted, fontSize: 12 }}>{toolbarLabel(message, preferences.language)}{state.view.status === "error" ? `: ${state.view.error}` : ""}</Text></View>;
}

