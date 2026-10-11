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
    scale: { xs: 10; sm: 11; base: 12; md: 13; lg: 14; xl: 16 };
  };
  content: { size: number; lineHeight: number };
  mono: {
    /** Terminal output, diffs, paths, commands. */
    family: string;
    /** Code blocks: the ligature cut when ligatures are on and Iosevka is in use. */
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

export const UI_SCALE = { xs: 10, sm: 11, base: 12, md: 13, lg: 14, xl: 16 } as const;

export const CODE_SIZE = { default: 12, min: 10, max: 22 } as const;

/** Paseo's own content size defaults (`use-settings/storage.ts`). */
const CONTENT_SIZE = { web: 15, native: 16 } as const;

const CJK_FALLBACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"';
const WEB_MONO_TAIL = `ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace, ${CJK_FALLBACK}`;
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
  const ligatures = prefs.codeFont === "code";

  // --- Monospace -----------------------------------------------------------
  // "Follow Paseo" on a host without H1 keeps today's look (decision D2):
  // embedded Iosevka on web, the platform monospace on native.
  const hostMono = host?.fontFamily?.mono;
  const embeddedStack = `"${EMBEDDED_FAMILY.mono}", ${WEB_MONO_TAIL}`;
  const embeddedCodeStack = `"${EMBEDDED_FAMILY.code}", ${embeddedStack}`;
  let family: string;
  let codeFamily: string;
  if (web) {
    const follow = hostMono ? withCjk(hostMono) : embeddedStack;
    const followIsEmbedded = !hostMono;
    if (prefs.monoFont === "iosevka" || (prefs.monoFont === "host" && followIsEmbedded)) {
      family = embeddedStack;
      codeFamily = ligatures ? embeddedCodeStack : embeddedStack;
    } else if (prefs.monoFont === "custom" && text(prefs.customMonoFont)) {
      family = `${quoteFamily(prefs.customMonoFont)}, ${follow}`;
      codeFamily = family;
    } else {
      family = follow;
      codeFamily = followIsEmbedded && ligatures ? embeddedCodeStack : follow;
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
