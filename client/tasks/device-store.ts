import { LANE_WIDTHS, type TasksSettings } from "../../shared/tasks-settings";

export const DEVICE_BOARD_FIELDS = ["hideSubtasks", "showArchived", "showEmptyGroups", "laneWidth"] as const;
export const CARD_TITLE_LINE_COUNTS = ["1", "2", "3", "4"] as const;
const DEVICE_PREFERENCE_FIELDS = [...DEVICE_BOARD_FIELDS, "titleLines"] as const;
export type CardTitleLineCount = (typeof CARD_TITLE_LINE_COUNTS)[number];
export const DEFAULT_CARD_TITLE_LINES: CardTitleLineCount = "2";
export type DeviceBoardPreferences = Pick<TasksSettings["board"], (typeof DEVICE_BOARD_FIELDS)[number]> & { titleLines: CardTitleLineCount };
export interface DevicePreferenceStorage {
  read(): string | null | Promise<string | null>;
  write(value: string): void | Promise<void>;
}

export function deviceBoardPreferences(board: TasksSettings["board"]): DeviceBoardPreferences {
  return { hideSubtasks: board.hideSubtasks, showArchived: board.showArchived, showEmptyGroups: board.showEmptyGroups, laneWidth: board.laneWidth, titleLines: DEFAULT_CARD_TITLE_LINES };
}

function decode(raw: string): DeviceBoardPreferences {
  const value = JSON.parse(raw) as Partial<DeviceBoardPreferences>;
  if (!value || typeof value.hideSubtasks !== "boolean" || typeof value.showArchived !== "boolean" || typeof value.showEmptyGroups !== "boolean" || !LANE_WIDTHS.includes(value.laneWidth!) || value.titleLines !== undefined && !CARD_TITLE_LINE_COUNTS.includes(value.titleLines)) {
    throw new Error("Invalid device Tasks preferences");
  }
  return { hideSubtasks: value.hideSubtasks, showArchived: value.showArchived, showEmptyGroups: value.showEmptyGroups, laneWidth: value.laneWidth!, titleLines: value.titleLines ?? DEFAULT_CARD_TITLE_LINES };
}

/** The old host fields are migration input only; never send a device edit back to the daemon. */
export function sharedTasksSettings(next: TasksSettings, saved: TasksSettings): TasksSettings {
  return { ...next, board: { ...next.board, hideSubtasks: saved.board.hideSubtasks, showArchived: saved.board.showArchived, showEmptyGroups: saved.board.showEmptyGroups, laneWidth: saved.board.laneWidth } };
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
      if (DEVICE_PREFERENCE_FIELDS.every((key) => previous[key] === values[key])) return Promise.resolve();
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
