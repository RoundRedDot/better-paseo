import { useEffect } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, type TasksSettings } from "../../../shared/tasks-settings";

/**
 * Whether the Tasks board is on (`enabled` in the tasks settings), for what
 * lives outside React: `contribute.tsx` registers the board's screen,
 * sidebar entry and Command Center item only while it is. Null until
 * something knows: the one settings read at startup, the settings page,
 * or, while the board is on, its mounted sidebar entry and screen (their
 * `useSettings` follows saves from every client). Module state, so one per
 * host bundle like the board's session store.
 */
let enabled: boolean | null = null;
const listeners = new Set<() => void>();

export function tasksEnabled(): boolean | null {
  return enabled;
}

export function setTasksEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeTasksEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tasks settings for a component, and the store kept in step with them. Null until they load. */
export function useTasksSettings(): TasksSettings | null {
  const state = useSettings(TASKS_SETTINGS);
  const values = state.status === "ready" ? state.values : null;
  const on = values?.enabled ?? null;
  useEffect(() => {
    if (on !== null) setTasksEnabled(on);
  }, [on]);
  // A record the schema rejects keeps the board off rather than guessing.
  if (state.status === "invalid") return { ...DEFAULT_TASKS_SETTINGS, enabled: false };
  return values;
}

/** Tests only. */
export function resetTasksEnabled(): void {
  enabled = null;
  listeners.clear();
}
