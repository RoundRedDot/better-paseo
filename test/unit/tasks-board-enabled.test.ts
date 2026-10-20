import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { createFakePaseo, makeAgent, makePlacement, makeWorkspace } from "./helpers/fake-paseo";

// The Tasks board is opt-in: off (or still loading), nothing shows and nothing subscribes.
// Uses the real data layer against the fake PaseoApi, so subscriptions are counted.

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
  return { ...rn, AppState, default: { ...rn.default, AppState } };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const React = await import("react");
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  function FlatList(props: Props) {
    const data = (props.data as unknown[]) ?? [];
    const render = props.renderItem as (info: { item: unknown; index: number }) => React.ReactNode;
    return React.createElement("FlatList", null, data.map((item, index) => React.createElement(React.Fragment, { key: index }, render({ item, index }))));
  }
  function Modal(props: Props) {
    return props.open ? React.createElement("Modal", null, props.children) : null;
  }
  Modal.Content = (props: Props) => React.createElement("ModalContent", null, props.children);
  return {
    Icon: (props: Props) => React.createElement("Icon", { name: props.name }),
    FlatList,
    Modal,
    ScrollView: rn.ScrollView,
    TextInput: rn.TextInput,
    useToast: () => ({ show() {}, error() {} }),
  };
});
const host = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  paseo: null as unknown,
}));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => host.paseo,
  useRpc: () => () => Promise.resolve({ stop: false }),
  useSettings: () => (host.settings ? { status: "ready", values: host.settings, revision: "1", saving: false, saveError: null } : { status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const React = await import("react");
  return {
    SidebarRow: (props: Record<string, unknown> & { trailing?: React.ReactNode }) =>
      React.createElement("SidebarRow", { label: props.label }, props.trailing),
  };
});

import { TasksBoardScreen } from "../../client/tasks/board/board-screen";
import { TasksSidebarEntry } from "../../client/tasks/board/sidebar-entry";
import { resetTasksEnabled, setTasksEnabled, setTasksSettingsOpener, tasksEnabled } from "../../client/tasks/board/enabled";
import { resetTasksLanguage, resolveTasksLanguage } from "../../client/tasks/i18n";
import { contributeTasks } from "../../client/tasks/contribute";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7",
    foreground: "#09090b", foregroundMuted: "#71717a", accent: "#2563eb", accentForeground: "#ffffff",
    statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
  },
} as never;
const hostProps = { theme, host: { id: "host-1", label: "Local" }, layout: { compact: false, platform: "web" as const } };

let fake: ReturnType<typeof createFakePaseo>;
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

function sidebar() {
  return React.createElement(TasksSidebarEntry, { ...hostProps, currentScreen: null, openScreen: vi.fn(), openPopover: vi.fn() });
}

function screen() {
  return React.createElement(TasksBoardScreen, { ...hostProps, params: {} });
}

async function mount(element: React.ReactElement) {
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  // Let the data layer's first list calls settle.
  await act(async () => {
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
  });
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

beforeEach(() => {
  const workspace = makeWorkspace({ id: "wks_1" });
  const agent = makeAgent({ id: "a1", status: "running" });
  fake = createFakePaseo({ workspaces: [workspace], agents: [agent], placements: { a1: makePlacement(agent) } });
  host.paseo = fake.paseo;
  host.settings = null;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  resetTasksEnabled();
  resetTasksLanguage();
  resetEnhancerPreferences();
});

describe("Tasks sidebar entry, opt-in", () => {
  it("draws nothing and subscribes to nothing while the settings load", async () => {
    await mount(sidebar());
    expect(renderer!.toJSON()).toBeNull();
    expect(fake.openSubscriptions()).toBe(0);
    expect(tasksEnabled()).toBeNull();
  });

  it("draws nothing and subscribes to nothing while the board is off", async () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS };
    await mount(sidebar());
    expect(renderer!.toJSON()).toBeNull();
    expect(fake.openSubscriptions()).toBe(0);
    expect(fake.calls.filter((call) => call.method.startsWith("agents."))).toEqual([]);
    expect(tasksEnabled()).toBe(false);
  });

  it("draws the row and counts once the board is on", async () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true };
    await mount(sidebar());
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "SidebarRow")).toHaveLength(1);
    expect(fake.openSubscriptions()).toBeGreaterThan(0);
    expect(tasksEnabled()).toBe(true);
  });

  it("does not subscribe for counts it does not draw", async () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true, sidebar: { count: "none" } };
    await mount(sidebar());
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "SidebarRow")).toHaveLength(1);
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("releases its subscriptions when the board is turned off", async () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true };
    await mount(sidebar());
    expect(fake.openSubscriptions()).toBeGreaterThan(0);
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: false };
    await act(async () => renderer!.update(sidebar()));
    expect(renderer!.toJSON()).toBeNull();
    expect(fake.openSubscriptions()).toBe(0);
    expect(tasksEnabled()).toBe(false);
  });
});

describe("Tasks board screen, opt-in", () => {
  it("says the board is off, offers the settings, and subscribes to nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
    try {
      const open = vi.fn();
      setTasksSettingsOpener(open);
      host.settings = { ...DEFAULT_TASKS_SETTINGS };
      await mount(screen());
      expect(textOf(renderer!.root)).toContain("The Tasks board is off");
      expect(fake.openSubscriptions()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      const button = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && textOf(node) === "Open settings");
      act(() => button.props.onPress());
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the settings button where nothing can open the settings", async () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS };
    await mount(screen());
    expect(textOf(renderer!.root)).not.toContain("Open settings");
  });

  it("draws an empty page while the settings load", async () => {
    await mount(screen());
    expect(textOf(renderer!.root)).toBe("");
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("opens straight onto the board on a reload: registered first, settings later", async () => {
    // contribute runs before the settings read answers; the route resolves against the screen at once.
    let answer!: (value: unknown) => void;
    const registered: string[] = [];
    contributeTasks({
      addScreen: (screen: { id: string }) => (registered.push(screen.id), () => {}),
      addSidebarHeaderItem: () => () => {},
      addSettingsScreen: () => () => {},
      addCommandCenterItem: () => () => {},
      openSettings: vi.fn(),
      rpc: () => new Promise((resolve) => (answer = resolve)),
    } as never);
    expect(registered).toEqual(["tasks"]);
    await mount(screen());
    expect(textOf(renderer!.root)).toBe("");
    expect(fake.openSubscriptions()).toBe(0);
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true };
    answer({ status: "ready", revision: "1", values: { enabled: true } });
    await act(async () => renderer!.update(screen()));
    await act(async () => {
      for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    });
    // The board itself: its toolbar counts the one running agent.
    expect(textOf(renderer!.root)).toContain("1 task");
    expect(fake.openSubscriptions()).toBeGreaterThan(0);
  });
});

describe("Tasks registrations, opt-in", () => {
  type Registered = { kind: string; id: string; title: string | (() => string) };
  function client(read: () => Promise<unknown>) {
    const active: Registered[] = [];
    const removed: Registered[] = [];
    const add = (kind: string) => (contribution: { id: string; title: string | (() => string) }) => {
      const entry = { kind, id: contribution.id, title: contribution.title };
      active.push(entry);
      return () => {
        active.splice(active.indexOf(entry), 1);
        removed.push(entry);
      };
    };
    const value = {
      addScreen: add("screen"),
      addSidebarHeaderItem: add("sidebar"),
      addSettingsScreen: add("settings"),
      addCommandCenterItem: add("command"),
      openSettings: vi.fn(),
      rpc: vi.fn(read),
    };
    return { value, active, removed, kinds: () => active.map((entry) => entry.kind).sort() };
  }
  const flush = async () => {
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
  };
  const offRecord = () => Promise.resolve({ status: "ready", revision: "1", values: {} });

  it("registers only the settings page and the idle screen while off: no sidebar item, command, timer or listener", async () => {
    vi.useFakeTimers();
    const listen = vi.fn();
    const previous = (globalThis as { addEventListener?: unknown }).addEventListener;
    (globalThis as { addEventListener?: unknown }).addEventListener = listen;
    try {
      const plugin = client(offRecord);
      contributeTasks(plugin.value as never);
      await flush();
      expect(plugin.value.rpc).toHaveBeenCalledTimes(1);
      expect(plugin.kinds()).toEqual(["screen", "settings"]);
      expect(tasksEnabled()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(listen).not.toHaveBeenCalled();
      expect(fake.openSubscriptions()).toBe(0);
    } finally {
      (globalThis as { addEventListener?: unknown }).addEventListener = previous;
      vi.useRealTimers();
    }
  });

  it("registers the board when it is turned on and calls every cleanup when it is turned off", async () => {
    const plugin = client(offRecord);
    const cleanup = contributeTasks(plugin.value as never);
    await flush();
    setTasksEnabled(true);
    expect(plugin.kinds()).toEqual(["command", "screen", "settings", "sidebar"]);
    setTasksEnabled(true);
    expect(plugin.active).toHaveLength(4);
    setTasksEnabled(false);
    expect(plugin.kinds()).toEqual(["screen", "settings"]);
    expect(plugin.removed.map((entry) => entry.kind).sort()).toEqual(["command", "sidebar"]);
    setTasksEnabled(true);
    cleanup();
    expect(plugin.active).toEqual([]);
    // Unloaded: a later flip registers nothing.
    setTasksEnabled(false);
    setTasksEnabled(true);
    expect(plugin.active).toEqual([]);
  });

  it("seeds from one settings read at startup", async () => {
    const plugin = client(() => Promise.resolve({ status: "ready", revision: "1", values: { enabled: true } }));
    contributeTasks(plugin.value as never);
    expect(plugin.kinds()).toEqual(["screen", "settings"]);
    await flush();
    expect(plugin.kinds()).toEqual(["command", "screen", "settings", "sidebar"]);
  });

  it("keeps the board off when the read fails or the record is unusable", async () => {
    const failing = client(() => Promise.reject(new Error("offline")));
    contributeTasks(failing.value as never);
    await flush();
    expect(failing.kinds()).toEqual(["screen", "settings"]);
    expect(tasksEnabled()).toBeNull();
    resetTasksEnabled();
    const invalid = client(() => Promise.resolve({ status: "invalid", revision: "1", error: "bad" }));
    contributeTasks(invalid.value as never);
    await flush();
    expect(invalid.kinds()).toEqual(["screen", "settings"]);
  });

  it("titles everything in the host's language and re-registers when it changes", async () => {
    updateEnhancerPreferences({ language: "zh" });
    const plugin = client(() => Promise.resolve({ status: "ready", revision: "1", values: { enabled: true } }));
    contributeTasks(plugin.value as never);
    await flush();
    expect(Object.fromEntries(plugin.active.map((entry) => [entry.kind, typeof entry.title === "function" ? entry.title() : entry.title]))).toEqual({
      settings: "任务",
      screen: "任务",
      sidebar: "任务",
      command: "打开任务",
    });
    updateEnhancerPreferences({ language: "en" });
    resolveTasksLanguage();
    await flush();
    expect(Object.fromEntries(plugin.active.map((entry) => [entry.kind, typeof entry.title === "function" ? entry.title() : entry.title]))).toEqual({
      settings: "Tasks",
      screen: "Tasks",
      sidebar: "Tasks",
      command: "Open Tasks",
    });
    expect(plugin.active).toHaveLength(4);
    // The screen follows in place: registered once, never removed.
    expect(plugin.removed.filter((entry) => entry.kind === "screen")).toEqual([]);
  });
});
