import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { themeKey } from "../../ui/tokens/theme-key";

/**
 * The board's derived colours and motion (prototype 6.1, 6.4). Colours are
 * the prototype's formulas, `mix(A, B, p) = A·p + B·(1 − p)`, written with
 * `theme-tokens`' `mix(from, to, t)`, which runs the other way.
 */
export interface BoardColors {
  /** The 16px dot grid under the lanes. */
  dotGrid: string;
  /** Unchecked boxes. */
  borderStrong: string;
  /** A selected chip's fill. */
  accentSoft: string;
  /** Menus and the details popover. */
  popoverShadow: string;
}

// Keyed on the colour strings: the host builds a fresh `theme.colors` on every render.
const cache = new Map<string, BoardColors>();

function isLight(color: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return true;
  const value = parseInt(match[1]!, 16);
  const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance >= 0.5;
}

export function boardColors(theme: PluginTheme): BoardColors {
  const colors = theme.colors;
  const key = themeKey(theme);
  let out = cache.get(key);
  if (!out) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value as string);
    const light = isLight(colors.surface0);
    out = {
      dotGrid: mix(colors.surface0, colors.foregroundMuted, 0.22),
      borderStrong: mix(colors.border, colors.foregroundMuted, 0.35),
      accentSoft: mix(colors.surface0, colors.accent, 0.12),
      popoverShadow: light
        ? "0px 8px 24px -6px rgba(0, 0, 0, 0.12), 0px 2px 6px -2px rgba(0, 0, 0, 0.06)"
        : "0px 8px 24px -6px rgba(0, 0, 0, 0.5), 0px 2px 6px -2px rgba(0, 0, 0, 0.35)",
    };
    cache.set(key, out);
  }
  return out;
}

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
