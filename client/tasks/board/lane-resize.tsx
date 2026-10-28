import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Platform } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { MOTION } from "./board-style";

const nativeDriver = Platform.OS !== "web";

type Resize = { from: number; to: number };

/**
 * A desktop lane's width. It eases to a new width when the user changed the
 * lanes' sizing (`sizing`: a lane collapsed or expanded, the lane width
 * switched), and takes it at once otherwise: the board resized. A change that lands
 * mid-way starts from where the lane is. No motion when reduced.
 *
 * Only the lane's clip moves: its content takes the new width at once, so a
 * list's cards lay out once, not on every frame. `moving` is true while it
 * eases, for content swapped in then to fade in.
 */
export function useLaneWidth(target: number, sizing: string): { width: number | Animated.Value; moving: boolean } {
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState({ target, sizing });
  const [resize, setResize] = useState<Resize | null>(null);
  // Where an easing lane is, frame by frame: the start of the next one if the target moves again.
  const now = useRef(target);
  if (seen.target !== target || seen.sizing !== sizing) {
    setSeen({ target, sizing });
    if (seen.target !== target) {
      const eases = seen.sizing !== sizing && !reduced;
      setResize(eases ? { from: resize ? now.current : seen.target, to: target } : null);
    }
  }
  // A fresh value per resize, so its first frame draws at `from` and not where the last one ended.
  const value = useMemo(() => (resize ? new Animated.Value(resize.from) : null), [resize]);
  useEffect(() => {
    if (!resize || !value) return;
    now.current = resize.from;
    const listener = value.addListener(({ value: width }) => {
      now.current = width;
    });
    const animation = Animated.timing(value, { toValue: resize.to, duration: MOTION.resizeMs, easing: MOTION.ease, useNativeDriver: false });
    animation.start(({ finished }) => {
      if (finished) setResize((current) => (current === resize ? null : current));
    });
    return () => {
      animation.stop();
      value.removeListener(listener);
    };
  }, [resize, value]);
  return { width: value ?? target, moving: resize !== null };
}

/** Slide the complete panel inside its fixed slot; reversing keeps the current position. */
export function useLaneSlide(phase: "enter" | "leave" | null, distance: number): Animated.Value {
  const reduced = useReducedMotion();
  const x = useRef(new Animated.Value(phase === "enter" && !reduced ? distance : 0)).current;
  useEffect(() => {
    if (!phase || reduced) {
      x.setValue(0);
      return;
    }
    const animation = Animated.timing(x, { toValue: phase === "leave" ? distance : 0, duration: MOTION.resizeMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [x, phase, distance, reduced]);
  return x;
}

/** A lane's content swapped in while the lane eases (strip for list, or back): opacity 0 -> 1 once on mount. */
export function LaneSwap(props: { fade: boolean; width: number; children: ReactNode }) {
  // Decided at mount: the swap remounts this, a resize alone does not.
  const play = useRef(props.fade).current;
  const opacity = useRef(new Animated.Value(play ? 0 : 1)).current;
  useEffect(() => {
    if (!play) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: MOTION.swapMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start();
    return () => animation.stop();
  }, [play, opacity]);
  return <Animated.View style={{ width: props.width, flex: 1, minHeight: 0, flexDirection: "row", opacity }}>{props.children}</Animated.View>;
}
