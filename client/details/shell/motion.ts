/**
 * The details panel's motion (design table 5.5). One easing for every move,
 * cubic-bezier(0.2, 0, 0, 1); the scrim fades linearly. Under reduced motion
 * every change is a 120 ms fade and nothing moves, except under the finger.
 */
import { Animated, Platform } from "react-native";
import { cubicBezier } from "../../tasks/board/board-style";

export const DETAILS_MOTION = {
  /** Drawer and floating panel: translateY 100% to 0. */
  openMs: 280,
  scrimMs: 200,
  /** A detent change; a released drag takes `settleMs` instead. */
  detentMs: 240,
  closeMs: 200,
  /** Side panel: translateX 24 to 0 with a fade, and back. */
  sideOpenMs: 240,
  sideCloseMs: 160,
  sideShift: 24,
  /** Block switch: the old content leaves 25% (either way) over the first 120 ms, the new one comes in from 24 on the other side. */
  swipeMs: 220,
  swipeOutMs: 120,
  swipeShift: 24,
  swipeOut: 0.25,
  /** A form change: the old form fades out, the new one fades in, nothing moves. */
  formOutMs: 120,
  formInMs: 160,
  reducedMs: 120,
  /** How long the window must hold its size before the form is chosen again. */
  resizeSettleMs: 150,
} as const;

export const DETAILS_EASE = cubicBezier(0.2, 0, 0, 1);

const linear = (t: number) => t;

/**
 * Animates a transform or an opacity: `value` to `to`, then `done`. On iOS and
 * Android on the native driver, as the press preview's entrance is: a
 * JS-driven value commits a new tree on every frame, and the panel's first
 * frames are when its content (selectable text, images) gets its native
 * state. The values are never read back; `now` refs keep what they hold.
 */
export function animate(value: Animated.Value, to: number, ms: number, done?: () => void, ease: "ease" | "linear" = "ease"): Animated.CompositeAnimation {
  return run(value, to, ms, done, ease, Platform.OS !== "web");
}

/** Animates a layout value (a height), which only the JS driver can move. */
export function animateLayout(value: Animated.Value, to: number, ms: number, done?: () => void): Animated.CompositeAnimation {
  return run(value, to, ms, done, "ease", false);
}

function run(value: Animated.Value, to: number, ms: number, done: (() => void) | undefined, ease: "ease" | "linear", native: boolean) {
  const animation = Animated.timing(value, {
    toValue: to,
    duration: ms,
    easing: ease === "linear" ? linear : DETAILS_EASE,
    useNativeDriver: native,
  });
  animation.start(({ finished }) => {
    if (finished) done?.();
  });
  return animation;
}

/** The panel's elevation (design 5.6): #000 at 12% (light) or 50% (dark), y 8, blur 32. */
export function panelShadow(isDark: boolean, up = false): string {
  return `0px ${up ? -8 : 8}px 32px rgba(0, 0, 0, ${isDark ? 0.5 : 0.12})`;
}

export const isWeb = () => Platform.OS === "web";
