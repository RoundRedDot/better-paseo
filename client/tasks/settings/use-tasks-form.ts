import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, type TasksSettings } from "../../../shared/tasks-settings";
import { setTasksEnabled } from "../board/enabled";

/**
 * The switch went on from this page and the board has not been opened since:
 * the page says where the entry appeared. Module state, so the notice
 * survives a switch between the page's halves (each mounts its own form).
 */
let turnedOnHere = false;
const noticeListeners = new Set<() => void>();

function setTurnedOnHere(next: boolean): void {
  if (next === turnedOnHere) return;
  turnedOnHere = next;
  for (const listener of [...noticeListeners]) listener();
}

function subscribeNotice(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

const noticeSnapshot = () => turnedOnHere;

/** The board was opened from the notice: it has done its job. */
export function dismissEnabledNotice(): void {
  setTurnedOnHere(false);
}

/** Tests only. */
export function resetEnabledNotice(): void {
  turnedOnHere = false;
  noticeListeners.clear();
}

/**
 * The Tasks settings as the settings page edits them: the host's settings
 * record (`useSettings`, the page's one read), saves against its revision, a
 * refused save reloading the latest, and a reset that keeps the board on or
 * off. The board's store follows the record, so the sidebar entry and the
 * Command Center item come and go with the switch (`contribute.tsx`).
 */
export function useTasksForm() {
  const settings = useSettings(TASKS_SETTINGS);
  const [conflict, setConflict] = useState(false);
  const turnedOn = useSyncExternalStore(subscribeNotice, noticeSnapshot, noticeSnapshot);

  const { save, reload, reset } = settings;
  const revision = settings.status === "ready" ? settings.revision : null;
  // A second edit while one saves would carry the same, soon stale, revision.
  const saving = settings.saving;
  const commit = useCallback(
    async (next: TasksSettings) => {
      if (revision === null || saving) return;
      setConflict(false);
      if (await save(next, revision)) return;
      // A refused save is a stale revision more often than not: show the latest.
      await reload();
      setConflict(true);
    },
    [save, reload, revision, saving],
  );
  const enabled = settings.status === "ready" ? settings.values.enabled : null;
  const setEnabled = useCallback(
    (next: boolean) => {
      if (settings.status !== "ready") return;
      setTurnedOnHere(next);
      void commit({ ...settings.values, enabled: next });
    },
    [settings, commit],
  );
  // Resetting the card and board options keeps the board on or off: a reset
  // that also hid the board would read as the page breaking it. A record the
  // schema rejects has no switch to keep, so it takes the host's reset.
  const restoreDefaults = useCallback(async () => {
    setConflict(false);
    if (enabled === null) await reset();
    else await commit({ ...DEFAULT_TASKS_SETTINGS, enabled });
  }, [reset, commit, enabled]);
  useEffect(() => {
    if (enabled !== null) setTasksEnabled(enabled);
    // Turned off elsewhere: the hint about the entry no longer holds.
    if (enabled === false) setTurnedOnHere(false);
  }, [enabled]);

  return { settings, conflict, commit, setEnabled, restoreDefaults, turnedOn: turnedOn && enabled === true };
}

export type TasksForm = ReturnType<typeof useTasksForm>;
