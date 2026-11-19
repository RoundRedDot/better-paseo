import React, { useCallback, useContext, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { PluginIcon } from "@getpaseo/plugin/client";
import { findTranslationLanguage, resolveTranslationTarget } from "../../shared/translation-languages";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2 } from "../components/theme-tokens";
import { MarkdownView, type MarkdownVariant } from "../components/markdown/markdown-view";
import { ToolbarCopyButton, ToolbarHoverColorContext, ToolbarItem, TooltipSideContext } from "../ui/toolbar-button";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { useEnhancerPreferences } from "../preferences";
import { resolveLanguage, type SettingsLanguagePreference } from "../i18n/settings-strings";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { useTranslationSettingsState } from "./settings-store";
import {
  resolveAssistantSource,
  resolveReasoningSource,
  translationStore,
  useTranslateCaller,
  useTranslationEntry,
  type AssistantSourceInput,
  type TranslationEntry,
  type TranslationSourceKind,
} from "./store";

export const TRANSLATE_ICON: PluginIcon = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
};

function safeColors(tokens: ExtendedThemeTokens) {
  const anyTokens = tokens as ExtendedThemeTokens & {
    v2?: Partial<ExtendedThemeTokens["v2"]>;
    surface2?: string;
    border?: string;
    accent?: string;
    danger?: string;
  };
  return {
    hover: anyTokens.v2?.surface2 ?? anyTokens.surface2 ?? "transparent",
    surface: anyTokens.v2?.surface2 ?? anyTokens.surface2 ?? "transparent",
    border: anyTokens.v2?.border ?? anyTokens.border ?? "rgba(128,128,128,0.25)",
    accent: anyTokens.accent ?? anyTokens.foreground,
    danger: anyTokens.danger ?? anyTokens.foreground,
  };
}

function getInterfaceLanguage(languagePreference: SettingsLanguagePreference | undefined): "en" | "zh" {
  return resolveLanguage(languagePreference ?? "system");
}

export interface TranslationController {
  enabled: boolean;
  settingsStatus: "loading" | "ready" | "invalid" | "error";
  settingsError: string | null;
  sourceAvailable: boolean;
  streaming: boolean;
  active: boolean;
  entry: TranslationEntry | undefined;
  sourceKind: TranslationSourceKind;
  targetLabel: string;
  onPressTranslate: () => void;
  onRetry: () => void;
  onHide: () => void;
}

export function useItemTranslation(options: {
  sourceKey: string;
  sourceKind: TranslationSourceKind;
  agentId: string;
  text: string;
  sourceAvailable?: boolean;
  streaming: boolean;
  onActivate?: () => void;
}): TranslationController {
  const settingsState = useTranslationSettingsState();
  const settings = settingsState.values;
  const preferences = useEnhancerPreferences();
  const interfaceLanguage = getInterfaceLanguage(preferences?.language);
  const caller = useTranslateCaller();
  const entry = useTranslationEntry(options.sourceKey, options.text, settings, interfaceLanguage);

  const sourceAvailable = options.sourceAvailable ?? true;
  const enabled = settingsState.status === "ready" ? settings.enabled : true;
  const target = resolveTranslationTarget(settings.targetLanguage, interfaceLanguage);
  const targetLabel = interfaceLanguage === "zh" ? target.entry.zhName : target.entry.enName;
  const active = Boolean(entry && entry.visible);

  const latestRef = useRef({
    options,
    settingsState,
    settings,
    sourceAvailable,
    interfaceLanguage,
    caller,
    entry,
  });
  latestRef.current = {
    options,
    settingsState,
    settings,
    sourceAvailable,
    interfaceLanguage,
    caller,
    entry,
  };

  const start = useCallback(() => {
    const {
      options: opt,
      settingsState: st,
      settings: cfg,
      sourceAvailable: available,
      interfaceLanguage: lang,
      caller: rpc,
    } = latestRef.current;
    if (st.status !== "ready" || !cfg.enabled || !available || opt.streaming || !opt.text.trim()) return;
    opt.onActivate?.();
    translationStore.startTranslation(
      {
        sourceKey: opt.sourceKey,
        sourceKind: opt.sourceKind,
        agentId: opt.agentId,
        text: opt.text,
        interfaceLanguage: lang,
        settings: cfg,
      },
      rpc.call,
      rpc.watch,
    );
  }, []);

  const onPressTranslate = useCallback(() => {
    const {
      options: opt,
      settingsState: st,
      settings: cfg,
      sourceAvailable: available,
      entry: current,
    } = latestRef.current;
    if (st.status !== "ready" || !cfg.enabled || !available || opt.streaming || !opt.text.trim()) return;
    if (current?.state.state === "running" || current?.state.state === "done") {
      const nextVisible = !current.visible;
      if (nextVisible) opt.onActivate?.();
      translationStore.setVisible(opt.sourceKey, nextVisible);
      return;
    }
    if (current?.state.state === "error" && !current.visible) {
      opt.onActivate?.();
      translationStore.setVisible(opt.sourceKey, true);
      return;
    }
    start();
  }, [start]);

  const onRetry = useCallback(() => {
    start();
  }, [start]);

  const onHide = useCallback(() => {
    translationStore.setVisible(latestRef.current.options.sourceKey, false);
  }, []);

  return useMemo(() => ({
    enabled,
    settingsStatus: settingsState.status,
    settingsError: settingsState.error,
    sourceAvailable,
    streaming: options.streaming,
    active,
    entry,
    sourceKind: options.sourceKind,
    targetLabel,
    onPressTranslate,
    onRetry,
    onHide,
  }), [
    enabled,
    settingsState.status,
    settingsState.error,
    sourceAvailable,
    options.streaming,
    active,
    entry,
    options.sourceKind,
    targetLabel,
    onPressTranslate,
    onRetry,
    onHide,
  ]);
}

export function useAssistantTranslation(options: {
  agentId: string;
  data: AssistantSourceInput;
}) {
  const resolved = resolveAssistantSource(options.agentId, options.data);
  const streaming = options.data.phase !== "complete";
  const controller = useItemTranslation({
    sourceKey: resolved.sourceKey,
    sourceKind: "assistant_message",
    agentId: options.agentId,
    text: resolved.sourceText,
    sourceAvailable: resolved.sourceAvailable,
    streaming,
  });
  return {
    ...controller,
    ...resolved,
  };
}

export function useReasoningTranslation(options: {
  agentId: string;
  storeKey: string;
  text: string;
  streaming: boolean;
  onActivate?: () => void;
}) {
  const resolved = resolveReasoningSource(options.agentId, options.storeKey, options.text);
  return useItemTranslation({
    sourceKey: resolved.sourceKey,
    sourceKind: "reasoning",
    agentId: options.agentId,
    text: resolved.sourceText,
    sourceAvailable: true,
    streaming: options.streaming,
    onActivate: options.onActivate,
  });
}

export function TranslateButton({
  controller,
  tokens,
  compact = false,
}: {
  controller: TranslationController;
  tokens: ExtendedThemeTokens;
  compact?: boolean;
}) {
  const capabilities = useInputCapabilities();
  const colors = safeColors(tokens);
  const existingHover = useContext(ToolbarHoverColorContext);
  const existingSide = useContext(TooltipSideContext);
  const isRunning = controller.entry?.state.state === "running";
  const isRunningHidden = isRunning && !controller.entry?.visible;
  const isDoneVisible = controller.entry?.state.state === "done" && controller.entry.visible;
  const isDoneHidden = controller.entry?.state.state === "done" && !controller.entry.visible;
  const isErrorHidden = controller.entry?.state.state === "error" && !controller.entry.visible;
  const notReady = controller.settingsStatus !== "ready";
  const disabled = controller.streaming || notReady || !controller.sourceAvailable;

  let label = controller.sourceKind === "reasoning" ? "Translate thought" : "Translate reply";
  if (controller.settingsStatus === "loading") {
    label = "Loading translation settings...";
  } else if (controller.settingsStatus === "invalid") {
    label = "Translation settings are invalid";
  } else if (controller.settingsStatus === "error") {
    label = "Could not load translation settings";
  } else if (!controller.sourceAvailable) {
    label = "Full reply text is unavailable for this block";
  } else if (controller.streaming) {
    label =
      controller.sourceKind === "reasoning"
        ? "Wait until the thought finishes streaming"
        : "Wait until the reply finishes streaming";
  } else if (isRunningHidden || isDoneHidden || isErrorHidden) {
    label = "Show translation";
  } else if (isRunning) {
    label = "Translating...";
  } else if (isDoneVisible) {
    label = "Hide translation";
  }

  const iconColor = isRunning || isDoneVisible ? colors.accent : tokens.foregroundMuted;
  const hitSlop = compact || !capabilities.hover ? 8 : 4;

  const button = (
    <ToolbarItem
      label={label}
      tokens={tokens}
      disabled={disabled}
      checked={isDoneVisible}
      align="end"
      hitSlop={hitSlop}
      onPress={controller.onPressTranslate}
    >
      {isRunning ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Icon icon={TRANSLATE_ICON} size={14} color={iconColor} />
      )}
    </ToolbarItem>
  );

  const withSide = existingSide === "auto"
    ? button
    : <TooltipSideContext.Provider value="auto">{button}</TooltipSideContext.Provider>;

  return existingHover !== null
    ? withSide
    : <ToolbarHoverColorContext.Provider value={colors.hover}>{withSide}</ToolbarHoverColorContext.Provider>;
}

export function TranslationBlock({
  controller,
  tokens,
  variant = "document",
  compact = false,
  quiet = false,
  size,
  onRevealPath,
}: {
  controller: TranslationController;
  tokens: ExtendedThemeTokens;
  variant?: MarkdownVariant;
  compact?: boolean;
  quiet?: boolean;
  size?: number;
  onRevealPath?: (path: string) => void;
}) {
  const { entry } = controller;
  const preferences = useEnhancerPreferences();
  const colors = safeColors(tokens);
  if (!controller.enabled || !entry || !entry.visible || entry.state.state === "idle") return null;

  const langPreference = preferences?.language ?? "system";
  const lang = resolveLanguage(langPreference);
  const doneTarget =
    entry.state.state === "done"
      ? findTranslationLanguage(entry.state.targetLanguageCode)
      : undefined;
  const languageTitle = doneTarget
    ? (lang === "zh" ? doneTarget.zhName : doneTarget.enName)
    : controller.targetLabel;
  const headerPrefix = toolbarLabel("Translation", langPreference);
  const hideLabel = toolbarLabel("Hide", langPreference);
  const retryLabel = toolbarLabel("Retry", langPreference);
  const translatingLabel = toolbarLabel("Translating...", langPreference);
  const mutedText = tokens.foregroundSubtle ?? tokens.foregroundMuted;

  return (
    <ToolbarHoverColorContext.Provider value={colors.hover}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderLeftColor: entry.state.state === "error" ? colors.danger : colors.accent,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleGroup}>
            <Icon icon={TRANSLATE_ICON} size={13} color={entry.state.state === "error" ? colors.danger : colors.accent} />
            <Text style={[styles.cardTitle, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]} numberOfLines={1}>
              {headerPrefix} · {languageTitle}
            </Text>
            {entry.state.state === "running" ? (
              <View style={styles.runningBadge}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.runningText, { color: mutedText, fontFamily: tokens.fontUi }]}>{translatingLabel}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.cardActions}>
            {entry.state.state === "done" ? (
              <ToolbarCopyButton
                text={entry.state.translation}
                tokens={tokens}
                label="Copy translation"
              />
            ) : null}
            {entry.state.state === "error" || entry.state.state === "done" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={retryLabel}
                onPress={controller.onRetry}
                hitSlop={6}
                style={styles.textAction}
              >
                <Text style={[styles.actionText, { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }]}>{retryLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hideLabel}
              onPress={controller.onHide}
              hitSlop={6}
              style={styles.textAction}
            >
              <Text style={[styles.actionText, { color: mutedText, fontFamily: tokens.fontUi }]}>{hideLabel}</Text>
            </Pressable>
          </View>
        </View>

        {entry.state.state === "running" ? (
          entry.state.text ? (
            <MarkdownView
              text={entry.state.text}
              tokens={tokens}
              variant={variant}
              compact={compact}
              quiet={quiet}
              size={size}
              onRevealPath={onRevealPath}
            />
          ) : null
        ) : entry.state.state === "error" ? (
          <View style={styles.errorRow}>
            <Text style={[styles.errorText, { color: colors.danger, fontFamily: tokens.fontUi }]}>
              {toolbarLabel("Translation failed", langPreference)}: {entry.state.error}
            </Text>
          </View>
        ) : (
          <MarkdownView
            text={entry.state.translation}
            tokens={tokens}
            variant={variant}
            compact={compact}
            quiet={quiet}
            size={size}
            onRevealPath={onRevealPath}
          />
        )}
      </View>
    </ToolbarHoverColorContext.Provider>
  );
}

export const translationRowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  actionSlot: {
    flexShrink: 0,
    marginLeft: 4,
  },
});

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderLeftWidth: 2,
    borderRadius: radiusV2.block,
    gap: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardTitle: {
    fontWeight: "500",
    fontSize: 11.5,
    lineHeight: 16,
    flexShrink: 1,
  },
  runningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  runningText: {
    fontSize: 11,
    lineHeight: 14,
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  textAction: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  actionText: {
    fontWeight: "500",
    fontSize: 11.5,
    lineHeight: 16,
  },
  errorRow: {
    paddingVertical: 2,
  },
  errorText: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});
