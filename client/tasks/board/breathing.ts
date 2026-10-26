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

export const FLASH = {
  /** The accent's strength over the fill at a pulse's peak: a pale tint. */
  peak: 0.07,
  /** Each pulse swells this long, */
  inMs: 600,
  /** then fades this long. */
  outMs: 800,
} as const;

/** A breath: slow at both ends, with no edge to the swell or the fade. */
const breathe = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

/**
 * A flash's opacity, for an accent fill laid over a background: `pulses` slow
 * pulses each time `key` moves past 0, after `delay`; one still beat under
 * reduced motion.
 */
export function useFlash(key: number, delay = 0, pulses = 2): Animated.Value {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // A new key swells on from where the last flash stood.
    if (key === 0) {
      value.setValue(0);
      return;
    }
    const to = (toValue: number, duration: number, wait = 0) => Animated.timing(value, { toValue, duration, delay: wait, easing: breathe, useNativeDriver: nativeDriver });
    const { peak, inMs, outMs } = FLASH;
    const steps = reduced
      ? [to(peak, 0, delay), to(0, 0, MOTION.highlightMs)]
      : Array.from({ length: pulses }, (_, index) => [to(peak, inMs, index === 0 ? delay : 0), to(0, outMs)]).flat();
    const animation = Animated.sequence(steps);
    animation.start();
    return () => animation.stop();
  }, [key, delay, pulses, reduced, value]);
  return value;
}
