/**
 * TEMPORARY, READ-ONLY compatibility layer: the content size (every platform)
 * and, on web, the monospace font and code size the user set in Paseo's
 * Appearance settings.
 *
 * Why it exists (plan decision D10, authorised by the user on 2026-10-11):
 * the monospace source priority is
 *   1. host `theme.typography` (plan H1),
 *   2. the font the user set in Paseo's Appearance settings,
 *   3. Paseo's official default stack,
 * with a custom family only when picked in this plugin's settings.
 * Paseo 0.11.2 has no plugin API for level 2, so this module reads the
 * host's persisted app settings directly. It departs from requirement §11.5
 * ("do not read private storage") on the user's explicit instruction.
 *
 * What it reads, and nothing else:
 * - `window.localStorage["@paseo:app-settings"]`, else the legacy key
 *   `"@paseo:settings"` — the keys of `use-settings/keys.ts`. The host
 *   persists app settings with `@react-native-async-storage/async-storage`,
 *   whose web backend is `localStorage`, as one JSON object (schema in
 *   `use-settings/storage.ts`).
 * - `monoFontFamily` (string; "" means the platform default stack, i.e. unset),
 *   `codeFontSize` (number; the host floors it and clamps it to 9–22, default
 *   12), and `contentFontSize` (number; floored and clamped to 10–21). When
 *   content size is absent, `uiBaseFontSize` is used, which is what the host
 *   itself does before it rewrites the blob.
 * It never writes to the host's storage.
 *
 * Validation mirrors the host's own (`sanitizeFontFamily`,
 * `parseClampedFontSize`): a family over 200 characters, or one with a
 * character that could break a CSS value (`<>{}();`, control characters), is
 * rejected — the host would draw its default for it, so the plugin does too.
 * Any read, parse or shape failure falls back to level 3 silently.
 *
 * Scope: while the host theme carries no `typography`. Web and desktop read
 * `localStorage`. iOS and Android read the same JSON through the host's
 * AsyncStorage module (`RNCAsyncStorage`); if that module is missing, native
 * keeps the platform default. Content size is used on every platform. The
 * monospace family stays web-only: a CSS stack is not a native font name.
 *
 * Liveness: reading is throttled to one look per 500 ms, and a look only
 * re-parses when the raw string changed. Looks happen on triggers: our
 * renderers re-rendering after the host applies an appearance change (which
 * patches the theme they receive), window `focus` / `visibilitychange`, and
 * the `storage` event from other windows. Each trigger also schedules one
 * trailing look, since the host's async write can land just after its theme
 * update; a change in Paseo's Appearance settings therefore reaches plugin
 * cards within about a second.
 *
 * REMOVE this module once Paseo ships H1 (`theme.typography`): from then on it
 * is switched off at runtime anyway, since H1 takes precedence and the hook
 * stops reading.
 */
import { useEffect, useSyncExternalStore } from "react";

/** The host's app-settings keys (`packages/app/src/hooks/use-settings/keys.ts`). */
export const APP_SETTINGS_KEY = "@paseo:app-settings";
export const LEGACY_SETTINGS_KEY = "@paseo:settings";

/** The host's bounds (`use-settings/storage.ts`). */
export const HOST_CODE_FONT_SIZE = { min: 9, max: 22, default: 12 } as const;
export const HOST_CONTENT_FONT_SIZE = { min: 10, max: 21 } as const;
const MAX_FONT_FAMILY_LENGTH = 200;
/** Re-read storage at most this often. */
export const RECHECK_MS = 500;
/** One trailing look after a trigger, for a host write that lands late. */
const TRAILING_MS = 600;

/** What Paseo's Appearance settings say, as far as the plugin uses it. */
export interface HostAppearance {
  /** The user's mono family or stack, as typed in Paseo; absent when unset. */
  monoFontFamily?: string;
  /** Code size in px, floored and clamped like the host does; absent when unreadable. */
  codeFontSize?: number;
  /** Reading size in px, floored and clamped like the host does; absent when unreadable. */
  contentFontSize?: number;
}

/** Same rules as the host's `sanitizeFontFamily`; "" and invalid both mean unset. */
export function sanitizeFamily(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FONT_FAMILY_LENGTH) return undefined;
  if (/[<>{}();]/.test(trimmed)) return undefined;
  if ([...trimmed].some((char) => char.charCodeAt(0) <= 0x1f || char.charCodeAt(0) === 0x7f)) {
    return undefined;
  }
  return trimmed;
}

function clampSize(value: unknown, bounds: { min: number; max: number }): number | undefined {
  let numeric = NaN;
  if (typeof value === "number") numeric = value;
  else if (typeof value === "string" && value.trim().length > 0) numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(numeric)));
}

/** Same rules as the host's `parseClampedFontSize` for code. */
export function clampCodeSize(value: unknown): number | undefined {
  return clampSize(value, HOST_CODE_FONT_SIZE);
}

/** Same rules as the host's `parseClampedFontSize` for content. */
export function clampContentSize(value: unknown): number | undefined {
  return clampSize(value, HOST_CONTENT_FONT_SIZE);
}

/** One stored settings blob, or null when it is missing, not JSON or not an object. */
export function parseAppSettings(raw: string | null): HostAppearance | null {
  if (raw === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  const record = decoded as Record<string, unknown>;
  const appearance: HostAppearance = {};
  const family = sanitizeFamily(record.monoFontFamily);
  if (family !== undefined) appearance.monoFontFamily = family;
  const size = clampCodeSize(record.codeFontSize);
  if (size !== undefined) appearance.codeFontSize = size;
  // The host fills a missing content size from the UI base size, then writes
  // it back. Read the same way so a blob that has not been rewritten yet
  // still follows the control.
  const content = clampContentSize(record.contentFontSize) ?? clampContentSize(record.uiBaseFontSize);
  if (content !== undefined) appearance.contentFontSize = content;
  return appearance;
}

/**
 * The host's own read order: the current key, else (missing or corrupt) the
 * legacy one. Null when neither yields settings.
 */
export function resolveAppearance(current: string | null, legacy: string | null): HostAppearance | null {
  return parseAppSettings(current) ?? parseAppSettings(legacy);
}

const GENERIC_FAMILIES = new Set([
  "monospace",
  "ui-monospace",
  "serif",
  "sans-serif",
  "system-ui",
  "cursive",
  "fantasy",
]);

/**
 * The CSS stack for the user's value: each entry of what they typed (one
 * family, or a stack like `JetBrains Mono, Fira Code`) quoted unless it is
 * already quoted or generic, then Paseo's default stack, so a face this
 * computer lacks falls back exactly as the host's default would.
 */
export function appearanceMonoStack(family: string, defaultStack: string): string {
  const entries = (family.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== '""' && entry !== "''")
    .map((entry) => {
      if (/^(["']).*\1$/.test(entry)) return `"${entry.slice(1, -1).replace(/["']/g, "")}"`;
      if (GENERIC_FAMILIES.has(entry.toLowerCase())) return entry.toLowerCase();
      return `"${entry.replace(/["']/g, "")}"`;
    });
  return entries.length > 0 ? `${entries.join(", ")}, ${defaultStack}` : defaultStack;
}

// --- Store ---------------------------------------------------------------

type Storage = Pick<globalThis.Storage, "getItem">;

interface StoreState {
  current: string | null;
  legacy: string | null;
  value: HostAppearance | null;
  checkedAt: number;
}

const state: StoreState = { current: null, legacy: null, value: null, checkedAt: -Infinity };
let parses = 0;
const listeners = new Set<() => void>();
let trailing: ReturnType<typeof setTimeout> | null = null;
let nativeInflight = false;
let nativeAgain = false;

type SettingsPair = { current: string | null; legacy: string | null };
type NativeSettingsRead = () => Promise<SettingsPair | null>;
type MultiGet = (
  keys: string[],
  callback: (errors?: unknown[] | null, result?: Array<[string, string | null]>) => void,
) => void;

/** Test seam: replace the AsyncStorage read. `null` uses the host module. */
let nativeReaderOverride: NativeSettingsRead | null = null;

export function setNativeSettingsReaderForTests(reader: NativeSettingsRead | null): void {
  nativeReaderOverride = reader;
}

function webStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate && typeof candidate.getItem === "function" ? candidate : null;
  } catch {
    // Reading `localStorage` throws where storage is blocked.
    return null;
  }
}

function readRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Applies one pair of raw blobs. Returns whether the value the plugin uses changed. */
function applyRaw(current: string | null, legacy: string | null): boolean {
  if (parses > 0 && current === state.current && legacy === state.legacy) return false;
  state.current = current;
  state.legacy = legacy;
  parses += 1;
  const next = resolveAppearance(current, legacy);
  // Keep the old object while nothing the plugin uses changed, so memoised
  // tokens and styles keep their identity.
  if (sameAppearance(state.value, next)) return false;
  state.value = next;
  return true;
}

function readNativeKey(multiGet: MultiGet, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      multiGet([key], (_errors, result) => {
        const value = result?.[0]?.[1];
        resolve(typeof value === "string" ? value : null);
      });
    } catch {
      resolve(null);
    }
  });
}

interface ReactNativeSettingsModule {
  Platform?: { OS?: string };
  TurboModuleRegistry?: { get?: (name: string) => { multiGet?: MultiGet } | null };
  NativeModules?: { RNCAsyncStorage?: { multiGet?: MultiGet } };
}

// The plugin bundle is CJS. A direct `require` uses that bundle's require,
// which the host resolves to its own React Native. A static `import` would
// load the package in every unit test that touches typography.
declare function require(id: string): unknown;

/**
 * The host's AsyncStorage, or null on web and where the native module is not
 * registered. Plugins cannot import the AsyncStorage package; the host app
 * already links `RNCAsyncStorage`, and `react-native` is the host's module.
 *
 * Called only when `localStorage` is absent, so unit tests that stub
 * `localStorage` never reach it.
 */
function builtinNativeRead(): NativeSettingsRead | null {
  let rn: ReactNativeSettingsModule | null = null;
  try {
    rn = require("react-native") as ReactNativeSettingsModule;
  } catch {
    return null;
  }
  const os = rn?.Platform?.OS;
  if (os !== "ios" && os !== "android") return null;
  let storage: { multiGet?: MultiGet } | null = null;
  try {
    storage = rn.TurboModuleRegistry?.get?.("RNCAsyncStorage") ?? null;
  } catch {
    storage = null;
  }
  if (typeof storage?.multiGet !== "function") {
    try {
      storage = rn.NativeModules?.RNCAsyncStorage ?? null;
    } catch {
      storage = null;
    }
  }
  const multiGet = storage?.multiGet;
  if (typeof multiGet !== "function") return null;
  return () =>
    Promise.all([readNativeKey(multiGet, APP_SETTINGS_KEY), readNativeKey(multiGet, LEGACY_SETTINGS_KEY)]).then(
      ([current, legacy]) => ({ current, legacy }),
    );
}

function startNativeRead(read: NativeSettingsRead): void {
  if (nativeInflight) {
    nativeAgain = true;
    return;
  }
  nativeInflight = true;
  void read()
    .then((pair) => {
      nativeInflight = false;
      if (pair && applyRaw(pair.current, pair.legacy)) notify();
      if (nativeAgain) {
        nativeAgain = false;
        startNativeRead(read);
      }
    })
    .catch(() => {
      nativeInflight = false;
      nativeAgain = false;
    });
}

/**
 * Looks at storage if the last look is older than `RECHECK_MS`, and parses
 * only when a raw string changed. Returns whether the value changed.
 *
 * Web reads `localStorage` synchronously. iOS and Android read AsyncStorage;
 * that result arrives on a later turn and notifies subscribers itself, so
 * this call returns false.
 */
export function checkHostAppearance(now: number = Date.now()): boolean {
  if (now - state.checkedAt < RECHECK_MS) return false;
  const storage = webStorage();
  if (storage) {
    state.checkedAt = now;
    return applyRaw(readRaw(storage, APP_SETTINGS_KEY), readRaw(storage, LEGACY_SETTINGS_KEY));
  }
  const read = nativeReaderOverride ?? builtinNativeRead();
  if (!read) {
    state.checkedAt = now;
    return applyRaw(null, null);
  }
  if (nativeInflight) {
    nativeAgain = true;
    return false;
  }
  state.checkedAt = now;
  startNativeRead(read);
  return false;
}

function sameAppearance(a: HostAppearance | null, b: HostAppearance | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.monoFontFamily === b.monoFontFamily &&
    a.codeFontSize === b.codeFontSize &&
    a.contentFontSize === b.contentFontSize
  );
}

function notify() {
  for (const listener of listeners) listener();
}

/** A trigger: look now (throttled) and once more shortly after. */
export function triggerHostAppearanceCheck(): void {
  if (checkHostAppearance()) notify();
  if (trailing !== null) return;
  trailing = setTimeout(() => {
    trailing = null;
    if (checkHostAppearance()) notify();
  }, TRAILING_MS);
}

function onVisibility() {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    triggerHostAppearanceCheck();
  }
}

function onStorage(event: Event) {
  const key = (event as StorageEvent).key;
  if (key === null || key === APP_SETTINGS_KEY || key === LEGACY_SETTINGS_KEY) {
    triggerHostAppearanceCheck();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const target = globalThis as {
    addEventListener?: Window["addEventListener"];
    removeEventListener?: Window["removeEventListener"];
  };
  if (listeners.size === 1 && typeof target.addEventListener === "function") {
    target.addEventListener("focus", triggerHostAppearanceCheck);
    target.addEventListener("storage", onStorage);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof target.removeEventListener === "function") {
      target.removeEventListener("focus", triggerHostAppearanceCheck);
      target.removeEventListener("storage", onStorage);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      if (trailing !== null) {
        clearTimeout(trailing);
        trailing = null;
      }
    }
  };
}

function snapshot(): HostAppearance | null {
  checkHostAppearance();
  return state.value;
}

function serverSnapshot(): HostAppearance | null {
  return null;
}

const noSubscribe = () => () => {};
const noSnapshot = () => null;

/**
 * Paseo's Appearance settings for the tokens hooks, or null.
 *
 * `enabled` is false whenever the host theme carries `typography` (H1): then
 * nothing is read or subscribed. On iOS and Android the read is asynchronous.
 * `hostTheme` is the
 * theme prop: the host hands plugins a new one after it applies an
 * appearance change, which is the moment to look again.
 */
export function useHostAppearance(enabled: boolean, hostTheme: unknown): HostAppearance | null {
  const value = useSyncExternalStore(
    enabled ? subscribe : noSubscribe,
    enabled ? snapshot : noSnapshot,
    serverSnapshot,
  );
  useEffect(() => {
    if (enabled) triggerHostAppearanceCheck();
  }, [enabled, hostTheme]);
  return enabled ? value : null;
}

/** Test seam: how many times a raw settings string was parsed. */
export function hostAppearanceParseCount(): number {
  return parses;
}

/** Test seam: forget the cache and pending looks. */
export function resetHostAppearanceForTests(): void {
  state.current = null;
  state.legacy = null;
  state.value = null;
  state.checkedAt = -Infinity;
  parses = 0;
  nativeInflight = false;
  nativeAgain = false;
  nativeReaderOverride = null;
  if (trailing !== null) clearTimeout(trailing);
  trailing = null;
}
