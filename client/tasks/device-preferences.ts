import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import type { TasksSettings } from "../../shared/tasks-settings";
import { readDevicePreference, writeDevicePreference } from "../web";
import { createDeviceTasksStore, DEFAULT_CARD_TITLE_LINES, deviceBoardPreferences, type DevicePreferenceStorage, type DeviceTasksStore } from "./device-store";
import { createDeviceSettingsAdapter, installDeviceSettings, LEGACY_BOARD_KEY, LEGACY_SIDEBAR_KEY, TASKS_DEVICE_SETTINGS, useDeviceSettingsBridge, type DeviceRecord } from "./device-settings";

const RUNTIME_KEY = "__betterPaseoDeviceTasksV4";

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

/** Paseo's device settings. The old records are read once to import them; web keeps them as a copy for an older host. */
function deviceSettingsStorage(): DevicePreferenceStorage {
  const web = Platform.OS === "web";
  const adapter = createDeviceSettingsAdapter({
    legacyBoard: async () => web ? readDevicePreference(LEGACY_BOARD_KEY) : readNative(LEGACY_BOARD_KEY),
    // Only web kept the sidebar across restarts.
    legacySidebar: async () => web ? readDevicePreference(LEGACY_SIDEBAR_KEY) : null,
    mirror(record: DeviceRecord) {
      if (!web) return;
      try {
        if (record.board !== undefined) writeDevicePreference(LEGACY_BOARD_KEY, JSON.stringify(record.board));
        if (record.sidebar !== undefined) writeDevicePreference(LEGACY_SIDEBAR_KEY, JSON.stringify(record.sidebar));
      } catch {
        // Storage full or blocked: the device settings still hold them.
      }
    },
  });
  installDeviceSettings(adapter);
  return adapter.storage;
}

/**
 * The store and adapter code this bundle carries. Bump it whenever either changes: a plugin
 * update loads the new bundle into a runtime that still holds the old objects, whose closures
 * would keep running the old code. A newer bundle replaces them; an older one (another host
 * still on an older plugin) uses the newer ones.
 */
const DEVICE_RUNTIME_VERSION = 3;

interface DeviceRuntime {
  store: DeviceTasksStore;
  /** Whether the store reads Paseo's device settings: fixed for the runtime. */
  deviceSettings: boolean;
  /** Absent on the first release of this runtime. */
  version?: number;
}

function runtime(): DeviceRuntime {
  const holder = globalThis as Record<string, unknown>;
  const existing = holder[RUNTIME_KEY] as DeviceRuntime | undefined;
  if (!existing || (existing.version ?? 1) < DEVICE_RUNTIME_VERSION) {
    const forTests = holder.__betterPaseoDeviceTasksStorageForTests as DevicePreferenceStorage | undefined;
    const deviceSettings = !forTests && TASKS_DEVICE_SETTINGS !== null && holder.__betterPaseoLegacyDeviceStorageForTests !== true;
    if (!deviceSettings) installDeviceSettings(null);
    // On web the old record is the device settings' copy: the shortcut works before a hook reports them.
    const provisional = deviceSettings && Platform.OS === "web" ? () => readDevicePreference(LEGACY_BOARD_KEY) : undefined;
    holder[RUNTIME_KEY] = { store: createDeviceTasksStore(forTests ?? (deviceSettings ? deviceSettingsStorage() : legacyStorage()), provisional), deviceSettings, version: DEVICE_RUNTIME_VERSION } satisfies DeviceRuntime;
  }
  return holder[RUNTIME_KEY] as DeviceRuntime;
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
