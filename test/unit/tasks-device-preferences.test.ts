import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { createDeviceTasksStore, deviceBoardPreferences, sharedTasksSettings, type DevicePreferenceStorage } from "../../client/tasks/device-store";

const defaults = deviceBoardPreferences(DEFAULT_TASKS_SETTINGS.board);
function disk(initial: string | null = null) {
  let value = initial;
  return { read: vi.fn(() => value), write: vi.fn((next: string) => { value = next; }) };
}

describe("device Tasks preferences", () => {
  it("migrates the host fields once, persists them, and ignores subsequent host changes", async () => {
    const storage = disk();
    const store = createDeviceTasksStore(storage);
    const seed = { ...defaults, showArchived: false };
    store.load(seed);
    expect(store.snapshot()).toMatchObject({ ready: true, values: seed });
    expect(storage.write).toHaveBeenCalledTimes(1);
    await store.update({ laneWidth: "wide", hideSubtasks: true });
    store.load({ ...defaults, showEmptyGroups: false });
    expect(store.snapshot().values).toEqual({ ...seed, laneWidth: "wide", hideSubtasks: true });
    const restarted = createDeviceTasksStore(storage);
    restarted.load(defaults);
    expect(restarted.snapshot().values).toEqual(store.snapshot().values);
    expect(storage.write).toHaveBeenCalledTimes(2);
  });

  it("keeps two devices isolated even when their host seed is identical", async () => {
    const first = createDeviceTasksStore(disk());
    const second = createDeviceTasksStore(disk());
    first.load(defaults);
    second.load(defaults);
    const listener = vi.fn();
    const unsubscribe = first.subscribe(listener);
    await first.update({ showArchived: false, showEmptyGroups: false, hideSubtasks: true, laneWidth: "narrow" });
    expect(first.snapshot().values).toEqual({ showArchived: false, showEmptyGroups: false, hideSubtasks: true, laneWidth: "narrow" });
    expect(second.snapshot().values).toEqual(defaults);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await first.update(defaults);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(first.snapshot().values).toEqual(defaults);
  });

  it("strips every device edit from a save of unrelated shared settings", () => {
    const next = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, hideSubtasks: true, showArchived: false, showEmptyGroups: false, laneWidth: "wide" as const, doneWindow: "7d" as const } };
    expect(sharedTasksSettings(next, DEFAULT_TASKS_SETTINGS)).toEqual({ ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, doneWindow: "7d" } });
  });

  it("waits for native hydration before allowing edits and never migrates over a saved record", async () => {
    let resolve!: (raw: string | null) => void;
    const storage = { read: () => new Promise<string | null>((done) => { resolve = done; }), write: vi.fn() };
    const store = createDeviceTasksStore(storage);
    store.load(defaults);
    expect(store.snapshot().ready).toBe(false);
    await expect(store.update({ showArchived: false })).rejects.toThrow("still loading");
    const saved = { ...defaults, laneWidth: "wide" as const };
    resolve(JSON.stringify(saved));
    await Promise.resolve();
    expect(store.snapshot()).toMatchObject({ ready: true, values: saved });
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("serializes rapid writes without losing changes to other fields", async () => {
    const storage = disk(JSON.stringify(defaults));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const writes: string[] = [];
    const asynchronous: DevicePreferenceStorage = { read: storage.read, write: async (value) => { await pending; writes.push(value); } };
    const store = createDeviceTasksStore(asynchronous);
    store.load(defaults);
    const first = store.update({ hideSubtasks: true });
    const second = store.update({ laneWidth: "wide" });
    release();
    await Promise.all([first, second]);
    expect(writes.map((value) => JSON.parse(value))).toEqual([{ ...defaults, hideSubtasks: true }, { ...defaults, hideSubtasks: true, laneWidth: "wide" }]);
  });

  it("rolls back a failed edit and reports the persistence error", async () => {
    const storage = disk(JSON.stringify(defaults));
    const store = createDeviceTasksStore(storage);
    store.load(defaults);
    storage.write.mockImplementationOnce(() => { throw new Error("Disk full"); });
    await expect(store.update({ laneWidth: "wide" })).rejects.toThrow("Disk full");
    expect(store.snapshot()).toMatchObject({ ready: true, values: defaults, error: "Disk full" });
    await store.update({ laneWidth: "narrow" });
    expect(store.snapshot()).toMatchObject({ values: { ...defaults, laneWidth: "narrow" }, error: null });
  });

  it.each(["not json", "{}", JSON.stringify({ ...defaults, showArchived: "yes" })])("rejects an invalid record without overwriting it: %s", (raw) => {
    const storage = disk(raw);
    const store = createDeviceTasksStore(storage);
    store.load(defaults);
    expect(store.snapshot().ready).toBe(false);
    expect(store.snapshot().error).toBeTruthy();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("does not mark migration ready when its first write fails", () => {
    const storage = disk();
    storage.write.mockImplementationOnce(() => { throw new Error("Read only"); });
    const store = createDeviceTasksStore(storage);
    store.load(defaults);
    expect(store.snapshot()).toEqual({ ready: false, values: null, error: "Read only" });
  });
  it("repairs an invalid local record through an explicit restore", async () => {
    const storage = disk("broken");
    const store = createDeviceTasksStore(storage);
    store.load(defaults);
    expect(store.snapshot().ready).toBe(false);
    await store.restore(defaults);
    expect(store.snapshot()).toEqual({ ready: true, values: defaults, error: null });
    expect(JSON.parse(storage.read()!)).toEqual(defaults);
  });

  it("never lets a delayed hydration overwrite an explicit reset", async () => {
    let finishRead!: (raw: string) => void;
    const storage = { read: () => new Promise<string>((resolve) => { finishRead = resolve; }), write: vi.fn() };
    const store = createDeviceTasksStore(storage);
    store.load(defaults);
    await store.restore(defaults);
    finishRead(JSON.stringify({ ...defaults, laneWidth: "wide" }));
    await Promise.resolve();
    expect(store.snapshot().values).toEqual(defaults);
    expect(storage.write).toHaveBeenCalledTimes(1);
  });

});
