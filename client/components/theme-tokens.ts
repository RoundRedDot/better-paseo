import { useMemo } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { DEFAULT_PREFERENCES, type EnhancerPreferences, ACCENT_PRESETS } from "../preferences";
import {
  EMBEDDED_FAMILY,
  NATIVE_DEFAULT_MONO,
  resolveTypography,
  type Typography,
  type TypographyPlatform,
} from "../ui/tokens/typography";
import { currentPlatform } from "../ui/tokens/platform";
import { themeKey } from "../ui/tokens/theme-key";

export type PluginSurfaceColors = PluginTheme["colors"];

/**
 * Corner rounding, in three tiers: outer card, inner block, small chip. Each
 * tier steps down so a block nested in a card reads as inside it rather than
 * as a second card. Components reference these rather than literals, so the
 * tier a surface belongs to is stated once and stays consistent.
 */
export const radius = { card: 12, block: 8, chip: 5 } as const;

/**
 * Token v2 radii (plan §3.6): the host's own lg / md / base / full, so plugin
 * cards line up with native rows. New primitives use these; existing
 * components move over in their own slices.
 */
export const radiusV2 = {
  card: 8,
  block: 6,
  chip: 4,
  pill: 999,
  /** The user bubble, as the host draws its own: 2xl with an sm tail corner. */
  bubble: 16,
  bubbleTail: 2,
} as const;

/** Token v2 spacing, the host's `SPACING` steps. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16 } as const;

const STATIC_PLATFORM: TypographyPlatform = currentPlatform();

/**
 * Families for styles built once at module level, outside any theme.
 *
 * One family per value on native: React Native's `fontFamily` takes a single
 * name there, and a name the platform does not have silently draws the
 * proportional system face — which is what the embedded names did on iOS and
 * Android, since `@font-face` only exists on web. Native therefore gets the
 * platform monospace and the system UI face. On web these stay the bare
 * `@font-face` names `embed-fonts.ts` registers.
 */
export const fontMono =
  STATIC_PLATFORM === "web" ? EMBEDDED_FAMILY.mono : NATIVE_DEFAULT_MONO[STATIC_PLATFORM];

/**
 * The ligature cut of Iosevka, used only inside code blocks. Terminal output,
 * diffs and paths stay on `fontMono`: a shaped `->` or `=>` stops matching the
 * bytes it stands for, which is wrong for a log line or a patch.
 */
export const fontCode = STATIC_PLATFORM === "web" ? EMBEDDED_FAMILY.code : fontMono;
export const fontUi = STATIC_PLATFORM === "web" ? EMBEDDED_FAMILY.ui : "System";

export interface ExtendedThemeTokens {
  isDark: boolean;
  /** `typography.mono.family`. */
  fontMono: string;
  /** `typography.mono.codeFamily`. */
  fontCode: string;
  /** The interface family; see `legacyUiFamily`. */
  fontUi: string;
  typography: Typography;

  // Surfaces
  surface0: string;
  surface1: string;
  surface2: string;
  surfaceCode: string;
  // Translucent variants, for surfaces that blur what sits behind them.
  surfaceGlass: string;
  surfaceCodeGlass: string;

  // Foreground
  foreground: string;
  foregroundMuted: string;
  foregroundSubtle: string;

  // Accent: primary action, selection, and running state only
  accent: string;
  accentForeground: string;
  accentBg: string;
  // The authored turn sits on a raised theme surface, exactly as the native
  // stream draws it. It carries no accent: colour belongs to the agent's work.
  userSurface: string;
  userBorder: string;
  userText: string;
  userTextMuted: string;

  // Semantic status: failure, risk, and diff markers only
  success: string;
  successBg: string;
  successBorder: string;

  warning: string;
  warningBg: string;
  warningBorder: string;

  danger: string;
  dangerBg: string;
  dangerBorder: string;

  // Borders
  border: string;
  borderSubtle: string;
  boxShadow: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };

  /**
   * Token v2 (plan §3.6), added beside the tokens above so existing
   * components render unchanged until their own slice moves them over.
   */
  v2: {
    radius: typeof radiusV2;
    space: typeof space;
    surface0: string;
    /** The host's own raised surfaces, not derived from the foreground. */
    surface1: string;
    surface2: string;
    surfaceCode: string;
    /** Outer frame of an expanded block. */
    border: string;
    /** Divider inside a block, e.g. between header and body. */
    borderSubtle: string;
    /** Shadow for floating layers only; inline blocks carry none. */
    elevation: { overlay: ExtendedThemeTokens["boxShadow"] };
  };

  // Syntax
  syntax: {
    keyword: string;
    string: string;
    number: string;
    comment: string;
    property: string;
    function: string;
    diffAddBg: string;
    diffAddMarker: string;
    diffRemoveBg: string;
    diffRemoveMarker: string;
    hunk: string;
  };
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(color: string): Rgba | null {
  const value = color.trim();
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((c) => c + c).join("");
    }
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
    const channel = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: hex.length === 8 ? channel(6) / 255 : 1,
    };
  }
  const body = /^rgba?\(([^)]+)\)$/i.exec(value)?.[1];
  if (!body) return null;
  const [r, g, b, a = 1] = body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (r === undefined || g === undefined || b === undefined) return null;
  if ([r, g, b, a].some(Number.isNaN)) return null;
  return { r, g, b, a };
}

/** `color` at `alpha` opacity, multiplied with any alpha it already has. Unparseable colours pass through. */
export function withAlpha(color: string, alpha: number): string {
  const rgba = parseColor(color);
  if (!rgba) return color;
  const a = Number((rgba.a * alpha).toFixed(3));
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${a})`;
}

/** Linear blend from `from` towards `to`; `t = 0` returns `from`. */
export function mix(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return from;
  const channel = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

function isDarkSurface(color: string): boolean {
  const rgba = parseColor(color);
  if (!rgba) return true;
  return (0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b) / 255 < 0.5;
}

// PluginTheme only carries six colours, so every other surface is derived from
// the host foreground/accent with alpha. That keeps the plugin on-theme for any
// Paseo theme instead of hard-coding a palette that matches only one of them.
export interface ThemeTokenOptions {
  /** Defaults to the running platform. */
  platform?: TypographyPlatform;
  /** The host theme, read only for its optional `typography` (plan H1). */
  theme?: unknown;
}

/**
 * The interface family the existing components draw with.
 *
 * Until slice S5 moves `data-pmono` from item roots to code surfaces, the
 * host's UI font cannot reach plugin text on web, so "follow Paseo" has
 * nothing to follow there; and the stack `typography.ui.family` builds for
 * Inter changes line boxes wherever Inter lacks a glyph. Web therefore keeps
 * the bare embedded Inter it has always drawn, for both. Native gets the host
 * family when H1 provides one, else the system face — never the embedded
 * name, which iOS and Android do not have.
 */
function legacyUiFamily(
  typography: Typography,
  preferences: EnhancerPreferences,
  platform: TypographyPlatform,
): string {
  if (platform !== "web") return typography.ui.family ?? "System";
  if (preferences.uiFont === "system") return "System";
  if (preferences.uiFont === "host" && typography.fromHost && typography.ui.family) {
    return typography.ui.family;
  }
  return EMBEDDED_FAMILY.ui;
}

export function buildThemeTokens(
  colors: PluginSurfaceColors,
  preferences: EnhancerPreferences = DEFAULT_PREFERENCES,
  options: ThemeTokenOptions = {},
): ExtendedThemeTokens {
  const platform = options.platform ?? STATIC_PLATFORM;
  const typography = resolveTypography(options.theme, preferences, platform);
  const isDark = isDarkSurface(colors.surface0);
  const fg = colors.foreground;
  const accent = ACCENT_PRESETS[preferences.accent] ?? colors.accent;
  const success = isDark ? "#4cb782" : "#1f8a5b";
  const warning = isDark ? "#d9a53f" : "#a36a00";
  const danger = colors.statusDanger;
  const tint = isDark ? 0.1 : 0.08;
  const boxShadow = {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.12 : 0.08,
    shadowRadius: 5,
    elevation: 1,
  };
  const surfaceCode = isDark ? "rgba(0, 0, 0, 0.22)" : withAlpha(fg, 0.03);
  const border = withAlpha(fg, isDark ? 0.09 : 0.1);
  const borderSubtle = withAlpha(fg, 0.06);
  const edge = isDark ? 0.22 : 0.18;

  return {
    isDark,
    fontMono: typography.mono.family,
    fontCode: typography.mono.codeFamily,
    fontUi: legacyUiFamily(typography, preferences, platform),
    typography,

    surface0: colors.surface0,
    surface1: withAlpha(fg, isDark ? 0.03 : 0.025),
    surface2: withAlpha(fg, isDark ? 0.06 : 0.045),
    surfaceCode,
    // Translucent so the blur behind them reads, but still dense enough to
    // keep text legible over whatever scrolls past.
    surfaceGlass: preferences.frostedGlass
      ? withAlpha(colors.surface0, isDark ? 0.52 : 0.64)
      : colors.surface0,
    surfaceCodeGlass: preferences.frostedGlass
      ? isDark
        ? "rgba(0, 0, 0, 0.34)"
        : withAlpha(fg, 0.05)
      : isDark
        ? "rgba(0, 0, 0, 0.22)"
        : withAlpha(fg, 0.03),

    foreground: fg,
    foregroundMuted: colors.foregroundMuted,
    foregroundSubtle: withAlpha(colors.foregroundMuted, 0.7),

    accent,
    accentForeground: colors.accentForeground,
    accentBg: withAlpha(accent, isDark ? 0.14 : 0.1),
    userSurface: withAlpha(fg, isDark ? 0.1 : 0.06),
    userBorder: withAlpha(fg, isDark ? 0.14 : 0.12),
    userText: fg,
    userTextMuted: colors.foregroundMuted,

    success,
    successBg: withAlpha(success, tint),
    successBorder: withAlpha(success, edge),

    warning,
    warningBg: withAlpha(warning, tint),
    warningBorder: withAlpha(warning, edge),

    danger,
    dangerBg: withAlpha(danger, tint),
    dangerBorder: withAlpha(danger, edge),

    border,
    borderSubtle,
    boxShadow,

    v2: {
      radius: radiusV2,
      space,
      surface0: colors.surface0,
      surface1: colors.surface1,
      surface2: colors.surface2,
      surfaceCode,
      border,
      borderSubtle,
      elevation: { overlay: boxShadow },
    },

    // GitHub Dark Dimmed / GitHub Light
    syntax: {
      keyword: isDark ? "#f47067" : "#cf222e",
      string: isDark ? "#96d0ff" : "#0a3069",
      number: isDark ? "#6cb6ff" : "#0550ae",
      comment: isDark ? "#768390" : "#6e7781",
      property: isDark ? "#6cb6ff" : "#0550ae",
      function: isDark ? "#dcbdfb" : "#8250df",
      diffAddBg: withAlpha(success, tint),
      diffAddMarker: success,
      diffRemoveBg: withAlpha(danger, tint),
      diffRemoveMarker: danger,
      hunk: withAlpha(colors.foregroundMuted, 0.7),
    },
  };
}

/**
 * Tokens for a renderer, memoised on the theme's colour strings rather than
 * on the `theme.colors` object, which Paseo 0.11.2 rebuilds on every render
 * (plan §3.2). `preferences` is the store's own object and only changes when
 * the reader changes a setting.
 */
export function useThemeTokens(
  theme: PluginTheme,
  preferences: EnhancerPreferences,
  platform?: TypographyPlatform,
): ExtendedThemeTokens {
  const key = themeKey(theme);
  return useMemo(
    () => buildThemeTokens(theme.colors, preferences, { platform, theme }),
    // `theme` is read through `key`; its identity is exactly what must not count.
    [key, preferences, platform],
  );
}
