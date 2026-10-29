import { useEffect, useMemo, useSyncExternalStore } from "react";
import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import type { TasksSettings } from "../../shared/tasks-settings";
import { readDevicePreference, writeDevicePreference } from "../web";
import { createDeviceTasksStore, DEFAULT_CARD_TITLE_LINES, deviceBoardPreferences, type DevicePreferenceStorage, type DeviceTasksStore } from "./device-store";

const STORAGE_KEY = "paseo/better-chat/tasks/device-board/v1";
const RUNTIME_KEY = "__betterPaseoDeviceTasksV1";

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

function storage(): DevicePreferenceStorage {
  if (Platform.OS === "web") return { read: () => readDevicePreference(STORAGE_KEY), write: (value) => writeDevicePreference(STORAGE_KEY, value) };
  return {
    read: () => new Promise((resolve, reject) => nativeStorage().multiGet([STORAGE_KEY], (errors, values) => errors?.length ? reject(new Error("Could not read device Tasks preferences")) : resolve(values?.[0]?.[1] ?? null))),
    write: (value) => new Promise((resolve, reject) => nativeStorage().multiSet([[STORAGE_KEY, value]], (errors) => errors?.length ? reject(new Error("Could not save device Tasks preferences")) : resolve())),
  };
}

export function deviceTasksStore(): DeviceTasksStore {
  const holder = globalThis as Record<string, unknown>;
  if (!holder[RUNTIME_KEY]) holder[RUNTIME_KEY] = createDeviceTasksStore((holder.__betterPaseoDeviceTasksStorageForTests as DevicePreferenceStorage | undefined) ?? storage());
  return holder[RUNTIME_KEY] as DeviceTasksStore;
}

/** One device-wide record, shared by this client's boards and settings pages, never by its daemon. */
export function useDeviceTasksPreferences(settings: TasksSettings | null) {
  const store = deviceTasksStore();
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
