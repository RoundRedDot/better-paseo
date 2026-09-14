import React, { useMemo, useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { Glyph } from "./glyph";
import { Pop } from "./motion";
import { radius } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { selectableSurface } from "./selection";
import { selectionSurface } from "./selection-actions";

export interface TurnUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
}

interface UserMessageProps {
  text: string;
  timestamp?: Date;
  /** Pasted or attached images, as anything `<Image>` accepts. */
  images?: string[];
  tokens: ExtendedThemeTokens;
  /** Absent until the turn reports usage, and absent entirely for turns this
   * client did not observe live — usage is not persisted on timeline items. */
  usage?: TurnUsage | null;
  /** True while the turn is still running, so the figures are still climbing. */
  pending?: boolean;
}

/**
 * Token counts run to six digits. One decimal is kept through the whole
 * thousands range: rounding 94,336 to `94k` hides the movement between turns,
 * which is the only reason to watch the number.
 */
function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  // Rounding is done on integers: 97850 / 1000 is held as 97.8499…, so
  // `toFixed(1)` would report 97.8 for a value that is 97.9k.
  if (value < 1_000_000) return `${(Math.round(value / 100) / 10).toFixed(1)}k`;
  return `${(Math.round(value / 100_000) / 10).toFixed(1)}M`;
}

function formatClock(value: Date): string {
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  const ss = String(value.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** One labelled figure. A missing count is omitted, never shown as zero. */
function UsageFigure({
  label,
  value,
  styles,
}: {
  label: string;
  value?: number;
  styles: { usageKey: object; usageValue: object };
}) {
  if (typeof value !== "number") return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text selectable style={styles.usageKey}>
        {label}
      </Text>
      <Text selectable style={styles.usageValue}>
        {formatTokens(value)}
      </Text>
    </View>
  );
}

/**
 * The user's turn. It sits to the right on light paper with dark text and no
 * accent: colour on this surface marks agent activity, so keeping it off the
 * prompt is what separates what the user wrote from what the agent did.
 * The body text stays left-aligned inside the block, because right-ragged
 * prose is harder to read once it wraps.
 */
export function UserMessage({
  text,
  timestamp,
  images,
  tokens,
  usage,
  pending = false,
}: UserMessageProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    // The host owns clipboard access. Reaching for navigator directly would
    // only work on web and would bypass its permission handling.
    copyText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }, [text]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          alignSelf: "flex-end",
          maxWidth: "82%",
          flexDirection: "row",
          gap: 10,
          paddingVertical: 8,
          paddingLeft: 12,
          paddingRight: 10,
          borderRadius: radius.card,
          // The square tail marks the turn's owner, matching the native stream.
          borderTopRightRadius: radius.chip,
          backgroundColor: tokens.userSurface,
          borderWidth: 1,
          borderColor: tokens.userBorder,
          ...tokens.boxShadow,
          ...selectableSurface,
        },
        body: { flex: 1, gap: 3 },
        metaRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
        },
        label: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          fontWeight: "600",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: tokens.userTextMuted,
        },
        copyButton: {
          paddingHorizontal: 4,
          paddingVertical: 2,
        },
        clock: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          color: tokens.userTextMuted,
        },
        text: {
          fontFamily: tokens.fontUi,
          fontSize: 13.5,
          lineHeight: 20,
          color: tokens.userText,
        },
        imageRow: {
          marginTop: 8,
          gap: 6,
        },
        image: {
          width: "100%",
          // Tall enough to read, bounded so a screenshot cannot take over
          // the thread.
          height: 200,
          borderRadius: radius.block,
          backgroundColor: tokens.userBorder,
        },
        usageRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 7,
          paddingTop: 6,
          borderTopWidth: 1,
          borderTopColor: tokens.userBorder,
        },
        usageKey: {
          fontFamily: tokens.fontUi,
          fontSize: 10,
          color: tokens.userTextMuted,
        },
        usageValue: {
          fontFamily: tokens.fontUi,
          fontSize: 11,
          fontWeight: "600",
          color: tokens.userText,
        },
      }),
    [tokens],
  );

  return (
    <View {...selectionSurface} style={styles.container}>
      <View style={styles.body}>
        <View style={styles.metaRow}>
          <Text selectable style={styles.label}>
            You
          </Text>
          {timestamp ? (
            <Text selectable style={styles.clock}>
              {formatClock(timestamp)}
            </Text>
          ) : null}
          <Pressable
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel="Copy prompt"
            style={styles.copyButton}
          >
            <Pop trigger={copied}>
              <Glyph
                name={copied ? "Check" : "Copy"}
                size={11}
                color={copied ? tokens.userText : tokens.userTextMuted}
              />
            </Pop>
          </Pressable>
        </View>
        <Text selectable style={styles.text}>
          {text}
        </Text>
        {images?.length ? (
          <View style={styles.imageRow}>
            {images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={styles.image}
                resizeMode="contain"
                accessibilityLabel="Attached image"
              />
            ))}
          </View>
        ) : null}
        {usage ? (
          <View style={styles.usageRow}>
            <UsageFigure label="in" value={usage.inputTokens} styles={styles} />
            <UsageFigure label="cached" value={usage.cachedInputTokens} styles={styles} />
            <UsageFigure label="out" value={usage.outputTokens} styles={styles} />
            {pending ? (
              <Text selectable style={styles.usageKey}>
                counting…
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
