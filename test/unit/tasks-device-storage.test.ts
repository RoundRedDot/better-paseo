import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => import("./helpers/rn-mock"));
import { NativeModules } from "react-native";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { deviceBoardPreferences } from "../../client/tasks/device-store";
import { deviceTasksStore } from "../../client/tasks/device-preferences";

const holder = globalThis as Record<string, unknown>;
const seed = deviceBoardPreferences(DEFAULT_TASKS_SETTINGS.board);
afterEach(() => {
  delete holder.__rnMockOS;
  delete holder.localStorage;
  delete NativeModules.RNCAsyncStorage;
});

it.each(["ios", "android"])("persists the four preferences through %s AsyncStorage and reads them after a runtime restart", async (os) => {
  holder.__rnMockOS = os;
  delete holder.__betterPaseoDeviceTasksStorageForTests;
  const data = new Map<string, string>();
  NativeModules.RNCAsyncStorage = {
    multiGet: vi.fn((keys: string[], done: (errors: null, values: [string, string | null][]) => void) => done(null, keys.map((key) => [key, data.get(key) ?? null]))),
    multiSet: vi.fn((pairs: [string, string][], done: (errors: null) => void) => { for (const [key, value] of pairs) data.set(key, value); done(null); }),
  };
  const store = deviceTasksStore();
  store.load(seed);
  await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
  const saved = { hideSubtasks: true, showArchived: false, showEmptyGroups: false, laneWidth: "wide" as const, titleLines: "4" as const };
  await store.update(saved);
  expect(NativeModules.RNCAsyncStorage.multiSet).toHaveBeenCalledTimes(2);
  delete holder.__betterPaseoDeviceTasksV1;
  const restarted = deviceTasksStore();
  restarted.load(seed);
  await vi.waitFor(() => expect(restarted.snapshot().ready).toBe(true));
  expect(restarted.snapshot().values).toEqual(saved);
});

it("persists the same device record with web localStorage", async () => {
  holder.__rnMockOS = "web";
  delete holder.__betterPaseoDeviceTasksStorageForTests;
  const data = new Map<string, string>();
  holder.localStorage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
  const store = deviceTasksStore();
  store.load(seed);
  await store.update({ hideSubtasks: true });
  delete holder.__betterPaseoDeviceTasksV1;
  const restarted = deviceTasksStore();
  restarted.load(seed);
  expect(restarted.snapshot().values?.hideSubtasks).toBe(true);
  expect(restarted.snapshot().values?.titleLines).toBe("2");
});
