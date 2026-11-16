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
function fakeHost(initial: DeviceRecord | null = null, options: { refuse?: number; afterSave?: () => void } = {}) {
  let refuse = options.refuse ?? 0;
  let raw: string | null = initial === null ? null : JSON.stringify({ version: 1, values: initial });
  const saves: DeviceRecord[] = [];
  /** Every mounted hook, of any bundle: the host's query re-renders them all. */
  const bridges = new Set<(remote: DeviceRemote) => void>();
  const reportAll = (remote: DeviceRemote) => { for (const report of bridges) report(remote); };
  const read = (): DeviceRemote => ({ status: "ready", revision: raw ?? "missing", values: raw === null ? {} : (JSON.parse(raw) as { values: DeviceRecord }).values });
  let saveError: string | null = null;
  const actions = {
    async save(values: DeviceRecord, revision: string) {
      await tick();
      if (refuse > 0) {
        refuse -= 1;
        saveError = "Could not write device settings";
        return false;
      }
      if ((raw ?? "missing") !== revision) {
        saveError = "Settings changed. Reload before saving.";
        return false;
      }
      raw = JSON.stringify({ version: 1, values });
      saves.push(values);
      saveError = null;
      options.afterSave?.();
      // The query's new data renders, then the bridge's effect reports it.
      setTimeout(() => reportAll(read()), 0);
      return true;
    },
    async reload() {
      await tick();
      // The query holds the reread now; the hook reports it on a later render.
      const reread = read();
      setTimeout(() => reportAll(reread), 0);
    },
    saveError: () => saveError,
  };
  return {
    saves,
    record: (): DeviceRecord | null => raw === null ? null : (JSON.parse(raw) as { values: DeviceRecord }).values,
    /** Refuses the next `count` saves, as a failing write does. */
    refuseNext(count: number) {
      refuse = count;
    },
    /** Another window wrote the record; this one's hook has not heard. */
    writeElsewhere(values: DeviceRecord) {
      raw = JSON.stringify({ version: 1, values });
    },
    mount(adapter: ReturnType<typeof createDeviceSettingsAdapter>) {
      const own = {};
      const report = (remote: DeviceRemote) => adapter.report(own, remote, actions);
      bridges.add(report);
      report(read());
      return () => { adapter.leave(own); bridges.delete(report); };
    },
  };
}

function setup(options: { host?: ReturnType<typeof fakeHost>; legacyBoard?: string | null; legacySidebar?: string | null } = {}) {
  const host = options.host ?? fakeHost();
  const mirrored: DeviceRecord[] = [];
  let store!: ReturnType<typeof createDeviceTasksStore>;
  const adapter = createDeviceSettingsAdapter({
    legacyBoard: async () => options.legacyBoard ?? null,
    legacySidebar: async () => options.legacySidebar ?? null,
    mirror: (record) => mirrored.push(record),
    onBoard: (board) => store?.receive(board),
  });
  installDeviceSettings(adapter);
  store = createDeviceTasksStore(adapter.storage);
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
    // The board shows the record as saved, so picking the old value again is a change.
    expect(store.snapshot().values).toEqual({ ...seed, titleLines: "4", hideSubtasks: true });
    await store.update({ titleLines: "2" });
    expect(host.record()).toEqual({ board: { ...seed, titleLines: "2", hideSubtasks: true } });
  });

  it.each([
    ["an old sidebar record only", null, JSON.stringify({ open: false, width: 380 })],
    ["a device record with a sidebar and no board", { sidebar: { open: false, width: 380 } }, null],
  ] as const)("saves the seeded board alongside %s", async (_name, initial, legacySidebar) => {
    const { host, adapter, store } = setup({ host: fakeHost(initial), legacySidebar });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    expect(host.record()).toEqual({ board: seed, sidebar: { open: false, width: 380 } });
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

  it("shows the board another window saved when a sidebar save reads it again", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    host.writeElsewhere({ board: { ...seed, titleLines: "4" } });
    adapter.sidebar.persist({ open: false, width: 400 });
    await vi.waitFor(() => expect(host.record()?.sidebar).toEqual({ open: false, width: 400 }));
    expect(store.snapshot().values?.titleLines).toBe("4");
    await store.update({ titleLines: "2" });
    expect(host.record()?.board).toMatchObject({ titleLines: "2" });
  });

  it("keeps a local edit that is still saving when another record is reported", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    host.writeElsewhere({ board: { ...seed, titleLines: "4" } });
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(store.snapshot().values!.hideSubtasks));
    // The edit's own conflict reread reports the other board while the edit is pending.
    await store.update({ hideSubtasks: true });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(Boolean)).toBe(true);
    expect(store.snapshot().values).toMatchObject({ hideSubtasks: true, titleLines: "4" });
  });

  it("lets two code versions on one device save without undoing each other", async () => {
    // A host still on another plugin version runs its own store and adapter on the same record.
    const host = fakeHost({ board: seed });
    const make = () => {
      let store!: ReturnType<typeof createDeviceTasksStore>;
      const adapter = createDeviceSettingsAdapter({ legacyBoard: async () => null, legacySidebar: async () => null, mirror() {}, onBoard: (board) => store?.receive(board) });
      store = createDeviceTasksStore(adapter.storage);
      host.mount(adapter);
      store.load(seed);
      return { adapter, store };
    };
    const older = make();
    const newer = make();
    await vi.waitFor(() => expect(older.store.snapshot().ready && newer.store.snapshot().ready).toBe(true));
    await Promise.all([older.store.update({ hideSubtasks: true }), newer.store.update({ titleLines: "4" })]);
    newer.adapter.sidebar.persist({ open: false, width: 400 });
    await vi.waitFor(() => expect(host.record()).toEqual({ board: { ...seed, hideSubtasks: true, titleLines: "4" }, sidebar: { open: false, width: 400 } }));
    // Each shows the other's change once the host reports it.
    await vi.waitFor(() => expect(older.store.snapshot().values).toMatchObject({ hideSubtasks: true, titleLines: "4" }));
    expect(newer.store.snapshot().values).toMatchObject({ hideSubtasks: true, titleLines: "4" });
  });

  it("fails the load when the import cannot be saved, so a seed never closes the import", async () => {
    const { host, adapter, store } = setup({ host: fakeHost(null, { refuse: 2 }), legacySidebar: JSON.stringify({ open: false, width: 380 }) });
    host.mount(adapter);
    store.load(seed);
    // The retry waits for a report its reread never brings (the record did not move).
    await vi.waitFor(() => expect(store.snapshot().error).toBe("Could not write device settings"), 5_000);
    expect(store.snapshot().ready).toBe(false);
    expect(host.record()).toBeNull();
  });

  it("shows a later save the hook reports in place of its own", async () => {
    let host!: ReturnType<typeof fakeHost>;
    let once = true;
    // Another writer saves right after this one, before the hook reports either.
    host = fakeHost({ board: seed }, { afterSave: () => { if (!once) return; once = false; host.writeElsewhere({ board: { ...seed, hideSubtasks: true, titleLines: "4" } }); } });
    const { adapter, store, mirrored } = setup({ host });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    await store.update({ hideSubtasks: true });
    expect(store.snapshot().values).toMatchObject({ hideSubtasks: true, titleLines: "4" });
    expect(mirrored.at(-1)).toEqual({ board: { ...seed, hideSubtasks: true, titleLines: "4" } });
  });

  it("shows the record a later save put back to its old content, not its own values", async () => {
    let host!: ReturnType<typeof fakeHost>;
    let once = true;
    // Another writer restores the previous record before the hook reports this save: the
    // revision (the content) is the one this save started from.
    host = fakeHost({ board: seed }, { afterSave: () => { if (!once) return; once = false; host.writeElsewhere({ board: seed }); } });
    const { adapter, store, mirrored } = setup({ host });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    await store.update({ hideSubtasks: !seed.hideSubtasks });
    expect(host.record()).toEqual({ board: seed });
    expect(store.snapshot().values?.hideSubtasks).toBe(seed.hideSubtasks);
    expect(mirrored.at(-1)).toEqual({ board: seed });
  }, 10_000);

  it("shows the record a failed edit read again, keeping the failure", async () => {
    const { host, adapter, store } = setup({ host: fakeHost({ board: seed }) });
    host.mount(adapter);
    store.load(seed);
    await vi.waitFor(() => expect(store.snapshot().ready).toBe(true));
    host.writeElsewhere({ board: { ...seed, titleLines: "4" } });
    host.refuseNext(2);
    await expect(store.update({ hideSubtasks: !seed.hideSubtasks })).rejects.toThrow("Could not write device settings");
    // The edit is rolled back to the record as read again, not to what this board showed before.
    expect(store.snapshot()).toMatchObject({ values: { ...seed, titleLines: "4" }, error: "Could not write device settings" });
    await store.update({ titleLines: "2" });
    expect(host.record()?.board).toMatchObject({ titleLines: "2" });
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
