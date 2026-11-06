import { useEffect, useMemo, useRef } from "react";
import { Animated, Platform } from "react-native";
import { DESKTOP_OVERLAY, DROPDOWN_REVEAL, easing, PREVIEW_REVEAL } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

/** Start only after the modal is shown and its panel has been measured. */
export function usePreviewEntrance({ ready, quiet = false, from, dropdown = false }: {
  ready: boolean;
  quiet?: boolean;
  from?: number;
  dropdown?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const desktopDropdown = Platform.OS === "web" && dropdown;
  const reveal = desktopDropdown ? DROPDOWN_REVEAL : DESKTOP_OVERLAY;
  const shift = from ?? (Platform.OS === "web" ? reveal.shift : PREVIEW_REVEAL.shift);
  const progress = useRef(new Animated.Value(quiet || reducedMotion ? 1 : Platform.OS === "web" ? reveal.opacity : 0)).current;
  // Keep the native interpolation node attached while content/layout updates.
  const translateY = useMemo(() => progress.interpolate({
    inputRange: [Platform.OS === "web" ? reveal.opacity : 0, 1], outputRange: [shift, 0],
  }), [progress, shift, reveal]);
  const scale = useMemo(() => desktopDropdown ? progress.interpolate({
    inputRange: [DROPDOWN_REVEAL.opacity, 1], outputRange: [DROPDOWN_REVEAL.scale, 1],
  }) : 1, [progress, desktopDropdown]);
  useEffect(() => {
    if (!ready) return;
    if (quiet || reducedMotion) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: Platform.OS === "web" ? reveal.ms : PREVIEW_REVEAL.ms,
      easing: Platform.OS === "web" ? reveal.ease : easing.out,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [progress, ready, quiet, reducedMotion, reveal]);
  return {
    opacity: ready ? progress : 0,
    transform: [{ translateY: quiet || reducedMotion ? 0 : translateY },
      ...(desktopDropdown && !quiet && !reducedMotion ? [{ scale }] : [])],
  };
}
