import React, { useEffect, useRef, type ReactNode } from "react";
import { Animated, Platform } from "react-native";
import { duration, easing, motionDuration } from "../ui/tokens/motion";
import { useReducedMotion } from "../ui/use-reduced-motion";

/**
 * The expanded body's entrance (plan §3.7 item 2): opacity 0 -> 1 over 120 ms
 * on the native driver, played once on mount. Collapsing unmounts the body at
 * once, and there is no height animation, so nothing below it moves twice.
 * Reduced motion shows the body immediately.
 */
export function FadeIn({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    const ms = motionDuration(duration.fast, reducedMotion);
    if (ms === 0) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: ms,
      easing: easing.out,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
    // Mount only: the entrance plays once per expansion.
  }, []);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}
