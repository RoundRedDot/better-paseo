import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SETTINGS_STRINGS } from "./i18n/settings-strings";
import { subscribeHostLanguage } from "./i18n/host-language";
import { BetterPaseoSettingsPage } from "./settings-page";
import { SETTINGS_SCREEN_ID } from "./settings-tab";
import { onTasksLanguageChange, resolveTasksLanguage } from "./tasks/i18n";

/**
 * Registers Better Paseo's one settings screen: the chat options and the
 * Tasks board's, as two halves of one page. Paseo lists it in the plugin's
 * menu under Settings > Plugins and heads the page with its title, which is a
 * plain string: it follows the language by registering again, with the same
 * component, so an open page keeps its state. Returns the cleanup.
 */
export function contributeSettingsScreen(client: PluginClientContext): () => void {
  let live = true;
  let language = resolveTasksLanguage();
  const register = () => {
    const remove = client.addSettingsScreen({
      id: SETTINGS_SCREEN_ID,
      title: SETTINGS_STRINGS[language].screenTitle,
      icon: "Blocks",
      Component: BetterPaseoSettingsPage,
    });
    return () => void remove();
  };
  let remove = register();
  const relabel = () => {
    const next = resolveTasksLanguage();
    if (!live || next === language) return;
    language = next;
    remove();
    remove = register();
  };
  const unsubscribeLanguage = onTasksLanguageChange(relabel);
  // iOS and Android learn the host's language from AsyncStorage after this first look.
  const unsubscribeHostLanguage = subscribeHostLanguage(relabel);
  return () => {
    live = false;
    unsubscribeLanguage();
    unsubscribeHostLanguage();
    remove();
  };
}
