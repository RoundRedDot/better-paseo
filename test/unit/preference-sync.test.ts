import { describe, expect, it, vi } from "vitest";
import {
  MAX_SAVE_ATTEMPTS,
  MISSING_REVISION,
  createPreferenceSync,
  type RemoteActions,
  type RemoteSettings,
} from "../../client/state/preference-sync";
import { DEFAULT_PREFERENCES, storedPart } from "../../client/preferences";
import type { StoredPreferences } from "../../shared/preferences-settings";

const DEFAULTS = storedPart(DEFAULT_PREFERENCES);
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A daemon with a revision check, as the host's settings store has. */
function fakeDaemon(initial: { revision: string; values: StoredPreferences } | null = null) {
  let record = initial;
  let counter = 0;
  const saves: Array<{ values: StoredPreferences; against: string }> = [];
  const state = (): RemoteSettings =>
    record
      ? { status: "ready", revision: record.revision, values: record.values }
      : { status: "ready", revision: MISSING_REVISION, values: DEFAULTS };
  const actions: RemoteActions = {
    save: vi.fn(async (values: StoredPreferences, against: string) => {
      saves.push({ values, against });
      if ((record?.revision ?? MISSING_REVISION) !== against) return false;
      record = { revision: `r${++counter}`, values };
      return true;
    }),
    reset: vi.fn(async () => {
      record = { revision: `r${++counter}`, values: DEFAULTS };
      return true;
    }),
    reload: vi.fn(async () => {}),
  };
  return {
    state,
    actions,
    saves,
    /** Another client writes. */
    external(values: StoredPreferences) {
      record = { revision: `r${++counter}`, values };
    },
    get record() {
      return record;
    },
  };
}

function setup(legacy: StoredPreferences | null = null) {
  const applied: StoredPreferences[] = [];
  const markMigrated = vi.fn();
  const sync = createPreferenceSync({
    apply: (values) => applied.push(values),
    defaults: () => DEFAULTS,
    legacy: () => legacy,
    markMigrated,
  });
  return { sync, applied, markMigrated };
}

describe("preference sync (S5 fix round 1)", () => {
  it("applies the daemon values once they are ready, and nothing before", () => {
    const daemon = fakeDaemon({ revision: "r0", values: { ...DEFAULTS, monoFont: "custom", codeFontSize: 14 } });
    const { sync, applied, markMigrated } = setup();
    sync.report({ status: "loading" }, daemon.actions);
    expect(applied).toEqual([]);
    sync.report(daemon.state(), daemon.actions);
    expect(applied).toEqual([{ ...DEFAULTS, monoFont: "custom", codeFontSize: 14 }]);
    // A daemon that already holds settings means the local record is never offered.
    expect(markMigrated).toHaveBeenCalledTimes(1);
    // The same revision again (another render) applies nothing new.
    sync.report(daemon.state(), daemon.actions);
    expect(applied).toHaveLength(1);
  });

  it("migrates this client's old local record once into a daemon with none", async () => {
    const legacy = { ...DEFAULTS, accent: "jade" as const, pathDisplay: "absolute" as const };
    const daemon = fakeDaemon();
    const { sync, applied, markMigrated } = setup(legacy);
    sync.report(daemon.state(), daemon.actions);
    expect(applied[0]).toEqual(legacy);
    await flushPromises();
    expect(daemon.saves).toEqual([{ values: legacy, against: MISSING_REVISION }]);
    expect(daemon.record?.values).toEqual(legacy);
    expect(markMigrated).toHaveBeenCalledTimes(1);
  });

  it("does not migrate when the daemon already has settings", async () => {
    const daemon = fakeDaemon({ revision: "r0", values: DEFAULTS });
    const { sync } = setup({ ...DEFAULTS, accent: "rose" });
    sync.report(daemon.state(), daemon.actions);
    await flushPromises();
    expect(daemon.saves).toEqual([]);
  });

  it("saves a change against the revision it was read at, serialising changes made meanwhile", async () => {
    const daemon = fakeDaemon({ revision: "r0", values: DEFAULTS });
    const { sync } = setup();
    sync.report(daemon.state(), daemon.actions);
    sync.request({ ...DEFAULTS, codeFontSize: 13 });
    // A second click while the first save is in flight waits for it.
    sync.request({ ...DEFAULTS, codeFontSize: 14 });
    await flushPromises();
    expect(daemon.saves).toEqual([{ values: { ...DEFAULTS, codeFontSize: 13 }, against: "r0" }]);
    expect(sync.status().pending).toBe(true);
    // The host re-renders with the new revision; the waiting change goes out against it.
    sync.report(daemon.state(), daemon.actions);
    await flushPromises();
    expect(daemon.saves[1]).toEqual({ values: { ...DEFAULTS, codeFontSize: 14 }, against: "r1" });
    sync.report(daemon.state(), daemon.actions);
    expect(daemon.record?.values.codeFontSize).toBe(14);
    expect(sync.status().pending).toBe(false);
  });

  it("queues a change made before the settings are ready", async () => {
    const daemon = fakeDaemon({ revision: "r0", values: DEFAULTS });
    const { sync, applied } = setup();
    sync.report({ status: "loading" }, daemon.actions);
    sync.request({ ...DEFAULTS, uiFont: "system" });
    await flushPromises();
    expect(daemon.saves).toEqual([]);
    sync.report(daemon.state(), daemon.actions);
    // The waiting change keeps the reader's choice on screen; the daemon's
    // older values are not applied over it.
    expect(applied).toEqual([]);
    await flushPromises();
    expect(daemon.saves).toEqual([{ values: { ...DEFAULTS, uiFont: "system" }, against: "r0" }]);
  });

  it("reloads and retries when another client saved first (last writer wins)", async () => {
    const daemon = fakeDaemon({ revision: "r0", values: DEFAULTS });
    const { sync } = setup();
    sync.report(daemon.state(), daemon.actions);
    daemon.external({ ...DEFAULTS, accent: "amber" });
    sync.request({ ...DEFAULTS, accent: "violet" });
    await flushPromises();
    expect(daemon.actions.reload).toHaveBeenCalledTimes(1);
    sync.report(daemon.state(), daemon.actions);
    await flushPromises();
    expect(daemon.record?.values.accent).toBe("violet");
  });

  it("gives a change up after repeated failures and shows the daemon's values", async () => {
    const values = { ...DEFAULTS, accent: "jade" as const };
    const actions: RemoteActions = {
      save: vi.fn(async () => false),
      reset: vi.fn(async () => true),
      reload: vi.fn(async () => {}),
    };
    const { sync, applied } = setup();
    const ready: RemoteSettings = { status: "ready", revision: "r0", values };
    sync.report(ready, actions);
    sync.request({ ...values, accent: "rose" });
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
      await flushPromises();
      sync.report(ready, actions);
    }
    await flushPromises();
    expect(actions.save).toHaveBeenCalledTimes(MAX_SAVE_ATTEMPTS);
    expect(sync.status()).toMatchObject({ pending: false, failed: true });
    expect(applied[applied.length - 1]).toEqual(values);
  });

  it("draws the defaults for unreadable settings and resets them before saving a change", async () => {
    const daemon = fakeDaemon({ revision: "bad", values: DEFAULTS });
    const { sync, applied } = setup();
    sync.report({ status: "invalid", revision: "bad", error: "Unexpected token" }, daemon.actions);
    expect(applied).toEqual([DEFAULTS]);
    expect(sync.status()).toMatchObject({ status: "invalid", error: "Unexpected token" });
    sync.request({ ...DEFAULTS, toolDetail: "expand-failed" });
    await flushPromises();
    expect(daemon.actions.reset).toHaveBeenCalledTimes(1);
    sync.report(daemon.state(), daemon.actions);
    await flushPromises();
    expect(daemon.record?.values.toolDetail).toBe("expand-failed");
  });

  it("keeps the last-known values while the daemon is unreachable", () => {
    const daemon = fakeDaemon({ revision: "r0", values: DEFAULTS });
    const { sync, applied } = setup();
    sync.report({ status: "error", error: "offline" }, daemon.actions);
    expect(applied).toEqual([]);
    expect(sync.status()).toMatchObject({ status: "error", error: "offline" });
  });
});
