import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { useCopy, type CopyFeedback } from "./use-copy";
import { useHover } from "./use-hover";
import { UI_SCALE } from "./tokens/typography";

/** Visual box; `hitSlop` brings the touch target to 32 (plan §3.8, §3.11). */
const BOX = 24;
const HIT_SLOP = (32 - BOX) / 2;
const ICON = 14;

interface CopyButtonProps {
  /** The raw text, or a function that builds it only when pressed. */
  text: string | (() => string);
  tokens: ExtendedThemeTokens;
  feedback?: CopyFeedback;
  /** Accessibility label, and the visible label when `showLabel` is set. */
  label?: string;
  showLabel?: boolean;
}

/**
 * A copy icon that turns into a check for 1.2 s once the text is on the
 * clipboard (plan §3.8). Failure shows a toast and never the check. The label
 * is not selectable, so a drag across a card never picks it up.
 */
export function CopyButton({
  text,
  tokens,
  feedback = "icon",
  label = "Copy",
  showLabel = false,
}: CopyButtonProps) {
  const { copied, copy } = useCopy();
  const { hovered, hoverProps } = useHover();
  const onPress = useCallback(() => {
    const value = typeof text === "function" ? text() : text;
    if (value) void copy(value, { feedback, label });
  }, [copy, feedback, label, text]);

  // Success is not coloured (plan §3.6): the check itself is the signal.
  const color = copied ? tokens.foreground : tokens.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => [
        styles.button,
        showLabel && styles.withLabel,
        hovered && { backgroundColor: tokens.v2.surface1 },
        pressed && { backgroundColor: tokens.v2.surface2 },
      ]}
    >
      <View style={styles.icon}>
        <Icon name={copied ? "Check" : "Copy"} size={ICON} color={color} />
      </View>
      {showLabel ? (
        <Text
          selectable={false}
          style={[styles.label, unselectable, { color, fontFamily: tokens.fontUi }]}
        >
          {copied ? "Copied" : label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: BOX,
    height: BOX,
    borderRadius: radiusV2.chip,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  withLabel: {
    paddingHorizontal: 6,
    gap: space.xs,
  },
  icon: {
    width: ICON,
    height: ICON,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: UI_SCALE.base,
  },
});
