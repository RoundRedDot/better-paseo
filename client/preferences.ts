import { useSyncExternalStore } from "react";
import {
  BLOCK_FONT_SIZE_DEFAULT,
  BLOCK_FONT_SIZE_MAX,
  BLOCK_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  clampBlockFontSize,
  clampCodeFontSize,
  HOVER_DELAY_DEFAULT,
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  clampHoverDelay,
  preferencesSchema,
  type StoredPreferences,
} from "../shared/preferences-settings";
import type { SettingsLanguagePreference } from "./i18n/settings-strings";

export {
  BLOCK_FONT_SIZE_DEFAULT,
  BLOCK_FONT_SIZE_MAX,
  BLOCK_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  clampBlockFontSize,
  clampCodeFontSize,
  HOVER_DELAY_DEFAULT,
  HOVER_DELAY_MAX,
  HOVER_DELAY_MIN,
  clampHoverDelay,
};
export type { StoredPreferences };

export const ACCENT_PRESETS = {
  host: undefined,
  jade: "#10b981",
  violet: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
} as const;

export type AccentPreset = keyof typeof ACCENT_PRESETS;

/**
 * Inline code colours for iOS and Android, a light and a dark shade each so
 * the small mono glyphs keep their contrast on either theme. `grey` is not
 * listed: it is derived from the theme's own body colour.
 */
export const INLINE_CODE_PALETTE = {
  blue: { light: "#0969da", dark: "#58a6ff" },
  violet: { light: "#8250df", dark: "#bc8cff" },
  green: { light: "#1a7f37", dark: "#3fb950" },
  coral: { light: "#cf222e", dark: "#ff7b72" },
} as const;

export type InlineCodeColorPreference = "grey" | keyof typeof INLINE_CODE_PALETTE;
/**
 * `host` follows Paseo's interface font. Inter is embedded on web only; native
 * renders it as the system face, since a plugin cannot register fonts there.
 */
export type UiFontPreference = "host" | "inter" | "system";
export type MarkdownVariantPreference = "document" | "compact" | "terminal";
/**
 * `host` follows Paseo: its mono font once the host exposes typography, until
 * then Paseo's own default monospace stack on web and the platform monospace
 * on iOS/Android.
 */
export type MonoFontPreference = "host" | "custom";
/** Tool cards start collapsed; `expand-failed` opens failed ones by default. */
export type ToolDetailPreference = "collapsed" | "expand-failed";
export type PathDisplayPreference = "relative" | "absolute";
export type RowLabelStylePreference = "icon" | "label" | "both";

export interface EnhancerPreferences {
  /** Fold consecutive tool calls between source timeline boundaries. Opt-in. */
  toolCallRollups: boolean;
  accent: AccentPreset;
  uiFont: UiFontPreference;
  /** Inline code text off the web; the web keeps its filled chip. */
  inlineCodeColor: InlineCodeColorPreference;
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
  /**
   * Text size in tool rows, thoughts, checklists and notices, 9-20.
   * 13 is the built-in row label. Code inside those blocks keeps `codeFontSize`.
   */
  blockFontSize: number;
  toolDetail: ToolDetailPreference;
  pathDisplay: PathDisplayPreference;
  /** Show desktop hover previews for collapsed rows and file paths. */
  hoverPreview: boolean;
  /** Seconds the pointer rests before a desktop hover preview opens (0-10, tenths). */
  hoverDelaySeconds: number;
  /** Whether a preview panel opens with its lines wrapped; its toolbar button flips it for that panel. */
  previewWrap: boolean;
  /**
   * Points the phone's details drawer draws its text above or below the
   * timeline's, -4 to 10. A pinch on the drawer's body sets it.
   */
  detailsTextZoom: number;
  /**
   * Tap a row to open its details in a drawer or panel (docs/prototypes/block-details-sheet.md).
   * On by default; off brings back the long-press preview and tap-to-expand.
   */
  blockDetails: boolean;
  /** Number the lines of a file, diff or command output in a preview panel. */
  previewLineNumbers: boolean;
  /** Shade every other line of a file, diff or command output in a preview panel. */
  previewStripes: boolean;
  /**
   * Paseo maps a stream item to the plugin timeline item before any transformer
   * runs, and that mapping carries only the text. Pasted images therefore never
   * reach plugin code, so the enhanced bubble cannot draw them. Rewind is the
   * host's menu when this Paseo exports one (`host-rewind.ts`); the SDK still
   * exposes neither the rewind call nor which modes the provider supports.
   * Prompts stay with the host by default, and the enhanced bubble is an opt-in.
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
   * What names a tool or thought row's kind: its icon, its verb ("Bash",
   * "Read", "Thought"), or both. Icon only gives the target the most width;
   * label only keeps the slot for status (running, failed) and the hover
   * chevron, so every row's text column stays put.
   */
  rowLabelStyle: RowLabelStylePreference;
  /**
   * Paseo up to 0.11.2 spaces a plugin item like any other item, 16pt under
   * each, where its own tool rows sit flush. On, tool and thought rows take
   * most of that back (`ROW_GAP_COMPENSATION`). A host that stacks plugin rows
   * itself is detected from where the rows are drawn (`host-row-gap.ts`), and
   * a row then takes nothing back above another row.
   */
  compactRowSpacing: boolean;
  /**
   * A tighter reply than Paseo's own. Paseo leaves 16pt between a reply and
   * the tool row below it: 12pt of the reply's own padding plus a 4pt gap,
   * and the same 16pt as the gap under a plugin item. On, a reply takes 12
   * back when a tool, thought or todo row comes next (`timeline-order.ts`).
   */
  compactReplySpacing: boolean;
  /** The settings page's language; `system` follows the device locale. */
  language: SettingsLanguagePreference;
  /**
   * Hidden: not shown in settings. Turns on the perf probes in
   * `client/debug/perf.ts`; toggle it with `__bcPerf.enable()` / `disable()`.
   */
  debugPerf: boolean;
}

/**
 * Web `localStorage`, kept as a fast-start cache of the daemon's settings
 * (and, before fix round 1 of S5, the store itself). The daemon is the
 * source of truth on every platform; see `shared/preferences-settings.ts`.
 */
export const STORAGE_KEY = "paseo/better-chat/preferences/v2";
/** Read once, to migrate; never written again. */
export const LEGACY_STORAGE_KEY = "paseo/better-chat/preferences/v1";
/** Set once this client's local record has been offered to the daemon. */
export const MIGRATED_KEY = "paseo/better-chat/preferences/migrated-to-daemon";
/** Keys from before the plugin id changed. Copied forward on the first read. */
const PREVIOUS_STORAGE_KEY = "paseo/beautiful-chat/preferences/v2";
const PREVIOUS_LEGACY_STORAGE_KEY = "paseo/beautiful-chat/preferences/v1";
const PREVIOUS_MIGRATED_KEY = "paseo/beautiful-chat/preferences/migrated-to-daemon";

function readKey(store: PreferenceStorage | undefined, key: string, previous: string): string | null {
  const current = store?.getItem(key);
  if (current) return current;
  const old = store?.getItem(previous);
  if (!old) return null;
  try {
    store?.setItem(key, old);
  } catch {
    // Storage can refuse writes; the old value still holds this session.
  }
  return old;
}

export const DEFAULT_PREFERENCES: Readonly<EnhancerPreferences> = {
  accent: "host",
  uiFont: "host",
  inlineCodeColor: "grey",
  monoFont: "host",
  customMonoFont: "",
  codeFontSize: null,
  blockFontSize: BLOCK_FONT_SIZE_DEFAULT,
  toolDetail: "collapsed",
  toolCallRollups: false,
  pathDisplay: "relative",
  hoverPreview: true,
  hoverDelaySeconds: HOVER_DELAY_DEFAULT,
  previewWrap: true,
  detailsTextZoom: 0,
  blockDetails: true,
  previewLineNumbers: true,
  previewStripes: true,
  enhancedUserBubble: false,
  selectionActions: true,
  assistantMarkdown: true,
  markdownVariant: "document",
  rowLabelStyle: "icon",
  compactRowSpacing: true,
  compactReplySpacing: true,
  language: "system",
  debugPerf: false,
};

const listeners = new Set<() => void>();

type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): PreferenceStorage | undefined {
  const candidate = globalThis as typeof globalThis & { localStorage?: Storage };
  return candidate.localStorage;
}

/** Validates a record field by field; anything unusable takes its default. */
export function parsePreferences(raw: unknown): EnhancerPreferences {
  const candidate = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { ...preferencesSchema.parse(candidate), debugPerf: candidate.debugPerf === true };
}

/** The part of the preferences the daemon stores: all but the local debug flag. */
export function storedPart(preferences: EnhancerPreferences): StoredPreferences {
  const { debugPerf: _debugPerf, ...stored } = preferences;
  return stored;
}

/** Field-by-field equality of the stored part. */
export function sameStored(a: StoredPreferences, b: StoredPreferences): boolean {
  for (const key of Object.keys(a) as Array<keyof StoredPreferences>) {
    if (a[key] !== b[key]) return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}

/**
 * v1 -> v2 (plan §3.6 item 2, §3.10 item 4).
 *
 * v1 stored every field, defaults included. Its interface font `inter` was
 * the default, so it becomes "follow Paseo"; an explicit `system` is kept.
 * Fields v1 did not have take their v2 defaults, and fields that no longer
 * exist (the frosted-glass and pointer-glow switches, removed in S7) are
 * dropped by the schema.
 */
export function migrateV1Preferences(raw: unknown): EnhancerPreferences {
  const v1 = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return parsePreferences({
    ...v1,
    uiFont: v1.uiFont === "system" ? "system" : "host",
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
    const stored = readKey(store, STORAGE_KEY, PREVIOUS_STORAGE_KEY);
    if (stored) return parsePreferences(JSON.parse(stored));
    const legacy = readKey(store, LEGACY_STORAGE_KEY, PREVIOUS_LEGACY_STORAGE_KEY);
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
let persister: ((values: StoredPreferences) => void) | null = null;

function publish(): void {
  for (const listener of listeners) listener();
}

function writeCache(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Browser storage can be disabled; the in-memory value still holds.
  }
}

export function getEnhancerPreferences(): EnhancerPreferences {
  return preferences;
}

/**
 * Where a change the reader makes goes after the in-memory store: the
 * daemon sync (`state/preference-sync.ts`) registers itself here.
 */
export function setPreferencePersister(next: ((values: StoredPreferences) => void) | null): void {
  persister = next;
}

/**
 * A change from the reader: applied at once (renderers read this store
 * synchronously), cached on web, and handed to the daemon sync, which saves
 * it against the settings revision.
 */
export function updateEnhancerPreferences(update: Partial<EnhancerPreferences>): void {
  const before = storedPart(preferences);
  preferences = { ...preferences, ...update };
  writeCache();
  publish();
  const after = storedPart(preferences);
  if (!sameStored(before, after)) persister?.(after);
}

export function resetEnhancerPreferences(): void {
  updateEnhancerPreferences({ ...storedPart(DEFAULT_PREFERENCES) });
}

/**
 * Values from the daemon. Replaces the stored part (the local debug flag is
 * kept) and notifies only when something actually changed, so a settings
 * read that matches the cache costs no render.
 */
export function applyStoredPreferences(values: StoredPreferences): void {
  if (sameStored(storedPart(preferences), values)) return;
  preferences = { ...values, debugPerf: preferences.debugPerf };
  writeCache();
  publish();
}

/**
 * This client's own record from before the daemon stored preferences (web
 * `localStorage`, v2 or v1), offered once to a daemon that has none. Null
 * when there is none or it was offered already.
 */
export function legacyLocalPreferences(): StoredPreferences | null {
  const store = storage();
  try {
    if (!store || readKey(store, MIGRATED_KEY, PREVIOUS_MIGRATED_KEY)) return null;
    if (!readKey(store, STORAGE_KEY, PREVIOUS_STORAGE_KEY) && !readKey(store, LEGACY_STORAGE_KEY, PREVIOUS_LEGACY_STORAGE_KEY)) return null;
  } catch {
    return null;
  }
  return storedPart(readStoredPreferences(store));
}

export function markLegacyMigrated(): void {
  try {
    storage()?.setItem(MIGRATED_KEY, "1");
  } catch {
    // Without storage there is no local record to offer twice.
  }
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
