import { useMemo } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { themeKey } from "../../ui/tokens/theme-key";

/**
 * The board's derived colours (prototype 6.1), computed from the host theme.
 *
 * The prototype writes `mix(A, B, p) = A × p + B × (1 − p)`; `mix` in
 * theme-tokens blends from its first argument towards the second, so the
 * prototype's `mix(A, B, p)` is `mix(B, A, p)` here.
 *
 * The status band is Paseo's internal `statusDot*` colours, which the plugin
 * theme does not carry: picked by the luminance of `surface0`, exactly as the
 * host's light and dark themes define them.
 */
export interface TaskTokens {
  isDark: boolean;
  surface0: string;
  surface1: string;
  surface2: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  /** Paseo's `statusDot*` band: running ring, needs-input alert, unread dot, failed dot. */
  status: { running: string; warning: string; success: string; danger: string };
  /** The host's `statusWarning`/`statusDanger`, for text and bars (context, timers, errors). */
  warning: string;
  danger: string;
  /** The board's dot grid, 1px every 16. */
  dotGrid: string;
  /** Card hover border, unchecked boxes. */
  borderStrong: string;
  /** Switch-on fill, allow button hover. */
  accentSoft: string;
  /** The 3px focus ring outside the accent border. */
  accentRing: string;
  /** The 1 s background after a parent link scrolled here. */
  highlight: string;
  /** The confirm-stop button's fill. */
  dangerSoft: string;
  /** CSS `box-shadow` for menus, the details popover and toasts only. */
  popoverShadow: string;
  /** The phone sheet's backdrop; fixed, not a theme colour. */
  scrim: string;
  /** Label chip: fill, border, text. */
  tagChip: { background: string; border: string; text: string };
}

const STATUS_LIGHT = { running: "#268ae0", warning: "#b37824", success: "#299f51", danger: "#f12e2f" } as const;
const STATUS_DARK = { running: "#5caaf6", warning: "#db932e", success: "#35c264", danger: "#f7796d" } as const;

/** Relative luminance-ish brightness of a `#rrggbb` colour, 0..1; null when unparseable. */
function brightness(color: string): number | null {
  const hex = /^#([0-9a-f]{6})/i.exec(color.trim())?.[1];
  if (!hex) {
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
    if (!rgb) return null;
    return (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255;
  }
  const channel = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  return (0.299 * channel(0) + 0.587 * channel(2) + 0.114 * channel(4)) / 255;
}

export function buildTaskTokens(colors: PluginTheme["colors"]): TaskTokens {
  const isDark = (brightness(colors.surface0) ?? 0) < 0.5;
  const s0 = colors.surface0;
  const status = isDark ? STATUS_DARK : STATUS_LIGHT;
  const danger = colors.statusDanger || status.danger;
  return {
    isDark,
    surface0: s0,
    surface1: colors.surface1,
    surface2: colors.surface2,
    border: colors.border,
    foreground: colors.foreground,
    foregroundMuted: colors.foregroundMuted,
    accent: colors.accent,
    status,
    warning: colors.statusWarning || status.warning,
    danger,
    dotGrid: mix(s0, colors.foregroundMuted, 0.22),
    borderStrong: mix(colors.border, colors.foregroundMuted, 0.35),
    accentSoft: mix(s0, colors.accent, 0.12),
    accentRing: mix(s0, colors.accent, 0.28),
    highlight: mix(s0, colors.accent, 0.08),
    dangerSoft: mix(s0, danger, 0.1),
    popoverShadow: isDark
      ? "0px 8px 24px -6px rgba(0, 0, 0, 0.5), 0px 2px 6px -2px rgba(0, 0, 0, 0.35)"
      : "0px 8px 24px -6px rgba(0, 0, 0, 0.12), 0px 2px 6px -2px rgba(0, 0, 0, 0.06)",
    scrim: isDark ? "rgba(0, 0, 0, 0.56)" : "rgba(0, 0, 0, 0.32)",
    tagChip: { background: s0, border: colors.border, text: colors.foregroundMuted },
  };
}

/**
 * One object per theme for the whole board: Paseo rebuilds `theme.colors` on
 * every render, so the cache is keyed on the colour strings. A handful of
 * entries covers a theme switch and the settings preview's other theme.
 */
const cache = new Map<string, TaskTokens>();

export function taskTokens(theme: PluginTheme): TaskTokens {
  const key = themeKey(theme);
  let tokens = cache.get(key);
  if (!tokens) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value as string);
    tokens = buildTaskTokens(theme.colors);
    cache.set(key, tokens);
  }
  return tokens;
}

export function useTaskTokens(theme: PluginTheme): TaskTokens {
  const key = themeKey(theme);
  // `theme` is read through `key`; its identity changes every render.
  return useMemo(() => taskTokens(theme), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
