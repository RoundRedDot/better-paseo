/**
 * The group a work details panel shows (`turn-work-card.tsx`), kept at
 * module level: the panel's body mounts again at each text size step on iOS,
 * and the running card's panel moves to the settled card, so a `useState`
 * would drop the reader's choice right then. In memory only, bounded to the
 * most recently chosen keys; a key nobody touched answers "all".
 */
import { useCallback, useSyncExternalStore } from "react";

/** The kinds the work details groups a turn's calls by, in display order. */
export type CallKind = "read" | "edit" | "command" | "search" | "fetch" | "mcp" | "agent" | "other" | "failed";
export type WorkFilter = "all" | CallKind;

export const WORK_FILTER_LIMIT = 200;

const choices = new Map<string, WorkFilter>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function getWorkFilter(key: string): WorkFilter {
  return choices.get(key) ?? "all";
}

export function setWorkFilter(key: string, filter: WorkFilter): void {
  choices.delete(key);
  choices.set(key, filter);
  while (choices.size > WORK_FILTER_LIMIT) {
    const oldest = choices.keys().next().value as string;
    choices.delete(oldest);
    notify(oldest);
  }
  notify(key);
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, set = new Set());
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

export function useWorkFilter(key: string): [WorkFilter, (filter: WorkFilter) => void] {
  const filter = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => getWorkFilter(key),
  );
  return [filter, useCallback((next: WorkFilter) => setWorkFilter(key, next), [key])];
}

/** Test seam: forget every choice. */
export function resetWorkFilterStore(): void {
  const keys = [...choices.keys()];
  choices.clear();
  for (const key of keys) notify(key);
}
