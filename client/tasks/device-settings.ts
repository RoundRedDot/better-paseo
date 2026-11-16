import { useEffect, useRef, useState } from "react";
import { defineSettings, type SettingsDefinition } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { z } from "zod";
import type { DevicePreferenceStorage } from "./device-store";

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
  /** Copies a saved record back to the old storage, so an older host still finds it. */
  mirror(record: DeviceRecord): void;
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
  /** The mounted hooks' actions, the latest reporter last. */
  const bridges = new Map<number, DeviceActions>();
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

  /** Writes `patch` over the record as last reported; one retry on a fresh read after a refusal (a conflict). */
  async function save(patch: DeviceRecord): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      await until(settled);
      const current = remote;
      if (current.status === "loading") continue;
      if (current.status === "error") throw new Error(current.error);
      const values: DeviceRecord = { ...(current.status === "ready" ? current.values : {}), ...patch };
      const act = actions();
      if (await act.save(values, current.revision)) {
        // The next write needs the revision the host gave this one; the hook reports it.
        await until(() => "revision" in remote && remote.revision !== current.revision, REPORT_WAIT_MS);
        deps.mirror(values);
        return;
      }
      if (attempt >= 1) throw new Error(act.saveError() ?? "Could not save device Tasks preferences");
      await act.reload();
    }
  }

  const storage: DevicePreferenceStorage = {
    async read() {
      await until(settled);
      const current = remote;
      if (current.status === "loading") throw new Error("Device Tasks preferences are still loading");
      if (current.status !== "ready") throw new Error(current.error);
      if (current.revision === NEVER_SAVED && current.values.board === undefined && current.values.sidebar === undefined) {
        const [board, sidebar] = await Promise.all([deps.legacyBoard().catch(() => null), deps.legacySidebar().catch(() => null)]);
        const imported: DeviceRecord = {};
        const boardValue = parseJson(board);
        const sidebarValue = parseJson(sidebar);
        if (boardValue !== undefined) imported.board = boardValue;
        if (sidebarValue !== undefined) imported.sidebar = sidebarValue;
        if (boardValue === undefined && sidebarValue === undefined) return null;
        // A refused import leaves the old record for the next start; this session uses it as read.
        await serial(() => save(imported)).catch(() => undefined);
        return boardValue === undefined ? null : JSON.stringify(boardValue);
      }
      return current.values.board === undefined ? null : JSON.stringify(current.values.board);
    },
    write(value: string) {
      return serial(() => save({ board: z.json().parse(JSON.parse(value)) }));
    },
  };

  return {
    storage,
    /** A mounted hook's state; every hook reads the same record. */
    report(id: number, next: DeviceRemote, own: DeviceActions) {
      bridges.delete(id);
      bridges.set(id, own);
      remote = next;
      for (const check of [...waiters]) check();
    },
    leave(id: number) {
      bridges.delete(id);
    },
    sidebar: {
      stored: (): unknown => (remote.status === "ready" ? remote.values.sidebar : undefined),
      persist(next: unknown) {
        void serial(() => save({ sidebar: z.json().parse(next) })).catch((error: unknown) => console.error("Could not save the Tasks sidebar", error));
      },
    },
  };
}

export type DeviceSettingsAdapter = ReturnType<typeof createDeviceSettingsAdapter>;

const ADAPTER_KEY = "__betterPaseoDeviceSettingsV1";

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

let nextBridge = 0;

/**
 * Mounts the host's settings hook and reports each state to the adapter. Call only when the
 * device store uses the device settings: that choice is fixed for the runtime.
 */
export function useDeviceSettingsBridge(): void {
  const definition = TASKS_DEVICE_SETTINGS;
  if (!definition) throw new Error("This host has no device settings");
  const state = useSettings(definition);
  const [id] = useState(() => ++nextBridge);
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
    installedDeviceSettings()?.report(id, remote, actions);
    // `remote` is rebuilt every render; its identity is its status and revision.
  }, [remote.status, revision, error]);
  useEffect(() => () => installedDeviceSettings()?.leave(id), []);
}
