/**
 * What lies behind the details panel. The phone drawer dims the timeline and
 * closes on a tap there; the floating and side panels on iOS and Android sit
 * on a clear catcher that closes them the same way, since nothing under a
 * Modal reaches the timeline anyway (host facts §1). On web those two have
 * neither: the timeline behind stays live.
 */
import React from "react";
import { Animated, Pressable, StyleSheet } from "react-native";
import { withAlpha, type ExtendedThemeTokens } from "../../components/theme-tokens";

/** Colours the design adds (table 5.6), from the theme. */
export function detailsPalette(tokens: ExtendedThemeTokens) {
  return {
    /** #000 at 20% on a light theme, 50% on a dark one. */
    scrim: tokens.isDark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.2)",
    grabber: withAlpha(tokens.foregroundMuted, 0.35),
    border: tokens.v2.border,
  };
}

export function Scrim({ tokens, opacity, onPress }: {
  tokens: ExtendedThemeTokens;
  opacity: Animated.Value;
  onPress(): void;
}) {
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
      <Pressable
        testID="details-scrim"
        accessibilityRole="button"
        accessibilityLabel="Close details"
        onPress={onPress}
        style={[StyleSheet.absoluteFill, { backgroundColor: detailsPalette(tokens).scrim }]}
      />
    </Animated.View>
  );
}

/** A clear full-screen press target under a panel with no scrim. Native only. */
export function OutsideCatcher({ onPress }: { onPress(): void }) {
  return (
    <Pressable
      testID="details-outside"
      accessible={false}
      onPress={onPress}
      style={StyleSheet.absoluteFill}
    />
  );
}
