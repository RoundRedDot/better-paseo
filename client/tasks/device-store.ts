import { LANE_WIDTHS, type TasksSettings } from "../../shared/tasks-settings";
import { DEFAULT_OPEN_TASKS_SHORTCUT, validTasksShortcut } from "./shortcut-model";

export const DEVICE_BOARD_FIELDS = ["hideSubtasks", "showArchived", "showEmptyGroups", "laneWidth"] as const;
export const CARD_TITLE_LINE_COUNTS = ["1", "2", "3", "4", "all"] as const;
const DEVICE_PREFERENCE_FIELDS = [...DEVICE_BOARD_FIELDS, "titleLines", "openShortcut"] as const;
export type CardTitleLineCount = (typeof CARD_TITLE_LINE_COUNTS)[number];
export const DEFAULT_CARD_TITLE_LINES: CardTitleLineCount = "2";
export type DeviceBoardPreferences = Pick<TasksSettings["board"], (typeof DEVICE_BOARD_FIELDS)[number]> & { titleLines: CardTitleLineCount; openShortcut: string | null };
/** Why a record is written: a first seed, an edit of some fields, or (none) a full replace. */
export type DeviceWriteIntent = { kind: "seed" } | { kind: "patch"; patch: Partial<DeviceBoardPreferences> };

export interface DevicePreferenceStorage {
  read(): string | null | Promise<string | null>;
  /** May answer the record it ended up with (a seed that another writer beat). */
  write(value: string, intent?: DeviceWriteIntent): void | string | null | Promise<void | string | null>;
}

export function deviceBoardPreferences(board: TasksSettings["board"]): DeviceBoardPreferences {
  return { hideSubtasks: board.hideSubtasks, showArchived: board.showArchived, showEmptyGroups: board.showEmptyGroups, laneWidth: board.laneWidth, titleLines: DEFAULT_CARD_TITLE_LINES, openShortcut: DEFAULT_OPEN_TASKS_SHORTCUT };
}

function decode(raw: string): DeviceBoardPreferences {
  const value = JSON.parse(raw) as Partial<DeviceBoardPreferences>;
  if (!value || typeof value.hideSubtasks !== "boolean" || typeof value.showArchived !== "boolean" || typeof value.showEmptyGroups !== "boolean" || !LANE_WIDTHS.includes(value.laneWidth!) || value.titleLines !== undefined && !CARD_TITLE_LINE_COUNTS.includes(value.titleLines) || value.openShortcut !== undefined && !validTasksShortcut(value.openShortcut)) {
    throw new Error("Invalid device Tasks preferences");
  }
  return { hideSubtasks: value.hideSubtasks, showArchived: value.showArchived, showEmptyGroups: value.showEmptyGroups, laneWidth: value.laneWidth!, titleLines: value.titleLines ?? DEFAULT_CARD_TITLE_LINES, openShortcut: value.openShortcut === undefined ? DEFAULT_OPEN_TASKS_SHORTCUT : value.openShortcut };
}

/** The old host fields are migration input only; never send a device edit back to the daemon. */
export function sharedTasksSettings(next: TasksSettings, saved: TasksSettings): TasksSettings {
  return { ...next, board: { ...next.board, hideSubtasks: saved.board.hideSubtasks, showArchived: saved.board.showArchived, showEmptyGroups: saved.board.showEmptyGroups, laneWidth: saved.board.laneWidth } };
}

/**
 * `provisional` reads a copy of the record that is usable before `storage` answers, or null:
 * the web copy of Paseo's device settings, read synchronously at startup.
 */
export function createDeviceTasksStore(storage: DevicePreferenceStorage, provisional?: () => string | null) {
  let state: { values: DeviceBoardPreferences | null; ready: boolean; error: string | null } = { values: null, ready: false, error: null };
  const listeners = new Set<() => void>();
  let loading = false;
  let writes = Promise.resolve();
  let revision = 0;
  /** Writes not settled yet: a reported record waits for them, so a local edit is never undone. */
  let inflight = 0;
  /** The latest record reported while a write was pending. */
  let deferred: string | null = null;
  /** Shows a reported record, keeping any error a failed write left. */
  const take = (raw: string) => {
    let values: DeviceBoardPreferences;
    try {
      values = decode(raw);
    } catch {
      return;
    }
    if (state.values && DEVICE_PREFERENCE_FIELDS.every((key) => state.values![key] === values[key])) return;
    state = { ...state, values, ready: true };
    emit();
  };
  /** After a write failed and rolled back: the record reported meanwhile, once nothing else is pending. */
  const takeDeferred = () => {
    if (inflight > 0 || deferred === null) return;
    const raw = deferred;
    deferred = null;
    take(raw);
  };
  const track = <T,>(pending: Promise<T>): Promise<T> => {
    inflight += 1;
    const done = () => { inflight -= 1; };
    pending.then(done, done);
    return pending;
  };
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const fail = (error: unknown) => {
    state = { ...state, error: error instanceof Error ? error.message : String(error) };
    emit();
  };
  const accept = (values: DeviceBoardPreferences) => {
    state = { values, ready: true, error: null };
    emit();
  };
  /** A write's own record, when it differs (fields another writer saved, merged in): unless a newer edit replaced it. */
  const adopt = (ownRevision: number, stored: void | string | null) => {
    // The saved record is newer than anything reported while it was pending.
    if (inflight === 0) deferred = null;
    if (revision !== ownRevision || typeof stored !== "string") return;
    let values: DeviceBoardPreferences;
    try {
      values = decode(stored);
    } catch {
      return;
    }
    if (!state.values || DEVICE_PREFERENCE_FIELDS.some((key) => state.values![key] !== values[key])) accept(values);
  };
  return {
    snapshot: () => state,
    /**
     * A record the storage reported on its own (another window saved, a reread after a
     * conflict). Taken while no write of this store is pending; a pending one adopts the
     * record it saves.
     */
    receive(raw: string | null) {
      if (!state.ready || raw === null) return;
      if (inflight > 0) {
        // A pending write adopts the record it saves; if it fails, this one is taken then.
        deferred = raw;
        return;
      }
      take(raw);
    },
    current(): DeviceBoardPreferences | null {
      if (state.values || state.ready || !provisional) return state.values;
      try {
        const raw = provisional();
        return raw === null ? null : decode(raw);
      } catch {
        return null;
      }
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(seed: DeviceBoardPreferences) {
      if (loading || state.ready) return;
      loading = true;
      const loadRevision = revision;
      const readFailed = (error: unknown) => { if (revision === loadRevision) fail(error); };
      const read = (raw: string | null) => {
        if (revision !== loadRevision) return;
        if (raw !== null) { accept(decode(raw)); return; }
        const result = storage.write(JSON.stringify(seed), { kind: "seed" });
        const settle = (stored: void | string | null) => accept(typeof stored === "string" ? decode(stored) : seed);
        if (result instanceof Promise) {
          writes = result.then(() => {}, () => {});
          return result.then((stored) => { if (revision === loadRevision) settle(stored); });
        }
        settle(result);
      };
      try {
        const result = storage.read();
        if (result instanceof Promise) void result.then(read).catch(readFailed);
        else {
          const migrated = read(result);
          if (migrated instanceof Promise) void migrated.catch(readFailed);
        }
      } catch (error) { fail(error); }
    },
    /** An explicit reset also repairs an unreadable local record. */
    /**
     * Resets the `reset` fields to `values`' and saves only those, over the record as read when
     * saving, so another window's other fields survive. Without `reset`, or with no readable
     * record to keep fields from, it replaces the whole record: that also repairs a broken one.
     */
    restore(defaults: DeviceBoardPreferences, reset?: readonly (keyof DeviceBoardPreferences)[]): Promise<void> {
      const previous = state;
      const ownRevision = ++revision;
      const partial = reset !== undefined && state.ready && state.values !== null;
      const patch = partial ? Object.fromEntries(reset.map((key) => [key, defaults[key]])) as Partial<DeviceBoardPreferences> : null;
      const values = partial ? { ...state.values!, ...patch } : defaults;
      accept(values);
      const pending = track(writes.then(() => patch ? storage.write(JSON.stringify(values), { kind: "patch", patch }) : storage.write(JSON.stringify(values))));
      writes = pending.then(() => {}, () => {});
      return pending.then((stored) => {
        if (revision === ownRevision && state.error) { state = { ...state, error: null }; emit(); }
        adopt(ownRevision, stored);
      }).catch((error: unknown) => {
        if (revision === ownRevision) state = previous;
        fail(error);
        takeDeferred();
        throw error;
      });
    },
    update(patch: Partial<DeviceBoardPreferences>): Promise<void> {
      if (!state.ready || !state.values) return Promise.reject(new Error(state.error ?? "Device Tasks preferences are still loading"));
      const previous = state.values;
      const values = { ...previous, ...patch };
      if (DEVICE_PREFERENCE_FIELDS.every((key) => previous[key] === values[key])) return Promise.resolve();
      const ownRevision = ++revision;
      accept(values);
      const changed = Object.fromEntries(DEVICE_PREFERENCE_FIELDS.filter((key) => previous[key] !== values[key]).map((key) => [key, values[key]])) as Partial<DeviceBoardPreferences>;
      const pending = track(writes.then(() => storage.write(JSON.stringify(values), { kind: "patch", patch: changed })));
      writes = pending.then(() => {}, () => {});
      return pending.then((stored) => {
        if (revision === ownRevision && state.error) { state = { ...state, error: null }; emit(); }
        adopt(ownRevision, stored);
      }).catch((error: unknown) => {
        if (revision === ownRevision) state = { ...state, values: previous };
        fail(error);
        takeDeferred();
        throw error;
      });
    },
  };
}

export type DeviceTasksStore = ReturnType<typeof createDeviceTasksStore>;
