/**
 * The board's motion (prototype 6.4). Colours come from the cards' `taskTokens`.
 */

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

export const MOTION = {
  /** Every board transition: cubic-bezier(.2, 0, 0, 1), no overshoot. */
  ease: cubicBezier(0.2, 0, 0, 1),
  /** The phone's lane switch: underline and incoming content. */
  laneMs: 200,
  /** The outgoing lane's fade. */
  laneOutMs: 120,
  /** How far lane content travels on a switch. */
  laneShift: 24,
  /** A card that changed lanes fades in. */
  fadeMs: 120,
  popoverInMs: 160,
  /** The skeleton breathes from 1 to 0.5 and back. */
  skeletonMs: 1200,
  /** Hover before the details popover opens; leave before it closes. */
  popoverOpenMs: 450,
  popoverCloseMs: 150,
  highlightMs: 1000,
} as const;
