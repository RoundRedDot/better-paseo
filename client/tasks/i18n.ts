import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { getEnhancerPreferences, useEnhancerPreferences } from "../preferences";
import { systemLanguage, type SettingsLanguage } from "../i18n/settings-strings";

/**
 * The Tasks board's language, Chinese or English only. An explicit choice in
 * Better Paseo's settings wins; "Follow system" follows the HOST's language:
 *
 * - web and desktop read Paseo's own app settings from localStorage
 *   (`@paseo:app-settings`, `.language`, Paseo 0.12's APP_SETTINGS_KEY):
 *   `zh-CN` (any `zh`) is Chinese, `system` follows the browser locale, any
 *   other language is English;
 * - native keeps those settings in AsyncStorage, out of reach of a
 *   synchronous read, so it follows the device locale.
 *
 * Each module keeps its own `{ en, zh }` strings and picks with this.
 */
export type TasksLanguage = SettingsLanguage;

const HOST_SETTINGS_KEY = "@paseo:app-settings";

function isChinese(locale: string | null | undefined): boolean {
  return typeof locale === "string" && /^zh(?:[-_]|$)/i.test(locale);
}

function readHostSettings(): string | null {
  try {
    return (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage?.getItem(HOST_SETTINGS_KEY) ?? null;
  } catch {
    return null;
  }
}

let parsedRaw: string | null = null;
let parsedLanguage: unknown = undefined;
let readAt = -Infinity;
// Every card asks on every render; the stored settings are read at most once a second.
const READ_EVERY_MS = 1000;

/** Paseo's language setting from its stored app settings: "zh-CN", "system", ...; undefined when unreadable. */
function hostLanguageSetting(): unknown {
  const now = Date.now();
  if (now - readAt < READ_EVERY_MS) return parsedLanguage;
  readAt = now;
  const raw = readHostSettings();
  if (raw === null) {
    parsedRaw = null;
    parsedLanguage = undefined;
    return undefined;
  }
  if (raw !== parsedRaw) {
    parsedRaw = raw;
    try {
      parsedLanguage = (JSON.parse(raw) as { language?: unknown } | null)?.language;
    } catch {
      parsedLanguage = undefined;
    }
  }
  return parsedLanguage;
}

/** The host's language as the board draws it. Pure over its inputs, for tests. */
export function hostLanguage(
  setting: unknown = Platform.OS === "web" ? hostLanguageSetting() : undefined,
  locale: string | null = systemLanguage(),
): TasksLanguage {
  if (setting === undefined || setting === null || setting === "system") return isChinese(locale) ? "zh" : "en";
  return isChinese(String(setting)) ? "zh" : "en";
}

let current: TasksLanguage | null = null;
const changeListeners = new Set<() => void>();

/**
 * The language now, outside React (registration titles). A change noticed
 * here is announced to `onTasksLanguageChange` on the next microtask, never
 * during a render.
 */
export function resolveTasksLanguage(): TasksLanguage {
  const preference = getEnhancerPreferences().language;
  const next = preference === "en" || preference === "zh" ? preference : hostLanguage();
  if (current !== null && next !== current) {
    void Promise.resolve().then(() => {
      for (const listener of [...changeListeners]) listener();
    });
  }
  current = next;
  return next;
}

/** Called after the language changed; registers no DOM listener of its own. */
export function onTasksLanguageChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

// The host's language changed in another window (desktop has one per
// window): the `storage` event. A change in this window fires none; the next
// render of a Tasks component or the next load picks it up. Listened to only
// while a Tasks component is mounted.
let storageVersion = 0;
const storageListeners = new Set<() => void>();
let detachStorage: (() => void) | null = null;

function subscribeStorage(listener: () => void): () => void {
  storageListeners.add(listener);
  const target = (globalThis as { addEventListener?: typeof window.addEventListener }).addEventListener;
  if (!detachStorage && Platform.OS === "web" && typeof target === "function") {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== HOST_SETTINGS_KEY) return;
      storageVersion++;
      readAt = -Infinity;
      for (const each of [...storageListeners]) each();
    };
    globalThis.addEventListener("storage", onStorage);
    detachStorage = () => globalThis.removeEventListener("storage", onStorage);
  }
  return () => {
    storageListeners.delete(listener);
    if (storageListeners.size === 0 && detachStorage) {
      detachStorage();
      detachStorage = null;
    }
  };
}

const readStorageVersion = () => storageVersion;

export function useTasksLanguage(): TasksLanguage {
  // Re-render on Better Paseo's preference and on the host's language changing elsewhere.
  useEnhancerPreferences();
  useSyncExternalStore(subscribeStorage, readStorageVersion, readStorageVersion);
  return resolveTasksLanguage();
}

/** Tests only. */
export function resetTasksLanguage(): void {
  current = null;
  parsedRaw = null;
  parsedLanguage = undefined;
  readAt = -Infinity;
  changeListeners.clear();
}
