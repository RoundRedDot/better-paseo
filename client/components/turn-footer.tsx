import React, { useCallback, useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { unselectable } from "./selection";
import { radiusV2, space } from "./theme-tokens";
import { useCopy } from "../ui/use-copy";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { DISCLOSURE_HEADER } from "../ui/disclosure-header";
import { formatStamp } from "../ui/time";
import { TYPE } from "../ui/tokens/typography";

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
  tokens: ExtendedThemeTokens;
  /** `layout.compact`: a 44pt touch target for Copy. */
  compact?: boolean;
}

export function AssistantFooter({ text, at, tokens, compact = false }: AssistantFooterProps) {
  // The shared copy path (plan §3.8): a check for 1.2 s on success, a toast
  // on failure, and no timer left running after unmount.
  const { copied, copy } = useCopy();
  const handleCopy = useCallback(() => void copy(text, { label: "Copy reply" }), [copy, text]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          height: FOOTER_HEIGHT,
          // Keep the Copy touch target clear of the composer below the tail.
          marginBottom: compact ? space.lg : 0,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
        },
        copyButton: {
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
        time: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.button.size,
          lineHeight: TYPE.button.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.foregroundMuted,
          ...unselectable,
        },
      }),
    [tokens, compact],
  );

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Reply copied" : "Copy reply"}
        onPress={handleCopy}
        hitSlop={compact ? (44 - FOOTER_HEIGHT) / 2 : 0}
        style={({ pressed }) => [styles.copyButton, pressed && { backgroundColor: tokens.v2.surface2 }]}
      >
        <Icon
          name={copied ? "Check" : "Copy"}
          size={DISCLOSURE_HEADER.icon}
          color={copied ? tokens.success : tokens.foregroundMuted}
        />
        <Text style={styles.copyLabel}>{copied ? "Copied" : "Copy"}</Text>
      </Pressable>
      <Text style={styles.time}>{formatStamp(at)}</Text>
    </View>
  );
}

/**
 * The footer row: 24 tall (the mockup's 32 less the padding; it sits under
 * the last reply, where every extra point moves the turn below), a 44pt Copy
 * on touch through hitSlop.
 */
const FOOTER_HEIGHT = 24;
