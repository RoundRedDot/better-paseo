import { LANE_WIDTHS, type TasksSettings } from "../../shared/tasks-settings";

export const DEVICE_BOARD_FIELDS = ["hideSubtasks", "showArchived", "showEmptyGroups", "laneWidth"] as const;
export type DeviceBoardPreferences = Pick<TasksSettings["board"], (typeof DEVICE_BOARD_FIELDS)[number]>;
export interface DevicePreferenceStorage {
  read(): string | null | Promise<string | null>;
  write(value: string): void | Promise<void>;
}

export function deviceBoardPreferences(board: TasksSettings["board"]): DeviceBoardPreferences {
  return { hideSubtasks: board.hideSubtasks, showArchived: board.showArchived, showEmptyGroups: board.showEmptyGroups, laneWidth: board.laneWidth };
}

function decode(raw: string): DeviceBoardPreferences {
  const value = JSON.parse(raw) as DeviceBoardPreferences;
  if (!value || typeof value.hideSubtasks !== "boolean" || typeof value.showArchived !== "boolean" || typeof value.showEmptyGroups !== "boolean" || !LANE_WIDTHS.includes(value.laneWidth)) {
    throw new Error("Invalid device Tasks preferences");
  }
  return deviceBoardPreferences(value as TasksSettings["board"]);
}

/** The old host fields are migration input only; never send a device edit back to the daemon. */
export function sharedTasksSettings(next: TasksSettings, saved: TasksSettings): TasksSettings {
  return { ...next, board: { ...next.board, ...deviceBoardPreferences(saved.board) } };
}

export function createDeviceTasksStore(storage: DevicePreferenceStorage) {
  let state: { values: DeviceBoardPreferences | null; ready: boolean; error: string | null } = { values: null, ready: false, error: null };
  const listeners = new Set<() => void>();
  let loading = false;
  let writes = Promise.resolve();
  let revision = 0;
  const emit = () => { for (const listener of [...listeners]) listener(); };
  const fail = (error: unknown) => {
    state = { ...state, error: error instanceof Error ? error.message : String(error) };
    emit();
  };
  const accept = (values: DeviceBoardPreferences) => {
    state = { values, ready: true, error: null };
    emit();
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(seed: DeviceBoardPreferences) {
      if (loading || state.ready) return;
      loading = true;
      const loadRevision = revision;
      const readFailed = (error: unknown) => { if (revision === loadRevision) fail(error); };
      const read = (raw: string | null) => {
        if (revision !== loadRevision) return;
        if (raw !== null) { accept(decode(raw)); return; }
        const result = storage.write(JSON.stringify(seed));
        if (result instanceof Promise) {
          writes = result.catch(() => {});
          return result.then(() => { if (revision === loadRevision) accept(seed); });
        }
        accept(seed);
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
    restore(values: DeviceBoardPreferences): Promise<void> {
      const previous = state;
      const ownRevision = ++revision;
      accept(values);
      const pending = writes.then(() => storage.write(JSON.stringify(values)));
      writes = pending.catch(() => {});
      return pending.then(() => {
        if (revision === ownRevision && state.error) { state = { ...state, error: null }; emit(); }
      }).catch((error: unknown) => {
        if (revision === ownRevision) state = previous;
        fail(error);
        throw error;
      });
    },
    update(patch: Partial<DeviceBoardPreferences>): Promise<void> {
      if (!state.ready || !state.values) return Promise.reject(new Error(state.error ?? "Device Tasks preferences are still loading"));
      const previous = state.values;
      const values = { ...previous, ...patch };
      if (DEVICE_BOARD_FIELDS.every((key) => previous[key] === values[key])) return Promise.resolve();
      const ownRevision = ++revision;
      accept(values);
      const pending = writes.then(() => storage.write(JSON.stringify(values)));
      writes = pending.catch(() => {});
      return pending.then(() => {
        if (revision === ownRevision && state.error) { state = { ...state, error: null }; emit(); }
      }).catch((error: unknown) => {
        if (revision === ownRevision) state = { ...state, values: previous };
        fail(error);
        throw error;
      });
    },
  };
}

export type DeviceTasksStore = ReturnType<typeof createDeviceTasksStore>;
