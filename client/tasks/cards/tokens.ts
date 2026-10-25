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
  /** The accent as text: pulled towards the foreground until it reads at 4.5:1 on the card and the surfaces. */
  accentText: string;
  /** Paseo's `statusDot*` band: running ring, needs-input alert, unread dot, failed dot. */
  status: { running: string; warning: string; success: string; danger: string };
  /** The branch pill's hue: GitHub's branch-label blue, the same whatever the theme's accent. */
  branch: string;
  /** The host's `statusWarning`/`statusDanger`, for text and bars (context, timers, errors). */
  warning: string;
  danger: string;
  /** The host's `statusSuccess`. */
  success: string;
  /** The board's dot grid, 1px every 16. */
  dotGrid: string;
  /** Card hover border, unchecked boxes. */
  borderStrong: string;
  /** Switch-on fill, allow button hover. */
  accentSoft: string;
  /** The 1 s background after a parent link scrolled here. */
  highlight: string;
  /** The confirm-stop button's fill. */
  dangerSoft: string;
  /** CSS `box-shadow` for menus and toasts only. */
  popoverShadow: string;
  /** The phone sheet's backdrop; fixed, not a theme colour. */
  scrim: string;
  /** Label chip: fill, border, text. */
  tagChip: { background: string; border: string; text: string };
  /**
   * The card, after Linear's issue card: the raised surface (surface0 on a
   * light theme, surface2 on a dark one), a hairline border and a 1 px shadow;
   * pills outlined a step darker than the border.
   */
  card: CardTokens;
}

export interface CardTokens {
  /** One step lighter than the lane panel: surface0 on a light theme, surface2 on a dark one. */
  background: string;
  /** Hover, as Linear: the fill greys a step (foreground at 4%); the border stays. */
  hoverBackground: string;
  /** The hairline outline (theme border). */
  border: string;
  /** CSS box-shadow at rest and on hover: short and mostly downward, fainter on a dark theme. */
  shadow: string;
  shadowHover: string;
  /** Neutral pill and secondary-button outline: the border a step towards the foreground. */
  pillBorder: string;
  /**
   * A neutral action button's 0.5 pt outline (Open tab, the sidebar's and the
   * phone bar's plain buttons): the pill's line on a light theme, a further
   * step towards the foreground on a dark one, where the theme border all but
   * matches the card and a half-pixel line in it disappears.
   */
  buttonBorder: string;
  /** A neutral pill's fill (branch, folder, path, PR, a label without colour). */
  pillFill: string;
  /** A hovered control's fill on the card. */
  controlHover: string;
  /** The 1 s background after a parent link scrolled here. */
  highlight: string;
  /** The card the details sidebar shows: the accent at 7% over the card, and its border mixed 45% towards the accent. */
  current: string;
  currentBorder: string;
  /** A failed card: the danger hue at 5% over the card (8% dark), a step more on hover, and its border and divider mixed towards it. */
  failed: string;
  failedHover: string;
  failedBorder: string;
  /**
   * The card's coloured buttons are outlines: at rest a hairline, label and
   * icon in their hue and no fill of their own; hovered, that hue tinted over
   * the card. Primary (Allow) in the accent.
   */
  primaryBorder: string;
  primaryHover: string;
  /** The primary button's label: the accent, readable at 4.5:1 on the card and on its hover. */
  primaryText: string;
  /** Stop and Deny: a danger hairline and label; hovered, the danger tinted over the card. */
  dangerHover: string;
  /** "Answer": the needs-input amber. */
  answerBorder: string;
  answerHover: string;
  /** Its label and arrow: the amber, readable at 4.5:1 on the card and on its hover. */
  answerText: string;
  /** Mark read on an unread card: the unread dot's green. */
  readBorder: string;
  readHover: string;
  /** Its label and icon: the green, readable at 4.5:1 on the card and on its hover. */
  readText: string;
  /** Archive: yellow, distinct from the warning orange. */
  archiveBorder: string;
  archiveHover: string;
  /** Its label and icon: the yellow, readable at 4.5:1 on the card and on its hover. */
  archiveText: string;
}

const STATUS_LIGHT = { running: "#268ae0", warning: "#b37824", success: "#299f51", danger: "#f12e2f" } as const;
const STATUS_DARK = { running: "#5caaf6", warning: "#db932e", success: "#35c264", danger: "#f7796d" } as const;
/** Archive's yellow, kept clear of the warning orange: Tailwind yellow-500, yellow-400 on a dark theme. */
const ARCHIVE_LIGHT = "#eab308";
const ARCHIVE_DARK = "#facc15";
const BRANCH_LIGHT = "#0969da";
const BRANCH_DARK = "#4493f8";

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

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (i: number) => {
    const c = Number.parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `hue` as text on every one of `backgrounds`: unchanged when it already
 * reads at `min`:1 on each, else pulled towards `toward` (the theme's
 * foreground) in 5% steps until it does. A colour that cannot be parsed is
 * returned as it is.
 */
export function readableOn(hue: string, backgrounds: readonly string[], toward: string, min = 4.5): string {
  // `mix` normalises to #rrggbb, which `contrastRatio` needs.
  const grounds = backgrounds.map((ground) => mix(ground, ground, 0)).filter((ground) => ground.startsWith("#") && ground.length === 7);
  const start = mix(hue, hue, 0);
  if (!start.startsWith("#") || start.length !== 7 || grounds.length === 0) return hue;
  const reads = (color: string) => grounds.every((ground) => contrastRatio(color, ground) >= min);
  for (let step = 0; step <= 20; step++) {
    const color = step === 0 ? start : mix(start, toward, step / 20);
    if (reads(color)) return color;
  }
  return mix(start, toward, 1);
}

export function buildTaskTokens(colors: PluginTheme["colors"]): TaskTokens {
  const isDark = (brightness(colors.surface0) ?? 0) < 0.5;
  const s0 = colors.surface0;
  const status = isDark ? STATUS_DARK : STATUS_LIGHT;
  const danger = colors.statusDanger || status.danger;
  const card = cardTokens(colors, isDark, danger, status.warning, status.success);
  const accentSoft = mix(s0, colors.accent, 0.12);
  return {
    isDark,
    surface0: s0,
    surface1: colors.surface1,
    surface2: colors.surface2,
    border: colors.border,
    foreground: colors.foreground,
    foregroundMuted: colors.foregroundMuted,
    accent: colors.accent,
    accentText: readableOn(colors.accent, [card.background, card.primaryHover, s0, colors.surface1, colors.surface2, accentSoft], colors.foreground),
    status,
    branch: isDark ? BRANCH_DARK : BRANCH_LIGHT,
    warning: colors.statusWarning || status.warning,
    danger,
    success: colors.statusSuccess || status.success,
    dotGrid: mix(s0, colors.foregroundMuted, 0.22),
    borderStrong: mix(colors.border, colors.foregroundMuted, 0.35),
    accentSoft,
    highlight: mix(s0, colors.accent, 0.08),
    dangerSoft: mix(s0, danger, 0.1),
    popoverShadow: isDark
      ? "0px 8px 24px -6px rgba(0, 0, 0, 0.5), 0px 2px 6px -2px rgba(0, 0, 0, 0.35)"
      : "0px 8px 24px -6px rgba(0, 0, 0, 0.12), 0px 2px 6px -2px rgba(0, 0, 0, 0.06)",
    scrim: isDark ? "rgba(0, 0, 0, 0.56)" : "rgba(0, 0, 0, 0.32)",
    tagChip: { background: s0, border: colors.border, text: colors.foregroundMuted },
    card,
  };
}

// Shadows are the one place the card darkens with plain black: a shadow is the
// absence of light whatever the palette. Only its strength follows the theme.
const SHADOW = {
  light: { rest: "0px 1px 2px rgba(0, 0, 0, 0.06)", hover: "0px 2px 6px rgba(0, 0, 0, 0.07)" },
  dark: { rest: "0px 1px 2px rgba(0, 0, 0, 0.18)", hover: "0px 2px 6px rgba(0, 0, 0, 0.26)" },
} as const;

function cardTokens(colors: PluginTheme["colors"], isDark: boolean, danger: string, amber: string, green: string): CardTokens {
  const background = isDark ? colors.surface2 : colors.surface0;
  const fg = colors.foreground;
  const yellow = isDark ? ARCHIVE_DARK : ARCHIVE_LIGHT;
  // An outline button's hover: its hue at 10% over the card, 16% on a dark theme.
  const tint = (hue: string) => mix(background, hue, isDark ? 0.16 : 0.1);
  const primaryHover = tint(colors.accent);
  const answerHover = tint(amber);
  const readHover = tint(green);
  const archiveHover = tint(yellow);
  return {
    background,
    hoverBackground: mix(background, fg, 0.04),
    border: colors.border,
    shadow: SHADOW[isDark ? "dark" : "light"].rest,
    shadowHover: SHADOW[isDark ? "dark" : "light"].hover,
    pillBorder: mix(colors.border, fg, isDark ? 0.08 : 0.05),
    buttonBorder: mix(colors.border, fg, isDark ? 0.2 : 0.05),
    pillFill: mix(background, fg, isDark ? 0.06 : 0.035),
    controlHover: mix(background, fg, isDark ? 0.1 : 0.07),
    highlight: mix(background, colors.accent, isDark ? 0.12 : 0.08),
    current: mix(background, colors.accent, isDark ? 0.1 : 0.07),
    currentBorder: mix(colors.border, colors.accent, 0.45),
    failed: mix(background, danger, isDark ? 0.08 : 0.05),
    failedHover: mix(background, danger, isDark ? 0.12 : 0.08),
    failedBorder: mix(colors.border, danger, isDark ? 0.4 : 0.35),
    primaryBorder: mix(background, colors.accent, isDark ? 0.55 : 0.5),
    primaryHover,
    primaryText: readableOn(colors.accent, [background, primaryHover], fg),
    dangerHover: tint(danger),
    answerBorder: mix(background, amber, isDark ? 0.45 : 0.4),
    answerHover,
    answerText: readableOn(amber, [background, answerHover], fg),
    readBorder: mix(background, green, isDark ? 0.45 : 0.4),
    readHover,
    readText: readableOn(green, [background, readHover], fg),
    archiveBorder: yellow,
    archiveHover,
    archiveText: readableOn(yellow, [background, archiveHover], fg),
  };
}

/**
 * A pill tinted with a data colour (a label, a provider's brand, a status):
 * the hue at 10% over the card (16% on a dark theme) with a hairline of the
 * same hue a little stronger. Null gives the neutral grey pill.
 */
export function pillTint(tokens: TaskTokens, color: string | null): { background: string; border: string } {
  if (!color) return { background: tokens.card.pillFill, border: tokens.card.pillBorder };
  const base = tokens.card.background;
  return {
    background: mix(base, color, tokens.isDark ? 0.16 : 0.1),
    border: mix(base, color, tokens.isDark ? 0.34 : 0.26),
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
