import React, { useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { usePaseo } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { radiusV2, useThemeTokens, type ExtendedThemeTokens } from "../components/theme-tokens";
import { ToolbarItem, ToolbarMetricsContext, TOOLBAR_METRICS, TooltipSideContext } from "../ui/toolbar-button";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import { useEnhancerPreferences } from "../preferences";
import { selectionViewLoading, selectionViewMessage, selectionViewRetryable, createSelectionTranslation, type SelectionTranslationView } from "./selection";
import { useTranslationSettingsState } from "./settings-store";
import { useTranslateCaller, type TranslationSourceKind } from "./store";
import { SHOW_ORIGINAL_ICON, TRANSLATE_ICON } from "./ui";
import { useHover } from "../ui/use-hover";
import { hoverFill } from "../tasks/hover-fill";
import { tipProps } from "../tasks/cards/card-hints";
import { SpinnerRing } from "../tasks/cards/status-icon";

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
  const translation = useMemo(() => createSelectionTranslation({ agentId, kind, text, streaming, waitForStreaming: true, translator: caller,
    host: paseo ?? undefined }), [agentId, kind, text, paseo]);
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
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences);
  return <InlineTranslateButtonWithTokens state={state} tokens={tokens} testID={testID} base={base} timeline={timeline} />;
}

export function InlineTranslateButtonWithTokens({ state, tokens, testID, base, timeline = false }: { state: InlineTranslationState; tokens: ExtendedThemeTokens; testID: string; base?: string; timeline?: boolean }) {
  const settings = useTranslationSettingsState();
  const preferences = useEnhancerPreferences();
  const { hovered, hoverProps } = useHover();
  const toolbar = useContext(ToolbarMetricsContext);
  const iconSize = timeline ? toolbar.icon : TOOLBAR_METRICS.icon;
  if (settings.status === "ready" && !settings.values.enabled) return null;
  // While the translation is shown, the button restores the original, and its
  // glyph says so; otherwise it translates (or retries) with the translate mark.
  const showingTranslation = state.active && state.view?.status === "done";
  const loading = state.active && selectionViewLoading(state.view);
  const label = showingTranslation ? (resolveLanguage(preferences.language ?? "system") === "zh" ? "显示原文" : "Show original") : state.active && state.view && selectionViewRetryable(state.view) ? toolbarLabel("Retry", preferences.language) : toolbarLabel("Translate", preferences.language);
  const icon = loading
    ? <SpinnerRing size={iconSize} markSize={iconSize} color={tokens.foregroundMuted} testID={`${testID}-spinner`} />
    : showingTranslation
      ? <Icon icon={SHOW_ORIGINAL_ICON} size={iconSize} color={tokens.foregroundMuted} />
      : <Icon icon={TRANSLATE_ICON} size={iconSize} color={tokens.foregroundMuted} />;
  if (timeline) return <View style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}><TooltipSideContext.Provider value="auto"><ToolbarItem testID={testID} label={label} tokens={tokens} align="end"
    buttonStyle={{ width: 24, height: 24, borderRadius: radiusV2.block }}
    onPress={(event) => { event.stopPropagation(); state.toggle(); }}>
    <View pointerEvents="none" testID={`${testID}-fill`}>{icon}</View>
  </ToolbarItem></TooltipSideContext.Provider></View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} hitSlop={6} {...tipProps(label)} {...hoverProps}
    onPress={(event) => { event.stopPropagation(); state.toggle(); }}
    style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
    {({ pressed }) => <View pointerEvents="none" testID={`${testID}-fill`} style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: hoverFill(base ?? tokens.surface0, tokens.foreground, hovered, pressed, "transparent") }}>{icon}</View>}
  </Pressable>;
}

export function InlineTranslationNotice({ state, theme }: { state: InlineTranslationState; theme: PluginTheme }) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences);
  return <InlineTranslationNoticeWithTokens state={state} tokens={tokens} />;
}

export function InlineTranslationNoticeWithTokens({ state, tokens }: { state: InlineTranslationState; tokens: ExtendedThemeTokens }) {
  const preferences = useEnhancerPreferences();
  if (!state.active || !state.view || selectionViewLoading(state.view)) return null;
  const message = selectionViewMessage(state.view);
  if (!message) return null;
  return <View style={{ paddingHorizontal: 6, paddingTop: 4, flexDirection: "row", alignItems: "center", gap: 6 }}><Text testID="inline-translation-status" style={{ color: tokens.foregroundMuted, fontSize: 12 }}>{toolbarLabel(message, preferences.language)}{state.view.status === "error" ? `: ${state.view.error}` : ""}</Text></View>;
}

