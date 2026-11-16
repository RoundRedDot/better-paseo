import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import type { TasksSettings } from "../../shared/tasks-settings";
import { readDevicePreference, writeDevicePreference } from "../web";
import { createDeviceTasksStore, DEFAULT_CARD_TITLE_LINES, deviceBoardPreferences, type DeviceBoardPreferences, type DevicePreferenceStorage, type DeviceTasksStore } from "./device-store";
import { DEVICE_RUNTIME_VERSION } from "./device-runtime-version";
import { createDeviceSettingsAdapter, installDeviceSettings, LEGACY_BOARD_KEY, LEGACY_SIDEBAR_KEY, TASKS_DEVICE_SETTINGS, useDeviceSettingsBridge, type DeviceRecord } from "./device-settings";


interface NativeStorage {
  multiGet(keys: string[], done: (errors?: unknown[] | null, values?: [string, string | null][]) => void): void;
  multiSet(values: [string, string][], done: (errors?: unknown[] | null) => void): void;
}

/** Use the same host-linked AsyncStorage module as the appearance reader, without a package import. */
function nativeStorage(): NativeStorage {
  const storage = (TurboModuleRegistry.get("RNCAsyncStorage") ?? NativeModules.RNCAsyncStorage) as NativeStorage | null;
  if (!storage?.multiGet || !storage.multiSet) throw new Error("Device storage is unavailable");
  return storage;
}

function readNative(key: string): Promise<string | null> {
  return new Promise((resolve, reject) => nativeStorage().multiGet([key], (errors, values) => errors?.length ? reject(new Error("Could not read device Tasks preferences")) : resolve(values?.[0]?.[1] ?? null)));
}

/** The board's own device storage, for hosts without device settings (Paseo 0.14 and 0.15). */
function legacyStorage(): DevicePreferenceStorage {
  if (Platform.OS === "web") return { read: () => readDevicePreference(LEGACY_BOARD_KEY), write: (value) => writeDevicePreference(LEGACY_BOARD_KEY, value) };
  return {
    read: () => readNative(LEGACY_BOARD_KEY),
    write: (value) => new Promise((resolve, reject) => nativeStorage().multiSet([[LEGACY_BOARD_KEY, value]], (errors) => errors?.length ? reject(new Error("Could not save device Tasks preferences")) : resolve())),
  };
}

/**
 * Paseo's device settings. The old records are only read, once, to import them: another host
 * may still run an older plugin that keeps writing them, and the two must not overwrite each
 * other. Web keeps its own copy of the board for the shortcut at startup.
 */
function deviceSettingsStorage(receive: (board: string | null) => void): DevicePreferenceStorage {
  const web = Platform.OS === "web";
  const adapter = createDeviceSettingsAdapter({
    onBoard: receive,
    legacyBoard: async () => web ? readDevicePreference(LEGACY_BOARD_KEY) : readNative(LEGACY_BOARD_KEY),
    // Only web kept the sidebar across restarts.
    legacySidebar: async () => web ? readDevicePreference(LEGACY_SIDEBAR_KEY) : null,
    mirror(record: DeviceRecord) {
      if (!web || record.board === undefined) return;
      try {
        writeDevicePreference(STARTUP_COPY_KEY, JSON.stringify(record.board));
      } catch {
        // Storage full or blocked: the device settings still hold them.
      }
    },
  });
  installDeviceSettings(adapter);
  return adapter.storage;
}

/** The board's last saved device preferences on web, read before the settings hook reports; never read by an older plugin. */
const STARTUP_COPY_KEY = "paseo/better-chat/tasks/device-settings-copy/v1";

/** The web copy, else (before the first save) the old record it was imported from. */
function startupCopy(): string | null {
  return readDevicePreference(STARTUP_COPY_KEY) ?? readDevicePreference(LEGACY_BOARD_KEY);
}

/**
 * Every host's bundle on this device shares one store, when it carries the same store and
 * adapter code: the runtime is keyed by that code's version. A bundle of another version (a
 * host still on an older plugin, or the one a plugin update replaces) keeps its own and never
 * takes over another's objects, whose closures run other code. Two versions then write the
 * device settings like two windows: against the revision, by field, rereading on a conflict.
 * Bump `DEVICE_RUNTIME_VERSION` (device-runtime-version.ts) whenever the store or adapter changes.
 */
const RUNTIME_KEY = `__betterPaseoDeviceTasks_r${DEVICE_RUNTIME_VERSION}`;

interface DeviceRuntime {
  store: DeviceTasksStore;
  /** Whether the store reads Paseo's device settings: fixed for the runtime. */
  deviceSettings: boolean;
}

function runtime(): DeviceRuntime {
  const holder = globalThis as Record<string, unknown>;
  if (!holder[RUNTIME_KEY]) {
    const forTests = holder.__betterPaseoDeviceTasksStorageForTests as DevicePreferenceStorage | undefined;
    const deviceSettings = !forTests && TASKS_DEVICE_SETTINGS !== null && holder.__betterPaseoLegacyDeviceStorageForTests !== true;
    if (!deviceSettings) installDeviceSettings(null);
    // On web the shortcut works from the copy before a hook reports the device settings.
    const provisional = deviceSettings && Platform.OS === "web" ? startupCopy : undefined;
    let store: DeviceTasksStore | null = null;
    if (!forTests && !deviceSettings) store = sharedLegacyStore();
    else {
      // The device settings report boards on their own; the store is made right after them.
      const storage = forTests ?? deviceSettingsStorage((board) => store?.receive(board));
      store = createDeviceTasksStore(storage, provisional);
    }
    holder[RUNTIME_KEY] = { store, deviceSettings } satisfies DeviceRuntime;
  }
  return holder[RUNTIME_KEY] as DeviceRuntime;
}

/**
 * Without device settings (Paseo 0.14, 0.15), every plugin version writes the same whole old
 * record, so they must share one store, as Better Paseo 1.6 already shared it across hosts:
 * under the key it used. This store's code is a superset of 1.6's, so an older bundle that loads
 * later takes it as its own; one that loaded first keeps its store, which this one fronts.
 */
const LEGACY_RUNTIME_KEY = "__betterPaseoDeviceTasksV3";

/** The 1.6 store's interface: what an older bundle's store answers. */
type LegacyStore = Pick<DeviceTasksStore, "snapshot" | "subscribe" | "load" | "update"> & {
  restore(values: DeviceBoardPreferences): Promise<void>;
};

function sharedLegacyStore(): DeviceTasksStore {
  const holder = globalThis as Record<string, unknown>;
  const existing = holder[LEGACY_RUNTIME_KEY] as (LegacyStore & Partial<DeviceTasksStore>) | undefined;
  if (!existing) {
    const store = createDeviceTasksStore(legacyStorage());
    holder[LEGACY_RUNTIME_KEY] = store;
    return store;
  }
  if (typeof existing.current === "function" && typeof existing.receive === "function") return existing as DeviceTasksStore;
  // An older bundle's store: no provisional copy, no reports, and a restore that writes whole.
  return {
    snapshot: () => existing.snapshot(),
    subscribe: (listener) => existing.subscribe(listener),
    load: (seed) => existing.load(seed),
    update: (patch) => existing.update(patch),
    restore: (values) => existing.restore(values),
    current: () => existing.snapshot().values,
    receive() {},
  };
}

export function deviceTasksStore(): DeviceTasksStore {
  return runtime().store;
}

/**
 * Keeps the device settings reported while nothing else reads the preferences: the sidebar's
 * Tasks row mounts it whatever it shows, so the web shortcut loads at startup.
 */
export function useDeviceSettingsReport(): void {
  // Fixed for the runtime, so the hook order never changes.
  if (runtime().deviceSettings) useDeviceSettingsBridge();
}

/** One device-wide record, shared by this client's boards and settings pages, never by its daemon. */
export function useDeviceTasksPreferences(settings: TasksSettings | null) {
  const { store, deviceSettings } = runtime();
  // Fixed for the runtime, so the hook order never changes.
  if (deviceSettings) useDeviceSettingsBridge();
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => { if (settings) store.load(deviceBoardPreferences(settings.board)); }, [store, settings]);
  const values = useMemo(() => {
    if (!settings) return null;
    const local = state.values;
    return {
      ...settings,
      board: {
        ...settings.board,
        ...(local ? { hideSubtasks: local.hideSubtasks, showArchived: local.showArchived, showEmptyGroups: local.showEmptyGroups, laneWidth: local.laneWidth } : {}),
      },
    };
  }, [settings, state.values]);
  return { ...state, settings: values, titleLines: state.values?.titleLines ?? DEFAULT_CARD_TITLE_LINES, update: store.update, restore: store.restore };
}
