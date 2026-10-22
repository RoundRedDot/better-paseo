/**
 * "Back to latest · N new lines": shown over the bottom of a streaming body
 * the reader has scrolled up from (docs/prototypes/block-details-sheet.md,
 * "运行中的 Block"). A tap goes back to the newest output and follows it again.
 * It fades in over 160 ms, rising 8.
 */
import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { radiusV2, space } from "../../components/theme-tokens";
import { unselectable } from "../../components/selection";
import { floatShadow } from "../../ui/tokens/float";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { easing } from "../../ui/tokens/motion";
import { useEnhancerPreferences } from "../../preferences";
import { toolbarLabel } from "../../i18n/toolbar-strings";

export const PILL_ENTER_MS = 160;
const PILL_RISE = 8;

/** The pill's words: the new lines are counted only once there are some. */
export function backToLatestText(lines: number, translate: (label: string) => string = (label) => label): string {
  const back = translate("Back to latest");
  if (lines <= 0) return back;
  const count = lines === 1 ? translate("1 new line") : translate("{count} new lines").replace("{count}", String(lines));
  return `${back} · ${count}`;
}

export function BackToLatestPill({ lines, onPress, tokens }: {
  lines: number;
  onPress(): void;
  tokens: ExtendedThemeTokens;
}) {
  const { language } = useEnhancerPreferences();
  const still = useReducedMotion();
  const shown = useRef(new Animated.Value(still ? 1 : 0)).current;
  useEffect(() => {
    if (still) {
      shown.setValue(1);
      return;
    }
    const animation = Animated.timing(shown, {
      toValue: 1,
      duration: PILL_ENTER_MS,
      easing: easing.out,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [shown, still]);
  const text = backToLatestText(lines, (label) => toolbarLabel(label, language));
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.slot, {
        opacity: shown,
        transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [PILL_RISE, 0] }) }],
      }]}
    >
      <Pressable
        testID="details-back-to-latest"
        accessibilityRole="button"
        accessibilityLabel={text}
        onPress={onPress}
        style={({ pressed }) => [styles.pill, Platform.OS === "web" && styles.pointer, {
          backgroundColor: pressed ? tokens.v2.surface2 : tokens.surface0,
          borderColor: tokens.v2.border,
          boxShadow: floatShadow(tokens),
        }]}
      >
        <Icon name="ArrowDown" size={14} color={tokens.accent} />
        <Text selectable={false} numberOfLines={1}
          style={[styles.text, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", left: 0, right: 0, bottom: space.md, alignItems: "center", zIndex: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radiusV2.pill,
    borderWidth: 1,
  },
  pointer: { cursor: "pointer" } as object,
  text: { fontSize: 12, fontVariant: ["tabular-nums"] },
});
