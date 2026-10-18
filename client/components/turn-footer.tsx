import React, { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { unselectable } from "./selection";
import { radiusV2, space } from "./theme-tokens";
import { useCopy } from "../ui/use-copy";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { formatFooterStamp, formatFullStamp, formatDuration } from "../ui/time";
import { TYPE } from "../ui/tokens/typography";
import { ProviderLogo } from "./provider-logo";
import { CenteredToolbarDetails, ToolbarItem, TooltipSideContext } from "../ui/toolbar-button";
import { FooterDetails, useFooterDetailsWidth } from "./footer-details";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { useScrollDismiss } from "../ui/scroll-anchor";
import type { TurnUsage } from "./user-message";
import { useEnhancerPreferences } from "../preferences";
import { resolveLanguage } from "../i18n/settings-strings";
import { toolbarLabel } from "../i18n/toolbar-strings";

/**
 * The host's own reply footer — copy, fork and the turn's time — is drawn by
 * the stream layout, not by the message renderer: it walks up from the newest
 * item looking for a `assistant_message` stream item
 * (`agent-stream/layout.ts:102`). A transformed item is projected as
 * `kind: "plugin"` (`plugins/timeline/projection.ts:96`), so once this plugin
 * renders the reply the host finds no assistant and draws no footer.
 *
 * This is the part a plugin can rebuild. Fork is not: it needs the daemon
 * client and a timeline cursor (`hooks/use-fork-agent.ts`), and the plugin SDK
 * exposes neither. Turning "Assistant markdown" off in settings hands the reply
 * back to the host, which brings the full footer with it.
 */
interface AssistantFooterProps {
  /** The reply, copied verbatim — the same text the host would copy. */
  text: string;
  /** The completed turn's end time; source reply identity is resolved before rendering. */
  at: Date;
  agentName?: string | null;
  /** The raw model name from the agent, used for clipboard writes. */
  modelId?: string | null;
  modelName?: string | null;
  thinkingLabel?: string | null;
  durationMs?: number | null;
  startedAt?: number | null;
  usage?: TurnUsage | null;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: a 44pt touch target for Copy. */
  compact?: boolean;
}

export function AssistantFooter({ text, at, agentName, modelId, modelName, thinkingLabel, durationMs, startedAt, usage, tokens, compact = false }: AssistantFooterProps) {
  // The shared copy path (plan §3.8): a check for 1.2 s on success, a toast
  // on failure, and no timer left running after unmount.
  const { copied, copy } = useCopy();
  const modelCopy = useCopy();
  const capabilities = useInputCapabilities(compact);
  const { language } = useEnhancerPreferences();
  const hintLanguage = resolveLanguage(language);
  const timeLabel = startedAt != null ? "Start time" : "End time";
  const timeStamp = formatFullStamp(startedAt != null ? new Date(startedAt) : at);
  const footerRef = useRef<View>(null);
  const [pressedAnchor, setPressedAnchor] = useState<RefObject<View | null> | null>(null);
  const showDetails = useCallback((anchor: RefObject<View | null>) => setPressedAnchor(anchor), []);
  const closeDetails = useCallback(() => setPressedAnchor(null), []);
  useScrollDismiss(pressedAnchor !== null, closeDetails);
  const longPress = capabilities.touch ? showDetails : undefined;
  const detailsWidth = useFooterDetailsWidth();
  // Grok and Cursor upstream history replays lack reliable per-message timestamps.
  const visibleDurationMs = agentName === "grok" || agentName === "cursor" ? null : durationMs;
  const details = <FooterDetails agentName={agentName} modelId={modelId} modelName={modelName} thinkingLabel={thinkingLabel}
    startedAt={startedAt} completedAt={at.getTime()} durationMs={visibleDurationMs} usage={usage} tokens={tokens} />;
  const copyModel = useCallback(() => {
    if (modelId) void modelCopy.copy(modelId, { label: "Copy model name" });
  }, [modelId, modelCopy.copy]);
  const handleCopy = useCallback(() => void copy(text, { label: "Copy reply" }), [copy, text]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          minHeight: FOOTER_HEIGHT,
          marginTop: space.sm,
          // Keep Copy clear of the composer in both desktop and compact layouts.
          marginBottom: space.lg,
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: space.sm,
        },
        copyButton: {
          width: "auto",
          // Exclude hit-area padding from the visible spacing between items.
          marginHorizontal: -space.xs,
          height: FOOTER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.xs,
          borderRadius: radiusV2.block,
        },
        copyLabel: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.button.size,
          lineHeight: TYPE.button.lineHeight,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        metadata: {
          width: "auto",
          minHeight: FOOTER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          borderRadius: radiusV2.block,
        },
        modelButton: {
          width: "auto",
          marginHorizontal: -space.xs,
          paddingHorizontal: space.xs,
          paddingVertical: space.xs / 2,
        },
        time: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.button.size,
          lineHeight: TYPE.button.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
      }),
    [tokens],
  );

  return (
    <TooltipSideContext.Provider value="auto">
      <Pressable ref={footerRef} testID="footer-toolbar" accessible={false} focusable={false}
        onLongPress={longPress ? () => longPress(footerRef) : undefined} style={styles.container}>
        <ToolbarItem
          label={copied ? "Copied" : "Copy reply"}
          tokens={tokens}
          align="start"
          accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
          onPress={handleCopy}
          onLongPress={longPress}
          hitSlop={compact ? (44 - FOOTER_HEIGHT) / 2 : 0}
          buttonStyle={styles.copyButton}
        >
          <Icon
            name={copied ? "Check" : "Copy"}
            size={DISCLOSURE_HEADER.icon}
            color={copied ? tokens.success : tokens.foregroundMuted}
          />
          <Text style={styles.copyLabel}>Copy</Text>
        </ToolbarItem>
        {modelName ? (
          <ToolbarItem
            label={modelCopy.copied ? "Copied" : "Copy model name"}
            tokens={tokens}
            align="start"
            accessibilityLabel={modelCopy.copied ? "Model name copied" : "Copy model name"}
            onPress={copyModel}
            onLongPress={longPress}
            hitSlop={compact ? (44 - FOOTER_HEIGHT) / 2 : 0}
            buttonStyle={[styles.metadata, styles.modelButton]}
            details={details}
            detailsWidth={detailsWidth}
          >
            {modelCopy.copied ? (
              <Icon name="Check" size={DISCLOSURE_HEADER.icon} color={tokens.success} />
            ) : agentName ? (
              <ProviderLogo provider={agentName} size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            ) : (
              <Icon name="Copy" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            )}
            <Text style={styles.time}>{modelName}</Text>
          </ToolbarItem>
        ) : null}
        <ToolbarItem label={`${toolbarLabel(timeLabel, language)} ${timeStamp}`} accessibilityLabel={`${timeLabel} ${timeStamp}`} tokens={tokens} align="start" buttonStyle={styles.metadata} onLongPress={longPress}>
          <Icon name="Clock" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
          <Text style={styles.time}>{formatFooterStamp(at)}</Text>
        </ToolbarItem>
        {visibleDurationMs != null ? (
          <ToolbarItem label={`${toolbarLabel("Elapsed time", language)}${hintLanguage === "zh" ? "：" : ":"} ${formatDuration(visibleDurationMs, hintLanguage)}`} accessibilityLabel={`Elapsed time: ${formatDuration(visibleDurationMs)}`} tokens={tokens} align="end" buttonStyle={styles.metadata} onLongPress={longPress}>
            <Icon name="Hourglass" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            <Text style={styles.time}>{formatDuration(visibleDurationMs)}</Text>
          </ToolbarItem>
        ) : null}
      </Pressable>
      {pressedAnchor ? (
        <CenteredToolbarDetails close={closeDetails} width={detailsWidth} tokens={tokens}>
          {details}
        </CenteredToolbarDetails>
      ) : null}
    </TooltipSideContext.Provider>
  );
}

/**
 * The footer row: at least 24 tall, wrapping metadata on narrow screens (it sits under
 * the last reply, where every extra point moves the turn below), a 44pt Copy
 * on touch through hitSlop.
 */
const FOOTER_HEIGHT = 24;
