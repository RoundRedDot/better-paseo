import React from "react";
import { View, type ViewStyle } from "react-native";

interface ProgressRingProps {
  value: number;
  max: number;
  /** Outer diameter. */
  size: number;
  stroke: number;
  color: string;
  trackColor: string;
}

/**
 * A static ring that fills clockwise from 12 o'clock. The plugin sandbox has
 * no react-native-svg, so the arc is a bordered circle with only its top and
 * right sides coloured — a half ring from 315° to 135° — turned so it ends at
 * the value and clipped to one half of the track. Up to half full that is one
 * clipped arc; past half a second fills the left half. A full ring is just
 * the track drawn in `color`.
 *
 * Three views up to half, five past it.
 */
export function ProgressRing({ value, max, size, stroke, color, trackColor }: ProgressRingProps) {
  const fraction = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const full = fraction >= 1;
  const half = size / 2;
  const circle: ViewStyle = { width: size, height: size, borderRadius: half, borderWidth: stroke };
  // The arc spans [end - 180°, end]; its own corners sit at 135° before turning.
  const arc = (endDeg: number, left: number): ViewStyle => ({
    ...circle,
    position: "absolute",
    top: 0,
    left,
    borderColor: "transparent",
    borderTopColor: color,
    borderRightColor: color,
    transform: [{ rotate: `${endDeg - 135}deg` }],
  });
  // Absolute children sit inside the track's border, so they step back by it.
  const clip = (left: number): ViewStyle => ({
    position: "absolute",
    top: -stroke,
    left: left - stroke,
    width: half,
    height: size,
    overflow: "hidden",
  });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max, now: value }}
      style={[circle, { borderColor: full ? color : trackColor }]}
    >
      {!full && fraction > 0 ? (
        <View style={clip(half)}>
          <View style={arc(Math.min(fraction, 0.5) * 360, -half)} />
        </View>
      ) : null}
      {!full && fraction > 0.5 ? (
        <View style={clip(0)}>
          <View style={arc(fraction * 360, 0)} />
        </View>
      ) : null}
    </View>
  );
}
