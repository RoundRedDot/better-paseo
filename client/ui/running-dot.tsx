import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet } from "react-native";
import { probeAnimationLoop } from "../debug/perf";
import { easing, runningDot } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

interface RunningDotProps {
  color: string;
  /** Defaults to the 6px token. */
  size?: number;
  accessibilityLabel?: string;
}

/**
 * The one looping animation in the plugin (plan §3.7): a dot pulsing between
 * full and 40% opacity while work is in flight. Mount it only while a tool is
 * running or a model is thinking; unmounting is what stops the loop, so a
 * finished card costs nothing.
 *
 * Opacity only, so the layout never moves, and on the native driver on iOS
 * and Android (React Native Web has none and animates on the JS thread).
 * Under reduced motion the dot is drawn static at full opacity.
 */
export function RunningDot({ color, size = runningDot.size, accessibilityLabel }: RunningDotProps) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(runningDot.maxOpacity)).current;

  useEffect(() => {
    if (reducedMotion) {
      opacity.setValue(runningDot.maxOpacity);
      return;
    }
    const half = runningDot.periodMs / 2;
    const useNativeDriver = Platform.OS !== "web";
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: runningDot.minOpacity,
          duration: half,
          easing: easing.out,
          useNativeDriver,
        }),
        Animated.timing(opacity, {
          toValue: runningDot.maxOpacity,
          duration: half,
          easing: easing.out,
          useNativeDriver,
        }),
      ]),
    );
    loop.start();
    const release = probeAnimationLoop("RunningDot");
    return () => {
      loop.stop();
      release();
    };
  }, [opacity, reducedMotion]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? "Running"}
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { flexShrink: 0 },
});
