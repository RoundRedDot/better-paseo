import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { probeAnimationLoop } from "../debug/perf";
import { holdStepClock } from "./step-clock";
import { runningDot, runningDotOpacity } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

interface RunningDotProps {
  color: string;
  /** Defaults to the 6px token. */
  size?: number;
  accessibilityLabel?: string;
}

/**
 * The one looping animation in the plugin (plan §3.7): a dot pulsing between
 * full and 30% opacity while work is in flight. Mount it only while a tool is
 * running or a model is thinking; unmounting is what stops the loop, so a
 * finished card costs nothing.
 *
 * Opacity only, so the layout never moves. iOS and Android step the opacity on
 * the shared step clock: a native-driver loop changed the dot on every vsync, and
 * many Android devices redraw the whole window for that, so one running tool kept
 * an idle screen at full frame rate. React Native Web has no native driver: an
 * `Animated` loop there re-renders the dot, and commits its whole row, on every
 * frame, so on web the pulse is a CSS animation that React never sees.
 * Under reduced motion the dot is drawn static at full opacity.
 */
export function RunningDot({ color, size = runningDot.size, accessibilityLabel }: RunningDotProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(runningDot.maxOpacity)).current;

  useEffect(() => {
    if (WEB) {
      return reducedMotion ? undefined : probeAnimationLoop("RunningDot");
    }
    if (reducedMotion) {
      opacity.setValue(runningDot.maxOpacity);
      return;
    }
    const releaseClock = holdStepClock(runningDot.periodMs, runningDot.steps, (step) =>
      opacity.setValue(runningDotOpacity(step)),
    );
    const release = probeAnimationLoop("RunningDot");
    return () => {
      releaseClock();
      release();
    };
  }, [opacity, reducedMotion]);

  const shape = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  if (WEB) {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={accessibilityLabel ?? "Running"}
        style={[styles.dot, shape, reducedMotion ? null : webPulse]}
      />
    );
  }

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? "Running"}
      style={[styles.dot, { ...shape, opacity }]}
    />
  );
}

const WEB = Platform.OS === "web";

const styles = StyleSheet.create({
  dot: { flexShrink: 0 },
});

/**
 * React Native Web compiles `animationKeyframes` into a `@keyframes` rule, but only
 * through `StyleSheet.create`, never as an inline style. CSS applies the timing
 * function per keyframe segment, so each half eases out like the native sequence.
 */
const webPulse: ViewStyle | null = WEB
  ? StyleSheet.create({
      pulse: {
        animationKeyframes: [
          {
            "0%": { opacity: runningDot.maxOpacity },
            "50%": { opacity: runningDot.minOpacity },
            "100%": { opacity: runningDot.maxOpacity },
          },
        ],
        animationDuration: `${runningDot.periodMs}ms`,
        animationIterationCount: "infinite",
        // outCubic, `1 - (1 - t)^3`.
        animationTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
      } as ViewStyle,
    }).pulse
  : null;
