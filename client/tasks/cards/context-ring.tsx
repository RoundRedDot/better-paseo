import React from "react";
import { Image, Platform, View, type ViewProps } from "react-native";

import { CONTEXT_RING_BITMAPS } from "./context-ring-bitmaps";

// Hidden from assistive tech: the ring is drawn, its value is read from the
// card. React Native Web passes the native props to the DOM as unknown
// attributes (a React warning), so web takes `aria-hidden` instead.
const hidden = (): ViewProps =>
  Platform.OS === "web" ? { "aria-hidden": true } : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" };

/**
 * The host's context meter: clockwise from twelve, with round caps. Each
 * percent is rasterised at 4x and downsampled by Image, avoiding the jagged
 * diagonal borders of clipped and rotated native Views. The masks share a
 * padded sprite sheet and take their colour from the current theme.
 */

export type ContextRingTone = "normal" | "warning" | "danger";

/** The host's thresholds: warning from 70%, danger above 90%. */
export function contextRingTone(ratio: number): ContextRingTone {
  const percent = ratio * 100;
  if (percent > 90) return "danger";
  if (percent >= 70) return "warning";
  return "normal";
}

/** Token counts exactly as the host's context details: "647k", "1m", "950". */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return Math.round(value).toString();
}

/** The session cost as the host shows it; null when there is none. */
export function formatSessionCost(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function ContextRing(props: { ratio: number; color: string; track: string; variant?: "card" | "subtask" }) {
  const bitmap = CONTEXT_RING_BITMAPS[props.variant ?? "card"];
  const { size, padding, frames } = bitmap;
  const stride = size + 2 * padding;
  const percent = Math.round(Math.max(0, Math.min(1, props.ratio)) * 100);
  const layer = (frame: number, color: string, testID: string) => (
    <View testID={testID} style={{ position: "absolute", width: size, height: size, overflow: "hidden" }}>
      <Image
        source={{ uri: bitmap.uri }}
        accessible={false}
        resizeMode="stretch"
        fadeDuration={0}
        style={{ position: "absolute", left: -frame * stride - padding, top: -padding, width: stride * frames, height: stride, tintColor: color }}
      />
    </View>
  );
  return (
    <View style={{ width: size, height: size }} testID="context-ring" {...hidden()}>
      {layer(100, props.track, "context-ring-track")}
      {percent > 0 ? layer(percent, props.color, "context-ring-fill") : null}
    </View>
  );
}
