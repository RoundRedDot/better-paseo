import type { PaseoApi } from "@getpaseo/client";
import { SETTINGS_SCREEN_ID, setSettingsTab } from "../settings-tab";

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
