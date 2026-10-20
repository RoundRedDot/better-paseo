import React from "react";
import { Platform, View, type ViewProps, type ViewStyle } from "react-native";

// Hidden from assistive tech: the ring is drawn, its value is read from the
// card. React Native Web passes the native props to the DOM as unknown
// attributes (a React warning), so web takes `aria-hidden` instead.
const hidden = (): ViewProps =>
  Platform.OS === "web" ? { "aria-hidden": true } : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" };

/**
 * Paseo's composer context meter (v0.12.0 `context-window-meter.tsx`): a
 * 14 px ring, stroke 2, filling clockwise from twelve o'clock with a round
 * cap. Native has no SVG, so the arc is two half rings, each a circle with
 * only its top and right borders coloured, clipped to one half of the box
 * and turned to the fill angle.
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

export function ContextRing(props: { ratio: number; color: string; track: string; size?: number; stroke?: number }) {
  const size = props.size ?? 14;
  const stroke = props.stroke ?? 2;
  const half = size / 2;
  const ratio = Math.max(0, Math.min(1, props.ratio));
  const angle = ratio * 360;
  const circle: ViewStyle = {
    position: "absolute",
    top: 0,
    width: size,
    height: size,
    borderRadius: half,
    borderWidth: stroke,
  };
  // Top and right borders cover -45..135 degrees; turned 45 more, 0..180,
  // then back by (180 - end) so the half ring ends at `end`.
  const halfRing = (end: number, left: number) => (
    <View
      style={[
        circle,
        {
          left,
          borderColor: "transparent",
          borderTopColor: props.color,
          borderRightColor: props.color,
          transform: [{ rotate: `${45 + end - 180}deg` }],
        },
      ]}
    />
  );
  const radius = (size - stroke) / 2;
  const theta = (angle * Math.PI) / 180;
  const cap = (x: number, y: number) => (
    <View
      style={{
        position: "absolute",
        left: x - stroke / 2,
        top: y - stroke / 2,
        width: stroke,
        height: stroke,
        borderRadius: stroke / 2,
        backgroundColor: props.color,
      }}
    />
  );
  return (
    <View style={{ width: size, height: size }} testID="context-ring" {...hidden()}>
      <View style={[circle, { left: 0, borderColor: props.track }]} />
      {angle > 0 ? (
        <View
          style={{ position: "absolute", left: half, top: 0, width: half, height: size, overflow: "hidden" }}
          testID="context-ring-right"
        >
          {halfRing(Math.min(angle, 180), -half)}
        </View>
      ) : null}
      {angle > 180 ? (
        <View
          style={{ position: "absolute", left: 0, top: 0, width: half, height: size, overflow: "hidden" }}
          testID="context-ring-left"
        >
          {halfRing(angle, 0)}
        </View>
      ) : null}
      {angle > 0 && angle < 360 ? (
        <>
          {cap(half, half - radius)}
          {cap(half + radius * Math.sin(theta), half - radius * Math.cos(theta))}
        </>
      ) : null}
    </View>
  );
}
