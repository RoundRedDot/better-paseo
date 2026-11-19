import type { PaseoApi } from "@getpaseo/client";
import { createContext } from "react";
import { SETTINGS_SCREEN_ID, setSettingsTab } from "../settings-tab";

/** A sheet hosting selectable text must close before settings replaces it. */
export const TranslationSettingsParentCloseContext = createContext<(() => void) | null>(null);

const openers = new WeakMap<object, () => void>();
let targetTranslation = false;

export function registerTranslationSettingsOpener(paseo: object, openSettings: (id: string) => void): () => void {
  const open = () => {
    targetTranslation = true;
    setSettingsTab("display");
    openSettings(SETTINGS_SCREEN_ID);
  };
  openers.set(paseo, open);
  return () => { if (openers.get(paseo) === open) openers.delete(paseo); };
}

export function openTranslationSettings(paseo: PaseoApi | undefined | null): void {
  if (paseo) openers.get(paseo)?.();
}

export function translationSettingsTarget(): boolean { return targetTranslation; }

export function clearTranslationSettingsTarget(): void { targetTranslation = false; }
