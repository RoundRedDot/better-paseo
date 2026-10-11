/**
 * TEMPORARY, READ-ONLY compatibility layer: the monospace font and code size
 * the user set in Paseo's own Appearance settings, on web and desktop.
 *
 * Why it exists (plan decision D10, authorised by the user on 2026-10-11):
 * the monospace source priority is
 *   1. host `theme.typography` (plan H1),
 *   2. the font the user set in Paseo's Appearance settings,
 *   3. Paseo's official default stack,
 * with the embedded Iosevka only when picked in this plugin's settings.
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
 * - Two fields of it: `monoFontFamily` (string; "" means the platform default
 *   stack, i.e. unset) and `codeFontSize` (number; the host floors it and
 *   clamps it to 9–22, default 12).
 * It never writes to the host's storage.
 *
 * Validation mirrors the host's own (`sanitizeFontFamily`,
 * `parseClampedFontSize`): a family over 200 characters, or one with a
 * character that could break a CSS value (`<>{}();`, control characters), is
 * rejected — the host would draw its default for it, so the plugin does too.
 * Any read, parse or shape failure falls back to level 3 silently.
 *
 * Scope: web and desktop only, and only while the host theme carries no
 * `typography`; iOS and Android cannot reach AsyncStorage from a plugin and
 * use level 3.
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

/** Same rules as the host's `parseClampedFontSize` for code. */
export function clampCodeSize(value: unknown): number | undefined {
  let numeric = NaN;
  if (typeof value === "number") numeric = value;
  else if (typeof value === "string" && value.trim().length > 0) numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(HOST_CODE_FONT_SIZE.max, Math.max(HOST_CODE_FONT_SIZE.min, Math.floor(numeric)));
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

/**
 * Looks at storage if the last look is older than `RECHECK_MS`, and parses
 * only when a raw string changed. Returns whether the value changed.
 */
export function checkHostAppearance(now: number = Date.now()): boolean {
  if (now - state.checkedAt < RECHECK_MS) return false;
  state.checkedAt = now;
  const storage = webStorage();
  const current = storage ? readRaw(storage, APP_SETTINGS_KEY) : null;
  const legacy = storage ? readRaw(storage, LEGACY_SETTINGS_KEY) : null;
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

function sameAppearance(a: HostAppearance | null, b: HostAppearance | null): boolean {
  if (a === null || b === null) return a === b;
  return a.monoFontFamily === b.monoFontFamily && a.codeFontSize === b.codeFontSize;
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
 * Paseo's Appearance mono settings for the tokens hooks, or null.
 *
 * `enabled` is false on iOS/Android and whenever the host theme carries
 * `typography` (H1): then nothing is read or subscribed. `hostTheme` is the
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
  if (trailing !== null) clearTimeout(trailing);
  trailing = null;
}
