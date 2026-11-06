/**
 * Motion tokens (plan §3.7, BC-09).
 *
 * The chat timeline and its details share these: the running indicator, the
 * fade-in of an expanded body, the preview entrance, and the floating controls
 * (a table's copy menu, the selection bar), whose CSS transitions live with
 * their family in `float.ts`. The Tasks board keeps its own choreography (lane
 * motion, rolling counts, lane flashes) in `MOTION` in
 * `client/tasks/board/board-style.ts`. There is no spring and no scale on
 * purpose: the requirement rules out bounce and noticeable zoom.
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

/** Desktop overlays are readable from their first frame, then settle without zoom or overshoot. */
export const DESKTOP_OVERLAY = {
  ms: 100,
  shift: 2,
  opacity: 0.9,
  cssEase: "cubic-bezier(0.16, 1, 0.3, 1)",
  ease: cubicBezier(0.16, 1, 0.3, 1),
} as const;

/** `cubic-bezier(x1, y1, x2, y2)` as an easing for `Animated.timing`. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const curve = (a: number, b: number, s: number) => 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) * (1 - s) + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const error = curve(x1, x2, s) - t;
      if (Math.abs(error) < 1e-5) break;
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= error / d;
    }
    return curve(y1, y2, Math.min(1, Math.max(0, s)));
  };
}

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
