import { useEffect, useSyncExternalStore } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, type TasksSettings } from "../../../shared/tasks-settings";
import { carriedSettings, carrySettings } from "./carry";

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
  notify();
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * The startup read (`contribute.tsx`): "pending" while it is in flight,
 * "done" once it answered, "failed" when it could not; "none" when nothing
 * started one (tests, another entry). A board opened while it is pending
 * waits for it instead of reading the settings a second time.
 */
export type StartupRead = "none" | "pending" | "done" | "failed";
let startupRead: StartupRead = "none";

export function setTasksStartupRead(next: StartupRead): void {
  if (next === startupRead) return;
  startupRead = next;
  notify();
}

export function tasksStartupRead(): StartupRead {
  return startupRead;
}

const snapshot = () => `${enabled}:${startupRead}`;

/** What the store knows, for a component: re-renders when either changes. */
export function useTasksEnabledStore(): { enabled: boolean | null; startupRead: StartupRead } {
  useSyncExternalStore(subscribeTasksEnabled, snapshot, snapshot);
  return { enabled, startupRead };
}

export function subscribeTasksEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The tasks settings for a component, and the store kept in step with them.
 * Until they load, the ones this host last read (`carry.ts`: a reconnect
 * evaluates the bundle again); null when there are none.
 */
export function useTasksSettings(hostId: string): TasksSettings | null {
  const state = useSettings(TASKS_SETTINGS);
  const values = state.status === "ready" ? state.values : null;
  const on = values?.enabled ?? null;
  useEffect(() => {
    if (on !== null) setTasksEnabled(on);
  }, [on]);
  useEffect(() => {
    if (values) carrySettings(hostId, values);
  }, [hostId, values]);
  // A record the schema rejects keeps the board off rather than guessing.
  if (state.status === "invalid") return { ...DEFAULT_TASKS_SETTINGS, enabled: false };
  return values ?? carriedSettings(hostId);
}

/**
 * Opens the Tasks half of Better Paseo's settings page; set by
 * `contribute.tsx`, since screen props carry no way to open settings.
 */
let settingsOpener: (() => void) | null = null;

export function setTasksSettingsOpener(open: (() => void) | null): void {
  settingsOpener = open;
}

export function tasksSettingsOpener(): (() => void) | null {
  return settingsOpener;
}

/** Opens the board; set by `contribute.tsx`, since settings props carry no navigation. */
let boardOpener: (() => void) | null = null;

export function setTasksBoardOpener(open: (() => void) | null): void {
  boardOpener = open;
}

export function tasksBoardOpener(): (() => void) | null {
  return boardOpener;
}

/** Tests only. */
export function resetTasksEnabled(): void {
  enabled = null;
  startupRead = "none";
  settingsOpener = null;
  boardOpener = null;
  listeners.clear();
}
