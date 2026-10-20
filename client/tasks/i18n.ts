import { getEnhancerPreferences, useEnhancerPreferences } from "../preferences";
import { type SettingsLanguage } from "../i18n/settings-strings";
import { deviceLocales, hostLanguageSetting, pickHostLanguage, resetHostLanguageForTests, useHostLanguageVersion } from "../i18n/host-language";

/**
 * The Tasks board's language, Chinese or English only. An explicit choice in
 * Better Paseo's settings wins; "Follow Paseo" (the "system" preference) follows the HOST's language
 * (`i18n/host-language.ts`): Paseo's stored `language` setting, read from
 * localStorage on web and desktop and from the host's AsyncStorage on iOS and
 * Android; `zh-CN` (any `zh`) is Chinese, `system` follows the device locales
 * the way the host does, any other language is English.
 *
 * Each module keeps its own `{ en, zh }` strings and picks with this.
 */
export type TasksLanguage = SettingsLanguage;

/** The host's language as the board draws it. Pure over its inputs, for tests. */
export function hostLanguage(
  setting: unknown = hostLanguageSetting(),
  locale: readonly string[] | string | null = deviceLocales(),
): TasksLanguage {
  return pickHostLanguage(setting, locale);
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

export function useTasksLanguage(): TasksLanguage {
  // Re-render on Better Paseo's preference and on the host's language changing
  // (a native read landing, another window writing it).
  useEnhancerPreferences();
  useHostLanguageVersion();
  return resolveTasksLanguage();
}

/** Tests only. */
export function resetTasksLanguage(): void {
  current = null;
  changeListeners.clear();
  resetHostLanguageForTests();
}
