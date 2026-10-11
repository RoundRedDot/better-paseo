import { useSyncExternalStore } from "react";

export const ACCENT_PRESETS = {
  host: undefined,
  jade: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
} as const;

export type AccentPreset = keyof typeof ACCENT_PRESETS;
/**
 * `host` follows Paseo's interface font. Inter is embedded on web only; native
 * renders it as the system face, since a plugin cannot register fonts there.
 */
export type UiFontPreference = "host" | "inter" | "system";
/** Ligatures inside code blocks (`code`, the Iosevka Code cut) or literal glyphs. */
export type CodeFontPreference = "code" | "plain";
export type MarkdownVariantPreference = "document" | "compact" | "terminal";
/**
 * `host` follows Paseo: its mono font once the host exposes typography, until
 * then the embedded Iosevka on web and the platform monospace on iOS/Android.
 */
export type MonoFontPreference = "host" | "iosevka" | "custom";
/** Tool cards start collapsed; `expand-failed` opens failed ones by default. */
export type ToolDetailPreference = "collapsed" | "expand-failed";
export type PathDisplayPreference = "relative" | "absolute";

export const CODE_FONT_SIZE_MIN = 10;
export const CODE_FONT_SIZE_MAX = 22;

export interface EnhancerPreferences {
  accent: AccentPreset;
  uiFont: UiFontPreference;
  codeFont: CodeFontPreference;
  /** Which monospace family code, diffs, terminals and paths use. */
  monoFont: MonoFontPreference;
  /**
   * The family for `monoFont: "custom"`. Free text on web, where a missing
   * face falls back through the stack; on iOS/Android only a family from the
   * platform list is honoured, because a wrong name there turns code
   * proportional with no fallback.
   */
  customMonoFont: string;
  /** Code font size in px, 10-22; null follows Paseo (12 until the host says otherwise). */
  codeFontSize: number | null;
  toolDetail: ToolDetailPreference;
  pathDisplay: PathDisplayPreference;
  frostedGlass: boolean;
  /**
   * A light that follows the pointer across a card. Web and desktop only:
   * touch platforms have no hover, so the attribute is inert there.
   */
  pointerGlow: boolean;
  /**
   * Paseo maps a stream item to the plugin timeline item before any transformer
   * runs, and that mapping carries only the text. Pasted images therefore never
   * reach plugin code, so the enhanced bubble cannot draw them. Turning this off
   * hands prompts back to the host, whose own bubble still shows them.
   */
  enhancedUserBubble: boolean;
  /**
   * The Copy / Add to chat bar that follows a highlight. Web and desktop only:
   * iOS and Android route selection through the platform's own menu, which the
   * plugin cannot extend, so the toggle has no effect there.
   */
  selectionActions: boolean;
  /**
   * The plugin's own markdown rendering for assistant replies. Off hands the
   * turn back to Paseo's renderer, which is the safety valve: the plugin
   * cannot import the host markdown pipeline, so its version is a reasonable
   * subset rather than a superset.
   */
  assistantMarkdown: boolean;
  /** Which look the markdown renderer uses. */
  markdownVariant: MarkdownVariantPreference;
  /**
   * Hidden: not shown in settings. Turns on the perf probes in
   * `client/debug/perf.ts`; toggle it with `__bcPerf.enable()` / `disable()`.
   */
  debugPerf: boolean;
}

/**
 * The monospace choice as the reader sees it. Iosevka and Iosevka Code are
 * one stored family (`monoFont: "iosevka"`) told apart by the ligature
 * setting (`codeFont`), which only the Code cut draws.
 */
export type MonoChoice = "host" | "iosevka" | "iosevka-code" | "custom";

export function monoChoice(preferences: Pick<EnhancerPreferences, "monoFont" | "codeFont">): MonoChoice {
  if (preferences.monoFont === "iosevka") return preferences.codeFont === "code" ? "iosevka-code" : "iosevka";
  return preferences.monoFont;
}

/** The preference update a monospace choice stands for. */
export function monoChoiceUpdate(choice: MonoChoice): Partial<EnhancerPreferences> {
  if (choice === "iosevka") return { monoFont: "iosevka", codeFont: "plain" };
  if (choice === "iosevka-code") return { monoFont: "iosevka", codeFont: "code" };
  // Follow Paseo keeps today's look on a host without typography (D2): the
  // embedded Iosevka with its ligature cut in code blocks.
  if (choice === "host") return { monoFont: "host", codeFont: "code" };
  return { monoFont: "custom" };
}

export const STORAGE_KEY = "paseo/beautiful-chat/preferences/v2";
/** Read once, to migrate; never written again. */
export const LEGACY_STORAGE_KEY = "paseo/beautiful-chat/preferences/v1";

export const DEFAULT_PREFERENCES: Readonly<EnhancerPreferences> = {
  accent: "host",
  uiFont: "host",
  codeFont: "code",
  monoFont: "host",
  customMonoFont: "",
  codeFontSize: null,
  toolDetail: "collapsed",
  pathDisplay: "relative",
  frostedGlass: false,
  pointerGlow: false,
  enhancedUserBubble: true,
  selectionActions: true,
  assistantMarkdown: true,
  markdownVariant: "document",
  debugPerf: false,
};

const listeners = new Set<() => void>();

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): PreferenceStorage | undefined {
  const candidate = globalThis as typeof globalThis & { localStorage?: Storage };
  return candidate.localStorage;
}

function isAccentPreset(value: unknown): value is AccentPreset {
  return typeof value === "string" && value in ACCENT_PRESETS;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function clampCodeFontSize(value: number): number {
  return Math.min(CODE_FONT_SIZE_MAX, Math.max(CODE_FONT_SIZE_MIN, Math.round(value)));
}

/** Validates a stored v2 record field by field; anything unusable takes its default. */
export function parsePreferences(raw: unknown): EnhancerPreferences {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES;
  return {
    accent: isAccentPreset(candidate.accent) ? candidate.accent : d.accent,
    uiFont: oneOf(candidate.uiFont, ["host", "inter", "system"], d.uiFont),
    codeFont: oneOf(candidate.codeFont, ["code", "plain"], d.codeFont),
    monoFont: oneOf(candidate.monoFont, ["host", "iosevka", "custom"], d.monoFont),
    customMonoFont:
      typeof candidate.customMonoFont === "string"
        ? candidate.customMonoFont.trim().slice(0, 200)
        : d.customMonoFont,
    codeFontSize:
      typeof candidate.codeFontSize === "number" && Number.isFinite(candidate.codeFontSize)
        ? clampCodeFontSize(candidate.codeFontSize)
        : d.codeFontSize,
    toolDetail: oneOf(candidate.toolDetail, ["collapsed", "expand-failed"], d.toolDetail),
    pathDisplay: oneOf(candidate.pathDisplay, ["relative", "absolute"], d.pathDisplay),
    frostedGlass: flag(candidate.frostedGlass, d.frostedGlass),
    pointerGlow: flag(candidate.pointerGlow, d.pointerGlow),
    enhancedUserBubble: flag(candidate.enhancedUserBubble, d.enhancedUserBubble),
    selectionActions: flag(candidate.selectionActions, d.selectionActions),
    assistantMarkdown: flag(candidate.assistantMarkdown, d.assistantMarkdown),
    markdownVariant: oneOf(
      candidate.markdownVariant,
      ["document", "compact", "terminal"],
      d.markdownVariant,
    ),
    debugPerf: candidate.debugPerf === true,
  };
}

/**
 * v1 -> v2 (plan §3.6 item 2, §3.10 item 4).
 *
 * v1 stored every field, defaults included, so a v1 `true` for frosted glass
 * or pointer glow cannot be told apart from the old default: both are reset
 * to off, once. The v1 interface font `inter` was likewise the default, so it
 * becomes "follow Paseo"; an explicit `system` is kept. Fields v1 did not
 * have take their v2 defaults.
 */
export function migrateV1Preferences(raw: unknown): EnhancerPreferences {
  const v1 = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return parsePreferences({
    ...v1,
    uiFont: v1.uiFont === "system" ? "system" : "host",
    frostedGlass: false,
    pointerGlow: false,
    monoFont: undefined,
    customMonoFont: undefined,
    codeFontSize: undefined,
    toolDetail: undefined,
    pathDisplay: undefined,
  });
}

/**
 * Reads v2, or migrates v1 and writes the result as v2 so the reset happens
 * exactly once. The v1 record is left in place for a downgrade.
 */
export function readStoredPreferences(store: PreferenceStorage | undefined): EnhancerPreferences {
  try {
    const stored = store?.getItem(STORAGE_KEY);
    if (stored) return parsePreferences(JSON.parse(stored));
    const legacy = store?.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return { ...DEFAULT_PREFERENCES };
    const migrated = migrateV1Preferences(JSON.parse(legacy));
    try {
      store?.setItem(STORAGE_KEY, JSON.stringify(migrated));
    } catch {
      // Storage can refuse writes; the migrated value still holds this session.
    }
    return migrated;
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function loadPreferences(): EnhancerPreferences {
  return readStoredPreferences(storage());
}

let preferences = loadPreferences();

function publish(): void {
  for (const listener of listeners) listener();
}

export function getEnhancerPreferences(): EnhancerPreferences {
  return preferences;
}

export function updateEnhancerPreferences(update: Partial<EnhancerPreferences>): void {
  preferences = { ...preferences, ...update };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browser storage can be disabled. Keep the change alive for this session.
  }
  publish();
}

export function resetEnhancerPreferences(): void {
  preferences = { ...DEFAULT_PREFERENCES };
  try {
    // Written rather than removed: an absent v2 record would re-run the v1
    // migration on the next load and bring the old choices back.
    storage()?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Keep the default session value if storage is unavailable.
  }
  publish();
}

/** Calls `listener` after every change. Returns the unsubscribe function. */
export function subscribeEnhancerPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useEnhancerPreferences(): EnhancerPreferences {
  return useSyncExternalStore(
    subscribeEnhancerPreferences,
    getEnhancerPreferences,
    getEnhancerPreferences,
  );
}
