import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import type { DetailSection } from "./detail-model";

/**
 * The details sections the user opened or closed, by section, for every card:
 * the user's choice beats the state's default (usage closed while a card
 * asks or failed). Session memory everywhere, web storage across reloads.
 */
type Choices = Partial<Record<DetailSection, boolean>>;

const STORAGE_KEY = "paseo/better-chat/tasks/detail-sections/v1";
const SECTIONS: readonly DetailSection[] = ["properties", "subtasks", "usage", "activity"];
let remembered: Choices | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(): Choices {
  if (remembered) return remembered;
  const next: Choices = {};
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const section of SECTIONS) if (typeof parsed[section] === "boolean") next[section] = parsed[section];
  } catch {
    // A broken entry reads as no choices.
  }
  remembered = next;
  return next;
}

/** `true` when closed: the user's last choice, else the state's default. */
export function sectionClosed(choices: Choices, section: DetailSection, closedByDefault: boolean): boolean {
  return choices[section] ?? closedByDefault;
}

export function setSectionClosed(section: DetailSection, closed: boolean): void {
  remembered = { ...read(), [section]: closed };
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(remembered));
  } catch {
    // Storage full or blocked: the session still remembers.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSectionChoices(): Choices {
  return useSyncExternalStore(subscribe, read, read);
}

/** Tests only. */
export function resetSectionChoices(): void {
  remembered = null;
}
