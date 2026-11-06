import { useEffect, useMemo, useRef } from "react";
import { Animated, Platform } from "react-native";
import { DESKTOP_OVERLAY, easing, PREVIEW_REVEAL } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

/** Start only after the modal is shown and its panel has been measured. */
export function usePreviewEntrance({ ready, quiet = false, from = Platform.OS === "web" ? DESKTOP_OVERLAY.shift : PREVIEW_REVEAL.shift }: {
  ready: boolean;
  quiet?: boolean;
  from?: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(quiet || reducedMotion ? 1 : Platform.OS === "web" ? DESKTOP_OVERLAY.opacity : 0)).current;
  // Keep the native interpolation node attached while content/layout updates.
  const translateY = useMemo(() => progress.interpolate({
    inputRange: [Platform.OS === "web" ? DESKTOP_OVERLAY.opacity : 0, 1], outputRange: [from, 0],
  }), [progress, from]);
  useEffect(() => {
    if (!ready) return;
    if (quiet || reducedMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: Platform.OS === "web" ? DESKTOP_OVERLAY.ms : PREVIEW_REVEAL.ms,
      easing: Platform.OS === "web" ? DESKTOP_OVERLAY.ease : easing.out,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [progress, ready, quiet, reducedMotion]);
  return {
    opacity: ready ? progress : 0,
    transform: [{ translateY: quiet || reducedMotion ? 0 : translateY }],
  };
}
