/**
 * Paseo's own UI language, as far as a plugin can see it, reduced to the two
 * languages Better Paseo draws: Chinese or English.
 *
 * The plugin SDK does not say which language Paseo is set to, so this reads
 * what the host persists and what the device says, the way the host does
 * (`packages/app/src/i18n/provider.tsx`, `locales.ts`):
 *
 * - the setting: `language` in the host's app settings (`@paseo:app-settings`,
 *   else the legacy `@paseo:settings`), "system" or a locale such as "zh-CN".
 *   Web and desktop read it from `localStorage` synchronously; iOS and
 *   Android from the host's AsyncStorage module, which answers on a later
 *   turn, so the first look there sees the device locale only and a change
 *   is announced to `subscribeHostLanguage` when the read lands.
 * - the device locales, in order: web `navigator.languages`; native the host's
 *   own source, expo-localization's `getLocales()` through the Expo module
 *   registry, else iOS `AppleLanguages` / Android `localeIdentifier`, else
 *   `Intl`. `Intl` alone is wrong on native: an app bundle that declares no
 *   localisations resolves to "en-<region>" on a Chinese iPhone.
 *
 * "system" walks the device locales like the host: the first one Paseo
 * translates decides; any `zh` locale counts as Chinese.
 *
 * Reads are throttled to one look a second and never write anything.
 */
import { useSyncExternalStore } from "react";
import {
  APP_SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  builtinNativeRead,
  type NativeSettingsRead,
  type SettingsPair,
} from "../ui/tokens/host-appearance-shim";

export type HostLanguage = "en" | "zh";

/** Languages the host translates besides Chinese (`REGIONAL_LANGUAGE_LOCALES`, pt-BR). */
const HOST_OTHER_LANGUAGES = new Set(["ar", "en", "es", "fr", "ja", "ko", "ru", "pt"]);

export function isChineseLocale(locale: string | null | undefined): boolean {
  return typeof locale === "string" && /^zh(?:[-_]|$)/i.test(locale);
}

/**
 * The board's language for a host setting and the device locales. Pure, for
 * tests: an explicit host language decides (any `zh` is Chinese, every other
 * one English); "system" or no setting takes the first device locale the host
 * translates, else English.
 */
export function pickHostLanguage(setting: unknown, locales: readonly string[] | string | null | undefined): HostLanguage {
  if (setting !== undefined && setting !== null && setting !== "system") return isChineseLocale(String(setting)) ? "zh" : "en";
  const list = typeof locales === "string" ? [locales] : (locales ?? []);
  for (const locale of list) {
    if (typeof locale !== "string" || !locale) continue;
    if (isChineseLocale(locale)) return "zh";
    if (HOST_OTHER_LANGUAGES.has(locale.toLowerCase().split(/[-_]/, 1)[0] ?? "")) return "en";
  }
  return "en";
}

// --- Device locales -------------------------------------------------------

interface ReactNativeLocaleModule {
  Platform?: { OS?: string };
  Settings?: { get?: (key: string) => unknown };
  I18nManager?: { getConstants?: () => { localeIdentifier?: string | null } };
}

// The plugin bundle is CJS: `require` resolves to the host's React Native. A
// static import would load the package in unit tests that never mock it.
declare function require(id: string): unknown;

function reactNative(): ReactNativeLocaleModule | null {
  try {
    return require("react-native") as ReactNativeLocaleModule;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function navigatorLocales(): string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  const list = stringList(nav?.languages ? [...nav.languages] : []);
  return list.length > 0 ? list : stringList(nav?.language);
}

function expoLocales(): string[] {
  try {
    const module = (globalThis as {
      expo?: { modules?: { ExpoLocalization?: { getLocales?: () => Array<{ languageTag?: unknown }> } } };
    }).expo?.modules?.ExpoLocalization;
    const locales = typeof module?.getLocales === "function" ? module.getLocales() : null;
    return Array.isArray(locales) ? stringList(locales.map((locale) => locale?.languageTag)) : [];
  } catch {
    return [];
  }
}

function reactNativeLocales(rn: ReactNativeLocaleModule): string[] {
  try {
    if (rn.Platform?.OS === "ios" && typeof rn.Settings?.get === "function") {
      const languages = stringList(rn.Settings.get("AppleLanguages"));
      if (languages.length > 0) return languages;
      const locale = stringList(rn.Settings.get("AppleLocale"));
      if (locale.length > 0) return locale;
    }
    return stringList(rn.I18nManager?.getConstants?.().localeIdentifier);
  } catch {
    return [];
  }
}

function intlLocales(): string[] {
  try {
    return stringList(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return [];
  }
}

/** Test seam: where the locales and the native settings come from. */
interface Sources {
  deviceLocales?: () => string[];
  nativeRead?: NativeSettingsRead | null;
}
let sources: Sources = {};

function readDeviceLocales(): string[] {
  if (sources.deviceLocales) return sources.deviceLocales();
  const fromNavigator = navigatorLocales();
  if (fromNavigator.length > 0) return fromNavigator;
  const fromExpo = expoLocales();
  if (fromExpo.length > 0) return fromExpo;
  const rn = reactNative();
  const fromNative = rn ? reactNativeLocales(rn) : [];
  return fromNative.length > 0 ? fromNative : intlLocales();
}

const READ_EVERY_MS = 1000;
let locales: string[] = [];
let localesAt = -Infinity;

/** The device's preferred locales, most preferred first; empty where none is exposed. */
export function deviceLocales(now: number = Date.now()): readonly string[] {
  if (now - localesAt >= READ_EVERY_MS) {
    localesAt = now;
    locales = readDeviceLocales();
  }
  return locales;
}

// --- The host setting -----------------------------------------------------

let settingRaw: string | null | undefined = undefined;
let setting: unknown = undefined;
let settingAt = -Infinity;
let nativeInflight = false;
let version = 0;
const listeners = new Set<() => void>();

function languageOf(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    const decoded = JSON.parse(raw) as unknown;
    return decoded && typeof decoded === "object" && !Array.isArray(decoded) ? (decoded as { language?: unknown }).language : undefined;
  } catch {
    return undefined;
  }
}

/** The host's read order: the current key, else (missing or unreadable) the legacy one. */
function settingOf(pair: SettingsPair): unknown {
  return languageOf(pair.current) ?? languageOf(pair.legacy);
}

function apply(pair: SettingsPair): boolean {
  const raw = `${pair.current}\u0000${pair.legacy}`;
  if (raw === settingRaw) return false;
  settingRaw = raw;
  const next = settingOf(pair);
  if (next === setting) return false;
  setting = next;
  return true;
}

function notify(): void {
  version++;
  for (const listener of [...listeners]) listener();
}

type WebStorage = { getItem(key: string): string | null };

function webStorage(): WebStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: WebStorage }).localStorage;
    return candidate && typeof candidate.getItem === "function" ? candidate : null;
  } catch {
    return null;
  }
}

function readWeb(storage: WebStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Paseo's stored language setting: "zh-CN", "system", ...; undefined when
 * unreadable or, on native, not read yet. A native value that changes is
 * announced to `subscribeHostLanguage`.
 */
export function hostLanguageSetting(now: number = Date.now()): unknown {
  if (now - settingAt < READ_EVERY_MS) return setting;
  settingAt = now;
  const storage = webStorage();
  if (storage) {
    apply({ current: readWeb(storage, APP_SETTINGS_KEY), legacy: readWeb(storage, LEGACY_SETTINGS_KEY) });
    return setting;
  }
  const read = sources.nativeRead !== undefined ? sources.nativeRead : builtinNativeRead();
  if (read && !nativeInflight) {
    nativeInflight = true;
    void read()
      .then((pair) => {
        nativeInflight = false;
        if (pair && apply(pair)) notify();
      })
      .catch(() => {
        nativeInflight = false;
      });
  }
  return setting;
}

/** Paseo's UI language now, Chinese or English. */
export function hostLanguage(): HostLanguage {
  return pickHostLanguage(hostLanguageSetting(), deviceLocales());
}

// The host's language changed in another window (desktop has one per window):
// the `storage` event. A change in this window fires none; the next look
// picks it up.
let detachStorage: (() => void) | null = null;

function onStorage(event: { key?: string | null }): void {
  if (event.key !== null && event.key !== undefined && event.key !== APP_SETTINGS_KEY && event.key !== LEGACY_SETTINGS_KEY) return;
  settingAt = -Infinity;
  hostLanguageSetting();
  notify();
}

/** Called when the host's language may have changed: a native read landed, or another window wrote it. */
export function subscribeHostLanguage(listener: () => void): () => void {
  listeners.add(listener);
  const target = globalThis as {
    addEventListener?: (type: string, listener: (event: { key?: string | null }) => void) => void;
    removeEventListener?: (type: string, listener: (event: { key?: string | null }) => void) => void;
  };
  if (!detachStorage && webStorage() && typeof target.addEventListener === "function") {
    target.addEventListener("storage", onStorage);
    detachStorage = () => target.removeEventListener?.("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detachStorage) {
      detachStorage();
      detachStorage = null;
    }
  };
}

const readVersion = () => version;

/** Re-renders the caller when the host's language may have changed; returns a change counter. */
export function useHostLanguageVersion(): number {
  return useSyncExternalStore(subscribeHostLanguage, readVersion, readVersion);
}

/** Tests only: forget every cached look and replace the sources (none = the real ones). */
export function resetHostLanguageForTests(next: Sources = {}): void {
  sources = next;
  locales = [];
  localesAt = -Infinity;
  settingRaw = undefined;
  setting = undefined;
  settingAt = -Infinity;
  nativeInflight = false;
  listeners.clear();
  detachStorage?.();
  detachStorage = null;
}
