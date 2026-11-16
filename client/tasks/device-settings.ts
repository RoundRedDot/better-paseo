import { useEffect, useRef, useState } from "react";
import { defineSettings, type SettingsDefinition } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { z } from "zod";
import type { DevicePreferenceStorage, DeviceWriteIntent } from "./device-store";
import { DEVICE_RUNTIME_VERSION } from "./device-runtime-version";

/**
 * The board's device preferences in Paseo's device settings (Paseo 0.16+, `scope: "device"`):
 * the host keeps them on this device, never on a daemon. Older hosts refuse the scope; the
 * board then keeps its own device storage (`device-preferences.ts`).
 *
 * The host reads and writes them only through the `useSettings` hook. Every component that
 * reads the preferences mounts that hook (`useDeviceSettingsBridge`) and reports it here; the
 * device store reads and writes through this one adapter, shared by every host's bundle (the
 * host keys the record by plugin, so they all share it).
 */

export const LEGACY_BOARD_KEY = "paseo/better-chat/tasks/device-board/v1";
export const LEGACY_SIDEBAR_KEY = "paseo/better-chat/tasks/sidebar/v1";

const recordSchema = z.object({ board: z.json().optional(), sidebar: z.json().optional() });
export type DeviceRecord = z.output<typeof recordSchema>;

/** The definition when the host has device settings, else null (Paseo 0.14 and 0.15 throw). */
function deviceDefinition(): SettingsDefinition<typeof recordSchema> | null {
  try {
    return defineSettings({ id: "tasks-device", scope: "device", version: 1, schema: recordSchema });
  } catch {
    return null;
  }
}

export const TASKS_DEVICE_SETTINGS = deviceDefinition();

/** The host's revision of a record this device never saved (`plugins/settings/device.ts`). */
const NEVER_SAVED = "missing";
/** How long a save waits for the hook to report the record it wrote. */
const REPORT_WAIT_MS = 2_000;

export type DeviceRemote =
  | { status: "loading" }
  | { status: "ready"; revision: string; values: DeviceRecord }
  | { status: "invalid"; revision: string; error: string }
  | { status: "error"; error: string };

export interface DeviceActions {
  save(values: DeviceRecord, revision: string): Promise<boolean>;
  reload(): Promise<void>;
  saveError(): string | null;
}

export interface DeviceSettingsDeps {
  /** The board's own record from before, raw; imported once into a record never saved. */
  legacyBoard(): Promise<string | null>;
  legacySidebar(): Promise<string | null>;
  /** Keeps a copy of each saved record where it can be read before a hook reports. */
  mirror(record: DeviceRecord): void;
  /** Hears the board as each report brings it (another window's save, a reread). */
  onBoard?(board: string | null): void;
}

function parseJson(raw: string | null): DeviceRecord["board"] {
  if (raw === null) return undefined;
  try {
    return z.json().parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

export function createDeviceSettingsAdapter(deps: DeviceSettingsDeps) {
  let remote: DeviceRemote = { status: "loading" };
  /** The mounted hooks' actions by their own token (bundles share this adapter), the latest reporter last. */
  const bridges = new Map<object, DeviceActions>();
  /** Counts reports, so a retry can wait for the one its reread brings. */
  let reports = 0;
  /** The sidebar change being saved, and how many saves of it are in flight. */
  let sidebarLatest: DeviceRecord["sidebar"] = undefined;
  let sidebarSaving = 0;
  const waiters = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve();

  const settled = () => remote.status !== "loading";
  function until(holds: () => boolean, timeoutMs?: number): Promise<void> {
    if (holds()) return Promise.resolve();
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const check = () => {
        if (!holds()) return;
        waiters.delete(check);
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      waiters.add(check);
      if (timeoutMs !== undefined) timer = setTimeout(() => { waiters.delete(check); resolve(); }, timeoutMs);
    });
  }
  function actions(): DeviceActions {
    const mounted = [...bridges.values()];
    const latest = mounted[mounted.length - 1];
    if (!latest) throw new Error("Device Tasks preferences are not available");
    return latest;
  }
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Saves `build(record)` over the record as last reported, and answers the record it ended up
   * with; `build` answers null when there is nothing to save. After a refusal (a conflict) it
   * reads again and builds once more on the fresh record, so another window's fields survive.
   */
  async function save(build: (record: DeviceRecord) => DeviceRecord | null): Promise<DeviceRecord> {
    for (let attempt = 0; ; attempt += 1) {
      await until(settled);
      const current = remote;
      if (current.status === "loading") continue;
      if (current.status === "error") throw new Error(current.error);
      const base = current.status === "ready" ? current.values : {};
      const values = build(base);
      if (values === null) return base;
      const act = actions();
      if (await act.save(values, current.revision)) {
        // The next write needs the revision the host gave this one; the hook reports it.
        await until(() => "revision" in remote && remote.revision !== current.revision, REPORT_WAIT_MS);
        if ("revision" in remote && remote.revision === current.revision) {
          // No report moved the record: either it is late, or a later save put the old content
          // back (the revision is the content). A reread tells: it reports a moved record, and
          // reports nothing when the record is the one already reported.
          await act.reload().catch(() => undefined);
          await until(() => "revision" in remote && remote.revision !== current.revision, REPORT_WAIT_MS);
        }
        // The record as last reported holds any later save over this one (another window,
        // another version's bundle): that is the one to show and copy.
        const reported = remote.status === "ready" ? remote.values : values;
        deps.mirror(reported);
        return reported;
      }
      if (attempt >= 1) throw new Error(act.saveError() ?? "Could not save device Tasks preferences");
      // The reread lands in the query first; the hooks report it on a later render.
      const before = reports;
      await act.reload();
      await until(() => reports > before && "revision" in remote && remote.revision !== current.revision, REPORT_WAIT_MS);
    }
  }

  const boardOf = (record: DeviceRecord): Record<string, unknown> | null =>
    record.board && typeof record.board === "object" && !Array.isArray(record.board) ? record.board as Record<string, unknown> : null;
  const boardText = (record: DeviceRecord) => record.board === undefined ? null : JSON.stringify(record.board);

  const storage: DevicePreferenceStorage = {
    async read() {
      await until(settled);
      const current = remote;
      if (current.status === "loading") throw new Error("Device Tasks preferences are still loading");
      if (current.status !== "ready") throw new Error(current.error);
      if (current.revision === NEVER_SAVED && current.values.board === undefined && current.values.sidebar === undefined) {
        // A failed read is not an empty one: the store reports it instead of seeding over the old record.
        const [board, sidebar] = await Promise.all([deps.legacyBoard(), deps.legacySidebar()]);
        const boardValue = parseJson(board);
        const sidebarValue = parseJson(sidebar);
        if (boardValue === undefined && sidebarValue === undefined) return null;
        // Only the parts the record still lacks: what another window saved meanwhile wins.
        const fill = (record: DeviceRecord): DeviceRecord | null => {
          const next = { ...record };
          if (next.board === undefined && boardValue !== undefined) next.board = boardValue;
          if (next.sidebar === undefined && sidebarValue !== undefined) next.sidebar = sidebarValue;
          return next.board === record.board && next.sidebar === record.sidebar ? null : next;
        };
        // A refused import fails the read like a failed one: nothing is seeded over the old record,
        // which the next start imports again.
        return boardText(await serial(() => save(fill)));
      }
      return boardText(current.values);
    },
    async write(value: string, intent?: DeviceWriteIntent) {
      const board = z.json().parse(JSON.parse(value));
      // A seed fills a record without a board; one another window saved meanwhile is kept.
      if (intent?.kind === "seed") return boardText(await serial(() => save((record) => record.board === undefined ? { ...record, board } : null)));
      if (intent?.kind === "patch") {
        // Only the fields this edit changed, over the board as read now.
        const patch = z.json().parse(intent.patch) as Record<string, unknown>;
        return boardText(await serial(() => save((record) => ({ ...record, board: { ...(boardOf(record) ?? board as Record<string, unknown>), ...patch } as DeviceRecord["board"] }))));
      }
      return boardText(await serial(() => save((record) => ({ ...record, board }))));
    },
  };

  return {
    storage,
    /** A mounted hook's state; every hook reads the same record. */
    report(token: object, next: DeviceRemote, own: DeviceActions) {
      bridges.delete(token);
      bridges.set(token, own);
      remote = next;
      reports += 1;
      if (next.status === "ready") deps.onBoard?.(boardText(next.values));
      for (const check of [...waiters]) check();
    },
    leave(token: object) {
      bridges.delete(token);
    },
    /**
     * The board sidebar's preference. Every host's bundle reads it here, so a change made in one
     * shows in the others; while it saves, the change is answered before the hook reports it.
     */
    sidebar: {
      stored: (): unknown => (sidebarSaving > 0 ? sidebarLatest : remote.status === "ready" ? remote.values.sidebar : undefined),
      /** Saves the fields `patch` changed, over the sidebar as read then: another board's other fields survive. */
      persist(patch: Record<string, unknown>) {
        const changes = z.json().parse(patch) as Record<string, unknown>;
        const objectOf = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
        const shown = sidebarSaving > 0 ? sidebarLatest : remote.status === "ready" ? remote.values.sidebar : undefined;
        sidebarLatest = { ...objectOf(shown), ...changes } as DeviceRecord["sidebar"];
        sidebarSaving += 1;
        void serial(() => save((record) => ({ ...record, sidebar: { ...objectOf(record.sidebar), ...changes } as DeviceRecord["sidebar"] })))
          // The last pending save's record; an earlier one would hide a later change still saving.
          .then((saved) => { if (sidebarSaving === 1) sidebarLatest = saved.sidebar; })
          .catch((error: unknown) => console.error("Could not save the Tasks sidebar", error))
          .finally(() => { sidebarSaving -= 1; });
      },
    },
  };
}

export type DeviceSettingsAdapter = ReturnType<typeof createDeviceSettingsAdapter>;

const ADAPTER_KEY = `__betterPaseoDeviceSettings_r${DEVICE_RUNTIME_VERSION}`;

/** The adapter every bundle shares, once the device store chose the device settings. */
export function installedDeviceSettings(): DeviceSettingsAdapter | null {
  return ((globalThis as Record<string, unknown>)[ADAPTER_KEY] as DeviceSettingsAdapter | undefined) ?? null;
}

export function installDeviceSettings(adapter: DeviceSettingsAdapter | null): void {
  const holder = globalThis as Record<string, unknown>;
  if (adapter) holder[ADAPTER_KEY] = adapter;
  else delete holder[ADAPTER_KEY];
}

/** The board sidebar's preference while the device settings own it; null on older hosts. */
export function deviceSidebarSource(): DeviceSettingsAdapter["sidebar"] | null {
  return installedDeviceSettings()?.sidebar ?? null;
}

/**
 * Mounts the host's settings hook and reports each state to the adapter. Call only when the
 * device store uses the device settings: that choice is fixed for the runtime.
 */
export function useDeviceSettingsBridge(): void {
  const definition = TASKS_DEVICE_SETTINGS;
  if (!definition) throw new Error("This host has no device settings");
  const state = useSettings(definition);
  // Its own identity: every host's bundle reports to the one shared adapter.
  const [token] = useState(() => ({}));
  // The host hands out new actions each render; the adapter keeps one object calling the latest.
  const latest = useRef(state);
  latest.current = state;
  const actions = useRef<DeviceActions>({
    save: (values, revision) => latest.current.save(values, revision),
    reload: () => latest.current.reload(),
    saveError: () => latest.current.saveError,
  }).current;
  const remote: DeviceRemote =
    state.status === "ready"
      ? { status: "ready", revision: state.revision, values: state.values }
      : state.status === "invalid"
        ? { status: "invalid", revision: state.revision, error: state.error }
        : state.status === "error"
          ? { status: "error", error: state.error }
          : { status: "loading" };
  const revision = "revision" in remote ? remote.revision : "";
  const error = "error" in remote ? remote.error : "";
  useEffect(() => {
    installedDeviceSettings()?.report(token, remote, actions);
    // `remote` is rebuilt every render; its identity is its status and revision.
  }, [remote.status, revision, error]);
  useEffect(() => () => installedDeviceSettings()?.leave(token), []);
}
