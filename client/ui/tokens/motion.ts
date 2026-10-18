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

/** The running indicator (`RunningDot`): a 6px dot pulsing 1.0 <-> 0.3 every 1200 ms. */
export const runningDot = {
  size: 6,
  periodMs: 1200,
  minOpacity: 0.3,
  maxOpacity: 1,
} as const;

/** Every duration collapses to 0 while the system asks for reduced motion. */
export function motionDuration(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : ms;
}
