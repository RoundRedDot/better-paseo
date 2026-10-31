import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, type PressableProps } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HOVER_SCALE } from "./hover-lift";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Scale for a press, and for a hover when the caller passes `lifted`.
 * The shadow and the wash belong to the button: this only grows it.
 * Reduced motion snaps the scale instead of timing it.
 */
export function useActionPressMotion(enabled: boolean, lifted = false) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [pressed, setPressed] = useState(false);
  const touching = useRef(false);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const grow = enabled && (pressed || lifted);
  useEffect(() => {
    if (!enabled) setPressed(false);
  }, [enabled]);
  useEffect(() => {
    animation.current?.stop();
    const to = grow ? HOVER_SCALE : 1;
    if (!enabled || reduced) {
      scale.setValue(to);
      return;
    }
    animation.current = Animated.timing(scale, { toValue: to, duration: 100, useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.current.start();
    return () => { animation.current?.stop(); };
  }, [enabled, grow, reduced, scale]);
  const change = (value: boolean) => {
    if (!enabled) return;
    setPressed(value);
  };
  return {
    pressed,
    style: { transform: [{ scale }] },
    onPressIn: () => change(true),
    onPressOut: () => { if (!touching.current) change(false); },
    onTouchStart: () => { touching.current = true; },
    onTouchEnd: () => { touching.current = false; change(false); },
    onTouchCancel: () => { touching.current = false; change(false); },
  };
}

export function ActionPressable({ motion, lifted = false, style, ...props }: PressableProps & { motion: boolean; lifted?: boolean }) {
  const feedback = useActionPressMotion(motion && !props.disabled, lifted && !props.disabled);
  if (!motion) return <Pressable {...props} style={style} />;
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => { feedback.onPressIn(); props.onPressIn?.(event); }}
      onPressOut={(event) => { feedback.onPressOut(); props.onPressOut?.(event); }}
      onTouchStart={(event) => { feedback.onTouchStart(); props.onTouchStart?.(event); }}
      onTouchEnd={(event) => { feedback.onTouchEnd(); props.onTouchEnd?.(event); }}
      onTouchCancel={(event) => { feedback.onTouchCancel(); props.onTouchCancel?.(event); }}
      style={[typeof style === "function" ? style({ pressed: feedback.pressed && !props.disabled }) : style, feedback.style]}
    />
  );
}
