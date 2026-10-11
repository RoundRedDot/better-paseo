/**
 * Typography tokens (plan §3.10, BC-11 / BC-12).
 *
 * One pure function decides every family and size the plugin draws with, from
 * three inputs: what the host exposes, what the reader chose, and which
 * platform this is. Pure so it is tested for every combination, and so a font
 * change only rebuilds styles — nothing upstream (Markdown lexing) depends on it.
 *
 * Platform rules that drive the branches:
 * - iOS and Android cannot load the embedded faces (no `document`, no font
 *   loader), and an unregistered `fontFamily` there silently draws the system
 *   proportional face. Native therefore only ever gets a family the platform
 *   is known to have: `ui-monospace` (SF Mono) on iOS, `monospace` on Android.
 * - React Native's native `fontFamily` takes one family. Web passes the value
 *   to CSS, so it gets a real stack with CJK fallbacks at the end.
 */

export type TypographyPlatform = "ios" | "android" | "web";

/**
 * The shape plan H1 adds to `PluginTheme` as optional `typography`. Paseo
 * 0.11.2 does not send it; every field is read defensively.
 */
export interface HostTypography {
  fontFamily?: { ui?: string; mono?: string };
  fontSize?: { ui?: number; content?: number; code?: number };
  lineHeight?: { code?: number };
}

export interface TypographyPreferences {
  uiFont: "host" | "inter" | "system";
  codeFont: "code" | "plain";
  monoFont: "host" | "iosevka" | "custom";
  customMonoFont: string;
  codeFontSize: number | null;
}

export interface Typography {
  ui: {
    /** Undefined: inherit the host's interface font. */
    family?: string;
    scale: typeof UI_SCALE;
  };
  content: { size: number; lineHeight: number };
  mono: {
    /** Terminal output, diffs, paths, commands. */
    family: string;
    /** Code blocks: the ligature cut when the reader picked Iosevka Code, else `family`. */
    codeFamily: string;
    size: number;
    lineHeight: number;
    ligatures: boolean;
  };
  /** Whether host typography (H1) was present and used. */
  fromHost: boolean;
}

/** The `@font-face` names `embed-fonts.ts` registers on web. */
export const EMBEDDED_FAMILY = {
  ui: "OMP Inter",
  mono: "OMP Iosevka",
  code: "OMP Iosevka Code",
} as const;

/**
 * Interface sizes. Nothing in a row, a header or a control is drawn below 12
 * (S7 design spec §2.3): the old 10 and 11 steps read as noise next to the
 * host's own 12 metadata.
 */
export const UI_SCALE = { base: 12, md: 13, lg: 14, xl: 16 } as const;

/** A size and its line height. */
export interface TypeStep {
  size: number;
  lineHeight: number;
}

/**
 * Interface text by role (S7 design spec §2.3, F0 "UI scale"). Fixed sizes:
 * rows and controls track the host's native rows, not the reading size.
 */
export const TYPE = {
  /** Row verb, task text, notice text. */
  label: { size: 14, lineHeight: 20 },
  /** A row's path or command, monospace: 13 on touch layouts, 12 on desktop. */
  target: { compact: { size: 13, lineHeight: 20 }, desktop: { size: 12, lineHeight: 18 } },
  /** Row meta (`exit 0  1.2s`, `L10–80`) and usage, monospace with tabular digits. */
  meta: { size: 12, lineHeight: 16 },
  /** Times, a code block's language, captions, a failed row's error line. */
  caption: { size: 12, lineHeight: 16 },
  /** Copy, Show more, Show all. */
  button: { size: 13, lineHeight: 18 },
  /** Settings row label: 15 in a touch list, 14 in the desktop two-column layout. */
  setting: { compact: { size: 15, lineHeight: 22 }, desktop: { size: 14, lineHeight: 20 } },
  /** Settings descriptions and section labels. */
  settingNote: { size: 13, lineHeight: 18 },
  /** A page title (the settings page). */
  title: { size: 16, lineHeight: 22 },
} as const;

/** The nearest even integer: prose line heights sit on the 2px grid. */
export function even(value: number): number {
  return 2 * Math.round(value / 2);
}

/** Reading text derived from the host content size `b` (S7 design spec §2.3). */
export interface ProseScale {
  h1: TypeStep;
  h2: TypeStep;
  h3: TypeStep;
  body: TypeStep;
  /** One step quieter than the body: reasoning text. */
  secondary: TypeStep;
  /** Table cells, inline code. */
  small: TypeStep;
  /** Code in prose: a monospace step under the body. */
  code: TypeStep;
}

/**
 * Every reading size from the host body size, in integers. b = 15 (web)
 * gives h1 22/28, h2 18/24, h3 16/22, body 15/22; b = 16 (native) gives
 * 24/30, 20/26, 17/24, 16/24.
 */
export function proseScale(b: number): ProseScale {
  const base = Math.round(b);
  const body = { size: base, lineHeight: even(1.5 * base) };
  const h1 = Math.floor(1.5 * base);
  const h2 = Math.floor(1.25 * base);
  return {
    h1: { size: h1, lineHeight: h1 + 6 },
    h2: { size: h2, lineHeight: h2 + 6 },
    h3: { size: base + 1, lineHeight: body.lineHeight },
    body,
    secondary: { size: base - 1, lineHeight: body.lineHeight - 2 },
    small: { size: base - 2, lineHeight: body.lineHeight - 4 },
    code: { size: base - 2, lineHeight: body.lineHeight - 2 },
  };
}

export const CODE_SIZE = { default: 12, min: 10, max: 22 } as const;

/** Paseo's own content size defaults (`use-settings/storage.ts`). */
const CONTENT_SIZE = { web: 15, native: 16 } as const;

const CJK_FALLBACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"';

/**
 * Paseo's own default monospace stack on web and desktop, verbatim
 * (`DEFAULT_MONO_FONT_STACK`, `packages/app/src/styles/theme.ts`). "Follow
 * Paseo" draws with exactly this when the host does not share its typography,
 * so plugin code reads like the host's own code blocks and tool output.
 */
export const HOST_DEFAULT_WEB_MONO =
  "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
/** `HOST_DEFAULT_WEB_MONO` with the CJK fallbacks: the web "Follow Paseo" stack. */
export const DEFAULT_WEB_MONO_STACK = `${HOST_DEFAULT_WEB_MONO}, ${CJK_FALLBACK}`;
const WEB_MONO_TAIL = DEFAULT_WEB_MONO_STACK;
const WEB_UI_TAIL = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif, ${CJK_FALLBACK}`;

export const NATIVE_DEFAULT_MONO: Record<"ios" | "android", string> = {
  ios: "ui-monospace",
  android: "monospace",
};

/**
 * The only monospace families offered for "custom" on native: ones the OS is
 * known to ship. `value` is what goes into `fontFamily`.
 */
export const NATIVE_MONO_CHOICES: Record<
  "ios" | "android",
  ReadonlyArray<{ value: string; label: string }>
> = {
  ios: [
    { value: "ui-monospace", label: "SF Mono" },
    { value: "Menlo", label: "Menlo" },
    { value: "Courier New", label: "Courier New" },
  ],
  android: [{ value: "monospace", label: "Monospace" }],
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function size(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Feature detection for H1: returns the host's typography when `theme`
 * carries a usable one, null otherwise (Paseo 0.11.2 and earlier).
 */
export function readHostTypography(theme: unknown): HostTypography | null {
  if (!theme || typeof theme !== "object") return null;
  const raw = (theme as { typography?: unknown }).typography;
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, Record<string, unknown> | undefined>;
  const host: HostTypography = {
    fontFamily: { ui: text(t.fontFamily?.ui), mono: text(t.fontFamily?.mono) },
    fontSize: {
      ui: size(t.fontSize?.ui),
      content: size(t.fontSize?.content),
      code: size(t.fontSize?.code),
    },
    lineHeight: { code: size(t.lineHeight?.code) },
  };
  const any =
    host.fontFamily?.ui ||
    host.fontFamily?.mono ||
    host.fontSize?.ui ||
    host.fontSize?.content ||
    host.fontSize?.code ||
    host.lineHeight?.code;
  return any ? host : null;
}

/** A family name as one CSS stack entry: quoted, with stray quotes removed. */
function quoteFamily(name: string): string {
  const clean = name.replace(/["\\,;{}]/g, "").trim();
  return `"${clean}"`;
}

/** Appends the CJK tail to a host stack that does not already end with it. */
function withCjk(stack: string): string {
  return stack.includes("PingFang SC") ? stack : `${stack}, ${CJK_FALLBACK}`;
}

export function lineHeightFor(fontSize: number): number {
  return Math.round(fontSize * 1.5);
}

export function resolveTypography(
  theme: unknown,
  prefs: TypographyPreferences,
  platform: TypographyPlatform,
): Typography {
  const host = readHostTypography(theme);
  const web = platform === "web";

  // --- Monospace -----------------------------------------------------------
  // "Follow Paseo" is the host's mono: its H1 value, or else the stack the
  // host itself defaults to (web) and the platform monospace (native). The
  // embedded Iosevka is drawn only when the reader picks it.
  const hostMono = host?.fontFamily?.mono;
  let family: string;
  let codeFamily: string;
  let ligatures = false;
  if (web) {
    const follow = hostMono ? withCjk(hostMono) : WEB_MONO_TAIL;
    if (prefs.monoFont === "iosevka") {
      family = `"${EMBEDDED_FAMILY.mono}", ${WEB_MONO_TAIL}`;
      // The ligature cut exists only for Iosevka (Iosevka Code).
      ligatures = prefs.codeFont === "code";
      codeFamily = ligatures ? `"${EMBEDDED_FAMILY.code}", ${family}` : family;
    } else if (prefs.monoFont === "custom" && text(prefs.customMonoFont)) {
      family = `${quoteFamily(prefs.customMonoFont)}, ${follow}`;
      codeFamily = family;
    } else {
      family = follow;
      codeFamily = follow;
    }
  } else {
    const fallback = hostMono ?? NATIVE_DEFAULT_MONO[platform];
    const custom = text(prefs.customMonoFont);
    const allowed = NATIVE_MONO_CHOICES[platform].some((choice) => choice.value === custom);
    // Iosevka is not offered on native; a stored choice from a synced web
    // profile falls back to the platform face rather than to a missing font.
    family = prefs.monoFont === "custom" && custom && allowed ? custom : fallback;
    codeFamily = family;
  }

  const codeSize =
    prefs.codeFontSize !== null
      ? Math.min(CODE_SIZE.max, Math.max(CODE_SIZE.min, Math.round(prefs.codeFontSize)))
      : (host?.fontSize?.code ?? CODE_SIZE.default);
  const codeLineHeight =
    prefs.codeFontSize === null && host?.fontSize?.code && host.lineHeight?.code
      ? host.lineHeight.code
      : lineHeightFor(codeSize);

  // --- Interface -----------------------------------------------------------
  let uiFamily: string | undefined;
  if (prefs.uiFont === "system") {
    // React Native Web expands "System" to the platform UI stack; native
    // draws the system face when no family is set.
    uiFamily = web ? "System" : undefined;
  } else if (prefs.uiFont === "inter") {
    uiFamily = web ? `"${EMBEDDED_FAMILY.ui}", ${WEB_UI_TAIL}` : undefined;
  } else {
    const hostUi = host?.fontFamily?.ui;
    uiFamily = hostUi ? (web ? withCjk(hostUi) : hostUi) : undefined;
  }

  const contentSize = host?.fontSize?.content ?? (web ? CONTENT_SIZE.web : CONTENT_SIZE.native);

  return {
    ui: { family: uiFamily, scale: UI_SCALE },
    content: { size: contentSize, lineHeight: lineHeightFor(contentSize) },
    mono: { family, codeFamily, size: codeSize, lineHeight: codeLineHeight, ligatures },
    fromHost: host !== null,
  };
}

/** A string that changes exactly when `resolveTypography`'s host input does. */
export function hostTypographyKey(theme: unknown): string {
  const host = readHostTypography(theme);
  if (!host) return "";
  return [
    host.fontFamily?.ui,
    host.fontFamily?.mono,
    host.fontSize?.ui,
    host.fontSize?.content,
    host.fontSize?.code,
    host.lineHeight?.code,
  ].join("|");
}

/**
 * The `fontFamily` interface text is drawn with (plan §3.10 item 4).
 *
 * Undefined means "set none": the text keeps React Native's default class on
 * web, which the host's UI font rule overrides, and the system face on
 * native. That is "Follow Paseo" without host typography. It has to be
 * undefined rather than a family name: React Native Web writes a style that
 * is not from `StyleSheet.create` as an inline style, and an inline
 * `font-family` beats the host's rule however specific that rule is.
 *
 * With H1 the host family is set explicitly (it is the same value the host
 * rule would apply). Native never gets the embedded name, which iOS and
 * Android do not have. An explicit Inter or System choice also escapes the
 * item root (`itemRootFont`) and is drawn as chosen; Inter is the bare
 * embedded name, not the full stack `ui.family` builds, because the stack's
 * fallback faces shift line boxes by about 2px on text without an explicit
 * line height (S1) and the embedded face is always registered on web.
 */
export function interfaceFamily(
  typography: Typography,
  uiFont: TypographyPreferences["uiFont"],
  platform: TypographyPlatform,
): string | undefined {
  if (platform !== "web") return typography.ui.family;
  if (uiFont === "inter") return EMBEDDED_FAMILY.ui;
  if (uiFont === "system") return "System";
  return typography.fromHost ? typography.ui.family : undefined;
}
