/**
 * The drawer's text size while a pinch sets it (`pinch-zoom.ts`), over the
 * top of the body: "Text size 18", and "Reset" once it is off the timeline's
 * size. It stays a moment after the fingers lift, so the reset can be tapped.
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { radiusV2, space } from "../../components/theme-tokens";
import { unselectable } from "../../components/selection";
import { floatShadow } from "../../ui/tokens/float";
import { useEnhancerPreferences } from "../../preferences";
import { toolbarLabel } from "../../i18n/toolbar-strings";

export function ZoomBadge({ size, zoom, onReset, tokens }: {
  /** The body size drawn now. */
  size: number;
  /** Points off the timeline's size. */
  zoom: number;
  onReset(): void;
  tokens: ExtendedThemeTokens;
}) {
  const { language } = useEnhancerPreferences();
  const label = `${toolbarLabel("Text size", language)} ${size}`;
  const reset = toolbarLabel("Reset", language);
  return (
    <View pointerEvents="box-none" style={styles.slot}>
      <View testID="details-zoom-badge" style={[styles.pill, {
        backgroundColor: tokens.surface0,
        borderColor: tokens.v2.border,
        boxShadow: floatShadow(tokens),
      }]}>
        <Text selectable={false} numberOfLines={1} accessibilityLiveRegion="polite"
          style={[styles.text, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
          {label}
        </Text>
        {zoom !== 0 ? (
          <Pressable testID="details-zoom-reset" accessibilityRole="button" accessibilityLabel={reset}
            onPress={onReset} hitSlop={8}
            style={({ pressed }) => [styles.reset, Platform.OS === "web" && styles.pointer, pressed && { opacity: 0.6 }]}>
            <Text selectable={false} style={[styles.text, unselectable, { color: tokens.accent, fontFamily: tokens.fontUi }]}>
              {reset}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", left: 0, right: 0, top: space.sm, alignItems: "center", zIndex: 2 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radiusV2.pill,
    borderWidth: 1,
  },
  reset: { justifyContent: "center", height: 32 },
  pointer: { cursor: "pointer" } as object,
  text: { fontSize: 12, fontVariant: ["tabular-nums"] },
});
