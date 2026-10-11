import React, { useEffect, useRef, type ReactNode } from "react";
import { Animated, Platform, type StyleProp, type ViewStyle } from "react-native";
import { duration, easing, motionDuration } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * The expanded body's entrance (plan §3.7 item 2): opacity 0 -> 1 over 120 ms
 * on the native driver, played once on mount. Collapsing unmounts the body at
 * once, and there is no height animation, so nothing below it moves twice.
 * Reduced motion shows the body immediately. Every expandable block in the
 * plugin wraps its body in this; it is the only entrance motion there is.
 */
export function FadeIn({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
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
  }, [opacity, reducedMotion]);
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
