import React, { useCallback, useMemo, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { radiusV2, space } from "./theme-tokens";
import { useCopy } from "../ui/use-copy";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { FadeIn } from "../ui/fade-in";
import { formatStamp } from "../ui/time";
import { contentTextProps, contentTextStyle } from "../ui/content-text";
import { TYPE } from "../ui/tokens/typography";
import { unselectable } from "./selection";
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
  /**
   * Drawn where the usage row goes, instead of `usage`/`pending`. The live
   * renderer passes a child that owns the agent subscription, so agent
   * updates re-render that child and never the bubble (F2, D3/D6).
   */
  footer?: React.ReactNode;
  /** `layout.compact`: the bubble may take more of a narrow column. */
  compact?: boolean;
  /** Controls drawn just before Copy, as the host draws its rewind menu there. */
  actions?: React.ReactNode;
}

/**
 * Token counts run to six digits. One decimal is kept through the whole
 * thousands range: rounding 94,336 to `94k` hides the movement between turns,
 * which is the only reason to watch the number.
 */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  // Rounding is done on integers: 97850 / 1000 is held as 97.8499…, so
  // `toFixed(1)` would report 97.8 for a value that is 97.9k.
  if (value < 1_000_000) return `${(Math.round(value / 100) / 10).toFixed(1)}k`;
  return `${(Math.round(value / 100_000) / 10).toFixed(1)}M`;
}

const IS_WEB = Platform.OS === "web";

/**
 * The user's turn, drawn as the host draws its own (S7 design spec §3.5,
 * Paseo `message.tsx` `userMessageStylesheet`): a right-aligned bubble on the
 * most raised surface, radius 16 with a 2pt tail corner at the top right,
 * 16pt padding, the text at the host's content size. No label and no icons
 * inside; colour on this surface marks agent activity, so the prompt has
 * none.
 *
 * Under the bubble, right-aligned: the turn's usage (when this client saw it
 * live), the time, and Copy, always shown: a prompt is copied to be sent
 * again, and a control that appears only under the pointer is one the reader
 * has to hunt for. A press on the usage opens the in / cached / out figures
 * in place, below that line.
 */
export function UserMessage({
  text,
  timestamp,
  images,
  tokens,
  usage,
  pending = false,
  footer,
  compact = false,
  actions,
}: UserMessageProps) {
  // The shared copy path: the icon turns into a check for 1.2 s, a failure
  // is a toast, and the timer is cleared on unmount.
  const { copied, copy } = useCopy();
  const handleCopy = useCallback(() => void copy(text, { label: "Copy prompt" }), [copy, text]);
  const capabilities = useInputCapabilities(compact);

  const styles = useMemo(() => {
    const size = tokens.typography.content.size;
    return StyleSheet.create({
      column: {
        alignSelf: "flex-end",
        alignItems: "flex-end",
        maxWidth: compact ? "86%" : BUBBLE_MAX_DESKTOP,
        ...selectableSurface,
      },
      bubble: {
        paddingHorizontal: space.lg,
        paddingVertical: space.lg,
        borderRadius: radiusV2.bubble,
        // The square tail marks the turn's owner, matching the native stream.
        borderTopRightRadius: radiusV2.bubbleTail,
        backgroundColor: tokens.userSurface,
      },
      text: {
        fontFamily: tokens.fontUi,
        fontSize: size,
        lineHeight: Math.round(size * 1.4),
        color: tokens.userText,
      },
      imageRow: {
        marginTop: space.sm,
        gap: space.sm,
      },
      image: {
        width: "100%",
        // Tall enough to read, bounded so a screenshot cannot take over
        // the thread.
        height: 200,
        borderRadius: radiusV2.block,
        backgroundColor: tokens.v2.surface1,
      },
      // Right to left: Copy, the time, then the footer (usage), whose
      // breakdown wraps onto its own line below.
      trailing: {
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        alignItems: "center",
        minHeight: TRAILING_HEIGHT,
        marginTop: space.xs,
        columnGap: space.sm,
      },
      clock: {
        fontFamily: tokens.fontUi,
        fontSize: TYPE.caption.size,
        lineHeight: TYPE.caption.lineHeight,
        fontVariant: ["tabular-nums"],
        color: tokens.userTextMuted,
        ...unselectable,
      },
      copyButton: {
        width: TRAILING_HEIGHT,
        height: TRAILING_HEIGHT,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radiusV2.chip,
      },
    });
  }, [tokens, compact]);

  const Column = IS_WEB ? View : Pressable;

  return (
    <Column
      {...selectionSurface}
      {...(IS_WEB ? null : { accessible: false, focusable: false })}
      style={styles.column}
    >
      <View style={styles.bubble}>
        <Text selectable {...contentTextProps()} style={[styles.text, contentTextStyle()]}>
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
      </View>
      <View style={styles.trailing}>
        <Pressable
          onPress={handleCopy}
          accessibilityRole="button"
          accessibilityLabel={copied ? "Prompt copied" : "Copy prompt"}
          hitSlop={capabilities.touch ? 10 : 4}
          style={({ pressed }) => [
            styles.copyButton,
            pressed && { backgroundColor: tokens.v2.surface2 },
          ]}
        >
          <Icon
            name={copied ? "Check" : "Copy"}
            size={COPY_ICON}
            color={copied ? tokens.success : tokens.userTextMuted}
          />
        </Pressable>
        {/* The row runs right to left: these sit just left of Copy. */}
        {actions}
        {timestamp ? <Text style={styles.clock}>{formatStamp(timestamp)}</Text> : null}
        {footer !== undefined ? footer : <TurnUsageRow usage={usage} pending={pending} tokens={tokens} />}
      </View>
    </Column>
  );
}

/** Desktop bubble width (S7 §3.5): wide enough for a paragraph, never the whole column. */
const BUBBLE_MAX_DESKTOP = 560;
/** The line under the bubble, and its 24pt Copy. */
const TRAILING_HEIGHT = 24;
const COPY_ICON = 14;

/**
 * The turn's tokens under the prompt: "62.0k tokens" (output), and the in /
 * cached / out figures in place below it on press. Nothing until usage is
 * known; "counting…" while the turn still runs.
 */
export function TurnUsageRow({
  usage,
  pending = false,
  tokens,
}: {
  usage?: TurnUsage | null;
  pending?: boolean;
  tokens: ExtendedThemeTokens;
}) {
  const [open, setOpen] = useState(false);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        summary: {
          fontFamily: tokens.fontMono,
          fontSize: TYPE.meta.size,
          lineHeight: TYPE.meta.lineHeight,
          fontVariant: ["tabular-nums"],
          color: tokens.userTextMuted,
          ...unselectable,
        },
        // Full width, so it wraps below the time and Copy.
        breakdown: {
          width: "100%",
          alignItems: "flex-end",
          marginTop: space.xs,
        },
        panel: {
          minWidth: BREAKDOWN_WIDTH,
          paddingVertical: space.xs,
          paddingHorizontal: space.md,
          borderRadius: radiusV2.block,
          backgroundColor: tokens.v2.surface1,
        },
        figureRow: {
          height: 24,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.lg,
        },
        figureLabel: {
          fontFamily: tokens.fontUi,
          fontSize: TYPE.button.size,
          color: tokens.foregroundMuted,
        },
        figureValue: {
          fontFamily: tokens.fontMono,
          fontSize: TYPE.meta.size,
          fontVariant: ["tabular-nums"],
          color: tokens.foreground,
        },
      }),
    [tokens],
  );
  if (!usage) return null;
  const output = usage.outputTokens;
  const summary =
    typeof output === "number" ? `${formatTokens(output)} tokens` : pending ? "" : "usage";
  const figures: Array<[string, number | undefined]> = [
    ["Input", usage.inputTokens],
    ["Cached", usage.cachedInputTokens],
    ["Output", usage.outputTokens],
  ];
  return (
    <>
      <Text
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.summary}
      >
        {pending ? `${summary}${summary ? " · " : ""}counting…` : summary}
      </Text>
      {open ? (
        <FadeIn style={styles.breakdown}>
          <View style={styles.panel}>
            {figures.map(([label, value]) =>
              typeof value === "number" ? (
                <View key={label} style={styles.figureRow}>
                  <Text style={styles.figureLabel}>{label}</Text>
                  <Text selectable style={styles.figureValue}>
                    {formatTokens(value)}
                  </Text>
                </View>
              ) : null,
            )}
          </View>
        </FadeIn>
      ) : null}
    </>
  );
}

const BREAKDOWN_WIDTH = 200;
