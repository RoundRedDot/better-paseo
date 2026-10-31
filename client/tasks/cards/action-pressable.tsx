import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, type PressableProps } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A touch action pulses once, including when the finger lifts immediately. */
export function useActionPressMotion(enabled: boolean) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const active = enabled && !reduced;
  useEffect(() => {
    if (!active) {
      animation.current?.stop();
      scale.setValue(1);
    }
    return () => { animation.current?.stop(); };
  }, [active, scale]);
  return {
    style: { transform: [{ scale: active ? scale : 1 }] },
    onPressIn: () => {
      if (!active) return;
      animation.current?.stop();
      animation.current = Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 100, useNativeDriver: Platform.OS !== "web", isInteraction: false }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 220, useNativeDriver: Platform.OS !== "web", isInteraction: false }),
      ]);
      animation.current.start();
    },
  };
}

export function ActionPressable({ motion, style, ...props }: PressableProps & { motion: boolean }) {
  const pulse = useActionPressMotion(motion && !props.disabled);
  const [pressed, setPressed] = useState(false);
  if (!motion) return <Pressable {...props} style={style} />;
  return (
    <AnimatedPressable
      {...props}
      onPressIn={(event) => {
        setPressed(true);
        pulse.onPressIn();
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        props.onPressOut?.(event);
      }}
      style={[typeof style === "function" ? style({ pressed: pressed && !props.disabled }) : style, pulse.style]}
    />
  );
}
