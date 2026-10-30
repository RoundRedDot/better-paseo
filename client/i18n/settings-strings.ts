/**
 * The settings page's language: the preference, Paseo's language, and the
 * page's title. The page's own text, in English and Chinese, is in
 * `settings-page-strings.ts`, which only the Tasks chunk's settings page
 * reads, so the bundle the app loads on every connect leaves it out.
 *
 * "Follow Paseo" (the "system" preference) follows Paseo's own language (`host-language.ts`): the
 * language set in Paseo's settings, else the device locales the way Paseo
 * reads them. Only the settings page (with the sample turn of its preview)
 * and the names preview toolbar buttons show on hover are translated
 * (`toolbar-strings.ts`): the chat itself shows the model's and the tools'
 * own words.
 */
import { deviceLocales, hostLanguage, isChineseLocale } from "./host-language";

export type SettingsLanguagePreference = "system" | "en" | "zh";
export type SettingsLanguage = "en" | "zh";

/** The device locale, e.g. `zh-CN`, or null where the runtime exposes none. */
export function systemLanguage(): string | null {
  return deviceLocales()[0] ?? null;
}

/**
 * The language the page is drawn in: an explicit choice, else Paseo's
 * language. A `locale` given (tests, a caller that knows it) stands in for
 * Paseo's: Chinese for any `zh` locale.
 */
export function resolveLanguage(preference: SettingsLanguagePreference, locale?: string | null): SettingsLanguage {
  if (preference !== "system") return preference;
  if (locale === undefined) return hostLanguage();
  return isChineseLocale(locale) ? "zh" : "en";
}

/** The settings screen's title, which the host lists before the page itself loads. */
export const SETTINGS_SCREEN_TITLES: Readonly<Record<SettingsLanguage, string>> = { en: "Settings", zh: "设置" };
