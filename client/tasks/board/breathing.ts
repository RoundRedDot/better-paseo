import { useEffect, useRef } from "react";
import { Animated, Platform } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { MOTION } from "./board-style";

const nativeDriver = Platform.OS !== "web";

/** The skeletons' shared breathing, 1 → 0.5 → 1 over 1200 ms; still under reduced motion or while hidden. */
export function useBreathing(active: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    value.setValue(1);
    if (!active || reduced) return;
    const half = MOTION.skeletonMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.5, duration: half, useNativeDriver: nativeDriver }),
        Animated.timing(value, { toValue: 1, duration: half, useNativeDriver: nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, value]);
  return value;
}
