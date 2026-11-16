import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const holder = globalThis as Record<string, unknown>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  // The shared test helper hands every test its own storage; these choose the host's.
  delete holder.__betterPaseoDeviceTasksStorageForTests;
  holder.__rnMockOS = "web";
  const data = new Map<string, string>();
  holder.localStorage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) };
});
afterEach(() => {
  vi.doUnmock("@getpaseo/plugin");
  vi.doUnmock("@getpaseo/plugin/client");
  delete holder.__rnMockOS;
  delete holder.localStorage;
});

/** One record behind the host's hook, shared by every caller like its query (Paseo 0.16 `use-settings.ts`). */
function mockDeviceHook() {
  const host = { record: { revision: "missing", values: {} as Record<string, unknown> }, saved: [] as unknown[] };
  const listeners = new Set<() => void>();
  vi.doMock("@getpaseo/plugin/client", async () => {
    const { useSyncExternalStore } = await import("react");
    return {
      useSettings: (definition: { id: string; scope: string }) => {
        expect(definition).toMatchObject({ id: "tasks-device", scope: "device" });
        const current = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => host.record);
        return {
          status: "ready", revision: current.revision, values: current.values, saving: false, saveError: null,
          async save(values: Record<string, unknown>, revision: string) {
            if (revision !== host.record.revision) return false;
            host.saved.push(values);
            host.record = { revision: JSON.stringify(values), values };
            for (const listener of listeners) listener();
            return true;
          },
          reset: async () => true,
          reload: async () => {},
        };
      },
    };
  });
  return host;
}

describe("device Tasks preferences by host version", () => {
  it("keeps the board's own storage on a host without device settings (Paseo 0.14, 0.15)", async () => {
    vi.doMock("@getpaseo/plugin", async (original) => {
      const actual = await original<typeof import("@getpaseo/plugin")>();
      return {
        ...actual,
        defineSettings: (definition: { scope: string }) => {
          if (definition.scope !== "host") throw new Error("Only host-scoped settings are supported");
          return definition;
        },
      };
    });
    const useSettings = vi.fn();
    vi.doMock("@getpaseo/plugin/client", () => ({ useSettings }));
    const { deviceTasksStore, useDeviceTasksPreferences } = await import("../../client/tasks/device-preferences");
    const { installedDeviceSettings, TASKS_DEVICE_SETTINGS } = await import("../../client/tasks/device-settings");
    expect(TASKS_DEVICE_SETTINGS).toBeNull();
    function Probe() {
      useDeviceTasksPreferences(DEFAULT_TASKS_SETTINGS);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
    expect(deviceTasksStore().snapshot().ready).toBe(true);
    await deviceTasksStore().update({ hideSubtasks: true });
    expect(JSON.parse((holder.localStorage as Storage).getItem("paseo/better-chat/tasks/device-board/v1")!).hideSubtasks).toBe(true);
    expect(installedDeviceSettings()).toBeNull();
    expect(useSettings).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("reads and saves through the settings hook on Paseo 0.16, keeping a web copy", async () => {
    const host = mockDeviceHook();
    (holder.localStorage as Storage).setItem("paseo/better-chat/tasks/sidebar/v1", JSON.stringify({ open: false, width: 380 }));
    const { deviceTasksStore, useDeviceTasksPreferences } = await import("../../client/tasks/device-preferences");
    const { readSidebarPreference, writeSidebarPreference, resetSidebarPreference } = await import("../../client/tasks/board/sidebar-model");
    let ready = false;
    function Probe() {
      ready = useDeviceTasksPreferences(DEFAULT_TASKS_SETTINGS).ready;
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
    await act(async () => { await vi.waitFor(() => expect(ready).toBe(true)); });
    // The old web sidebar came along; the board reads it once the record loaded.
    resetSidebarPreference();
    expect(readSidebarPreference()).toMatchObject({ open: false, width: 380 });
    await act(async () => { await deviceTasksStore().update({ titleLines: "3" }); });
    await act(async () => { writeSidebarPreference({ open: true, width: 360 }); await tick(); await tick(); });
    await act(async () => { await vi.waitFor(() => expect(host.record.values).toMatchObject({ sidebar: { open: true, width: 360 } })); });
    expect(host.record.values).toMatchObject({ board: { titleLines: "3" } });
    expect(host.saved.length).toBeGreaterThanOrEqual(2);
    // The web copy follows, for the shortcut at startup and an older host.
    const copy = JSON.parse((holder.localStorage as Storage).getItem("paseo/better-chat/tasks/device-board/v1")!);
    expect(copy.titleLines).toBe("3");
    expect(JSON.parse((holder.localStorage as Storage).getItem("paseo/better-chat/tasks/sidebar/v1")!)).toEqual({ open: true, width: 360 });
    act(() => renderer.unmount());
  });

  it("keeps saving through one host's bundle after another host's bundle unmounts its hook", async () => {
    const host = mockDeviceHook();
    // Each host loads its own copy of the plugin's modules; they share the device runtime.
    const first = await import("../../client/tasks/device-preferences");
    vi.resetModules();
    const second = await import("../../client/tasks/device-preferences");
    expect(second).not.toBe(first);
    function ProbeA() { first.useDeviceTasksPreferences(DEFAULT_TASKS_SETTINGS); return null; }
    function ProbeB() { second.useDeviceTasksPreferences(DEFAULT_TASKS_SETTINGS); return null; }
    let a!: TestRenderer.ReactTestRenderer;
    let b!: TestRenderer.ReactTestRenderer;
    await act(async () => { a = TestRenderer.create(React.createElement(ProbeA)); b = TestRenderer.create(React.createElement(ProbeB)); });
    await act(async () => { await vi.waitFor(() => expect(second.deviceTasksStore().snapshot().ready).toBe(true)); });
    act(() => a.unmount());
    await act(async () => { await second.deviceTasksStore().update({ showArchived: false }); });
    expect(host.record.values).toMatchObject({ board: { showArchived: false } });
    act(() => b.unmount());
  });
});
