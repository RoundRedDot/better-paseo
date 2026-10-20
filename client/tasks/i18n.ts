import { useEnhancerPreferences } from "../preferences";
import { resolveLanguage, type SettingsLanguage } from "../i18n/settings-strings";

/**
 * The Tasks board's language: the same `language` preference as Better
 * Paseo's settings page (`system` follows the device locale). Each module
 * keeps its own `{ en, zh }` strings and picks with this.
 */
export function useTasksLanguage(): SettingsLanguage {
  return resolveLanguage(useEnhancerPreferences().language);
}

export type TasksLanguage = SettingsLanguage;
