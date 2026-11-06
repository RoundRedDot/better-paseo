import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, type GestureResponderEvent, type PressableProps } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { PAN_SLOP, PRESS_CUE_DELAY, PRESS_MOTION, SCROLL_SLOP, pressInput, surfaceLift, type LiftSize, type PressInput } from "./surface-lift";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A CSS `cubic-bezier(x1, y1, x2, y2)` as an easing function. */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t) => {
    if (t <= 0 || t >= 1) return t;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < t) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const EASE_OUT = bezier(0, 0, 0.58, 1);
const SETTLE = bezier(0.2, 0, 0, 1);

/** A touch's page point: React Native puts it on the event, the web on its first touch. */
function touchPoint(event: GestureResponderEvent | undefined): { x: number; y: number } | null {
  const native = event?.nativeEvent as { pageX?: number; pageY?: number; touches?: { pageX: number; pageY: number }[] } | undefined;
  if (!native) return null;
  if (typeof native.pageX === "number" && typeof native.pageY === "number") return { x: native.pageX, y: native.pageY };
  const first = native.touches?.[0];
  return first ? { x: first.pageX, y: first.pageY } : null;
}

export interface PressCue {
  /** Show the press cue now. */
  pressed: boolean;
  /** Who is pressing: a pointer (desktop, iPad trackpad) or a finger. */
  input: PressInput;
  onPressIn(event?: GestureResponderEvent): void;
  onPressOut(event?: GestureResponderEvent): void;
  onTouchStart(event?: GestureResponderEvent): void;
  onTouchMove(event?: GestureResponderEvent): void;
  onTouchEnd(event?: GestureResponderEvent): void;
  onTouchCancel(event?: GestureResponderEvent): void;
  /** Wrap `onPress` / `onLongPress`: a gesture that became a scroll or the host's pan fires nothing. */
  guard(handler: ((event: GestureResponderEvent) => void) | undefined | null): ((event: GestureResponderEvent) => void) | undefined;
}

/**
 * When a press shows. A pointer (desktop, or an iPad trackpad whose hover arrived
 * first) shows it at once. A finger shows it after `PRESS_CUE_DELAY` without
 * moving, and a quick tap still shows it for that long after lifting. A finger
 * that moves `SCROLL_SLOP` down or up, or `PAN_SLOP` sideways, is a scroll or
 * the host's agent-list pan: the cue clears at once and the press fires nothing.
 */
export function usePressCue(hovered: boolean, enabled = true): PressCue {
  const [cue, setCue] = useState<{ pressed: boolean; input: PressInput }>({ pressed: false, input: "pointer" });
  // Gesture bookkeeping for this one press; none of it is shown.
  const gesture = useRef({ hovered, input: "pointer" as PressInput, start: null as { x: number; y: number } | null, cancelled: false, shown: false, timer: null as ReturnType<typeof setTimeout> | null });
  gesture.current.hovered = hovered;
  const clear = () => {
    const g = gesture.current;
    if (g.timer) clearTimeout(g.timer);
    g.timer = null;
  };
  const hide = () => setCue((was) => (was.pressed ? { ...was, pressed: false } : was));
  const cancel = () => {
    gesture.current.cancelled = true;
    clear();
    hide();
  };
  useEffect(() => clear, []);
  useEffect(() => {
    if (enabled) return;
    clear();
    hide();
  }, [enabled]);
  return {
    pressed: enabled && cue.pressed,
    input: cue.input,
    onTouchStart: (event) => {
      const g = gesture.current;
      g.start = touchPoint(event);
      g.cancelled = false;
    },
    onTouchMove: (event) => {
      const g = gesture.current;
      const point = touchPoint(event);
      if (!g.start || !point || g.cancelled) return;
      if (Math.abs(point.y - g.start.y) >= SCROLL_SLOP || Math.abs(point.x - g.start.x) >= PAN_SLOP) cancel();
    },
    // A child's touches bubble here without giving this surface the responder's press-out.
    onTouchEnd: () => { gesture.current.start = null; },
    onTouchCancel: () => { gesture.current.start = null; cancel(); },
    onPressIn: () => {
      if (!enabled) return;
      const g = gesture.current;
      clear();
      // No touch started this press (a pointer, or a touch reported only as a press): nothing cancelled it yet.
      if (!g.start) g.cancelled = false;
      g.input = pressInput(g.hovered);
      g.shown = false;
      if (g.input === "pointer") {
        g.cancelled = false;
        g.shown = true;
        setCue({ pressed: true, input: "pointer" });
        return;
      }
      if (g.cancelled) return;
      g.timer = setTimeout(() => {
        g.timer = null;
        if (g.cancelled) return;
        g.shown = true;
        setCue({ pressed: true, input: "finger" });
      }, PRESS_CUE_DELAY);
    },
    onPressOut: () => {
      const g = gesture.current;
      clear();
      g.start = null;
      if (enabled && g.input === "finger" && !g.shown && !g.cancelled) {
        // A quick tap: show the cue for as long as the finger would have waited.
        setCue({ pressed: true, input: "finger" });
        g.timer = setTimeout(() => {
          g.timer = null;
          hide();
        }, PRESS_CUE_DELAY);
        return;
      }
      hide();
    },
    guard: (handler) => handler ? (event) => {
      if (gesture.current.cancelled) {
        // Accessibility clicks bypass press-in: native has no touch identifier; web has a zero click count.
        const native = event.nativeEvent as GestureResponderEvent["nativeEvent"] & { detail?: number };
        if (Platform.OS === "web" ? native.detail !== 0 : native.identifier !== undefined) return;
      }
      handler(event);
    } : undefined,
  };
}

/**
 * The press of a lifted control: its cue (`usePressCue`) and the inset a
 * pointer press animates to (`surfaceLift`), in 80 ms ease-out and out 160 ms
 * `cubic-bezier(.2,0,0,1)`. A finger never scales; reduced motion snaps to 1.
 */
export function useLiftPress(hovered: boolean, size: LiftSize = "control", enabled = true) {
  const reduced = useReducedMotion();
  const cue = usePressCue(hovered, enabled);
  const [scale] = useState(() => new Animated.Value(1));
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const target = surfaceLift(hovered, cue.pressed, reduced, size, cue.input).scale;
  const shown = useRef(1);
  useEffect(() => {
    if (shown.current === target) return;
    const pressing = target < shown.current;
    shown.current = target;
    animation.current?.stop();
    if (reduced) {
      scale.setValue(target);
      return;
    }
    animation.current = Animated.timing(scale, {
      toValue: target,
      duration: pressing ? PRESS_MOTION.in : PRESS_MOTION.out,
      easing: pressing ? EASE_OUT : SETTLE,
      useNativeDriver: Platform.OS !== "web",
      isInteraction: false,
    });
    animation.current.start();
  }, [target, reduced, scale]);
  useEffect(() => () => animation.current?.stop(), []);
  return { ...cue, style: { transform: [{ scale }] } };
}

/**
 * A free-standing control's own press grow (the phone's floating scroll
 * button): `pressedScale` while held, until the touch ends. Not the lift.
 */
export function useActionPressMotion(enabled: boolean, pressedScale: number) {
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

type ActionPressableProps = PressableProps & {
  /** What the lift treats it as. A card button or chip is a `control` (the default); a wide bar button a `row`. */
  lift?: LiftSize;
  /** A free-standing grow instead of the lift (`useActionPressMotion`), while `motion` is on. */
  pressedScale?: number;
  motion?: boolean;
};

/**
 * A board action button. Its style callback's `pressed` is the press cue
 * (`usePressCue`), and a pointer press insets it (`useLiftPress`). It keeps
 * its own hover so a trackpad press is told from a finger's.
 */
export function ActionPressable(props: ActionPressableProps) {
  if (props.pressedScale !== undefined) return <GrowPressable {...props} pressedScale={props.pressedScale} />;
  return <LiftPressable {...props} />;
}

function LiftPressable({ lift = "control", motion: _motion, pressedScale: _scale, style, ...props }: ActionPressableProps) {
  const [hovered, setHovered] = useState(false);
  const press = useLiftPress(hovered, lift, !props.disabled);
  return (
    <AnimatedPressable
      {...props}
      onHoverIn={(event) => { setHovered(true); props.onHoverIn?.(event); }}
      onHoverOut={(event) => { setHovered(false); props.onHoverOut?.(event); }}
      onPress={press.guard(props.onPress)}
      onLongPress={press.guard(props.onLongPress)}
      onPressIn={(event) => { press.onPressIn(event); props.onPressIn?.(event); }}
      onPressOut={(event) => { press.onPressOut(event); props.onPressOut?.(event); }}
      onTouchStart={(event) => { press.onTouchStart(event); props.onTouchStart?.(event); }}
      onTouchMove={(event) => { press.onTouchMove(event); props.onTouchMove?.(event); }}
      onTouchEnd={(event) => { press.onTouchEnd(event); props.onTouchEnd?.(event); }}
      onTouchCancel={(event) => { press.onTouchCancel(event); props.onTouchCancel?.(event); }}
      // One flat style, as a plain Pressable's: the inset joins whatever the control draws.
      style={StyleSheet.flatten([typeof style === "function" ? style({ pressed: press.pressed && !props.disabled }) : style, press.style])}
    />
  );
}

function GrowPressable({ motion = true, pressedScale, style, lift: _lift, ...props }: ActionPressableProps & { pressedScale: number }) {
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
