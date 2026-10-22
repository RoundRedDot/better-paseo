import { PixelRatio, Platform, StyleSheet } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { themeKey } from "../../ui/tokens/theme-key";

/**
 * The board's own palette, after Linear's board (page #f9f9fa, lanes
 * #f6f6f7 in its light theme): the page is `surface0` and each lane a
 * rounded panel a small step off it. Paseo's light `surface1` (#fafafa)
 * is too close to white to read, so a light panel sits halfway between
 * `surface1` and `surface2` (#f7f7f8); a dark one is `surface1`. Cards keep
 * `surface0`. The hex values are calibration against Paseo's default light
 * theme only: every colour here is derived from the host theme.
 */
/** Every line the board draws (borders, dividers, pills) is one device pixel, as Linear's are. */
export const HAIRLINE = StyleSheet.hairlineWidth;

/**
 * One device pixel, on the web too: react-native-web's `hairlineWidth` is a
 * whole CSS pixel, two device pixels on a retina screen. Read at render, as
 * the window can move to a screen of another density.
 */
export function devicePixel(): number {
  return Platform.OS === "web" ? 1 / Math.max(1, PixelRatio.get()) : StyleSheet.hairlineWidth;
}

/** Checkbox and letter-avatar outlines are part of the glyph, not a divider: a full point keeps them legible. */
export const GLYPH_LINE = 1;

/** Linear's lane panel corner: a 10 device px arc at 2x. */
export const PANEL_RADIUS = 5;

export interface BoardPalette {
  page: string;
  panel: string;
  /** A ghost button's hover and press fill on the panel. */
  panelHover: string;
}

const palettes = new Map<string, BoardPalette>();

function isDark(color: string): boolean {
  const value = color.trim();
  const hex = /^#([0-9a-f]{6})/i.exec(value)?.[1];
  let rgb: number[] | null = hex ? [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) : null;
  if (!rgb) {
    const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
    rgb = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }
  if (!rgb) return false;
  return (0.299 * rgb[0]! + 0.587 * rgb[1]! + 0.114 * rgb[2]!) / 255 < 0.5;
}

export function boardPalette(theme: PluginTheme): BoardPalette {
  const key = themeKey(theme);
  let palette = palettes.get(key);
  if (!palette) {
    if (palettes.size >= 8) palettes.delete(palettes.keys().next().value as string);
    const colors = theme.colors;
    const panel = isDark(colors.surface0) ? colors.surface1 : mix(colors.surface1, colors.surface2, 0.5);
    palette = { page: colors.surface0, panel, panelHover: colors.surface2 };
    palettes.set(key, palette);
  }
  return palette;
}

/**
 * The board's motion (prototype 6.4).
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
  /** A card that came into a lane from out of view fades in, once the cards below are half way out of its place. */
  fadeMs: 120,
  fadeDelayMs: 120,
  /** A card moved within its lane (one above it left or came in) slides to its new place. */
  slideMs: 240,
  /** A card that changed lanes travels from its old place to its new one. */
  flyMs: 300,
  /** A card that left the board fades where it was. */
  leaveMs: 160,
  /** A desktop lane collapsed, expanded or switched to another width eases to its new width. */
  resizeMs: 220,
  /** The strip or list swapped in as a lane collapses or expands fades in. */
  swapMs: 160,
  /** The skeleton breathes from 1 to 0.5 and back. */
  skeletonMs: 1200,
  highlightMs: 1000,
} as const;
