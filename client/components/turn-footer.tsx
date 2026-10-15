import React, { useCallback, useMemo } from "react";
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
import { ToolbarItem, TooltipSideContext } from "../ui/toolbar-button";
import { useEnhancerPreferences } from "../preferences";
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
  at: Date;
  agentName?: string | null;
  modelName?: string | null;
  thinkingLabel?: string | null;
  durationMs?: number | null;
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: a 44pt touch target for Copy. */
  compact?: boolean;
}

export function AssistantFooter({ text, at, agentName, modelName, thinkingLabel, durationMs, tokens, compact = false }: AssistantFooterProps) {
  // The shared copy path (plan §3.8): a check for 1.2 s on success, a toast
  // on failure, and no timer left running after unmount.
  const { copied, copy } = useCopy();
  const modelCopy = useCopy();
  const { language } = useEnhancerPreferences();
  const copyModel = useCallback(() => {
    if (modelName) void modelCopy.copy(modelName, { label: `Copy model name: ${modelName}` });
  }, [modelName, modelCopy.copy]);
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
          // The button's own padding is pulled back, so its icon starts on the
          // text column, the way the host footer does.
          marginLeft: -space.xs,
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
          paddingHorizontal: space.xs,
          paddingVertical: space.xs / 2,
        },
        detailRow: {
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.sm,
          paddingVertical: space.sm,
          borderRadius: radiusV2.block,
        },
        detailIcon: {
          width: 20,
          height: 20,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
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
      <View style={styles.container}>
        <ToolbarItem
          label={copied ? "Copied" : "Copy reply"}
          tokens={tokens}
          align="start"
          accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
          onPress={handleCopy}
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
            hitSlop={compact ? (44 - FOOTER_HEIGHT) / 2 : 0}
            buttonStyle={[styles.metadata, styles.modelButton]}
            details={(
              <View testID="footer-model-details">
                <Pressable accessibilityRole="button"
                  accessibilityLabel={modelCopy.copied ? "Model name copied" : "Copy model name"}
                  onPress={copyModel}
                  style={({ pressed }) => [styles.detailRow,
                    { backgroundColor: pressed ? tokens.v2.surface2 : "transparent" }]}>
                  <View style={styles.detailIcon}>
                    <Icon name={modelCopy.copied ? "Check" : "Copy"} size={DISCLOSURE_HEADER.icon}
                      color={modelCopy.copied ? tokens.success : tokens.foregroundMuted} />
                  </View>
                  <Text style={[styles.time, { flexShrink: 1 }]}>{modelName}</Text>
                </Pressable>
                {thinkingLabel ? (
                  <View accessibilityLabel={`Thinking level: ${thinkingLabel}`} style={styles.detailRow}>
                    <View style={styles.detailIcon}>
                      <Icon name="Brain" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
                    </View>
                    <Text style={[styles.time, { flexShrink: 1 }]}>{toolbarLabel("Thinking level", language)}: {thinkingLabel}</Text>
                  </View>
                ) : null}
              </View>
            )}
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
        <ToolbarItem label={formatFullStamp(at)} tokens={tokens} align="start" buttonStyle={styles.metadata}>
          <Icon name="Clock" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
          <Text style={styles.time}>{formatFooterStamp(at)}</Text>
        </ToolbarItem>
        {durationMs != null ? (
          <ToolbarItem label="Elapsed time" accessibilityLabel={`Elapsed time: ${formatDuration(durationMs)}`} tokens={tokens} align="end" buttonStyle={styles.metadata}>
            <Icon name="Hourglass" size={DISCLOSURE_HEADER.icon} color={tokens.foregroundMuted} />
            <Text style={styles.time}>{formatDuration(durationMs)}</Text>
          </ToolbarItem>
        ) : null}
      </View>
    </TooltipSideContext.Provider>
  );
}

/**
 * The footer row: at least 24 tall, wrapping metadata on narrow screens (it sits under
 * the last reply, where every extra point moves the turn below), a 44pt Copy
 * on touch through hitSlop.
 */
const FOOTER_HEIGHT = 24;
