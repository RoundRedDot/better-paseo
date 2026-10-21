import { useSyncExternalStore } from "react";

/**
 * Which half of Better Paseo's settings page shows: the chat options or the
 * Tasks board's. Module state, so the page opens where it was left, and so a
 * link from outside the page (the off board's "Open settings") can pick the
 * Tasks half before it asks the host to open the page: settings routes carry
 * no params (Paseo `plugins/settings/index.tsx`).
 */
export type SettingsTab = "display" | "tasks";

/** The page's settings screen id; the id predates the Tasks half and stays, since routes name it. */
export const SETTINGS_SCREEN_ID = "chat-presentation";

let tab: SettingsTab = "display";
const listeners = new Set<() => void>();

export function settingsTab(): SettingsTab {
  return tab;
}

export function setSettingsTab(next: SettingsTab): void {
  if (next === tab) return;
  tab = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettingsTab(): SettingsTab {
  return useSyncExternalStore(subscribe, settingsTab, settingsTab);
}

/** Tests only. */
export function resetSettingsTab(): void {
  tab = "display";
  listeners.clear();
}
