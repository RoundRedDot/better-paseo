import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, type PressableProps } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function useActionPressMotion(enabled: boolean, pressedScale = 1.03) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const [pressed, setPressed] = useState(false);
  const touching = useRef(false);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  useEffect(() => {
    if (!enabled) {
      setPressed(false);
      scale.setValue(1);
    }
    return () => { animation.current?.stop(); };
  }, [enabled, scale]);
  useEffect(() => {
    if (reduced && enabled) {
      animation.current?.stop();
      scale.setValue(pressed ? pressedScale : 1);
    }
  }, [reduced, enabled, pressed, scale, pressedScale]);
  const change = (value: boolean) => {
    if (!enabled) return;
    setPressed(value);
    animation.current?.stop();
    if (reduced) {
      scale.setValue(value ? pressedScale : 1);
      return;
    }
    animation.current = Animated.timing(scale, { toValue: value ? pressedScale : 1, duration: 100, useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.current.start();
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

export function ActionPressable({ motion, pressedScale, style, ...props }: PressableProps & { motion: boolean; pressedScale?: number }) {
  const feedback = useActionPressMotion(motion && !props.disabled, pressedScale);
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
