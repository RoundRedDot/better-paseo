import { useEffect, useMemo, useRef } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  DEFAULT_PREFERENCES,
  type EnhancerPreferences,
  type InlineCodeColorPreference,
  ACCENT_PRESETS,
  INLINE_CODE_PALETTE,
} from "../preferences";
import {
  DEFAULT_WEB_MONO_STACK,
  NATIVE_DEFAULT_MONO,
  interfaceFamily,
  readHostTypography,
  resolveTypography,
  type Typography,
  type TypographyPlatform,
} from "../ui/tokens/typography";
import { currentPlatform } from "../ui/tokens/platform";
import { themeKey } from "../ui/tokens/theme-key";
import { ensureEmbeddedFonts } from "./embed-fonts";
import {
  useHostAppearance,
  useHostSyntaxTheme,
  DEFAULT_SYNTAX_THEME,
  type HostAppearance,
  type PaseoSyntaxThemeId,
} from "../ui/tokens/host-appearance-shim";

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
  /** A floating panel over the timeline (the hover preview): the host's xl. */
  overlay: 12,
  /** The user bubble, as the host draws its own: 2xl with an sm tail corner. */
  bubble: 16,
  bubbleTail: 2,
} as const;

/** Token v2 spacing, the host's `SPACING` steps; 24 only separates settings sections. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

const STATIC_PLATFORM: TypographyPlatform = currentPlatform();

/**
 * Families for styles built once at module level, outside any theme.
 *
 * One family per value on native: React Native's `fontFamily` takes a single
 * name there, and a name the platform does not have silently draws the
 * proportional system face — which is what the embedded names did on iOS and
 * Android, since `@font-face` only exists on web. Native therefore gets the
 * platform monospace. Web gets Paseo's own default monospace stack, the face
 * "Follow Paseo" resolves to on a host that does not share its typography.
 */
export const fontMono =
  STATIC_PLATFORM === "web" ? DEFAULT_WEB_MONO_STACK : NATIVE_DEFAULT_MONO[STATIC_PLATFORM];

/** Interface text sets no family: the host's UI font (web) or the system face applies. */
export const fontUi: string | undefined = undefined;

/** A React Native shadow. Floating layers only (plan §3.6); inline blocks carry none. */
export interface Elevation {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ExtendedThemeTokens {
  isDark: boolean;
  /**
   * Paseo's Appearance > Syntax theme id, which decides what colour code gets.
   * The host gives plugins eleven surface colours and no syntax palette, so
   * this comes from its settings (read-only shim).
   */
  syntaxTheme: PaseoSyntaxThemeId;
  /**
   * The platform these tokens draw for: the running one, except in the
   * settings page's mobile preview, which draws a phone's rows on the web.
   */
  platform: TypographyPlatform;
  /** `typography.mono.family`. */
  fontMono: string;
  /** The interface family, or undefined to set none; see `interfaceFamily`. */
  fontUi: string | undefined;
  typography: Typography;

  // Surfaces
  surface0: string;
  surface1: string;
  surface2: string;
  surfaceCode: string;

  // Foreground
  foreground: string;
  foregroundMuted: string;
  foregroundSubtle: string;

  // Accent: primary action, selection, and running state only
  accent: string;
  accentForeground: string;
  accentBg: string;
  /**
   * A dragged Markdown range, such as table cells. Soft translucent grey from
   * the foreground, with more opacity on dark surfaces to keep it visible.
   */
  selectionFill: string;
  /**
   * Inline code where it cannot have a fill (iOS, Android): the colour picked
   * in the settings, an opaque dark grey by default. See `inlineCodeColor`.
   */
  codeInline: string;
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

  /**
   * A collapsed tool row at rest (docs/prototypes/quiet-tool-rows.md): one step
   * behind the prose, so a run of calls reads as a quiet log. Hover, press and
   * an opened row go back to `foreground`, `foregroundMuted` and the status
   * colours; see `rowTone` in `disclosure-header.tsx`.
   */
  row: {
    /** Command, path, verb: `foregroundMuted`. */
    target: string;
    /** A running row's target, halfway back to `foreground`. */
    targetActive: string;
    /** Meta, `✓` and a failure's error line: muted, 10% towards the page. */
    meta: string;
    /** The tool icon: muted, 30% towards the page. */
    icon: string;
    /** Diff counts, 35% towards muted. */
    diffAdd: string;
    diffDel: string;
    /** An opened call's body: surface1, 30% towards the page. */
    outputBg: string;
    /** The command and output in that body. */
    outputText: string;
  };

  /** Block details palette from docs/prototypes/block-details-sheet.md §5.6. */
  details: {
    accentSoft: string;
    grabber: string;
    scrim: string;
    shadow: string;
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
    elevation: { overlay: Elevation };
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

/**
 * The inline code colour off the web. It has its own setting rather than
 * following the accent: the accent marks actions and running state, and code
 * is read at body size, so it wants a shade per theme. The grey is opaque and
 * only a step off the body colour: a lighter or translucent one made the small
 * mono glyphs read thin on a phone.
 */
export function inlineCodeColor(
  preference: InlineCodeColorPreference,
  foreground: string,
  surface: string,
  isDark: boolean,
): string {
  if (preference === "grey") return mix(foreground, surface, 0.15);
  const shades = INLINE_CODE_PALETTE[preference];
  return isDark ? shades.dark : shades.light;
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
  /** Paseo's Appearance settings from the read-only shim (plan D10 level 2). */
  appearance?: HostAppearance | null;
  /** Paseo's Appearance > Syntax theme id; picks the palette for code. */
  syntaxTheme?: PaseoSyntaxThemeId;
}

/** The six roles the client's own tokeniser paints a streaming fence with. */
interface SyntaxRoles {
  keyword: string;
  string: string;
  number: string;
  comment: string;
  property: string;
  function: string;
}

/** GitHub Light Default: the light row for the family Shiki gives no light flavour. */
const GITHUB_LIGHT: SyntaxRoles = {
  keyword: "#cf222e",
  string: "#0a3069",
  number: "#0550ae",
  comment: "#6e7781",
  property: "#0550ae",
  function: "#8250df",
};

/**
 * The six roles per Paseo syntax theme and scheme, for a fence still being typed.
 *
 * An open fence never asks the daemon, so these colours have to be in this build.
 * Each row is Shiki's own resolution of one fixed sample line, and
 * `test/unit/syntax-theme-server.test.ts` re-reads every row from the real theme
 * files, so a Shiki bump that moves a colour fails there rather than restyling
 * open fences mid-session. The table covers all eight ids: an id Paseo adds later
 * is rejected by `parseSyntaxTheme` before it gets here, and adding one to
 * `PASEO_SYNTAX_THEMES` without a row is a type error.
 *
 * The light column matches the daemon's mapping: Shiki 4.4.3 ships no light
 * flavour for Nord, so that one reuses GitHub Light, while Dracula reads the
 * vendored Alucard palette and Tokyo Night its own light theme (both in
 * `server/light-syntax-themes.ts`).
 */
const THEME_SYNTAX_ROLES: Record<PaseoSyntaxThemeId, Record<"dark" | "light", SyntaxRoles>> = {
  github: {
    dark: { keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", property: "#79c0ff", function: "#d2a8ff" },
    light: GITHUB_LIGHT,
  },
  one: {
    dark: { keyword: "#c678dd", string: "#98c379", number: "#d19a66", comment: "#7f848e", property: "#e06c75", function: "#61afef" },
    light: { keyword: "#a626a4", string: "#50a14f", number: "#986801", comment: "#a0a1a7", property: "#986801", function: "#4078f2" },
  },
  catppuccin: {
    dark: { keyword: "#cba6f7", string: "#a6e3a1", number: "#fab387", comment: "#9399b2", property: "#fab387", function: "#89b4fa" },
    light: { keyword: "#8839ef", string: "#40a02b", number: "#fe640b", comment: "#7c7f93", property: "#fe640b", function: "#1e66f5" },
  },
  gruvbox: {
    dark: { keyword: "#fe8019", string: "#b8bb26", number: "#d3869b", comment: "#928374", property: "#83a598", function: "#fabd2f" },
    light: { keyword: "#af3a03", string: "#79740e", number: "#8f3f71", comment: "#928374", property: "#076678", function: "#b57614" },
  },
  solarized: {
    dark: { keyword: "#93a1a1", string: "#2aa198", number: "#d33682", comment: "#586e75", property: "#268bd2", function: "#268bd2" },
    light: { keyword: "#586e75", string: "#2aa198", number: "#d33682", comment: "#93a1a1", property: "#268bd2", function: "#268bd2" },
  },
  "tokyo-night": {
    dark: { keyword: "#9d7cd8", string: "#9ece6a", number: "#ff9e64", comment: "#51597d", property: "#ff9e64", function: "#7aa2f7" },
    light: { keyword: "#7B43BA", string: "#385F0D", number: "#965027", comment: "#888B94", property: "#965027", function: "#2959AA" },
  },
  nord: {
    dark: { keyword: "#81a1c1", string: "#a3be8c", number: "#b48ead", comment: "#616e88", property: "#d8dee9", function: "#88c0d0" },
    light: GITHUB_LIGHT,
  },
  dracula: {
    dark: { keyword: "#ff79c6", string: "#f1fa8c", number: "#bd93f9", comment: "#6272a4", property: "#bd93f9", function: "#50fa7b" },
    light: { keyword: "#A3144D", string: "#846E15", number: "#644AC9", comment: "#6C664B", property: "#644AC9", function: "#14710A" },
  },
};

export function buildThemeTokens(
  colors: PluginSurfaceColors,
  preferences: EnhancerPreferences = DEFAULT_PREFERENCES,
  options: ThemeTokenOptions = {},
): ExtendedThemeTokens {
  const platform = options.platform ?? STATIC_PLATFORM;
  const typography = resolveTypography(options.theme, preferences, platform, options.appearance ?? null);
  const isDark = isDarkSurface(colors.surface0);
  const syntaxTheme = options.syntaxTheme ?? DEFAULT_SYNTAX_THEME;
  // A fence still being typed has no daemon answer to read, so its six colours
  // come from this table.
  const roles = THEME_SYNTAX_ROLES[syntaxTheme][isDark ? "dark" : "light"];
  const fg = colors.foreground;
  const accent = ACCENT_PRESETS[preferences.accent] ?? colors.accent;
  // Status colours are the host's roles; the constants only cover a host
  // that does not send them.
  const success = colors.statusSuccess || (isDark ? "#4cb782" : "#1f8a5b");
  const warning = colors.statusWarning || (isDark ? "#d9a53f" : "#a36a00");
  const danger = colors.statusDanger;
  const tint = isDark ? 0.1 : 0.08;
  /** Diff line fills (S7 design spec §2.4). */
  const diffTint = 0.14;
  const overlayShadow: Elevation = {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.12 : 0.08,
    shadowRadius: 5,
    elevation: 1,
  };
  // Code and an opened tool body sit on the host's first raised surface
  // (S7 design spec §2.4), the same fill the host gives its own code.
  const surfaceCode = colors.surface1;
  const border = colors.border || withAlpha(fg, isDark ? 0.09 : 0.1);
  const borderSubtle = withAlpha(fg, 0.06);
  const edge = isDark ? 0.22 : 0.18;

  return {
    isDark,
    syntaxTheme,
    platform,
    fontMono: typography.mono.family,
    fontUi: interfaceFamily(typography, preferences.uiFont, platform),
    typography,

    surface0: colors.surface0,
    surface1: withAlpha(fg, isDark ? 0.03 : 0.025),
    surface2: withAlpha(fg, isDark ? 0.06 : 0.045),
    surfaceCode,

    foreground: fg,
    foregroundMuted: colors.foregroundMuted,
    // Only for marks that must sit below muted text: a scroll thumb, the
    // pending task ring, the streaming caret.
    foregroundSubtle: withAlpha(colors.foregroundMuted, 0.6),

    accent,
    accentForeground: colors.accentForeground,
    accentBg: withAlpha(accent, isDark ? 0.14 : 0.1),
    selectionFill: withAlpha(fg, isDark ? 0.08 : 0.06),
    codeInline: inlineCodeColor(preferences.inlineCodeColor, fg, colors.surface0, isDark),
    // The host draws its own prompt bubble on its most raised surface; surface2
    // is the most raised one a plugin is given.
    userSurface: colors.surface2,
    userBorder: border,
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

    row: {
      target: colors.foregroundMuted,
      targetActive: mix(colors.foregroundMuted, fg, 0.5),
      meta: mix(colors.foregroundMuted, colors.surface0, 0.1),
      icon: mix(colors.foregroundMuted, colors.surface0, 0.3),
      diffAdd: mix(success, colors.foregroundMuted, 0.35),
      diffDel: mix(danger, colors.foregroundMuted, 0.35),
      outputBg: mix(colors.surface1, colors.surface0, 0.3),
      outputText: mix(fg, colors.foregroundMuted, 0.25),
    },

    details: {
      accentSoft: mix(colors.surface0, accent, 0.1),
      grabber: withAlpha(colors.foregroundMuted, 0.35),
      scrim: withAlpha("#000000", isDark ? 0.5 : 0.2),
      shadow: `0 8px 32px rgba(0, 0, 0, ${isDark ? 0.5 : 0.12})`,
    },

    v2: {
      radius: radiusV2,
      space,
      surface0: colors.surface0,
      surface1: colors.surface1,
      surface2: colors.surface2,
      surfaceCode,
      border,
      borderSubtle,
      elevation: { overlay: overlayShadow },
    },

    // Code colours follow the reader's Paseo syntax theme: these six roles colour
    // a streaming fence, while a finished block carries Shiki's own colours. Diff
    // tints stay the host's status colours, which are not part of a syntax theme.
    syntax: {
      keyword: roles.keyword,
      string: roles.string,
      number: roles.number,
      comment: roles.comment,
      property: roles.property,
      function: roles.function,
      diffAddBg: withAlpha(success, diffTint),
      diffAddMarker: success,
      diffRemoveBg: withAlpha(danger, diffTint),
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
  const resolvedPlatform = platform ?? STATIC_PLATFORM;
  // Plan D10 level 2: Paseo's Appearance settings, while the host shares no
  // typography. Web reads localStorage; iOS and Android read AsyncStorage.
  // The value keeps its identity until it changes. H1 takes precedence and
  // the hook stops reading.
  const appearance = useHostAppearance(readHostTypography(theme) === null, theme);
  // Paseo's syntax theme: one shared store, one look per 500 ms at most, and its
  // identity changes only when the value does.
  const syntaxTheme = useHostSyntaxTheme(theme);
  // The drawer's pinch zoom is no part of the tokens: saving it must not
  // restyle every row of the timeline.
  const drawn = useRef(preferences);
  if (drawn.current !== preferences && !sameButZoom(drawn.current, preferences)) drawn.current = preferences;
  const tokenPreferences = drawn.current;
  return useMemo(
    () => {
      // Inter is installed only once a reader picks it.
      ensureEmbeddedFonts(tokenPreferences, resolvedPlatform);
      return buildThemeTokens(theme.colors, tokenPreferences, {
        platform,
        theme,
        appearance,
        syntaxTheme,
      });
    },
    // `theme` is read through `key`; its identity is exactly what must not count.
    [key, tokenPreferences, platform, appearance, syntaxTheme],
  );
}

function sameButZoom(a: EnhancerPreferences, b: EnhancerPreferences): boolean {
  for (const key of Object.keys(b) as Array<keyof EnhancerPreferences>) {
    if (key !== "detailsFontSize" && a[key] !== b[key]) return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}
