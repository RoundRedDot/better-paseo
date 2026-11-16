import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react-native", () => import("./helpers/rn-mock"));
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { createDeviceTasksStore, deviceBoardPreferences } from "../../client/tasks/device-store";
import { createDeviceSettingsAdapter, installDeviceSettings, type DeviceRecord, type DeviceRemote } from "../../client/tasks/device-settings";

const seed = deviceBoardPreferences(DEFAULT_TASKS_SETTINGS.board);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The host's device settings as `useSettings` serves them (Paseo 0.16
 * `plugins/settings/device.ts` + `use-settings.ts`): the revision is the stored text, or
 * "missing" before the first save; a save names the revision it read and is refused when the
 * record moved; the hook reports the saved record on a later render.
 */
function fakeHost(initial: DeviceRecord | null = null) {
  let raw: string | null = initial === null ? null : JSON.stringify({ version: 1, values: initial });
  const saves: DeviceRecord[] = [];
  let bridge: { report: (remote: DeviceRemote) => void } | null = null;
  const read = (): DeviceRemote => ({ status: "ready", revision: raw ?? "missing", values: raw === null ? {} : (JSON.parse(raw) as { values: DeviceRecord }).values });
  let saveError: string | null = null;
  const actions = {
    async save(values: DeviceRecord, revision: string) {
      await tick();
      if ((raw ?? "missing") !== revision) {
        saveError = "Settings changed. Reload before saving.";
        return false;
      }
      raw = JSON.stringify({ version: 1, values });
      saves.push(values);
      saveError = null;
      // The query's new data renders, then the bridge's effect reports it.
      setTimeout(() => bridge?.report(read()), 0);
      return true;
    },
    async reload() {
      await tick();
      // The query holds the reread now; the hook reports it on a later render.
      const reread = read();
      setTimeout(() => bridge?.report(reread), 0);
    },
    saveError: () => saveError,
  };
  return {
    saves,
    record: (): DeviceRecord | null => raw === null ? null : (JSON.parse(raw) as { values: DeviceRecord }).values,
    /** Another window wrote the record; this one's hook has not heard. */
    writeElsewhere(values: DeviceRecord) {
      raw = JSON.stringify({ version: 1, values });
    },
    mount(adapter: ReturnType<typeof createDeviceSettingsAdapter>) {
      const own = {};
      bridge = { report: (remote) => adapter.report(own, remote, actions) };
      bridge.report(read());
      return () => { adapter.leave(own); bridge = null; };
    },
  };
}

function setup(options: { host?: ReturnType<typeof fakeHost>; legacyBoard?: string | null; legacySidebar?: string | null } = {}) {
  const host = options.host ?? fakeHost();
  const mirrored: DeviceRecord[] = [];
  const adapter = createDeviceSettingsAdapter({
    legacyBoard: async () => options.legacyBoard ?? null,
    legacySidebar: async () => options.legacySidebar ?? null,
    mirror: (record) => mirrored.push(record),
  });
  installDeviceSettings(adapter);
  const store = createDeviceTasksStore(adapter.storage);
  return { host, adapter, store, mirrored };
}

afterEach(() => installDeviceSettings(null));

describe("device Tasks preferences in Paseo's device settings", () => {
  it("waits for the settings hook, then seeds a new device from the shared settings", async () => {
    const { host, adapter, store } = setup();
    store.load(seed);
    await tick();
    expect(store.snapshot().ready).toBe(false);
    host.mount(adapter);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(store.snapshot().values).toEqual(seed);
    expect(host.record()).toEqual({ board: seed });
  });

  it("imports the board's own records once into a device that never saved", async () => {
    const legacy = { ...seed, hideSubtasks: true, laneWidth: "wide", titleLines: "all", openShortcut: null };
    const { host, adapter, store, mirrored } = setup({ legacyBoard: JSON.stringify(legacy), legacySidebar: JSON.stringify({ open: false, width: 400 }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(store.snapshot().values).toEqual(legacy);
    expect(host.record()).toEqual({ board: legacy, sidebar: { open: false, width: 400 } });
    expect(adapter.sidebar.stored()).toEqual({ open: false, width: 400 });
    expect(mirrored).toHaveLength(1);
  });

  it("keeps a saved record and ignores the old ones", async () => {
    const saved = { ...seed, showArchived: false };
    const { host, adapter, store } = setup({ host: fakeHost({ board: saved }), legacyBoard: JSON.stringify({ ...seed, hideSubtasks: true }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(store.snapshot().values).toEqual(saved);
    expect(host.saves).toEqual([]);
  });

  it("saves back-to-back edits and a sidebar change against each new revision", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    const first = store.update({ hideSubtasks: true });
    adapter.sidebar.persist({ open: true, width: 333 });
    const second = store.update({ titleLines: "4" });
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(host.saves).toHaveLength(3));
    expect(host.record()).toEqual({ board: { ...seed, hideSubtasks: true, titleLines: "4" }, sidebar: { open: true, width: 333 } });
    expect(store.snapshot().error).toBeNull();
  });

  it("reads again and retries once when another window moved the record", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    host.writeElsewhere({ board: seed, sidebar: { open: false, width: 300 } });
    await store.update({ showEmptyGroups: false });
    expect(host.record()).toEqual({ board: { ...seed, showEmptyGroups: false }, sidebar: { open: false, width: 300 } });
  });

  it("reports a refused save and keeps the previous values", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    const unmount = host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    unmount();
    await expect(store.update({ hideSubtasks: true })).rejects.toThrow("not available");
    expect(store.snapshot().values?.hideSubtasks).toBe(seed.hideSubtasks);
    expect(host.saves).toEqual([]);
  });

  it("keeps the old record when reading it fails, instead of seeding over it", async () => {
    const adapter = createDeviceSettingsAdapter({ legacyBoard: () => Promise.reject(new Error("Could not read device Tasks preferences")), legacySidebar: async () => null, mirror() {} });
    const store = createDeviceTasksStore(adapter.storage);
    const host = fakeHost();
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().error).toBe("Could not read device Tasks preferences"));
    expect(store.snapshot().ready).toBe(false);
    expect(host.saves).toEqual([]);
  });

  it("keeps another window's board fields when an edit retries after a conflict", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    host.writeElsewhere({ board: { ...seed, titleLines: "4" } });
    await store.update({ hideSubtasks: true });
    expect(host.record()).toEqual({ board: { ...seed, titleLines: "4", hideSubtasks: true } });
  });

  it("does not import the old record over one another window saved while it was read", async () => {
    let release!: (raw: string) => void;
    const legacy = new Promise<string>((resolve) => { release = resolve; });
    const host = fakeHost();
    const adapter = createDeviceSettingsAdapter({ legacyBoard: () => legacy, legacySidebar: async () => null, mirror() {} });
    installDeviceSettings(adapter);
    const store = createDeviceTasksStore(adapter.storage);
    host.mount(adapter);
    store.load(seed);
    await tick();
    host.writeElsewhere({ board: { ...seed, titleLines: "4" } });
    release(JSON.stringify({ ...seed, titleLines: "1" }));
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(host.record()).toEqual({ board: { ...seed, titleLines: "4" } });
    expect(store.snapshot().values?.titleLines).toBe("4");
    expect(host.saves).toEqual([]);
  });

  it("takes the record another window saved instead of seeding over it", async () => {
    const host = fakeHost();
    const adapter = createDeviceSettingsAdapter({ legacyBoard: async () => null, legacySidebar: async () => null, mirror() {} });
    installDeviceSettings(adapter);
    // The seed waits on the queue behind a sidebar save that the other window's write refuses.
    const store = createDeviceTasksStore(adapter.storage);
    host.mount(adapter);
    store.load(seed);
    host.writeElsewhere({ board: { ...seed, laneWidth: "wide" } });
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(host.record()).toEqual({ board: { ...seed, laneWidth: "wide" } });
    expect(store.snapshot().values?.laneWidth).toBe("wide");
  });

  it("answers a sidebar change at once and keeps it after the hook reports", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed, sidebar: { open: true, width: 300 } }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    adapter.sidebar.persist({ open: false, width: 400 });
    expect(adapter.sidebar.stored()).toEqual({ open: false, width: 400 });
    await vi.waitFor(() => expect(host.record()?.sidebar).toEqual({ open: false, width: 400 }));
    await tick();
    expect(adapter.sidebar.stored()).toEqual({ open: false, width: 400 });
  });

  it("offers a provisional copy for the shortcut until the settings load", async () => {
    const adapter = createDeviceSettingsAdapter({ legacyBoard: async () => null, legacySidebar: async () => null, mirror() {} });
    const copy = JSON.stringify({ ...seed, openShortcut: "Mod+Shift+KeyK" });
    const store = createDeviceTasksStore(adapter.storage, () => copy);
    expect(store.current()?.openShortcut).toBe("Mod+Shift+KeyK");
    const host = fakeHost({ board: { ...seed, openShortcut: null } });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(store.current()?.openShortcut).toBeNull();
  });
});
