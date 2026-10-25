/**
 * The drawer's text size while a pinch sets it (`pinch-zoom.ts`), over the
 * top of the body: "Text size 18", step buttons and an always available reset.
 * Touching anywhere on the pill keeps it up until the interaction ends.
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ExtendedThemeTokens } from "../../components/theme-tokens";
import { radiusV2, space } from "../../components/theme-tokens";
import { unselectable } from "../../components/selection";
import { floatShadow } from "../../ui/tokens/float";
import { useEnhancerPreferences } from "../../preferences";
import { toolbarLabel } from "../../i18n/toolbar-strings";
import { Glyph } from "../../components/glyph";

export function ZoomBadge({ size, onReset, onStep, onInteraction, canDecrease, canIncrease, tokens }: {
  /** The body size drawn now. */
  size: number;
  onReset(): void;
  onStep(direction: -1 | 1): void;
  onInteraction(active: boolean): void;
  canDecrease: boolean;
  canIncrease: boolean;
  tokens: ExtendedThemeTokens;
}) {
  const { language } = useEnhancerPreferences();
  const mobile = Platform.OS !== "web";
  const label = `${toolbarLabel("Text size", language)} ${size}`;
  const reset = toolbarLabel("Reset", language);
  return (
    <View pointerEvents="box-none" style={styles.slot}>
      <View testID="details-zoom-badge"
        onTouchStart={(event) => { event.stopPropagation(); onInteraction(true); }}
        onTouchEnd={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.touches.length === 0) onInteraction(false);
        }}
        onTouchCancel={(event) => { event.stopPropagation(); onInteraction(false); }}
        style={[styles.pill, mobile && styles.mobilePill, {
          backgroundColor: tokens.surface0,
          borderColor: tokens.v2.border,
          boxShadow: floatShadow(tokens),
        }]}>
        <Pressable testID="details-zoom-decrease" accessibilityRole="button"
          accessibilityLabel={toolbarLabel("Decrease text size", language)}
          accessibilityState={{ disabled: !canDecrease }} disabled={!canDecrease} onPress={() => onStep(-1)}
          style={({ pressed }) => [styles.step, mobile && styles.mobileStep, Platform.OS === "web" && styles.pointer, (!canDecrease || pressed) && { opacity: 0.4 }]}>
          <Glyph name="Minus" size={mobile ? 18 : 16} color={tokens.foreground} />
        </Pressable>
        <View style={[styles.label, mobile && styles.mobileControl]}>
          <Text selectable={false} numberOfLines={1} accessibilityLiveRegion="polite"
            style={[styles.text, mobile && styles.mobileText, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
            {label}
          </Text>
        </View>
        <Pressable testID="details-zoom-increase" accessibilityRole="button"
          accessibilityLabel={toolbarLabel("Increase text size", language)}
          accessibilityState={{ disabled: !canIncrease }} disabled={!canIncrease} onPress={() => onStep(1)}
          style={({ pressed }) => [styles.step, mobile && styles.mobileStep, Platform.OS === "web" && styles.pointer, (!canIncrease || pressed) && { opacity: 0.4 }]}>
          <Glyph name="Plus" size={mobile ? 18 : 16} color={tokens.foreground} />
        </Pressable>
        <Pressable testID="details-zoom-reset" accessibilityRole="button" accessibilityLabel={reset}
          onPress={onReset}
          style={({ pressed }) => [styles.reset, mobile && styles.mobileControl, Platform.OS === "web" && styles.pointer, pressed && { opacity: 0.6 }]}>
          <Text selectable={false} style={[styles.text, mobile && styles.mobileText, unselectable, { color: tokens.accent, fontFamily: tokens.fontUi }]}>
            {reset}
          </Text>
        </Pressable>
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
    minHeight: 34,
    paddingHorizontal: space.md,
    borderRadius: radiusV2.pill,
    borderWidth: 1,
  },
  label: { alignItems: "center", justifyContent: "center", height: 32 },
  reset: { alignItems: "center", justifyContent: "center", height: 32 },
  step: { alignItems: "center", justifyContent: "center", width: 32, height: 32 },
  mobilePill: { minHeight: 40 },
  mobileControl: { height: 38, minWidth: 32 },
  mobileStep: { width: 38, height: 38 },
  pointer: { cursor: "pointer" } as object,
  text: { fontSize: 12, lineHeight: 18, includeFontPadding: false, textAlign: "center", fontVariant: ["tabular-nums"] },
  mobileText: { fontSize: 13, lineHeight: 20 },
});
