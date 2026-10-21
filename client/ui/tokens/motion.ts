/**
 * Motion tokens (plan §3.7, BC-09).
 *
 * Three kinds of motion remain in the plugin: the running indicator, the
 * fade-in of an expanded body, and the floating controls (a table's copy
 * menu, the selection bar), whose CSS transitions live with their family in
 * `float.ts`. The first two read their timing from here. There is no
 * spring and no scale on purpose: the requirement rules out bounce and
 * noticeable zoom.
 *
 * Pure (no `react-native` import) so it can be unit tested; React Native's
 * `Animated.timing` accepts any `(t) => number` as its easing.
 */

export const duration = {
  /** Fades and state changes. */
  fast: 120,
} as const;

/** Shared native and web preview entrance, applied after positioning. */
export const PREVIEW_REVEAL = { ms: 140, shift: 4 } as const;

/** Decelerating cubic: `1 - (1 - t)^3`. */
export function outCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

export const easing = { out: outCubic } as const;

/**
 * Holds each of `steps` values for an equal share of the period: 0, 1/steps, ...
 * Native loops run on the native driver with this easing. Many Android devices
 * redraw the whole window for any changed view; a value that holds between steps
 * changes the view only on a step, while the native driver keeps JS out of it.
 * (A JS timer calling `setValue` instead commits a Fabric tree per call.)
 */
export function steppedEasing(steps: number): (t: number) => number {
  return (t) => Math.min(Math.floor(t * steps), steps - 1) / steps;
}

/**
 * The running indicator (`RunningDot`): a 6px dot pulsing 1.0 <-> 0.3 every 1200 ms.
 * Native steps through `steps` phases per period; web keeps a smooth CSS animation.
 */
export const runningDot = {
  size: 6,
  periodMs: 1200,
  steps: 4,
  minOpacity: 0.3,
  maxOpacity: 1,
} as const;

const runningDotMiddle = (runningDot.maxOpacity + runningDot.minOpacity) / 2;

/** The dot's phase (0..1) to opacity: full, halfway, faint, halfway. */
export const runningDotOpacityRange = {
  inputRange: [0, 0.25, 0.5, 0.75, 1],
  outputRange: [runningDot.maxOpacity, runningDotMiddle, runningDot.minOpacity, runningDotMiddle, runningDot.maxOpacity],
};

/** Every duration collapses to 0 while the system asks for reduced motion. */
export function motionDuration(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : ms;
}
