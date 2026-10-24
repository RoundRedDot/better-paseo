import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
  return { ...rn, AppState, default: { ...rn.default, AppState } };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const React = await import("react");
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  // Renders every item, header and footer in place: enough to count what a lane shows.
  function FlatList(props: Props) {
    const data = (props.data as unknown[]) ?? [];
    const render = props.renderItem as (info: { item: unknown; index: number }) => React.ReactNode;
    const key = props.keyExtractor as (item: unknown, index: number) => string;
    const empty = props.ListEmptyComponent as React.ReactNode;
    return React.createElement(
      "FlatList",
      { testID: props.testID },
      data.length
        ? data.map((item, index) => {
            host.rowRenders += 1;
            return React.createElement(React.Fragment, { key: key(item, index) }, render({ item, index }));
          })
        : empty,
      props.ListFooterComponent as React.ReactNode,
    );
  }
  function Modal(props: Props) {
    return props.open ? React.createElement("Modal", { title: props.title }, props.children) : null;
  }
  Modal.Content = (props: Props) => React.createElement("ModalContent", null, props.children);
  return {
    Icon: (props: Props) => React.createElement("Icon", { name: props.name }),
    FlatList,
    Modal,
    ScrollView: rn.ScrollView,
    TextInput: rn.TextInput,
    useToast: () => ({ show: host.toast, error: host.toast }),
    copyText: async () => {},
  };
});
const host = vi.hoisted(() => ({
  toast: vi.fn(),
  settings: null as Record<string, unknown> | null,
  counts: null as { running: number; needsInput: number; review: number; done: number } | null,
  canStop: false,
  save: vi.fn(async (_values: unknown, _revision: string) => true),
  reload: vi.fn(async () => {}),
  /** Rows a lane's list drew, counted by the FlatList mock. */
  rowRenders: 0,
}));
// The details read a card's first prompt from its timeline: one stable client whose timelines are empty.
const paseo = vi.hoisted(() => ({
  agents: { ref: () => ({ timeline: { refetch: () => Promise.resolve({ error: null, entries: [] }) } }) },
}));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => paseo,
  useRpc: () => () => Promise.resolve({ stop: host.canStop }),
  useSettings: () => (host.settings ? { status: "ready", values: host.settings, revision: "1", saving: false, saveError: null, save: host.save, reload: host.reload } : { status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const React = await import("react");
  return {
    SidebarRow: (props: Record<string, unknown> & { trailing?: React.ReactNode }) =>
      React.createElement("SidebarRow", { label: props.label, active: props.active, onPress: props.onPress }, props.trailing),
  };
});
// The data layer's real body needs a daemon; the board is tested against the samples.
vi.mock("../../client/tasks/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/tasks/data")>();
  const { sampleCards } = await import("../../client/tasks/sample-cards");
  const { LANE_ORDER } = await import("../../client/tasks/model");
  const cards = sampleCards(Date.parse("2026-10-20T12:00:00Z"));
  const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id), hasMore: id === "done", loading: false }]));
  const handle = {
    lanes,
    counts: { needsInput: 1, running: 2, review: 2, done: 1 },
    byId: new Map(cards.map((card) => [card.id, card])),
    workspaces: [{ id: "wks_sample", name: "tasks-board", projectId: "prj_sample", projectName: "better-paseo" }],
    providers: [
      { id: "claude", label: "Claude" },
      { id: "codex", label: "Codex" },
    ],
    labels: [{ name: "frontend", color: "#8b5cf6" }],
    ready: true,
    error: null,
    loadMoreDone: vi.fn(),
    resolveParent: vi.fn(),
    refreshParent: vi.fn(async () => false),
    requestProjectIcon: vi.fn(),
  };
  return {
    ...actual,
    __handle: handle,
    useTasks: () => handle,
    useTaskCounts: () => ({ ...(host.counts ?? handle.counts), ready: true }),
  };
});

import { StyleSheet, View } from "react-native";
import { ProviderLogo } from "../../client/components/provider-logo";
import * as data from "../../client/tasks/data";
import { TasksBoardScreen } from "../../client/tasks/board/board-screen";
import { CardCell, RollingCount, RollingTotal, WindowSegments } from "../../client/tasks/board/board-parts";
import { LaneMotionLayer } from "../../client/tasks/board/lane-motion";
import { TasksSidebarEntry } from "../../client/tasks/board/sidebar-entry";
import { contributeTasks } from "../../client/tasks/contribute";
import { lastBoardParams, rememberBoardParams, rememberedCollapsed, resetBoardSessions, EMPTY_PARAMS, type BoardParams } from "../../client/tasks/board/params";
import { DesktopFilterBar } from "../../client/tasks/board/filter-bar";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { NOTICE_MS } from "../../client/tasks/board/use-board";
import { readSidebarPreference, resetSidebarPreference, writeSidebarPreference } from "../../client/tasks/board/sidebar-model";
import { ACTIVE_LANE_ORDER as LANE_ORDER } from "../../client/tasks/model";
import { BrandMark, PiMark, TagMark, TaskCardView, TaskDetailCards, taskTokens } from "../../client/tasks/cards";
import { deviceTasksStore } from "../../client/tasks/device-preferences";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS } from "../../shared/tasks-settings";
import { resetTasksEnabled } from "../../client/tasks/board/enabled";
import { APP_SETTINGS_KEY, resetHostAppearanceForTests, setNativeSettingsReaderForTests, triggerHostAppearanceCheck } from "../../client/ui/tokens/host-appearance-shim";

// These tests draw the board on and the archived lane off unless they turn it on
// (tasks-board-enabled.test.ts covers the board off).
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: true, board: { ...STOCK_SETTINGS.board, showArchived: false } };
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#e2e2e6",
    foreground: "#1b1b1f",
    foregroundMuted: "#6b6b75",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#198754",
    statusWarning: "#a36a00",
    statusDanger: "#d92d20",
  },
} as never;

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
const openAgent = vi.fn();

function screen(compact: boolean, params: Record<string, string> = {}, boardTheme: unknown = theme) {
  return React.createElement(TasksBoardScreen, {
    theme: boardTheme as never,
    host: { id: "host-1", label: "Local" },
    layout: { compact, platform: compact ? "ios" : "web" },
    navigation: { openAgent, openWorkspace: vi.fn() },
    params,
  });
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

/**
 * The desktop lanes wait for their width, and the board picks its layout by
 * it; this lays every View out at `width`, again while that mounts Views
 * that wait for one.
 */
/** A size on iOS or Android with no interface size set: the host's native default is 15 against its 14 ramp. */
const NATIVE = (size: number) => Math.round(size * 15 / 14);

function layOut(width: number) {
  const laidOut = new Set<unknown>();
  for (let pass = 0; pass < 4; pass++) {
    const views = renderer!.root.findAll(
      (node) => (node.type as unknown) === "View" && typeof node.props.onLayout === "function" && !laidOut.has(node.props.onLayout),
    );
    if (views.length === 0) return;
    act(() => {
      for (const view of views) {
        laidOut.add(view.props.onLayout);
        view.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } } });
      }
    });
  }
}

/** Host nodes with a test id (composites carry the same props). */
function hostsById(testID: string): ReactTestInstance[] {
  return renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID);
}

function lanesScroll(): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.horizontal === true);
}

function hostParentOf(node: ReactTestInstance): ReactTestInstance | null {
  let parent = node.parent;
  while (parent && typeof parent.type !== "string") parent = parent.parent;
  return parent;
}

function cards(): ReactTestInstance[] {
  return renderer!.root.findAllByType(TaskCardView);
}

/** The card ids a phone pager page draws. */
function laneCards(lane: string): string[] {
  return renderer!.root.findByProps({ testID: `phone-lane-${lane}` }).findAllByType(TaskCardView).map((card) => card.props.card.id);
}

function pressable(label: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}

function failDeviceWrite() {
  const storage = (globalThis as Record<string, unknown>).__betterPaseoDeviceTasksStorageForTests as { write(value: string): void };
  vi.spyOn(storage, "write").mockImplementationOnce(() => { throw new Error("Disk full"); });
}

beforeEach(() => {
  resetHostAppearanceForTests();
  host.settings = { ...DEFAULT_TASKS_SETTINGS };
  host.counts = null;
  host.canStop = false;
  host.rowRenders = 0;
  resetBoardSessions();
  resetSidebarPreference();
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetHostAppearanceForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
  resetEnhancerPreferences();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  resetTasksEnabled();
});

describe("Tasks board, desktop", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });

  it("rolls the counts and moves the cards through a filter, a done window or the subtasks switch, never through a search or a sort", () => {
    const scopes = () => renderer!.root.findAll((node) => node.type === RollingCount).map((node) => node.props.scope as unknown);
    const pick = (window: "24h" | "7d" | "all") => act(() => renderer!.root.findAll((node) => node.type === WindowSegments)[0]!.props.onChange(window));
    const subtasks = () => act(() => pressable("Show subtasks").props.onPress());
    const filter = () => act(() => renderer!.root.findAll((node) => node.type === DesktopFilterBar)[0]!.props.board.setParams((params: BoardParams) => ({ ...params, providers: ["codex"] })));
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    // The lanes' counts, and the toolbar's and the sidebar's totals.
    const before = scopes();
    expect(renderer!.root.findAll((node) => node.type === RollingTotal).every((total) => total.findAll((node) => node.type === RollingCount).length === 1)).toBe(true);
    pick("all");
    subtasks();
    filter();
    expect(scopes()).toEqual(before);
    act(() => renderer!.root.find((node) => (node.type as unknown) === "TextInput").props.onChangeText("api"));
    expect(scopes().every((scope, index) => scope !== before[index])).toBe(true);
    act(() => renderer!.unmount());

    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    act(() => hostsById("filter-bar-more")[0]!.props.onPress());
    const tablet = scopes();
    // The total shows its number at once there; the lanes' counts roll as on web.
    const totals = renderer!.root.findAll((node) => node.type === RollingTotal);
    expect(totals.length).toBeGreaterThan(0);
    for (const total of totals) expect(total.findAll((node) => node.type === RollingCount)).toHaveLength(0);
    subtasks();
    pick("24h");
    expect(scopes()).toEqual(tablet);
    act(() => renderer!.root.findAll((node) => node.type === DesktopFilterBar)[0]!.props.board.setParams((params: BoardParams) => ({ ...params, sort: { key: "title", direction: "asc" } })));
    expect(scopes().every((scope, index) => scope !== tablet[index])).toBe(true);
  });

  it.each([10, 14, 21])("follows Paseo's %i px UI setting across the toolbar, cards and sort menu", (base) => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === APP_SETTINGS_KEY ? JSON.stringify({ uiBaseFontSize: base, contentFontSize: 19, codeFontSize: 18 }) : null,
    });
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(1600);
      const font = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style).fontSize;
      const text = (value: string) => renderer!.root.find((node) => (node.type as unknown) === "Text" && textOf(node) === value);
      // Every size is a step of the host's ramp (sm 12, base 14), scaled as the host scales it.
      expect(font(text("Move"))).toBe(Math.round(12 * base / 14));
      const search = renderer!.root.find((node) => (node.type as unknown) === "TextInput");
      expect(font(search)).toBe(Math.round(14 * base / 14));
      const title = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "task-card-title")[0]!;
      // A card's title and a lane's name read at the host's list-row step, a step over the meta row and pills.
      expect(font(title)).toBe(Math.round(14 * base / 14));
      expect(StyleSheet.flatten(title.props.style).lineHeight).toBe(Math.round(20 * base / 14));
      const laneHeader = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "lane-header-running");
      expect(font(laneHeader.findAll((node) => (node.type as unknown) === "Text")[0]!)).toBe(Math.round(14 * base / 14));
      const pill = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "pill-model")[0]!;
      expect(StyleSheet.flatten(pill.props.style).height).toBe(Math.round(20 * Math.max(1, base / 14)));
      // A pill's text is the card's small text times 11/12, scaled the same way, so it stays under the meta row at every size.
      const pillText = pill.findAll((node) => (node.type as unknown) === "Text")[0]!;
      const meta = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "task-card-meta-location")[0]!;
      expect(font(pillText)).toBe(Math.round(12 * (11 / 12) * base / 14));
      expect(font(pillText)).toBeLessThan(font(meta));
      const sort = text("Sort").parent!;
      act(() => hostParentOf(sort)!.props.onPress());
      expect(font(text("Default order"))).toBe(base);
      const row = hostParentOf(text("Default order"))!;
      expect(StyleSheet.flatten(row.props.style).height).toBe(Math.round(32 * Math.max(1, base / 14)));
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each([10, 14, 21])("sizes the details from Paseo's type ramp at its %i px UI setting", (base) => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === APP_SETTINGS_KEY ? JSON.stringify({ uiBaseFontSize: base }) : null,
    });
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(2000);
      const card = cards().find((node) => node.props.card.id === "sample-running")!;
      act(() => card.props.onSelect(card.props.card));
      const font = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style).fontSize;
      // Each a step of the host's ramp (sm 12, base 14) scaled and rounded as the host scales it; the details sit a step under its rows.
      const step = (size: number) => Math.round(size * base / 14);
      const host = (id: string) => renderer!.root.find((node) => (node.type as unknown) === "Text" && node.props.testID === id);
      expect(font(host("detail-title"))).toBe(step(14));
      const cwd = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "detail-cwd-value");
      expect(font(cwd.findAll((node) => (node.type as unknown) === "Text")[0]!)).toBe(step(12));
      expect(font(host("detail-branch-note"))).toBe(step(12));
      expect(font(host("detail-place-value"))).toBe(step(12));
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("updates memoized cards when only the UI size changes, including a delayed host write", () => {
    let base = 14;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === APP_SETTINGS_KEY ? JSON.stringify({ uiBaseFontSize: base, contentFontSize: 19 }) : null,
    });
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(1600);
      const titleFont = () => {
        const title = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "task-card-title")[0]!;
        return StyleSheet.flatten(title.props.style).fontSize;
      };
      expect(titleFont()).toBe(14);
      act(() => { triggerHostAppearanceCheck(); });
      base = 21;
      act(() => { vi.advanceTimersByTime(700); });
      expect(titleFont()).toBe(21);
      base = 10;
      act(() => { vi.advanceTimersByTime(600); triggerHostAppearanceCheck(); });
      expect(titleFont()).toBe(10);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("uses host UI typography directly without reading persisted appearance", () => {
    const getItem = vi.fn(() => JSON.stringify({ uiBaseFontSize: 10 }));
    vi.stubGlobal("localStorage", { getItem });
    try {
      act(() => {
        renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: 21 } } }));
      });
      layOut(1600);
      const search = renderer!.root.find((node) => (node.type as unknown) === "TextInput");
      expect(StyleSheet.flatten(search.props.style).fontSize).toBe(21);
      // The sidebar reads its own open state; the appearance is never read.
      expect(getItem).not.toHaveBeenCalledWith(APP_SETTINGS_KEY);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("follows the native host UI setting on the compact board", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    setNativeSettingsReaderForTests(async () => ({ current: JSON.stringify({ uiBaseFontSize: 21, contentFontSize: 14 }), legacy: null }));
    await act(async () => {
      renderer = TestRenderer.create(screen(true));
    });
    const title = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "task-card-title")[0]!;
    // The phone card's title: the host's base step (14) at 21 / 14.
    expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontSize: 21, lineHeight: 30 });
    const header = renderer!.root.find((node) => (node.type as unknown) === "Text" && textOf(node) === "6 tasks");
    // The host's large step (16) at 21 / 14.
    expect(StyleSheet.flatten(header.props.style).fontSize).toBe(24);
  });

  it("draws four lanes with their counts and every sample card", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const text = textOf(renderer!.root);
    for (const name of ["Needs input", "Running", "Review", "Done"]) expect(text).toContain(name);
    expect(cards().map((card) => card.props.card.id)).toEqual(["sample-input", "sample-running", "sample-child-1", "sample-failed", "sample-unread", "sample-done"]);
    expect(text).toContain("Load more");
  });

  it("applies the params it was opened with and remembers them for the sidebar", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { q: "ring", sub: "1" }));
    });
    layOut(1600);
    // "ring" matches the parent and its running child; the parent's card shows the child as a row.
    expect(cards().map((card) => card.props.card.id)).toEqual(["sample-running"]);
    expect(lastBoardParams("host-1")).toMatchObject({ query: "ring", hideSubtasks: null });
    expect(deviceTasksStore().snapshot().values?.hideSubtasks).toBe(true);
    expect(textOf(renderer!.root)).toContain("Clear all");
  });

  it("falls back to the session's last filters when opened without params", () => {
    rememberBoardParams("host-1", { ...EMPTY_PARAMS, providers: ["codex"] });
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    expect(cards().map((card) => card.props.card.id)).toEqual(["sample-running"]);
  });

  it("collapses a lane into a strip and expands it again", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const collapse = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane");
    expect(collapse).toHaveLength(4);
    act(() => collapse[1]!.props.onPress());
    expect(cards().map((card) => card.props.card.id)).not.toContain("sample-running");
    // The collapsed strip is a 40-wide panel with Linear's corner.
    expect(StyleSheet.flatten(pressable("Expand lane: Running").props.style)).toMatchObject({ width: 40, borderRadius: 5 });
    act(() => pressable("Expand lane: Running").props.onPress());
    expect(cards().map((card) => card.props.card.id)).toContain("sample-running");
  });

  it.each(["web", "ios"])("toggles only the displayed empty lanes on %s and remembers their state", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, { q: "ring" })); });
    layOut(1600);
    const button = () => hostsById("empty-lanes-toggle")[0]!;
    const icon = () => button().find((node) => (node.type as unknown) === "Icon").props.name;
    expect(button().props.accessibilityState).toEqual({ selected: false });
    expect(icon()).toBe("FoldHorizontal");
    expect(StyleSheet.flatten(button().props.style).width).toBe(StyleSheet.flatten(hostsById("sidebar-switch")[0]!.props.style).width);
    // Keep a manually folded nonempty lane folded through both bulk operations.
    act(() => hostsById("lane-header-running")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane")[0]!.props.onPress());
    act(() => button().props.onPress());
    expect(rememberedCollapsed("host-1")).toEqual(["running", "needs_input", "review", "done"]);
    expect(button().props.accessibilityState).toEqual({ selected: true });
    expect(button().props.accessibilityLabel).toBe("Expand empty lanes");
    expect(icon()).toBe("UnfoldHorizontal");
    // A manual expansion changes the bulk switch back to collapse.
    act(() => pressable("Expand lane: Done").props.onPress());
    expect(button().props.accessibilityState).toEqual({ selected: false });
    act(() => button().props.onPress());
    act(() => button().props.onPress());
    expect(rememberedCollapsed("host-1")).toEqual(["running"]);
    expect(hostsById("lane-archived")).toHaveLength(0);
  });

  it("disables the empty-lane switch when every displayed lane has cards", () => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    expect(hostsById("empty-lanes-toggle")[0]!.props.disabled).toBe(true);
    act(() => hostsById("empty-lanes-toggle")[0]!.props.onPress());
    expect(rememberedCollapsed("host-1")).toEqual([]);
  });

  it("includes the archived lane only while it is shown", async () => {
    act(() => { renderer = TestRenderer.create(screen(false, { q: "ring" })); });
    layOut(2400);
    await act(async () => { await deviceTasksStore().update({ showArchived: true }); });
    act(() => hostsById("empty-lanes-toggle")[0]!.props.onPress());
    expect(rememberedCollapsed("host-1")).toEqual(["needs_input", "review", "done", "archived"]);
    await act(async () => { await deviceTasksStore().update({ showArchived: false }); });
    act(() => hostsById("empty-lanes-toggle")[0]!.props.onPress());
    expect(rememberedCollapsed("host-1")).toEqual(["archived"]);
  });

  it("excludes loading empty lanes from the bulk operation", () => {
    const handle = (data as unknown as { __handle: { lanes: Record<string, { loading: boolean }> } }).__handle;
    const done = handle.lanes.done!;
    const loading = done.loading;
    try {
      done.loading = true;
      act(() => { renderer = TestRenderer.create(screen(false, { q: "ring" })); });
      layOut(1600);
      act(() => hostsById("empty-lanes-toggle")[0]!.props.onPress());
      expect(rememberedCollapsed("host-1")).toEqual(["needs_input", "review"]);
    } finally {
      done.loading = loading;
    }
  });

  it("draws the archived lane after done only when the setting turns it on", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    expect(hostsById("lane-done")).toHaveLength(1);
    expect(hostsById("lane-archived")).toHaveLength(0);
    expect(hostsById("sidebar-stat-archived")).toHaveLength(0);
    act(() => { void deviceTasksStore().update({ showArchived: true }); renderer!.update(screen(false)); });
    layOut(2400);
    const order = renderer!.root
      .findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && /^lane-header-/.test(node.props.testID))
      .map((node) => node.props.testID.slice("lane-header-".length));
    expect(order).toEqual(["needs_input", "running", "review", "done", "archived"]);
    expect(textOf(hostsById("lane-header-archived")[0]!)).toContain("Archived");
    expect(hostsById("sidebar-stat-archived")).toHaveLength(1);
  });

  it("eases the lanes to the widths the user picked, and follows the board's own at once", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    // The inline sidebar takes 380 and its 12 margin.
    layOut(2400);
    /** A lane's clip width: a number when it holds still, the eased value (at its start) while it moves. */
    const clip = (lane: string) => {
      const width = StyleSheet.flatten(hostsById(`lane-${lane}`)[0]!.props.style).width as number | { __value: number };
      return typeof width === "number" ? width : { easing: width.__value };
    };
    expect(LANE_ORDER.map(clip)).toEqual([340, 340, 340, 340]);
    act(() => hostsById("lane-needs_input")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane")[0]!.props.onPress());
    // The collapsed lane eases from 340 to its strip; the strip inside has its 40 at once and fades in.
    expect(clip("needs_input")).toEqual({ easing: 340 });
    const swap = hostParentOf(pressable("Expand lane: Needs input").findAll((node) => typeof node.type === "string")[0]!)!;
    expect(StyleSheet.flatten(swap.props.style)).toMatchObject({ width: 40, opacity: { __value: 0 } });
    expect(clip("running")).toBe(340);
    // The board's own width (a window resize, the sidebar's edge dragged) is followed at once.
    const share = (1400 - 392 - 2 * 12 - 3 * 8 - 40) / 3;
    layOut(1400);
    expect(clip("running")).toBe(share);
    // A lane width the user switched to: every expanded lane eases there.
    const button = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && String(node.props.accessibilityLabel).startsWith("Lanes · "))[0]!;
    act(() => button().props.onPress());
    const wide = renderer!.root.find((node) => node.props.testID === "lane-width-menu").findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem")[2]!;
    await act(async () => wide.props.onPress());
    expect(clip("running")).toEqual({ easing: share });
    expect(clip("done")).toEqual({ easing: share });
    expect(clip("needs_input")).toEqual({ easing: 340 });
  });

  it("grows the archived lane in and shrinks it out as it is switched, the other lanes easing with it", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const clip = (lane: string) => {
      const width = StyleSheet.flatten(hostsById(`lane-${lane}`)[0]!.props.style).width as number | { __value: number };
      return typeof width === "number" ? width : { easing: width.__value };
    };
    // The four share the room left of the sidebar; five take less each.
    const four = clip("done") as number;
    act(() => { void deviceTasksStore().update({ showArchived: true }); renderer!.update(screen(false)); });
    // In from nothing, while the four make room from where they were; the content inside has its width at once.
    expect(clip("archived")).toEqual({ easing: 0 });
    expect(clip("done")).toEqual({ easing: four });
    const inside = (lane: string) => {
      const swap = hostsById(`lane-${lane}`)[0]!.findAll((node) => {
        const style = typeof node.type === "string" ? StyleSheet.flatten(node.props.style) : null;
        return !!style && style.flex === 1 && style.flexDirection === "row" && typeof style.width === "number";
      })[0]!;
      return StyleSheet.flatten(swap.props.style).width as number;
    };
    const five = inside("done");
    expect(five).toBeLessThan(four);
    expect(inside("archived")).toBe(five);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => { void deviceTasksStore().update({ showArchived: false }); renderer!.update(screen(false)); });
    // Out to nothing, its content as it was and out of reach, then gone.
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(hostsById("lane-archived")[0]!.props.pointerEvents).toBe("none");
    expect(inside("archived")).toBe(five);
    expect(inside("done")).toBe(four);
    expect(typeof clip("done")).toBe("object");
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(hostsById("lane-archived")).toHaveLength(0);
  });

  it("draws an out-of-view lane's cards once it scrolls in, or a moment later", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1100);
    const list = (lane: string) => hostsById(`lane-${lane}`)[0]!.findAll((node) => (node.type as unknown) === "FlatList").length;
    // The row scrolled to its end: the archived lane comes in inside its edge padding, which is no view.
    const content = lanesScroll().props.contentContainerStyle.width as number;
    // The inline sidebar takes 380 and its 12 margin.
    act(() => lanesScroll().props.onScroll({ nativeEvent: { contentOffset: { x: content - (1100 - 392), y: 0 } } }));
    expect(list("done")).toBe(1);
    act(() => { void deviceTasksStore().update({ showArchived: true }); renderer!.update(screen(false)); });
    // Past the row's right edge: no cards yet, only the lane's skeleton.
    expect(list("needs_input")).toBe(1);
    expect(list("archived")).toBe(0);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(list("archived")).toBe(1);
    // Switched off and on again, it waits again; a scroll that brings it in draws it at once.
    act(() => { void deviceTasksStore().update({ showArchived: false }); });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => { void deviceTasksStore().update({ showArchived: true }); renderer!.update(screen(false)); });
    expect(list("archived")).toBe(0);
    act(() => lanesScroll().props.onScroll({ nativeEvent: { contentOffset: { x: 900, y: 0 } } }));
    expect(list("archived")).toBe(1);
  });

  it("draws again only the lane whose cards changed", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: unknown[] }> } }).__handle;
    const original = handle.lanes;
    try {
      // The same snapshot drawn again: no lane draws its rows.
      let rows = host.rowRenders;
      act(() => renderer!.update(screen(false)));
      expect(host.rowRenders).toBe(rows);
      // A new snapshot in which only the running lane changed: only its rows draw.
      const running = original.running!;
      handle.lanes = { ...original, running: { ...running, cards: running.cards.slice(1) } };
      rows = host.rowRenders;
      act(() => renderer!.update(screen(false)));
      expect(host.rowRenders - rows).toBe(running.cards.length - 1);
    } finally {
      handle.lanes = original;
    }
  });

  it("keeps the cards' fields across a settings read-back that leaves them as they were", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    const fields = () => new Set(renderer!.root.findAll((node) => node.props.card !== undefined && node.props.fields !== undefined).map((node) => node.props.fields));
    const before = fields();
    expect(before.size).toBe(1);
    // A save reads the whole record back as new objects: the archived lane's switch changes no card field.
    host.settings = JSON.parse(JSON.stringify({ ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } }));
    act(() => renderer!.update(screen(false)));
    expect([...fields()]).toEqual([...before]);
    expect(fields().values().next().value).toBe(before.values().next().value);
    host.settings = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, branch: !DEFAULT_TASKS_SETTINGS.card.branch } };
    act(() => renderer!.update(screen(false)));
    expect(fields().values().next().value).not.toBe(before.values().next().value);
  });

  it("shows the status counts in an inline sidebar that takes its width from the lanes", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    expect(hostsById("sidebar-inline")).toHaveLength(1);
    expect(renderer!.root.findByProps({ testID: "sidebar-switch" }).find((node) => node.props.side !== undefined).props.side).toBe("right");
    // The lanes keep the board less the sidebar's 380 and its 12 margin.
    expect(lanesScroll().props.contentContainerStyle).toMatchObject({ width: 2000 - 380 - 12 });
    const stats = renderer!.root.findByProps({ testID: "sidebar-stats" });
    expect(textOf(stats.findByProps({ testID: "sidebar-stat-running" }))).toMatch(/Running\d/);
    // No card chosen: the groups.
    expect(hostsById("sidebar-groups").length).toBeGreaterThan(0);
    const icon = () => hostsById("sidebar-switch")[0]!.find((node) => (node.type as unknown) === "Icon").props.name;
    expect(icon()).toBe("PanelRightClose");
    // The switch hides it, and the lanes take the whole board.
    act(() => renderer!.root.findByProps({ testID: "sidebar-switch" }).props.onPress());
    expect(hostsById("sidebar-inline")).toHaveLength(0);
    expect(lanesScroll().props.contentContainerStyle).toMatchObject({ width: 2000 });
    expect(readSidebarPreference().open).toBe(false);
    expect(icon()).toBe("PanelRightOpen");
  });

  it.each([2000, 600])("draws both panel actions with host icons at %i pt", (width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    const button = () => hostsById("sidebar-switch")[0]!;
    const icon = () => button().find((node) => (node.type as unknown) === "Icon").props.name;
    const side = width === 2000 ? "Right" : "Bottom";
    const initial = button().props.accessibilityState.selected;
    expect(icon()).toBe(`Panel${side}${initial ? "Close" : "Open"}`);
    expect(textOf(button())).toBe("");
    act(() => button().props.onPress());
    expect(button().props.accessibilityState.selected).toBe(!initial);
    expect(icon()).toBe(`Panel${side}${initial ? "Open" : "Close"}`);
  });

  it.each([
    ["ios", "en", 14], ["ios", "zh", 21], ["web", "en", 21],
  ] as const)("%s stats hide overflowing %s labels at UI base %i and restore them when space returns", (os, language, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } };
    act(() => {
      renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } }));
    });
    layOut(1600);
    const label = () => hostsById("sidebar-stat-label-running");
    const heading = () => hostsById("sidebar-stat-heading-running")[0]!;
    const measure = () => hostsById("sidebar-stat-measure-running")[0]!;
    const stat = () => hostsById("sidebar-stat-running")[0]!;
    const layout = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } }));
    layout(heading(), 100);
    layout(measure(), 60);
    expect(label()).toHaveLength(1);
    expect(stat().props.accessibilityLabel).toBe(`${BOARD_STRINGS[language].lanes.running} 2`);
    layout(heading(), 77);
    expect(label()).toHaveLength(0);
    expect(stat().findAllByType(RollingCount).map((node) => node.props.value)).toEqual([2]);
    expect(stat().findAll((node) => node.props.kind === "running").length).toBeGreaterThan(0);
    expect(hostParentOf(measure())!.props["aria-hidden"]).toBe(true);
    // The cell remains a lane navigation control while its label is hidden.
    act(() => stat().props.onPress());
    expect(label()).toHaveLength(0);
    layout(heading(), 80);
    expect(label()).toHaveLength(1);
    // A longer translation or larger type can hide it again without resizing.
    layout(measure(), 90);
    expect(label()).toHaveLength(0);
    layout(heading(), 120);
    expect(label()).toHaveLength(1);
  });

  it.each([
    ["ios", "en", 14], ["ios", "zh", 21], ["web", "en", 21],
  ] as const)("%s group tabs hide overflowing %s labels at UI base %i and restore whole labels", (os, language, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(os === "ios" ? 900 : 1600);
    if (os === "ios") act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    const layout = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } }));
    for (const kind of ["agent", "project", "workspace", "label"] as const) {
      const word = BOARD_STRINGS[language].sidebar.groups[kind];
      const tab = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "tab" && node.props.accessibilityLabel === word);
      const measure = () => tab().find((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-measure");
      const label = () => tab().findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-label");
      layout(measure(), 60);
      layout(tab(), 100);
      expect(label()).toHaveLength(1);
      const basis = StyleSheet.flatten(tab().props.style).flexBasis;
      layout(tab(), 50);
      expect(label()).toHaveLength(0);
      expect(tab().findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(1);
      expect(StyleSheet.flatten(tab().props.style).flexBasis).toBe(basis);
      expect(hostParentOf(measure())!.props.accessibilityElementsHidden).toBe(true);
      // Icon-only tabs still switch the group, preserving the full accessible name.
      const measurement = measure();
      act(() => tab().props.onPress());
      expect(tab().props.accessibilityState).toEqual({ selected: true });
      expect(label()).toHaveLength(0);
      expect(measure()).toBe(measurement);
      expect(StyleSheet.flatten(measure().props.style).fontWeight).toBe("500");
      layout(tab(), 120);
      expect(label()).toHaveLength(1);
      expect(textOf(label()[0]!)).toBe(word);
      // An updated measurement (font or translation) can hide the label without a resize.
      layout(measure(), 140);
      expect(label()).toHaveLength(0);
    }
  });

  it("keeps all four icon-only group tabs equal and their labels stable through repeated clicks", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    const tabs = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "tab");
    const layout = (node: ReactTestInstance, width: number) => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } });
    act(() => tabs().forEach((tab, index) => {
      layout(tab.find((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-measure"), 60 + index * 20);
      layout(tab, 50);
    }));
    const labels = () => hostsById("sidebar-group-tab-label");
    const sizes = () => tabs().map((tab) => {
      const { flexBasis, flexGrow, flexShrink, minWidth, height, paddingHorizontal } = StyleSheet.flatten(tab.props.style);
      return { flexBasis, flexGrow, flexShrink, minWidth, height, paddingHorizontal };
    });
    expect(labels()).toHaveLength(0);
    const original = sizes();
    expect(original).toHaveLength(4);
    expect(original.every((size) => size.flexBasis === 0 && size.flexGrow === 1)).toBe(true);
    expect(original.every((size) => JSON.stringify(size) === JSON.stringify(original[0]))).toBe(true);
    const measurements = hostsById("sidebar-group-tab-measure");
    for (const index of [1, 2, 3, 0, 2, 0]) {
      act(() => tabs()[index]!.props.onPress());
      expect(labels()).toHaveLength(0);
      expect(sizes()).toEqual(original);
      expect(hostsById("sidebar-group-tab-measure")).toEqual(measurements);
      expect(tabs()[index]!.props.accessibilityState).toEqual({ selected: true });
    }
    act(() => tabs().forEach((tab) => layout(tab, 180)));
    expect(labels()).toHaveLength(4);
    const textStyles = labels().map((node) => StyleSheet.flatten(node.props.style));
    act(() => tabs()[1]!.props.onPress());
    expect(labels()).toHaveLength(4);
    expect(labels().map((node) => StyleSheet.flatten(node.props.style).fontWeight)).toEqual(textStyles.map((style) => style.fontWeight));
  });

  it("counts the active cards by workspace in the sidebar's groups, a row a workspace filter", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const groups = () => renderer!.root.findByProps({ testID: "sidebar-groups" });
    act(() => groups().findByProps({ accessibilityRole: "tab", accessibilityLabel: "Workspace" }).props.onPress());
    const row = () => groups().findAll((node) => node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function")[0]!;
    // The workspace, its project muted after it, and the active (not done) cards in it.
    const active = (["needs_input", "running", "review"] as const).reduce((sum, lane) => sum + (data as unknown as { __handle: { lanes: Record<string, { cards: unknown[] }> } }).__handle.lanes[lane]!.cards.length, 0);
    expect(row().props.accessibilityLabel).toBe(`tasks-board better-paseo ${active}`);
    act(() => row().props.onPress());
    expect(lastBoardParams("host-1").workspaceIds).toEqual(["wks_sample"]);
    expect(row().props.accessibilityState).toEqual({ checked: true });
    act(() => row().props.onPress());
    expect(lastBoardParams("host-1").workspaceIds).toEqual([]);
  });

  it("draws the sidebar's label rows with a solid tag whose hole follows the row's fill", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const groups = () => renderer!.root.findByProps({ testID: "sidebar-groups" });
    act(() => groups().findByProps({ accessibilityRole: "tab", accessibilityLabel: "Labels" }).props.onPress());
    const row = () => groups().findAll((node) => node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function")[0]!;
    const tag = () => row().findByType(TagMark).props;
    const resting = tag().hole;
    act(() => row().props.onPress());
    expect(row().props.accessibilityState).toEqual({ checked: true });
    expect(tag().hole).not.toBe(resting);
    act(() => row().props.onPress());
  });

  it("scrolls the sidebar's groups with the details' scrollbar, its gutter out of the rows' right margin", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const groups = renderer!.root.findByProps({ testID: "sidebar-groups" });
    const scroll = groups.findAll((node) => node.props.testID === "sidebar-groups-scroll" && typeof node.type === "string")[0]!;
    expect(scroll.props).toMatchObject({ showsVerticalScrollIndicator: true, dataSet: { bcdetails: "inset" } });
    const row = groups.findAll((node) => node.props.accessibilityRole === "checkbox" && typeof node.type === "string")[0]!;
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ marginLeft: 6, marginRight: 0 });
  });

  it("draws the sidebar's project and workspace rows with the cards' project icon", () => {
    const handle = (data as unknown as { __handle: { workspaces: object[]; requestProjectIcon: ReturnType<typeof vi.fn> } }).__handle;
    const saved = handle.workspaces;
    handle.workspaces = [{ ...saved[0], projectKey: "remote:github.com/RoundRedDot/better-paseo", projectIcon: null }];
    handle.requestProjectIcon.mockClear();
    try {
      act(() => {
        renderer = TestRenderer.create(screen(false));
      });
      layOut(2000);
      const groups = () => renderer!.root.findByProps({ testID: "sidebar-groups" });
      const fill = (node: ReturnType<typeof groups>) => StyleSheet.flatten(node.findByProps({ testID: "project-icon-generated" }).props.style).backgroundColor;
      const cardIcon = renderer!.root.findAllByProps({ testID: "project-icon-generated" }).find((node) => !groups().findAll((inner) => inner === node).length)!;
      const cardFill = StyleSheet.flatten(cardIcon.props.style).backgroundColor;
      for (const tab of ["Project", "Workspace"]) {
        act(() => groups().findByProps({ accessibilityRole: "tab", accessibilityLabel: tab }).props.onPress());
        expect(fill(groups())).toBe(cardFill);
      }
      // The rows ask for the uploaded icon themselves: their project may have no card on screen.
      expect(handle.requestProjectIcon).toHaveBeenCalledWith("prj_sample");
    } finally {
      handle.workspaces = saved;
    }
  });

  it("flashes a stat's lane, opening it if folded, without focusing a card", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const lane = (id: string) => renderer!.root.find((node) => node.props.lane?.id === id && "flash" in node.props);
    const stat = (id: string) => renderer!.root.findByProps({ testID: `sidebar-stat-${id}` });
    const collapse = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane");
    act(() => collapse[1]!.props.onPress());
    expect(lane("running").props.collapsed).toBe(true);
    act(() => stat("running").props.onPress());
    expect(lane("running").props.collapsed).toBe(false);
    expect(lane("running").props.flash).toMatchObject({ lane: "running", key: 1 });
    expect(lane("review").props.flash).toBeNull();
    expect(cards().some((card) => card.props.focused)).toBe(false);
    // Again: a new key flashes it again.
    act(() => stat("running").props.onPress());
    expect(lane("running").props.flash).toMatchObject({ key: 2 });
  });

  it("shows a card only once it is clicked, and the next clicked card after it", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const card = (id: string) => cards().find((node) => node.props.card.id === id)!;
    const title = () => textOf(renderer!.root.findByProps({ testID: "detail-title" }));
    expect(hostsById("detail-title")).toHaveLength(0);
    act(() => card("sample-running").props.onSelect(card("sample-running").props.card));
    expect(title()).toBe(card("sample-running").props.card.title);
    expect(card("sample-running").props.current).toBe(true);
    act(() => card("sample-failed").props.onSelect(card("sample-failed").props.card));
    expect(title()).toBe(card("sample-failed").props.card.title);
    expect(card("sample-running").props.current).toBe(false);
    // No pin button: the header has only Close.
    expect(hostsById("detail-pin")).toHaveLength(0);
    // Close: back to the groups.
    act(() => renderer!.root.findByProps({ testID: "detail-close" }).props.onPress());
    expect(hostsById("detail-title")).toHaveLength(0);
  });

  it("scrolls a short sidebar as one, so the details' header does not hold the sections to a strip", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    act(() => card.props.onSelect(card.props.card));
    const column = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-sidebar");
    expect(hostsById("details-sidebar-scroll")).toHaveLength(0);
    act(() => column().props.onLayout({ nativeEvent: { layout: { width: 380, height: 560 } } }));
    expect(hostsById("details-sidebar-scroll")).toHaveLength(1);
    expect(textOf(renderer!.root.findByProps({ testID: "detail-title" }))).toBe(card.props.card.title);
    act(() => column().props.onLayout({ nativeEvent: { layout: { width: 380, height: 900 } } }));
    expect(hostsById("details-sidebar-scroll")).toHaveLength(0);
  });

  it("raises the details from the bottom of a board too narrow to float them, and the lanes make room", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(600);
    expect(hostsById("board-sheet")).toHaveLength(0);
    // The switch's mark shows the panel at the bottom, where the details will rise.
    const switchSide = () => renderer!.root.findByProps({ testID: "sidebar-switch" }).find((node) => node.props.side !== undefined).props.side;
    expect(switchSide()).toBe("bottom");
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    act(() => card.props.onSelect(card.props.card));
    expect(hostsById("board-sheet")).toHaveLength(1);
    expect(hostsById("sidebar-floating")).toHaveLength(0);
    expect(textOf(renderer!.root.findByProps({ testID: "detail-title" }))).toBe(card.props.card.title);
    // A card in the sheet leaves the counts out; each lane's list scrolls its last card above the half sheet (800 x 0.58).
    expect(hostsById("sidebar-stats")).toHaveLength(0);
    // A tablet's sheet (680 wide): the header with the first section on the left, the rest on the right, each scrolling.
    const column = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-sidebar");
    act(() => column().props.onLayout({ nativeEvent: { layout: { width: 680, height: 464 } } }));
    expect(hostsById("detail-column-head")).toHaveLength(1);
    expect(hostsById("detail-column-sections")).toHaveLength(1);
    expect(hostsById("details-sidebar-scroll")).toHaveLength(0);
    // A foldable's (580): one column again, scrolling as one.
    act(() => column().props.onLayout({ nativeEvent: { layout: { width: 580, height: 464 } } }));
    expect(hostsById("detail-column-head")).toHaveLength(0);
    expect(hostsById("details-sidebar-scroll")).toHaveLength(1);
    const list = renderer!.root.findAll((node) => typeof node.props.renderItem === "function" && node.props.contentContainerStyle !== undefined)[0]!;
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(8 + 464);
    // The handle switches to full height and back.
    const handle = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "board-sheet-handle");
    expect(handle().props.accessibilityLabel).toBe("Expand details");
    act(() => handle().props.onPress());
    expect(handle().props.accessibilityLabel).toBe("Collapse details");
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(8 + 792);
    // A drag down on the handle takes it back to half, and the click the drag ends with does not switch it again.
    const strip = handle().parent!.parent!;
    // The drag counts from where the finger went down (pageY), not from the late grant.
    act(() => {
      strip.props.onStartShouldSetPanResponderCapture({ nativeEvent: { pageY: 300 } });
      strip.props.onPanResponderGrant({ nativeEvent: { pageY: 340 } }, { dy: 0, vy: 0 });
      strip.props.onPanResponderRelease({ nativeEvent: { pageY: 420 } }, { dy: 80, vy: 0 });
    });
    act(() => handle().props.onPress());
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(8 + 464);
    // A tap on the lanes' blank space puts it away.
    let blank = lanesScroll().parent!;
    while (!blank.props.onResponderGrant) blank = blank.parent!;
    act(() => {
      blank.props.onResponderGrant({ nativeEvent: { pageX: 10, pageY: 10 } });
      blank.props.onResponderRelease({ nativeEvent: { pageX: 10, pageY: 10 } });
    });
    expect(hostsById("board-sheet")).toHaveLength(0);
  });

  it("keeps the blank-tap responder off the lanes' scroll views on touch, and above them on web", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const card = () => cards().find((node) => node.props.card.id === "sample-running")!;
    act(() => card().props.onSelect(card().props.card));
    expect(card().props.current).toBe(true);
    // A tap on a lane's header, then under a lane's cards, lets go of the card.
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "lane-header-review").props.onPress());
    expect(card().props.current).toBe(false);
    act(() => card().props.onSelect(card().props.card));
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "lane-blank-running").props.onPress());
    expect(card().props.current).toBe(false);
    // The gap between two lanes is a blank too.
    act(() => card().props.onSelect(card().props.card));
    act(() => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "lane-gap")[0]!.props.onPress());
    expect(card().props.current).toBe(false);
    // A quick swipe that starts on a lane's collapse button scrolls, it does not fold the lane.
    const collapse = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane")[1]!;
    act(() => {
      collapse().props.onPressIn({ nativeEvent: { pageX: 600, pageY: 40 } });
      collapse().props.onPress({ nativeEvent: { pageX: 350, pageY: 42 } });
    });
    expect(cards().map((node) => node.props.card.id)).toContain("sample-running");
    // A tap folds it.
    act(() => {
      collapse().props.onPressIn({ nativeEvent: { pageX: 600, pageY: 40 } });
      collapse().props.onPress({ nativeEvent: { pageX: 602, pageY: 41 } });
    });
    expect(cards().map((node) => node.props.card.id)).not.toContain("sample-running");
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Expand lane: Running").props.onPress());
    // Touch: no responder above the scroll row (it held its drags back), the header and the space under the cards take the tap.
    const above = () => {
      let node = lanesScroll().parent;
      while (node && !node.props.onResponderGrant) node = node.parent;
      return node;
    };
    expect(above()).toBeNull();
    expect(renderer!.root.findAll((node) => node.props.testID === "lane-blank-running").length).toBeGreaterThan(0);
    act(() => renderer!.unmount());
    // Web: the board's own responder above the row, with the scrollbar check; no touch-only blanks.
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    try {
      act(() => {
        renderer = TestRenderer.create(screen(false));
      });
      layOut(1600);
      const webCard = cards().find((node) => node.props.card.id === "sample-running")!;
      act(() => webCard.props.onSelect(webCard.props.card));
      expect(cards().find((node) => node.props.card.id === "sample-running")!.props.current).toBe(true);
      const blank = above()!;
      act(() => {
        blank.props.onResponderGrant({ nativeEvent: { pageX: 10, pageY: 10 } });
        blank.props.onResponderRelease({ nativeEvent: { pageX: 10, pageY: 10 } });
      });
      expect(cards().find((node) => node.props.card.id === "sample-running")!.props.current).toBe(false);
      expect(renderer!.root.findAll((node) => node.props.testID === "lane-blank-running")).toHaveLength(0);
    } finally {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    }
  });

  it("floats the sidebar over a narrow board only on demand, and puts it away on a tap outside", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(900);
    // Open as remembered, but a narrow board keeps its lanes clear until asked.
    expect(readSidebarPreference().open).toBe(true);
    expect(hostsById("sidebar-floating")).toHaveLength(0);
    expect(hostsById("sidebar-inline")).toHaveLength(0);
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    act(() => card.props.onSelect(card.props.card));
    expect(hostsById("sidebar-floating")).toHaveLength(1);
    expect(textOf(renderer!.root.findByProps({ testID: "detail-title" }))).toBe(card.props.card.title);
    // A tap on the lanes' blank space puts it away and lets go of the card.
    let blank = lanesScroll().parent!;
    while (!blank.props.onResponderGrant) blank = blank.parent!;
    act(() => {
      blank.props.onResponderGrant({ nativeEvent: { pageX: 10, pageY: 10 } });
      blank.props.onResponderRelease({ nativeEvent: { pageX: 10, pageY: 10 } });
    });
    expect(hostsById("sidebar-floating")).toHaveLength(0);
    // The switch shows the overview for the moment, and leaves the remembered state alone.
    act(() => renderer!.root.findByProps({ testID: "sidebar-switch" }).props.onPress());
    expect(hostsById("sidebar-floating")).toHaveLength(1);
    expect(hostsById("sidebar-groups").length).toBeGreaterThan(0);
    act(() => renderer!.root.findByProps({ testID: "sidebar-switch" }).props.onPress());
    expect(hostsById("sidebar-floating")).toHaveLength(0);
    expect(readSidebarPreference().open).toBe(true);
  });

  it.each([14, 21])("iPad floating sidebar uses smaller text at UI base %i and keeps other layouts unchanged", (base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    const uiTheme = { ...(theme as object), typography: { fontSize: { ui: base } } };
    act(() => { renderer = TestRenderer.create(screen(false, {}, uiTheme)); });
    layOut(900);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).width).toBe(340);
    expect(StyleSheet.flatten(hostsById("sidebar-stat-label-running")[0]!.props.style).fontSize).toBe(Math.round(12 * base / 14 * 0.9));
    expect(hostsById("floating-sidebar-grabber")).toHaveLength(1);
    layOut(1600);
    expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
    expect(StyleSheet.flatten(hostsById("sidebar-stat-label-running")[0]!.props.style).fontSize).toBe(Math.round(12 * base / 14));
    expect(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).width).toBe(380);
    layOut(600);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    expect(hostsById("board-sheet")).toHaveLength(1);
    expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
    expect(StyleSheet.flatten(hostsById("sidebar-stat-label-running")[0]!.props.style).fontSize).toBe(Math.round(12 * base / 14));
  });

  it("iPad drags the floating edge, clamps both ends, cancels and remembers a released width", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    const handle = () => hostsById("floating-sidebar-resize")[0]!;
    const width = () => StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).width;
    const event = (pageX: number) => ({ nativeEvent: { pageX } });
    expect(handle().props.onMoveShouldSetPanResponder({}, { dx: 3, dy: 0 })).toBe(false);
    expect(handle().props.onMoveShouldSetPanResponder({}, { dx: 8, dy: 20 })).toBe(false);
    expect(handle().props.onMoveShouldSetPanResponder({}, { dx: 8, dy: 0 })).toBe(true);
    act(() => {
      handle().props.onStartShouldSetPanResponderCapture(event(500));
      handle().props.onPanResponderGrant();
    });
    act(() => handle().props.onPanResponderMove(event(0)));
    expect(width()).toBe(480);
    act(() => handle().props.onPanResponderMove(event(800)));
    expect(width()).toBe(320);
    act(() => handle().props.onPanResponderRelease(event(450)));
    expect(width()).toBe(390);
    expect(readSidebarPreference()).toMatchObject({ width: 380, floatingWidth: 390 });
    act(() => {
      handle().props.onStartShouldSetPanResponderCapture(event(500));
      handle().props.onPanResponderGrant();
    });
    act(() => handle().props.onPanResponderMove(event(400)));
    expect(width()).toBe(480);
    act(() => handle().props.onPanResponderTerminate());
    expect(width()).toBe(390);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    expect(width()).toBe(390);
    act(() => handle().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(width()).toBe(410);
    act(() => { renderer!.unmount(); renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    expect(width()).toBe(410);
  });

  it("keeps the web floating sidebar at its original width without the tablet grabber", () => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    act(() => hostsById("sidebar-switch")[0]!.props.onPress());
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).width).toBe(380);
    expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
  });

  it("wires the cards: open jumps to the agent, a hidden parent toasts", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { agent: "claude" }));
    });
    layOut(1600);
    const child = cards().find((card) => card.props.card.id === "sample-child-1")!;
    act(() => child.props.onOpen("sample-child-1"));
    expect(openAgent).toHaveBeenCalledWith({ agentId: "sample-child-1" });
    act(() => child.props.onReveal("sample-running"));
    expect(host.toast).toHaveBeenCalledWith("Hidden by the current filters");
    expect(child.props.fields).toEqual(DEFAULT_TASKS_SETTINGS.card);
    expect(child.props.compact).toBe(false);
    // The host has no CLI to stop with (`tasks.capabilities`), so no card offers Stop.
    expect(child.props.onStop).toBeUndefined();
    // Nor Unarchive, which runs through the same CLI.
    expect(child.props.onUnarchive).toBeUndefined();
  });

  it("hands the cards Unarchive when the host has the CLI", async () => {
    host.canStop = true;
    await act(async () => {
      renderer = TestRenderer.create(screen(false));
      await Promise.resolve();
    });
    layOut(1600);
    const card = cards()[0]!;
    expect(card.props.onUnarchive).toEqual(expect.any(Function));
    expect(card.props.unarchivePending).toBe(false);
    // The phone's cards too, through the guard that drops a tap ending a swipe.
    await act(async () => renderer!.update(screen(true)));
    expect(cards()[0]!.props.onUnarchive).toEqual(expect.any(Function));
  });

  it("does not open an archived task, whose tab Paseo would drop for another, and says why", () => {
    const handle = (data as unknown as { __handle: { byId: Map<string, unknown> } }).__handle;
    const done = handle.byId.get("sample-done") as Record<string, unknown>;
    handle.byId.set("archived-task", { ...done, id: "archived-task", lane: "archived", status: "archived", archived: "agent" });
    try {
      act(() => {
        renderer = TestRenderer.create(screen(false));
      });
      layOut(1600);
      const card = cards()[0]!;
      act(() => card.props.onOpen("archived-task"));
      expect(openAgent).not.toHaveBeenCalled();
      expect(host.toast).toHaveBeenCalledWith("Unarchive this task to open it in Paseo");
      act(() => card.props.onOpen("sample-done"));
      expect(openAgent).toHaveBeenCalledWith({ agentId: "sample-done" });
    } finally {
      handle.byId.delete("archived-task");
    }
  });

  it("disarms an armed stop on Esc, whatever has the keyboard focus", async () => {
    host.canStop = true;
    const keys: Array<(event: unknown) => void> = [];
    vi.stubGlobal("document", {
      activeElement: null,
      body: {},
      visibilityState: "visible",
      addEventListener: (type: string, listener: (event: unknown) => void) => type === "keydown" && keys.push(listener),
      removeEventListener: () => {},
    });
    try {
      await act(async () => {
        renderer = TestRenderer.create(screen(false));
        await Promise.resolve();
        await Promise.resolve();
      });
      layOut(1600);
      const running = () => cards().find((card) => card.props.card.id === "sample-running")!;
      act(() => running().props.onStop(running().props.card));
      expect(running().props.stopPhase).toBe("confirming");
      const preventDefault = vi.fn();
      act(() => {
        for (const listener of keys) listener({ key: "Escape", preventDefault });
      });
      expect(running().props.stopPhase).toBe("idle");
      expect(preventDefault).toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("disarms on Esc in the capture phase from the search box and the sidebar, and blurs the search box", async () => {
    host.canStop = true;
    const capture: Array<(event: unknown) => void> = [];
    const doc = {
      activeElement: null as unknown,
      body: {},
      visibilityState: "visible",
      addEventListener: (type: string, listener: (event: unknown) => void, useCapture?: boolean) => type === "keydown" && useCapture === true && capture.push(listener),
      removeEventListener: () => {},
    };
    vi.stubGlobal("document", doc);
    const search = { tagName: "INPUT", inBoard: true, blur: vi.fn() };
    const sidebar = { tagName: "DIV", inBoard: false, blur: vi.fn() };
    // The board's root is the one collapsable={false} view; the rest stay unmocked.
    const nodeMock = {
      createNodeMock: (element: React.ReactElement) =>
        (element.props as { collapsable?: boolean }).collapsable === false ? { contains: (node: { inBoard?: boolean }) => node?.inBoard === true } : null,
    };
    try {
      await act(async () => {
        renderer = TestRenderer.create(screen(false), nodeMock);
        await Promise.resolve();
        await Promise.resolve();
      });
      layOut(1600);
      expect(capture).toHaveLength(1);
      const running = () => cards().find((card) => card.props.card.id === "sample-running")!;
      for (const focus of [search, sidebar]) {
        act(() => running().props.onStop(running().props.card));
        expect(running().props.stopPhase).toBe("confirming");
        doc.activeElement = focus;
        act(() => capture[0]!({ key: "Escape", preventDefault() {} }));
        expect(running().props.stopPhase).toBe("idle");
      }
      expect(search.blur).toHaveBeenCalledTimes(1);
      expect(sidebar.blur).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("keeps the done window and the sort at the first filter row's end, whatever wraps", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { q: "status", agent: "claude" }));
    });
    layOut(1440);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    // At the right end of its line; on a line of its own it shrinks rather than overflow.
    expect(StyleSheet.flatten(end.props.style)).toMatchObject({ marginLeft: "auto", maxWidth: "100%", flexShrink: 1 });
    expect(end.findAll((node) => (node.type as unknown) === "Text" && textOf(node) === "Sort")).toHaveLength(1);
    // The chips wrap inside the filters' own group. The bar wraps only once
    // that group would get less than its floor beside the done window and the
    // sort: a bar as wide as 1440's keeps them on the first row.
    let bar = end.parent!;
    while (typeof bar.type !== "string") bar = bar.parent!;
    expect(StyleSheet.flatten(bar.props.style).flexWrap).toBe("wrap");
    const groups = bar.findAll((node) => (node.type as unknown) === "View" && hostParentOf(node) === bar);
    expect(groups).toHaveLength(2);
    const filters = groups.find((child) => child !== end)!;
    expect(StyleSheet.flatten(filters.props.style)).toMatchObject({ flex: 1, minWidth: 240, flexWrap: "wrap" });
    expect(textOf(filters)).toContain("Clear all");
  });

  it("ends a long sort and every filter label in an ellipsis rather than overlap", () => {
    for (const sort of ["duration-asc", "updated-desc", "context-desc"]) {
      act(() => {
        renderer = TestRenderer.create(screen(false, { q: "status", sort }));
      });
      layOut(1440);
      const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
      let bar = end.parent!;
      while (typeof bar.type !== "string") bar = bar.parent!;
      const inSegments = (node: ReactTestInstance) => {
        for (let parent = node.parent; parent; parent = parent.parent) if (parent.type === WindowSegments) return true;
        return false;
      };
      const labels = bar.findAll((node) => (node.type as unknown) === "Text" && typeof node.children[0] === "string" && !inSegments(node));
      // Every label of the bar is one line: none wraps out of its 28pt button
      // (the done window's fixed segments aside).
      expect(labels.filter((label) => label.props.numberOfLines !== 1).map(textOf)).toEqual([]);
      const sortText = end.findAll((node) => (node.type as unknown) === "Text" && node.props.numberOfLines === 1 && /first|high|low/.test(textOf(node)));
      expect(sortText).toHaveLength(1);
      expect(StyleSheet.flatten(sortText[0]!.props.style)).toMatchObject({ maxWidth: 160, flexShrink: 1 });
      act(() => renderer!.unmount());
      renderer = undefined;
    }
  });

  it("draws the filter bar's buttons as icons alone once their words would wrap them, and gives the words back once they fit", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: 14 } } }));
    });
    layOut(1440);
    const view = (testID: string) => renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === testID);
    const lay = (node: ReactTestInstance, layout: { x?: number; y?: number; width: number }) =>
      act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, height: 28, ...layout } } }));
    const controls = () => view("filter-bar-controls");
    const group = () => hostParentOf(controls())!;
    const words = () => controls().findAll((node) => (node.type as unknown) === "Text").map(textOf);
    expect(words()).toEqual(expect.arrayContaining(["Project", "Workspace", "Agent", "Labels"]));

    // The buttons need 700 of the group's 500: they drop their words, and read them out.
    lay(group(), { width: 500 });
    lay(view("filter-bar-end"), { width: 420 });
    lay(controls(), { width: 700 });
    expect(words()).toEqual([]);
    expect(view("filter-bar-end").findAll((node) => (node.type as unknown) === "Text" && textOf(node) === "Sort")).toHaveLength(0);
    const named = (bar: ReactTestInstance) => bar.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.accessibilityLabel);
    expect(named(controls())).toEqual(["Project", "Workspace", "Agent", "Labels"]);
    expect(named(view("filter-bar-end"))).toContain("Sort");

    // Restoring six labels also restores each chevron and rectangular padding: 6 * (40 + 27) = 402.
    const hidden = view("filter-bar-words");
    expect(hidden.props["aria-hidden"]).toBe(true);
    expect(StyleSheet.flatten(hidden.props.style)).toMatchObject({ position: "absolute", opacity: 0 });
    const dropped = hidden.findAll((node) => (node.type as unknown) === "Text");
    expect(dropped.map(textOf)).toEqual(["Project", "Workspace", "Agent", "Labels", "Sort", expect.any(String)]);
    lay(controls(), { width: 300 });
    lay(view("filter-bar-end"), { width: 300 });
    for (const text of dropped) act(() => text.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 40, height: 18 } } }));
    expect(words()).toEqual([]);
    // Circular buttons retain their geometry while labels wait for enough room.
    for (const button of controls().findAll((node) => (node.type as unknown) === "Pressable")) {
      expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 28, height: 28, borderRadius: 14 });
      expect(button.findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(1);
    }
    lay(group(), { width: 700 });
    expect(words()).toEqual([]);
    // 300 + 402 fits a group of 750 with room to spare: the words come back.
    lay(group(), { width: 750 });
    expect(words()).toEqual(expect.arrayContaining(["Project", "Labels"]));
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-bar-words")).toHaveLength(0);

    // The done window and the sort pushed to a row of their own drop the words too.
    lay(controls(), { width: 660 });
    lay(view("filter-bar-end"), { y: 44, width: 420 });
    expect(words()).toEqual([]);
  });

  it("hides the jump without navigation", () => {
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(TasksBoardScreen, { theme, host: { id: "host-1", label: "Local" }, layout: { compact: false, platform: "web" }, params: {} }),
      );
    });
    layOut(1600);
    expect(cards()[0]!.props.onOpen).toBeUndefined();
  });

  it("says under each lane how many of its cards the filters hide, and which filters are on", () => {
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: { provider: string }[] }> } }).__handle;
    const hiddenIn = (lane: string) => handle.lanes[lane]!.cards.filter((card) => card.provider !== "codex").length;
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    expect(LANE_ORDER.flatMap((lane) => hostsById(`lane-filter-hint-${lane}`))).toHaveLength(0);
    act(() => renderer!.unmount());

    act(() => {
      renderer = TestRenderer.create(screen(false, { agent: "codex", sub: "1" }));
    });
    layOut(1600);
    expect(hiddenIn("needs_input")).toBeGreaterThan(0);
    for (const lane of LANE_ORDER) {
      const hints = hostsById(`lane-filter-hint-${lane}`);
      if (hiddenIn(lane) === 0) {
        expect(hints).toHaveLength(0);
        continue;
      }
      expect(hints).toHaveLength(1);
      expect(textOf(hints[0]!)).toBe(`${hiddenIn(lane)} hidden by filters` + "Agent: Codex \u00b7 Hide subtasks");
    }
    act(() => renderer!.unmount());

    // The phone's lanes say it too.
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => {
      renderer = TestRenderer.create(screen(true, { agent: "codex" }));
    });
    expect(textOf(hostsById("lane-filter-hint-needs_input")[0]!)).toBe(`${hiddenIn("needs_input")} hidden by filtersAgent: Codex · Hide subtasks`);
  });

  it("updates a lane's hidden count when only a filtered-out card changes, drawing no other lane", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { agent: "codex" }));
    });
    layOut(2400);
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: { id: string; provider: string }[] }> } }).__handle;
    const original = handle.lanes;
    const review = original.review!;
    const hint = () => hostsById("lane-filter-hint-review").map((node) => textOf(node));
    const before = review.cards.filter((card) => card.provider !== "codex").length;
    try {
      const extra = { ...review.cards.find((card) => card.provider !== "codex")!, id: "sample-extra-review" };
      handle.lanes = { ...original, review: { ...review, cards: [...review.cards, extra] } };
      const rows = host.rowRenders;
      act(() => renderer!.update(screen(false, { agent: "codex" })));
      expect(hint()).toEqual([`${before + 1} hidden by filtersAgent: Codex`]);
      // Only the review lane drew again, and it shows no more cards than before.
      expect(host.rowRenders - rows).toBe(review.cards.length - before);
    } finally {
      handle.lanes = original;
    }
  });
});

describe("Tasks board, sorting", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });
  const runningOrder = () => cards().filter((card) => card.props.card.lane === "running").map((card) => card.props.card.id);

  it("applies the sort from the params and notes the done lane's loaded pages", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { sort: "title-asc" }));
    });
    layOut(1600);
    // "Measure the sidebar ring" before "Port the status ring": the default order is the other way round.
    expect(runningOrder()).toEqual(["sample-child-1", "sample-running"]);
    const text = textOf(renderer!.root);
    expect(text).toContain("Title A→Z");
    expect(text).toContain("Sorted among the 1 loaded");
    expect(text).not.toContain("Showing 1");
  });

  it("folds several picks of one filter into a chip whose menu removes them one at a time", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { agent: "claude,codex", label: "api", sub: "1", win: "7d" }));
    });
    layOut(1600);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    let bar = end.parent!;
    while (typeof bar.type !== "string") bar = bar.parent!;
    const filters = bar.findAll((node) => (node.type as unknown) === "View" && hostParentOf(node) === bar).find((child) => child !== end)!;
    const text = textOf(filters);
    // A single pick's chip draws its filter's icon, not the word, and reads the word out; a label's is its own solid tag.
    expect(text).toContain("Labels · 1api");
    const kind = filters.find((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel === "Labels");
    expect(kind.findAllByType(TagMark)).toHaveLength(1);
    // The switch and the done window show themselves: no chip, no hint line.
    expect(text).not.toContain("still show");
    expect(text).not.toContain("Hide subtasks");
    expect(text).not.toContain("Show subtasks");
    expect(text).not.toContain("7 days");
    expect(text).toContain("Clear all");

    // The folded chip draws the agent icon and the count; the sentence is read out.
    const chip = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "chip-group-agent");
    expect(chip.props.accessibilityLabel).toBe("2 agents selected");
    expect(textOf(chip)).toBe("2");
    expect(chip.findAll((node) => node.props.name === "Bot")).not.toHaveLength(0);
    act(() => chip.props.onPress());
    const menu = renderer!.root.find((node) => node.props.testID === "chip-group-menu");
    const rows = menu.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
    expect(rows.map(textOf)).toEqual(["Claude", "Codex", "Clear filters"]);
    act(() => rows[0]!.props.onPress());
    expect(lastBoardParams("host-1").providers).toEqual(["codex"]);
    // One left: a plain chip again, and the menu closed with the group.
    expect(renderer!.root.findAll((node) => node.props.testID === "chip-group-menu")).toHaveLength(0);
    expect(textOf(filters)).toContain("apiCodex");
    expect(filters.find((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel === "Agent").findAll((node) => node.props.name === "Bot")).not.toHaveLength(0);
  });

  it("leaves out Clear all while only the switches or the done window are set", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { sub: "1", win: "7d" }));
    });
    layOut(1600);
    expect(textOf(renderer!.root)).not.toContain("Clear all");
  });

  it("picks a sort from the dropdown, keeps it for the session, and counts the done lane plainly by default", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    expect(runningOrder()).toEqual(["sample-running", "sample-child-1"]);
    expect(textOf(renderer!.root)).toContain("Showing 1");
    const pill = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false && textOf(node) === "Sort")[0]!;
    expect(StyleSheet.flatten(pill.props.style)).toMatchObject({ height: NATIVE(28), borderRadius: 6, borderWidth: StyleSheet.hairlineWidth });
    act(() => pill.props.onPress());
    const menu = renderer!.root.find((node) => node.props.testID === "sort-menu");
    const item = (label: string, within: ReactTestInstance = menu) =>
      within.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && textOf(node).startsWith(label))[0]!;
    // A field row opens its submenu on a click; the submenu holds the two directions.
    act(() => item("Title").props.onPress());
    const submenu = menu.find((node) => node.props.testID === "menu-submenu");
    expect(submenu.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem").map(textOf)).toEqual(["A→Z", "Z→A"]);
    act(() => item("Z→A", submenu).props.onPress());
    expect(renderer!.root.findAll((node) => node.props.testID === "sort-menu")).toHaveLength(0);
    // Z to A: "Port the status ring" before "Measure the sidebar ring".
    expect(runningOrder()).toEqual(["sample-running", "sample-child-1"]);
    expect(lastBoardParams("host-1").sort).toEqual({ key: "title", direction: "desc" });
    expect(textOf(renderer!.root)).toContain("Title Z→A");
  });

  it("drills into the sort in the phone's filter sheet", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => {
      renderer = TestRenderer.create(screen(true, { sort: "branch-desc" }));
    });
    act(() => pressable("Filters").props.onPress());
    const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "Modal");
    const rows = (testID: string) =>
      sheet().find((node) => node.props.testID === testID).findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
    const fields = rows("sort-fields");
    expect(fields.map(textOf)).toEqual(["Default order", "Workspace", "Project", "BranchZ→A", "Folder", "Title", "Created", "Updated", "Context", "Duration"]);
    act(() => fields.find((row) => textOf(row) === "Updated")!.props.onPress());
    const directions = rows("sort-directions");
    expect(directions.map(textOf)).toEqual(["BackUpdated", "Newest first", "Oldest first"]);
    // Back returns to the fields without choosing.
    act(() => directions[0]!.props.onPress());
    expect(lastBoardParams("host-1").sort).toEqual({ key: "branch", direction: "desc" });
    act(() => rows("sort-fields").find((row) => textOf(row) === "Updated")!.props.onPress());
    act(() => rows("sort-directions")[1]!.props.onPress());
    expect(lastBoardParams("host-1").sort).toEqual({ key: "updated", direction: "desc" });
  });
});

describe("Tasks board, lane widths", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    // The lanes alone; the sidebar's share is tested with it.
    writeSidebarPreference({ open: false, width: 380 });
  });

  it("fills a wide board without a scrollbar and scrolls a narrow one at the minimum", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "ScrollView" && node.props.horizontal === true)).toHaveLength(0);
    layOut(2000);
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: false, contentContainerStyle: { width: 2000 } });
    layOut(900);
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 300 * 4 } });
  });

  it.each(["web", "ios", "android"])("%s: adapts default lanes on a small tablet and keeps the horizontal board", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const tabs = () => hostsById("phone-stat-running");
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    // A small tablet with the host sidebar open: lanes keep a readable 260 pt, the rest scroll.
    layOut(540);
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 260 * 4 } });
    layOut(480);
    expect(tabs()).toHaveLength(0);
    // No room for the key hints beside the count and the search.
    expect(textOf(renderer!.root)).not.toContain("HLLane");
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 260 * 4 } });
    // Below the two-lane threshold: keep the 260 pt default and scroll.
    layOut(400);
    expect(tabs()).toHaveLength(0);
    expect(cards()[0]!.props.compact).toBe(false);
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 260 * 4 } });
    layOut(1600);
    expect(tabs()).toHaveLength(0);
    expect(textOf(renderer!.root).includes("HLLane")).toBe(os === "web");
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: false, contentContainerStyle: { width: 1600 } });
  });

  it.each(["web", "ios", "android"])("%s: switches a small tablet between three distinct device-local lane widths", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(540);
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    const choices = () => hostsById("filter-sheet-lane-width")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "radio");
    for (const [index, width, value] of [[0, 220, "narrow"], [1, 260, "default"], [2, 300, "wide"], [0, 220, "narrow"]] as const) {
      await act(async () => choices()[index]!.props.onPress());
      expect(lanesScroll().props.contentContainerStyle.width).toBe(48 + 4 * width);
      expect(deviceTasksStore().snapshot().values?.laneWidth).toBe(value);
      expect(host.save).not.toHaveBeenCalled();
    }
  });

  it("switches the lane width from the filter bar, draws it at once and saves it to the settings", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1300);
    const button = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && String(node.props.accessibilityLabel).startsWith("Lanes · "))[0]!;
    expect(textOf(button())).toBe("Default");
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: false, contentContainerStyle: { width: 1300 } });
    act(() => button().props.onPress());
    const menu = renderer!.root.find((node) => node.props.testID === "lane-width-menu");
    const items = menu.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
    expect(items.map(textOf)).toEqual(["Narrow", "Default", "Wide"]);
    expect(textOf(menu)).not.toContain("Lane width");
    await act(async () => items[2]!.props.onPress());
    expect(renderer!.root.findAll((node) => node.props.testID === "lane-width-menu")).toHaveLength(0);
    expect(textOf(button())).toBe("Wide");
    expect(button().props.accessibilityLabel).toBe("Lanes · Wide");
    // 1300 fits four lanes at 300 but not at 340: the row scrolls at the wide width.
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 340 * 4 } });
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ laneWidth: "wide" });
  });

  it("goes back to the saved lane width and says so when the save is refused", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const button = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && String(node.props.accessibilityLabel).startsWith("Lanes · "))[0]!;
    act(() => button().props.onPress());
    const narrow = renderer!.root
      .find((node) => node.props.testID === "lane-width-menu")
      .findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem")[0]!;
    failDeviceWrite();
    await act(async () => narrow.props.onPress());
    expect(textOf(button())).toBe("Default");
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.toast).toHaveBeenCalledWith("Couldn't save the lane width");
  });
});

describe("Tasks board, archived lane switch", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });

  const toggle = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "archived-lane-toggle")[0]!;

  it("shows the archived lane from the toolbar's switch beside the done window, and saves it", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    // The phone's round Archive button: no word, struck through while the lane hides.
    const slashed = () => toggle().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    expect(textOf(toggle())).toBe("");
    expect(toggle().props).toMatchObject({ accessibilityLabel: "Show the archived lane", accessibilityState: { checked: false } });
    expect(slashed()).toBe(true);
    const outline = () => StyleSheet.flatten(toggle().props.style).borderColor;
    const offOutline = outline();
    expect(hostsById("lane-archived")).toHaveLength(0);
    // In the bar's end, after the done window and before the sort.
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    const order = end.findAll((node) => (node.type as unknown) === "Pressable" && (node.props.testID === "archived-lane-toggle" || node.props.accessibilityLabel === "7 days" || textOf(node).includes("Sort")));
    expect(order.map((node) => node.props.testID === "archived-lane-toggle" ? "archived" : textOf(node).includes("Sort") ? "sort" : "window")).toEqual(["window", "archived", "sort"]);
    await act(async () => toggle().props.onPress());
    layOut(2400);
    // Drawn at once, before the record catches up.
    expect(toggle().props.accessibilityState).toEqual({ checked: true });
    expect(slashed()).toBe(false);
    // Only the icon changes: the outline stays.
    expect(outline()).toBe(offOutline);
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true });
  });

  it("goes back and says so when the save is refused", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    failDeviceWrite();
    await act(async () => toggle().props.onPress());
    expect(toggle().props.accessibilityState).toEqual({ checked: false });
    // The optimistic lane leaves through its normal collapse animation after rollback.
    act(() => { vi.advanceTimersByTime(300); });
    expect(hostsById("lane-archived")).toHaveLength(0);
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.toast).toHaveBeenCalledWith("Couldn't save the archived lane setting");
  });
});

describe("Tasks board, toolbar tips", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });

  const tips = () =>
    renderer!.root.findAll((node) => typeof node.type === "string" && node.props.dataSet?.bctip !== undefined).map((node) => node.props.dataSet.bctip as string);

  it("names every control of the two bars, and says what a switch would do", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    expect(tips()).toEqual(
      expect.arrayContaining([
        "Search titles (/)",
        "Filter by project",
        "Filter by workspace",
        "Filter by agent",
        "Filter by label",
        "Hide subtasks",
        "How far back Done and Archived reach",
        "Show the archived lane",
        "Hide groups with no active tasks",
        "Order the cards in each lane",
        "Lane width",
      ]),
    );
    const toggle = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "archived-lane-toggle")[0]!;
    await act(async () => toggle.props.onPress());
    expect(tips()).toContain("Hide the archived lane");
    expect(tips()).not.toContain("Show the archived lane");
    const subtasks = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "subtasks-toggle")[0]!;
    act(() => subtasks.props.onPress());
    expect(tips()).toContain("Show subtasks");
    expect(tips()).not.toContain("Hide subtasks");
    // An open menu covers its button's tip.
    const project = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.dataSet?.bctip === "Filter by project");
    act(() => project.props.onPress());
    expect(tips()).not.toContain("Filter by project");
  });

  it("leads an icon-only button's tip with the words it dropped", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { agent: "claude" }));
    });
    layOut(1440);
    const view = (testID: string) => renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === testID);
    const lay = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, height: 28, width } } }));
    expect(tips()).toContain("Filter by agent");
    lay(hostParentOf(view("filter-bar-controls"))!, 500);
    lay(view("filter-bar-end"), 420);
    lay(view("filter-bar-controls"), 700);
    expect(tips()).toEqual(
      expect.arrayContaining([
        "Agent · 1\nFilter by agent",
        "Project\nFilter by project",
        "Sort\nOrder the cards in each lane",
        "Lanes · Default",
      ]),
    );
  });

  it("shows a tip under the control a pointer rests on, over the lanes, and drops it on a press", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (event: unknown) => void>();
    const root = {
      clientLeft: 0,
      clientTop: 0,
      clientWidth: 1600,
      clientHeight: 900,
      getBoundingClientRect: () => ({ left: 200, top: 40, width: 1600, height: 900 }),
      contains: () => true,
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const mark = (text: string, box: { left: number; top: number; width: number; height: number }) => {
      const element = { isConnected: true, getAttribute: (name: string) => (name === "data-bctip" ? text : null), getBoundingClientRect: () => box, closest: () => element };
      return element;
    };
    act(() => {
      renderer = TestRenderer.create(screen(false), {
        createNodeMock: (element: React.ReactElement) => ((element.props as { collapsable?: boolean }).collapsable === false ? root : null),
      });
    });
    layOut(1600);
    const tip = () => hostsById("board-tip");
    act(() => listeners.get("pointerover")!({ pointerType: "mouse", target: mark("Lane width", { left: 1700, top: 100, width: 80, height: 28 }) }));
    act(() => { vi.advanceTimersByTime(399); });
    expect(tip()).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(textOf(tip()[0]!)).toBe("Lane width");
    // Below the button, ending at its right edge: the bar's right end keeps it on the board.
    expect(StyleSheet.flatten(tip()[0]!.props.style)).toMatchObject({ top: 92, right: 20, zIndex: 40 });
    act(() => listeners.get("pointerdown")!({}));
    expect(tip()).toHaveLength(0);
    // A card's marks are not the toolbar's.
    act(() => listeners.get("pointerover")!({ pointerType: "mouse", target: { closest: () => null } }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(tip()).toHaveLength(0);
  });
});

describe("Tasks board, tablet filters", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
  });

  it.each([
    ["ios", 800, "en", 14],
    ["ios", 1200, "zh", 21],
    ["android", 800, "zh", 14],
    ["android", 1200, "en", 21],
  ] as const)("%s at %i pt keeps four icon-only %s filters at UI base %i", (os, width, language, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    act(() => {
      renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } }));
    });
    layOut(width);
    const strings = BOARD_STRINGS[language];
    const controls = () => hostsById("filter-bar-controls")[0]!;
    const buttons = () => controls().findAll((node) => (node.type as unknown) === "Pressable");
    const end = () => hostsById("filter-bar-end")[0]!;
    expect(controls().findAll((node) => (node.type as unknown) === "Text")).toHaveLength(0);
    expect(buttons().map((node) => node.props.accessibilityLabel)).toEqual([strings.project, strings.workspace, strings.agent, strings.labels]);
    expect(buttons().map((node) => node.findAll((child) => (child.type as unknown) === "Icon").map((icon) => icon.props.name))).toEqual([["FolderKanban"], ["FolderGit2"], ["Bot"], ["Tag"]]);
    const height = Math.round(36 * Math.max(1, base / 14));
    for (const button of buttons()) expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: height, height, borderRadius: height / 2, borderColor: "#e2e2e6" });
    expect(StyleSheet.flatten(end().props.style).height).toBe(height);
    expect(end().findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "switch").map((node) => node.props.testID)).toEqual(os === "ios" ? [] : ["archived-lane-toggle"]);
    expect(renderer!.root.findAllByType(WindowSegments)).toHaveLength(0);
    expect(hostsById("filter-bar-more")).toHaveLength(1);
    expect(end().findAll((node) => (node.type as unknown) === "Text").map(textOf)).not.toContain(strings.sort);
    expect(end().findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.accessibilityLabel)).toContain(strings.sort);
    // Wider previews and large UI text never restore labels or chevrons to tablet buttons.
    layOut(1600);
    expect(controls().findAll((node) => (node.type as unknown) === "Text")).toHaveLength(0);
    expect(hostsById("filter-bar-words")).toHaveLength(0);
  });

  it.each(["ios", "android"])("%s exposes working project, workspace, agent and label menus from the icon buttons", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1000);
    const button = (index: number) => hostsById("filter-bar-controls")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button")[index]!;
    const option = (text: string) => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && textOf(node).includes(text));
    act(() => button(0).props.onPress());
    expect(hostsById("menu-search")).toHaveLength(1);
    act(() => option("better-paseo").props.onPress());
    expect(lastBoardParams("host-1").workspaceIds).toEqual(["wks_sample"]);
    expect(button(0).props.accessibilityLabel).toBe("Project · 1");
    act(() => button(1).props.onPress());
    expect(hostsById("menu-search")).toHaveLength(1);
    act(() => option("tasks-board").props.onPress());
    expect(lastBoardParams("host-1").workspaceIds).toEqual([]);
    act(() => button(2).props.onPress());
    act(() => option("Codex").props.onPress());
    expect(lastBoardParams("host-1").providers).toEqual(["codex"]);
    expect(button(2).props.accessibilityLabel).toBe("Agent · 1");
    act(() => button(3).props.onPress());
    act(() => option("frontend").props.onPress());
    expect(lastBoardParams("host-1").labels).toEqual(["frontend"]);
    expect(button(3).props.accessibilityLabel).toBe("Labels · 1");
    act(() => button(3).props.onPress());
    const clear = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && textOf(node) === "Clear all");
    expect(StyleSheet.flatten(clear.find((node) => (node.type as unknown) === "Text").props.style).fontSize).toBe(NATIVE(14));
    act(() => clear.props.onPress());
    expect(lastBoardParams("host-1")).toMatchObject({ providers: [], labels: [], workspaceIds: [] });
  });

  it.each([800, 1200])("iPad at %i pt keeps secondary choices in a working filter panel", async (width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    act(() => hostsById("filter-bar-more")[0]!.props.onPress());
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(1);
    expect(hostsById("filter-sheet-empty-groups")).toHaveLength(1);
    const sheet = hostsById("filter-sheet-scroll")[0]!;
    const choice = (value: string) => sheet.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "checkbox" && textOf(node).startsWith(value));
    act(() => choice("Codex").props.onPress());
    act(() => choice("frontend").props.onPress());
    expect(lastBoardParams("host-1")).toMatchObject({ providers: ["codex"], labels: ["frontend"] });
    await act(async () => hostsById("filter-sheet-subtasks")[0]!.props.onPress());
    expect(hostsById("toolbar-archived")[0]!.props.accessibilityState).toEqual({ selected: false });
    await act(async () => hostsById("toolbar-archived")[0]!.props.onPress());
    expect(hostsById("filter-sheet-archived")[0]!.props.accessibilityState).toEqual({ checked: true });
    await act(async () => hostsById("filter-sheet-archived")[0]!.props.onPress());
    expect(hostsById("toolbar-archived")[0]!.props.accessibilityState).toEqual({ selected: false });
    await act(async () => hostsById("filter-sheet-archived")[0]!.props.onPress());
    expect(deviceTasksStore().snapshot().values).toMatchObject({ hideSubtasks: true, showArchived: true });
    act(() => renderer!.root.findByType(WindowSegments).props.onChange("7d"));
    expect(lastBoardParams("host-1").doneWindow).toBe("7d");
    const widths = hostsById("filter-sheet-lane-width")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "radio");
    await act(async () => widths[2]!.props.onPress());
    expect(deviceTasksStore().snapshot().values).toMatchObject({ laneWidth: "wide" });
    // Changed panel filters stay visible on the toolbar and survive closing the panel.
    expect(textOf(hostsById("filter-bar-more")[0]!)).toBe("4");
    const done = hostsById("filter-sheet-footer")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && /^Show \d+ tasks?$/.test(textOf(node)))[0]!;
    act(() => done.props.onPress());
    expect(hostsById("filter-sheet-scroll")).toHaveLength(0);
    expect(textOf(hostParentOf(hostsById("filter-bar-controls")[0]!)!)).toContain("frontend");
    expect(lastBoardParams("host-1")).toMatchObject({ providers: ["codex"], labels: ["frontend"], doneWindow: "7d" });
  });

  it("sets lane names and card titles a step under the desktop's, at the meta row's size", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const font = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style).fontSize;
    const title = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "task-card-title")[0]!;
    const meta = renderer!.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "task-card-meta-location")[0]!;
    const lane = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "lane-header-running");
    expect(font(title)).toBe(font(meta));
    expect(font(lane.findAll((node) => (node.type as unknown) === "Text")[0]!)).toBe(font(meta));
    expect(StyleSheet.flatten(title.props.style).lineHeight).toBeGreaterThan(StyleSheet.flatten(meta.props.style).lineHeight);
  });

  it("folds a narrow board's header into one row, its filters, sort and lane width behind one button", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(600);
    // No filter bar: Workspace, Agent and the sort live in the sheet behind the header's button.
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-bar-end")).toHaveLength(0);
    const button = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "toolbar-filters");
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(0);
    act(() => button().props.onPress());
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(1);
    expect(hostsById("filter-sheet-sort").length).toBeGreaterThan(0);
    // A wide board keeps its filter bar and no button.
    layOut(1600);
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-bar-end").length).toBeGreaterThan(0);
    expect(renderer!.root.findAll((node) => node.props.testID === "toolbar-filters")).toHaveLength(0);
  });

  it("draws the bar's done window as three marks, 24h, 7d and infinity, their names read out", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    const radios = () => end.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "radio");
    expect(radios().map((node) => node.props.accessibilityLabel)).toEqual(["24h", "7 days", "All"]);
    // Each its count and a smaller unit, infinity for all; the words are left to the label.
    expect(radios().map((node) => node.findAll((child) => child.props.testID === "window-mark").length > 0)).toEqual([true, true, true]);
    expect(radios().map(textOf)).toEqual(["24h", "7d", "\u221e"]);
    // Each its own name as its hover tip, inside the control's.
    expect(radios().map((node) => node.props.dataSet?.bctip)).toEqual(["24h", "7 days", "All"]);
    act(() => radios()[2]!.props.onPress());
    expect(radios().map((node) => node.props.accessibilityState.selected)).toEqual([false, false, true]);
    expect(lastBoardParams("host-1").doneWindow).toBe("all");
  });

  it("lists the sidebar's groups with no active task until the bar's switch hides them, and saves it", async () => {
    const handle = (data as unknown as { __handle: { providers: object[] } }).__handle;
    const saved = handle.providers;
    handle.providers = [...saved, { id: "pi", label: "Pi" }];
    try {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
      act(() => {
        renderer = TestRenderer.create(screen(false));
      });
      layOut(2400);
      const toggle = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "empty-groups-toggle");
      const icon = () => toggle().find((node) => (node.type as unknown) === "Icon").props.name;
      const groups = () => renderer!.root.findByProps({ testID: "sidebar-groups" });
      const rows = () => groups().findAll((node) => node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function").map((node) => node.props.accessibilityLabel);
      expect(toggle().props).toMatchObject({ accessibilityLabel: "Show groups with no active tasks", accessibilityState: { checked: true } });
      expect(icon()).toBe("List");
      // After the subtasks' and the archived lane's switches, in the bar's end.
      const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
      expect(end.findAll((node) => (node.type as unknown) === "Pressable" && /-toggle$/.test(node.props.testID ?? "")).map((node) => node.props.testID)).toEqual(["subtasks-toggle", "archived-lane-toggle", "empty-groups-toggle"]);
      // Busy first, the empty ones after them.
      expect(rows().at(-1)).toBe("Pi 0");
      await act(async () => toggle().props.onPress());
      expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: false });
      expect(toggle().props.accessibilityState).toEqual({ checked: false });
      expect(icon()).toBe("ListFilter");
      expect(rows()).not.toContain("Pi 0");
      expect(rows().length).toBeGreaterThan(0);
    } finally {
      handle.providers = saved;
    }
  });

  it.each([["ios", 480], ["ios", 600], ["android", 600], ["web", 600]] as const)("%s at %i pt keeps empty groups in the filter sheet and saves the switch", async (os, width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(width);
    const buttons = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && /^toolbar-/.test(node.props.testID ?? ""));
    expect(buttons.map((node) => node.props.testID)).toEqual(["toolbar-archived", "toolbar-filters"]);
    expect(hostsById("toolbar-empty-groups")).toHaveLength(0);
    expect(hostsById("filter-sheet-empty-groups")).toHaveLength(0);
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    const button = () => hostsById("filter-sheet-empty-groups")[0]!;
    expect(button().props).toMatchObject({ accessibilityRole: "switch", accessibilityState: { checked: true } });
    await act(async () => button().props.onPress());
    expect(button().props.accessibilityState).toEqual({ checked: false });
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: false });
    expect(hostsById("toolbar-empty-groups")).toHaveLength(0);
    // Native keeps the open panel and its value while resizing; web restores the bar switch.
    layOut(1600);
    const target = os === "web" ? "empty-groups-toggle" : "filter-sheet-empty-groups";
    expect(hostsById(target)[0]!.props.accessibilityState).toEqual({ checked: false });
  });

  it.each([["web", 600], ["ios", 600], ["ios", 800], ["ios", 1200]] as const)("%s at %i pt keeps the archived lane's icon button in the toolbar", async (os, width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(width);
    const archived = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "toolbar-archived");
    const buttons = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && (node.props.testID === "toolbar-archived" || node.props.testID === "toolbar-filters"));
    expect(buttons.map((node) => node.props.testID)).toEqual(width === 600 ? ["toolbar-archived", "toolbar-filters"] : ["toolbar-archived"]);
    expect(textOf(archived())).toBe("");
    expect(archived().find((node) => (node.type as unknown) === "Icon").props.name).toBe("Archive");
    expect(hostsById("archived-lane-toggle")).toHaveLength(0);
    // The same size as the sidebar switch they sit beside.
    const size = (testID: string) => StyleSheet.flatten(renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === testID).props.style).width;
    expect(size("toolbar-archived")).toBe(size("sidebar-switch"));
    if (width === 600) expect(size("toolbar-filters")).toBe(size("sidebar-switch"));
    expect(archived().props).toMatchObject({ accessibilityLabel: "Show the archived lane", accessibilityState: { selected: false } });
    // Struck through while off.
    const slashed = () => archived().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    expect(slashed()).toBe(true);
    expect(hostsById("lane-archived")).toHaveLength(0);
    await act(async () => archived().props.onPress());
    layOut(width);
    expect(archived().props.accessibilityState).toEqual({ selected: true });
    expect(slashed()).toBe(false);
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true });
    act(() => hostsById(width === 600 ? "toolbar-filters" : "filter-bar-more")[0]!.props.onPress());
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(1);
    if (os === "web") expect(renderer!.root.findAll((node) => node.props.testID === "filter-sheet-archived")).toHaveLength(0);
    // iPad keeps the toolbar button when resized; web restores its filter-bar switch.
    layOut(1600);
    expect(hostsById("toolbar-archived")).toHaveLength(os === "ios" ? 1 : 0);
  });

  it("web keeps the subtasks switch on the bar and strikes its icon through while off", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(800);
    const toggle = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "subtasks-toggle");
    const slashed = () => toggle().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    const look = () => toggle().props.style as { borderColor: string; backgroundColor: string };
    expect(textOf(renderer!.root)).not.toContain("Open tabs only");
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-bar-more")).toHaveLength(0);
    // Every switch on the bar is a round one by the done window.
    const barSwitches = new Set(["subtasks-toggle", "archived-lane-toggle", "empty-groups-toggle"]);
    const switches = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "switch");
    expect(switches.filter((node) => !barSwitches.has(node.props.testID))).toHaveLength(0);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    expect(end.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "subtasks-toggle")).toHaveLength(1);
    expect(toggle().props).toMatchObject({ accessibilityLabel: "Show subtasks", accessibilityState: { checked: true } });
    expect(slashed()).toBe(false);
    const on = { ...look() };
    act(() => toggle().props.onPress());
    expect(lastBoardParams("host-1")).toMatchObject({ hideSubtasks: null });
    expect(deviceTasksStore().snapshot().values?.hideSubtasks).toBe(true);
    expect(toggle().props.accessibilityState).toEqual({ checked: false });
    expect(slashed()).toBe(true);
    // Off only strikes the icon through: the outline and fill stay.
    expect(look()).toMatchObject(on);
  });
});

describe("Tasks board, host theme", () => {
  const status = { statusSuccess: "#3f8f4f", statusWarning: "#b7791f", statusDanger: "#c53030" };
  const SEPIA_LIGHT = { surface0: "#fbf6ec", surface1: "#f5eedf", surface2: "#ede3cf", border: "#e2d6bf", foreground: "#3b2f20", foregroundMuted: "#7a6a55", accent: "#a0522d", accentForeground: "#fffaf0", ...status };
  const BLUE_DARK = { surface0: "#0f1729", surface1: "#16203a", surface2: "#1e2a48", border: "#25324f", foreground: "#e6ecff", foregroundMuted: "#93a0c4", accent: "#5b8cff", accentForeground: "#0f1729", ...status };

  it.each([
    ["sepia light", SEPIA_LIGHT, "#f1e9d7"],
    ["blue dark", BLUE_DARK, "#16203a"],
  ] as const)("draws the desktop board in a %s theme's colours, lines a hairline", (_name, colors, panel) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false, {}, { colors }));
    });
    layOut(1600);
    const style = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) as Record<string, unknown>;
    const views = renderer!.root.findAll((node) => (node.type as unknown) === "View");
    expect(style(views[0]!).backgroundColor).toBe(colors.surface0);
    const panels = views.filter((node) => style(node).backgroundColor === panel);
    expect(panels).toHaveLength(4);
    for (const lane of panels) {
      expect(style(lane)).toMatchObject({ borderRadius: 5 });
      expect(style(lane).borderWidth).toBeUndefined();
      expect(style(lane).boxShadow).toBeUndefined();
    }
    const pill = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false)[0]!;
    expect(style(pill)).toMatchObject({ height: NATIVE(28), borderRadius: 6, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth });
  });

  it("draws the phone board on the theme's panel with a hairline under the tabs", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true, {}, { colors: BLUE_DARK }));
    });
    const style = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) as Record<string, unknown>;
    const views = renderer!.root.findAll((node) => (node.type as unknown) === "View");
    expect(views.some((node) => style(node).backgroundColor === "#16203a")).toBe(true);
    // The status strip is the one row drawn above the lane content (zIndex 5), on the panel's track.
    const tabs = views.find((node) => style(node).zIndex === 5)!;
    expect(style(tabs)).toMatchObject({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BLUE_DARK.border, backgroundColor: "#16203a" });
  });
});

describe("Tasks filter brand marks", () => {
  it("draws the agent menu's marks as the cards do", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const agentPill = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false && textOf(node) === "Agent")[0]!;
    act(() => agentPill.props.onPress());
    // The menu's rows; the cards draw their own marks elsewhere.
    const rows = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
    const marks = rows.flatMap((row) => row.findAllByType(BrandMark));
    expect(marks.map((mark) => [mark.props.provider, mark.props.size])).toEqual([
      ["claude", 16],
      ["codex", 16],
    ]);
  });

  it("draws Pi in its three colours and monochrome marks in the theme foreground", () => {
    const colors = { ...(theme as unknown as { colors: Record<string, string> }).colors, foreground: "#3b2f20" };
    const tokens = taskTokens({ colors } as never);
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(View, null, ...["pi", "grok", "cursor", "claude"].map((provider) => React.createElement(BrandMark, { key: provider, provider, size: 16, tokens }))),
      );
    });
    expect(renderer!.root.findAllByType(PiMark)).toHaveLength(1);
    expect(renderer!.root.findAllByType(ProviderLogo).map((logo) => [logo.props.provider, logo.props.color])).toEqual([
      ["grok", "#3b2f20"],
      ["cursor", "#3b2f20"],
      ["claude", undefined],
    ]);
  });
});

describe("Tasks board, project icons", () => {
  const requestProjectIcon = () => (data as unknown as { __handle: { requestProjectIcon: ReturnType<typeof vi.fn> } }).__handle.requestProjectIcon;

  it("asks for the icons of rendered cards on desktop when the field is on", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    expect(requestProjectIcon()).toHaveBeenCalledWith("prj_sample");
    expect(cards()[0]!.props).toMatchObject({ language: "en", animated: true, hostId: "host-1" });
  });

  it("never asks on a phone or with the field off", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => renderer!.unmount());
    host.settings = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, projectIcon: false } };
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    expect(requestProjectIcon()).not.toHaveBeenCalled();
  });

  it("asks for the icons of the projects the project and workspace menus list", () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, projectIcon: false } };
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const pill = (label: string) => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded !== undefined && textOf(node) === label)[0]!;
    for (const label of ["Project", "Workspace"]) {
      requestProjectIcon().mockClear();
      act(() => pill(label).props.onPress());
      expect(requestProjectIcon()).toHaveBeenCalledWith("prj_sample");
      act(() => pill(label).props.onPress());
    }
  });
});

/** Every Text that shows a card's timer, by card id. */
function timerTexts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const card of cards()) {
    const [footer] = card.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "task-card-footer");
    const [timer] = footer ? footer.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "task-card-timer") : [];
    const [label] = timer ? timer.findAll((node) => (node.type as unknown) === "Text") : [];
    if (label) out[card.props.card.id as string] = textOf(label);
  }
  return out;
}

describe("Tasks board, the 1 s clock", () => {
  beforeEach(() => {
    vi.setSystemTime(Date.parse("2026-10-20T12:00:00Z"));
  });

  it.each([
    ["desktop", false],
    ["phone", true],
  ] as const)("ticks the timer texts without drawing the %s lane rows again", (_name, compact) => {
    if (!compact) (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(compact));
    });
    if (compact) act(() => pressable("Running 2").props.onPress());
    else layOut(1600);
    const before = timerTexts();
    expect(before["sample-running"]).toBe("12m 30s");
    const rows = host.rowRenders;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(timerTexts()["sample-running"]).toBe("12m 31s");
    expect(host.rowRenders).toBe(rows);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(timerTexts()["sample-running"]).toBe("12m 36s");
    expect(host.rowRenders).toBe(rows);
    // Waits and "ago" texts move by the minute, so six seconds leave them as they were.
    const after = timerTexts();
    for (const id of Object.keys(before)) if (id !== "sample-running" && id !== "sample-child-1") expect(after[id]).toBe(before[id]);
  });
});

describe("Tasks board, phone", () => {
  it.each([true, false])("keeps expanded subtasks through refresh, animation copies and lane remounts (compact=%s)", (compact) => {
    if (!compact) (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: import("../../client/tasks/model").TaskCard[] }> } }).__handle;
    const original = handle.lanes;
    let copy: ReturnType<typeof TestRenderer.create> | undefined;
    const card = () => hostsById("task-card-sample-running")[0]!;
    const toggle = () => card().find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "pill-subtasks");
    const refresh = () => {
      act(() => renderer!.update(screen(compact)));
      if (!compact) layOut(1600);
    };
    try {
      act(() => { renderer = TestRenderer.create(screen(compact)); });
      if (compact) act(() => pressable("Running 2").props.onPress());
      else layOut(1600);
      act(() => toggle().props.onPress());
      expect(card().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-subtasks")).toHaveLength(1);
      const mountedCard = card();
      const motion = renderer!.root.findByType(LaneMotionLayer).props.store;
      const parent = original.running!.cards.find((card) => card.id === "sample-running")!;
      let updated = { ...parent, children: [...parent.children.map((child, i) => i === 0 ? { ...child, title: "Updated child title", status: "done" as const } : child), { id: "added-child", title: "New child", status: "running" as const }] };
      handle.lanes = { ...original, running: { ...original.running!, cards: original.running!.cards.map((card) => card.id === parent.id ? updated : card) } };
      refresh();
      // Content-only refreshes keep the real card mounted and never hide its lane under copies.
      expect(card()).toBe(mountedCard);
      expect(motion.covered().size).toBe(0);
      expect(motion.ghosts()).toHaveLength(0);
      expect(textOf(card())).toContain("Updated child title");
      expect(textOf(card())).toContain("New child");
      expect(toggle().props.accessibilityState.expanded).toBe(true);
      // Native lane motion hides the real lane under newly mounted copies.
      const cell = renderer!.root.findAllByType(CardCell).find((node) => node.props.card.id === parent.id)!;
      act(() => { copy = TestRenderer.create(React.createElement(CardCell, { ...(cell.props as React.ComponentProps<typeof CardCell>), copy: true, fresh: false })); });
      expect(copy!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-subtasks")).toHaveLength(1);
      act(() => copy!.unmount());
      copy = undefined;
      updated = { ...updated, children: updated.children.slice(0, -1) };
      handle.lanes = { ...handle.lanes, running: { ...original.running!, cards: original.running!.cards.map((card) => card.id === parent.id ? updated : card).reverse() } };
      refresh();
      expect(toggle().props.accessibilityState.expanded).toBe(true);
      expect(textOf(card())).not.toContain("New child");
      // A parent following its children's status moves between different lane lists.
      handle.lanes = {
        ...handle.lanes,
        running: { ...original.running!, cards: original.running!.cards.filter((card) => card.id !== parent.id) },
        review: { ...original.review!, cards: [...original.review!.cards, { ...updated, lane: "review", status: "unread" }] },
      };
      refresh();
      handle.lanes = { ...original, running: { ...original.running!, cards: original.running!.cards.map((card) => card.id === parent.id ? updated : card) } };
      refresh();
      expect(toggle().props.accessibilityState.expanded).toBe(true);
      expect(textOf(card())).toContain("Updated child title");
      act(() => toggle().props.onPress());
      refresh();
      expect(card().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-subtasks")).toHaveLength(0);
    } finally {
      if (copy) act(() => copy!.unmount());
      handle.lanes = original;
    }
  });

  it("opens on needs-input, switches lanes by tab and remembers the pick", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(laneCards("needs_input")).toEqual(["sample-input"]);
    expect(renderer!.root.findByProps({ testID: "phone-lane-needs_input" }).findAllByType(TaskCardView)[0]!.props.compact).toBe(true);
    expect(cards()[0]!.props.hostId).toBe("host-1");
    act(() => pressable("Running 2").props.onPress());
    expect(laneCards("running")).toEqual(["sample-running", "sample-child-1"]);
    expect(pressable("Running 2").props.accessibilityState).toEqual({ selected: true });
    act(() => renderer!.unmount());
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(pressable("Running 2").props.accessibilityState).toEqual({ selected: true });
  });

  it("on iOS and Android pages the lanes natively, mounting the lane shown and its neighbours", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    const pager = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "phone-lane-pager");
    expect(pager().props).toMatchObject({ horizontal: true, pagingEnabled: true, scrollEnabled: true });
    act(() => pager().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } }));
    const mounted = () => ["needs_input", "running", "review", "done"].filter((id) => renderer!.root.findByProps({ testID: `phone-lane-${id}` }).findAll((node) => (node.type as unknown) === "FlatList").length > 0);
    expect(mounted()).toEqual(["needs_input", "running"]);
    // A swipe that comes to rest two pages on picks Review.
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 780, y: 0 } } }));
    expect(pressable("Review 2").props.accessibilityState).toEqual({ selected: true });
    expect(mounted()).toEqual(["running", "review", "done"]);
    // A release right on a page has no momentum; it settles too. Off a page it waits.
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 500, y: 0 } } }));
    expect(pressable("Review 2").props.accessibilityState).toEqual({ selected: true });
    act(() => pager().props.onScrollEndDrag({ nativeEvent: { contentOffset: { x: 390, y: 0 } } }));
    expect(pressable("Running 2").props.accessibilityState).toEqual({ selected: true });
  });

  it("swallows a card tap right after the pager moved", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    const pager = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "phone-lane-pager");
    act(() => pager.props.onScrollBeginDrag());
    const card = renderer!.root.findByProps({ testID: "phone-lane-needs_input" }).findAllByType(TaskCardView)[0]!;
    act(() => card.props.onOpen?.(card.props.card.id));
    expect(openAgent).not.toHaveBeenCalled();
  });

  it("uses the minimal card when mobile.compactCards is on", () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(cards()[0]!.props.fields.branch).toBe(false);
  });

  it("shows the filter badge and the filter sheet", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true, { agent: "claude,codex", sub: "1" }));
    });
    const filters = pressable("Filters");
    expect(textOf(filters)).toBe("3");
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
    act(() => filters.props.onPress());
    const sheet = renderer!.root.find((node) => (node.type as unknown) === "Modal");
    expect(sheet.props.title).toBe("Filters");
    expect(textOf(sheet)).toContain("When off, running, waiting and failed subtasks still show");
    expect(textOf(sheet)).not.toContain("Open tabs only");
  });

  it("shows an empty lane with a way out of the filters", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true, { q: "nothing matches" }));
    });
    const text = textOf(renderer!.root);
    expect(text).toContain("No agents running");
    expect(text).toContain("Clear filters");
  });

  it("switches lanes from the status strip, the shown lane raised as a card", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    const cell = (label: string) => pressable(label);
    expect(textOf(cell("Needs input 1"))).toMatch(/Input\s*1/);
    expect(cell("Needs input 1").props.accessibilityState).toEqual({ selected: true });
    act(() => cell("Running 2").props.onPress());
    expect(cell("Running 2").props.accessibilityState).toEqual({ selected: true });
    expect(cell("Needs input 1").props.accessibilityState).toEqual({ selected: false });
    expect(StyleSheet.flatten(cell("Running 2").props.style)).toMatchObject({ borderRadius: 8, minHeight: 36 });
  });

  it("says when a non-default sort is on, and opens the filters from it", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "phone-sort-hint")).toHaveLength(0);
    act(() => renderer!.unmount());
    act(() => {
      renderer = TestRenderer.create(screen(true, { sort: "branch-desc" }));
    });
    const hint = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "phone-sort-hint");
    expect(textOf(hint)).toBe("Branch Z→A");
    act(() => hint.props.onPress());
    expect(renderer!.root.find((node) => (node.type as unknown) === "Modal").props.title).toBe("Filters");
  });

  it("pins the filter sheet's button under its scrolling options, and keeps the sort's height when drilling in", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => pressable("Filters").props.onPress());
    const sheet = renderer!.root.find((node) => (node.type as unknown) === "Modal");
    const scroll = sheet.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
    const footer = sheet.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-footer");
    expect(scroll.findAll((node) => node === footer)).toHaveLength(0);
    expect(textOf(footer)).toMatch(/^ResetShow \d+ tasks?$/);
    const fields = sheet.find((node) => (node.type as unknown) === "View" && node.props.testID === "sort-fields");
    act(() => fields.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 512 } } }));
    const branch = fields.find((node) => (node.type as unknown) === "Pressable" && textOf(node).startsWith("Branch"));
    act(() => branch.props.onPress());
    const directions = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "sort-directions");
    expect(StyleSheet.flatten(directions.props.style).minHeight).toBe(512);
  });

  it("says the board's messages at its bottom, not in the host's toast over the header, and lets them go", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true, { agent: "claude" }));
    });
    act(() => pressable("Running 1").props.onPress());
    const child = cards().find((card) => card.props.card.id === "sample-child-1")!;
    act(() => child.props.onReveal("sample-running"));
    expect(host.toast).not.toHaveBeenCalled();
    const notice = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "phone-board-notice");
    expect(notice()).toHaveLength(1);
    expect(textOf(notice()[0]!)).toBe("Hidden by the current filters");
    expect(StyleSheet.flatten(hostParentOf(notice()[0]!)!.props.style)).toMatchObject({ position: "absolute", bottom: 16 });
    act(() => {
      vi.advanceTimersByTime(NOTICE_MS);
    });
    expect(notice()).toHaveLength(0);
    act(() => child.props.onReveal("sample-running"));
    act(() => notice()[0]!.props.onPress());
    expect(notice()).toHaveLength(0);
  });

  it("shows the archived lane's tab from the header's round button left of the filters, and saves it", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(renderer!.root.findAll((node) => node.props.testID === "phone-stat-archived")).toHaveLength(0);
    const button = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "phone-archived");
    const labels = hostParentOf(button())!.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Search", "Show the archived lane", "Filters"]);
    const slashed = () => button().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    expect(button().props.accessibilityState).toEqual({ selected: false });
    expect(slashed()).toBe(true);
    const outline = () => StyleSheet.flatten(button().findAll((node) => (node.type as unknown) === "View")[0]!.props.style).borderColor;
    const offOutline = outline();
    await act(async () => button().props.onPress());
    expect(button().props.accessibilityState).toEqual({ selected: true });
    expect(slashed()).toBe(false);
    expect(outline()).toBe(offOutline);
    // The filter sheet no longer carries the switch.
    act(() => pressable("Filters").props.onPress());
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-sheet-archived")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "phone-stat-archived")).toHaveLength(1);
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true });
  });

  it("opens the filter sheet with the sort first from the header's sort pill, and with the switches first from the filters button", () => {
    const order = () => {
      const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      const text = textOf(scroll);
      return { sort: text.indexOf("Sort"), switches: text.indexOf("Show subtasks"), workspace: text.indexOf("Workspace") };
    };
    act(() => {
      renderer = TestRenderer.create(screen(true, { sort: "branch-desc" }));
    });
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "phone-sort-hint").props.onPress());
    expect(order().sort).toBeGreaterThanOrEqual(0);
    expect(order().sort).toBeLessThan(order().switches);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-sort")).toHaveLength(1);
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Modal").props.onOpenChange?.(false));
    act(() => pressable("Filters").props.onPress());
    expect(order().switches).toBeLessThan(order().sort);
    expect(order().sort).toBeLessThan(order().workspace);
  });

  it("draws the filter sheet's on/off filters as switches, not ticks", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => pressable("Filters").props.onPress());
    const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
    const switches = () => scroll.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "switch");
    expect(switches().map((node) => textOf(node).startsWith("Show subtasks"))).toEqual([true, false]);
    expect(switches().map((node) => node.props.accessibilityState)).toEqual([{ checked: true }, { checked: true }]);
    act(() => switches()[0]!.props.onPress());
    expect(switches()[0]!.props.accessibilityState).toEqual({ checked: false });
    expect(switches().flatMap((node) => node.findAll((child) => (child.type as unknown) === "Icon" && child.props.name === "Check"))).toHaveLength(0);
  });

  it("leads the filter sheet with the short filters, the workspaces last, Reset by its button", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => pressable("Filters").props.onPress());
    const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
    const text = textOf(scroll);
    const at = (label: string) => text.indexOf(label);
    expect(at("Show subtasks")).toBe(0);
    expect(at("Agent")).toBeLessThan(at("Labels"));
    expect(at("Labels")).toBeLessThan(at("Sort"));
    expect(at("Sort")).toBeLessThan(at("Workspace"));
    // Reset sits by the sheet's button, not on a row of its own over the options.
    expect(scroll.findAll((node) => (node.type as unknown) === "Pressable" && textOf(node) === "Reset")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-reset")).toHaveLength(1);
  });

  it("searches the filter sheet's workspaces by project and workspace name, and holds the field at the top while searching", () => {
    const handle = (data as unknown as { __handle: { workspaces: object[] } }).__handle;
    const saved = handle.workspaces;
    handle.workspaces = [...saved, { id: "wks_idle", name: "idle-branch", projectId: "prj_idle", projectName: "idle-project" }];
    try {
      act(() => {
        renderer = TestRenderer.create(screen(true));
      });
      act(() => pressable("Filters").props.onPress());
      const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      const workspaces = () => sheet().find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-workspaces");
      const chips = () => workspaces().findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "checkbox").map(textOf);
      const field = () => workspaces().find((node) => (node.type as unknown) === "TextInput");
      expect(field().props.placeholder).toBe("Search projects and workspaces");
      expect(chips().map((chip) => chip.replace(/\d+$/, ""))).toEqual(["tasks-board", "idle-branch"]);
      // A project's name keeps its whole group; every word must match.
      act(() => field().props.onChangeText("IDLE proj"));
      expect(chips().map((chip) => chip.replace(/\d+$/, ""))).toEqual(["idle-branch"]);
      expect(textOf(workspaces())).not.toContain("better-paseo");
      act(() => field().props.onChangeText("nothing-here"));
      expect(chips()).toEqual([]);
      expect(textOf(workspaces())).toContain("No matches");
      act(() => workspaces().find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-search-clear").props.onPress());
      expect(field().props.value).toBe("");
      expect(chips()).toHaveLength(2);
      // Focused, the workspaces fill the scroller at least, so the field can stay at its top above the keyboard.
      act(() => sheet().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 420 } } }));
      expect(StyleSheet.flatten(workspaces().props.style)?.minHeight).toBeUndefined();
      act(() => field().props.onFocus());
      expect(StyleSheet.flatten(workspaces().props.style).minHeight).toBe(420);
      act(() => field().props.onBlur());
      expect(StyleSheet.flatten(workspaces().props.style)?.minHeight).toBeUndefined();
    } finally {
      handle.workspaces = saved;
    }
  });

  it("keeps the empty-groups switch in the phone's filter sheet, updates its options, and saves it", async () => {
    const handle = (data as unknown as { __handle: { workspaces: object[]; providers: object[]; labels: object[] } }).__handle;
    const saved = { workspaces: handle.workspaces, providers: handle.providers, labels: handle.labels };
    handle.workspaces = [...saved.workspaces, { id: "wks_idle", name: "idle-branch", projectId: "prj_idle", projectName: "idle-project" }];
    handle.providers = [...saved.providers, { id: "pi", label: "Pi" }];
    handle.labels = [...saved.labels, { name: "unused", color: null }];
    try {
      act(() => {
        renderer = TestRenderer.create(screen(true));
      });
      expect(hostsById("phone-empty-groups")).toHaveLength(0);
      expect(hostsById("filter-sheet-empty-groups")).toHaveLength(0);
      act(() => pressable("Filters").props.onPress());
      const button = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-empty-groups");
      const icon = () => button().find((node) => (node.type as unknown) === "Icon").props.name;
      // On by default: the whole list.
      expect(button().props).toMatchObject({ accessibilityRole: "switch", accessibilityState: { checked: true } });
      expect(textOf(button())).toContain("Show groups with no active tasks");
      expect(icon()).toBe("List");
      const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      expect(sheet().findAll((node) => node === button())).toHaveLength(1);
      const chips = () => sheet().findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "checkbox").map(textOf);
      expect(chips()).toEqual(expect.arrayContaining(["idle-branch0", "Pi", "unused0"]));
      await act(async () => button().props.onPress());
      expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: false });
      expect(button().props.accessibilityState).toEqual({ checked: false });
      expect(icon()).toBe("ListFilter");
      expect(chips().some((chip) => /^(idle-branch|Pi|unused)/.test(chip))).toBe(false);
      expect(chips().every((chip) => !/\D0$/.test(chip))).toBe(true);
      // A picked one stays, so it can be dropped.
      act(() => renderer!.unmount());
      host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showEmptyGroups: false } };
      rememberBoardParams("host-1", { ...EMPTY_PARAMS, providers: ["pi"] });
      act(() => {
        renderer = TestRenderer.create(screen(true));
      });
      act(() => pressable("Filters").props.onPress());
      expect(chips()).toContain("Pi");
      expect(chips()).not.toContain("idle-branch0");
    } finally {
      handle.workspaces = saved.workspaces;
      handle.providers = saved.providers;
      handle.labels = saved.labels;
    }
  });

  it("opens the details sheet on a card's tap or long press instead of its tab", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => cards()[0]!.props.onDetails(cards()[0]!.props.card));
    const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "Modal");
    // The details draw the title themselves; the sheet's header says what it is.
    expect(sheet().props.title).toBe("Details");
    expect(sheet().findByType(TaskDetailCards).props).toMatchObject({ touch: true, language: "en", card: { id: "sample-input" } });
    act(() => cards()[0]!.props.onSelect(cards()[0]!.props.card));
    expect(sheet().findByType(TaskDetailCards).props.card.id).toBe("sample-input");
    expect(openAgent).not.toHaveBeenCalled();
  });
});

describe("Tasks board, phone lane swipe and the host's pans", () => {
  const shadow = { tag: "grid-shadow" };
  const nodeMock = { createNodeMock: () => ({ __internalInstanceHandle: { stateNode: { node: shadow } } }) };
  const touch = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });
  const grid = () => renderer!.root.find((node) => (node.type as unknown) === "View" && typeof node.props.onTouchStart === "function");
  const pager = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "phone-lane-pager");

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("iOS: a swipe is the pager's; nothing is claimed from JS while the finger moves", async () => {
    const { TurboModuleRegistry } = await import("react-native");
    const handleSetJSResponder = vi.fn();
    vi.spyOn(TurboModuleRegistry, "get").mockImplementation((() => ({ handleSetJSResponder, flushOperations() {} })) as typeof TurboModuleRegistry.get);
    act(() => {
      renderer = TestRenderer.create(screen(true), nodeMock);
    });
    expect(grid().props.onTouchMove).toBeUndefined();
    act(() => grid().props.onTouchStart(touch(100, 300)));
    act(() => pager().props.onScrollBeginDrag());
    act(() => grid().props.onTouchEnd(touch(300, 304)));
    expect(handleSetJSResponder).not.toHaveBeenCalled();
  });

  it("iOS: a long press claims the touch through Gesture Handler and locks the pager", async () => {
    const { TurboModuleRegistry } = await import("react-native");
    const handleSetJSResponder = vi.fn();
    const flushOperations = vi.fn();
    vi.spyOn(TurboModuleRegistry, "get").mockImplementation(((name: string) =>
      name === "RNGestureHandlerModule" ? { handleSetJSResponder, flushOperations } : null) as typeof TurboModuleRegistry.get);
    act(() => {
      renderer = TestRenderer.create(screen(true), nodeMock);
    });
    act(() => grid().props.onTouchStart(touch(100, 300)));
    const card = renderer!.root.findByProps({ testID: "phone-lane-needs_input" }).findAllByType(TaskCardView)[0]!;
    act(() => card.props.onDetails(card.props.card));
    expect(handleSetJSResponder).toHaveBeenCalledTimes(1);
    expect(flushOperations).toHaveBeenCalledTimes(1);
    expect(pager().props.scrollEnabled).toBe(false);
    act(() => grid().props.onTouchEnd(touch(220, 302)));
    expect(pager().props.scrollEnabled).toBe(true);
    expect(renderer!.root.find((node) => (node.type as unknown) === "Modal").props.title).toBe("Details");
  });

  it("Android: a long press makes the lane the Fabric JS responder, never calls Gesture Handler, and lets go on release", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const { TurboModuleRegistry } = await import("react-native");
    const handleSetJSResponder = vi.fn();
    vi.spyOn(TurboModuleRegistry, "get").mockImplementation((() => ({ handleSetJSResponder, flushOperations() {} })) as typeof TurboModuleRegistry.get);
    const setIsJSResponder = vi.fn();
    vi.stubGlobal("nativeFabricUIManager", { setIsJSResponder });
    act(() => {
      renderer = TestRenderer.create(screen(true), nodeMock);
    });
    act(() => pressable("Running 2").props.onPress());
    act(() => grid().props.onTouchStart(touch(100, 300)));
    expect(setIsJSResponder).not.toHaveBeenCalled();
    const card = renderer!.root.findByProps({ testID: "phone-lane-running" }).findAllByType(TaskCardView)[0]!;
    act(() => card.props.onDetails(card.props.card));
    expect(setIsJSResponder).toHaveBeenCalledWith(shadow, true, true);
    expect(pager().props.scrollEnabled).toBe(false);
    act(() => grid().props.onTouchCancel());
    expect(setIsJSResponder).toHaveBeenLastCalledWith(shadow, false, false);
    expect(pager().props.scrollEnabled).toBe(true);
    expect(handleSetJSResponder).not.toHaveBeenCalled();
    expect(pressable("Running 2").props.accessibilityState).toEqual({ selected: true });
    expect(renderer!.root.find((node) => (node.type as unknown) === "Modal").props.title).toBe("Details");
  });

  it("Android: past the first lane tells the host the board is scrolled sideways, so its agent-list pan fails", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const record = { registerScrollOffset: vi.fn(), unregisterScrollOffset: vi.fn(), isAnyScrolledRight: { value: false } };
    const fiber = { memoizedProps: {}, return: { memoizedProps: { value: record }, return: null } };
    act(() => {
      renderer = TestRenderer.create(screen(true), { createNodeMock: () => ({ __internalInstanceHandle: fiber }) });
    });
    // Needs input: the first lane registers nothing.
    expect(record.registerScrollOffset).not.toHaveBeenCalled();
    act(() => pressable("Running 2").props.onPress());
    expect(record.registerScrollOffset).toHaveBeenCalledTimes(1);
    const [id, offset] = record.registerScrollOffset.mock.calls[0]!;
    expect(offset).toBeGreaterThan(1);
    act(() => pressable("Review 2").props.onPress());
    expect(record.registerScrollOffset).toHaveBeenCalledTimes(1);
    act(() => pressable("Needs input 1").props.onPress());
    expect(record.unregisterScrollOffset).toHaveBeenCalledWith(id);
    act(() => pressable("Running 2").props.onPress());
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(record.unregisterScrollOffset).toHaveBeenCalledTimes(2);
  });

  it("iOS registers nothing: the pager's pan begins first there", () => {
    const record = { registerScrollOffset: vi.fn(), unregisterScrollOffset: vi.fn(), isAnyScrolledRight: { value: false } };
    const fiber = { memoizedProps: { value: record }, return: null };
    act(() => {
      renderer = TestRenderer.create(screen(true), { createNodeMock: () => ({ __internalInstanceHandle: fiber }) });
    });
    act(() => pressable("Running 2").props.onPress());
    expect(record.registerScrollOffset).not.toHaveBeenCalled();
  });

  it("web: a pointer swipe still switches the lane", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    const area = renderer!.root.find((node) => (node.type as unknown) === "View" && typeof node.props.onPointerDown === "function");
    act(() => pressable("Running 2").props.onPress());
    act(() => area.props.onPointerDown(touch(100, 300)));
    act(() => area.props.onPointerUp(touch(180, 304)));
    expect(pressable("Needs input 1").props.accessibilityState).toEqual({ selected: true });
  });
});

describe("Tasks sidebar entry", () => {
  function entry(screenId: string | null, openScreen = vi.fn()) {
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(TasksSidebarEntry, {
          theme,
          host: { id: "host-1", label: "Local" },
          layout: { compact: false, platform: "web" },
          currentScreen: screenId ? { screenId, params: {} } : null,
          openScreen,
          openPopover: vi.fn(),
        }),
      );
    });
    return renderer!.root.find((node) => (node.type as unknown) === "SidebarRow");
  }

  it.each([
    ["all", "1 need input, 2 running, 2 to review", "122"],
    ["input-only", "1 need input", "1"],
    ["none", null, ""],
  ] as const)("draws the counts for %s", (count, label, text) => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count } };
    const row = entry(null);
    const counts = row.findAll((node) => node.props.accessibilityLabel !== undefined && (node.type as unknown) === "View");
    expect(counts.map((node) => node.props.accessibilityLabel)).toEqual(label ? [label] : []);
    expect(textOf(row)).toBe(text);
  });

  it("draws needs input, running and review in that order with their lane icons", () => {
    host.counts = { running: 3, needsInput: 1, review: 2, done: 4 };
    const row = entry(null);
    const icons = row.findAll((node) => (node.type as unknown) === "View" && /^status-[a-z_]+$/.test(String(node.props.testID ?? "")));
    expect(icons.map((node) => node.props.testID)).toEqual(["status-needs_input", "status-running", "status-unread"]);
    expect(textOf(row)).toBe("132");
  });

  it("hides a zero count and draws nothing when all are zero", () => {
    host.counts = { running: 0, needsInput: 2, review: 0, done: 0 };
    const row = entry(null);
    expect(textOf(row)).toBe("2");
    expect(row.findAll((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel !== undefined).map((node) => node.props.accessibilityLabel)).toEqual(["2 need input"]);
    expect(row.findAll((node) => node.props.kind === "running")).toHaveLength(0);
    const input = row.findAll((node) => (node.type as unknown) === "Text" && node.props.children === 2)[0]!;
    expect(StyleSheet.flatten(input.props.style)).toMatchObject({ fontWeight: "600" });
    host.counts = { running: 0, needsInput: 0, review: 0, done: 1 };
    act(() => renderer!.unmount());
    expect(textOf(entry(null))).toBe("");
  });

  it("is active on the board and opens it with the session's filters", () => {
    rememberBoardParams("host-1", { ...EMPTY_PARAMS, labels: ["frontend"], doneWindow: "7d" });
    const openScreen = vi.fn();
    const row = entry("tasks", openScreen);
    expect(row.props.active).toBe(true);
    act(() => row.props.onPress());
    expect(openScreen).toHaveBeenCalledWith({ screenId: "tasks", params: { label: "frontend", win: "7d" } });
  });
});

describe("Tasks Command Center item", () => {
  it("opens the board with the last filters", async () => {
    const items: { onSelect(context: unknown): void }[] = [];
    const noop = () => () => {};
    const client = {
      addScreen: noop,
      addSidebarHeaderItem: noop,
      addSettingsScreen: noop,
      openSettings: noop,
      rpc: () => Promise.resolve({ status: "ready", revision: "1", values: { enabled: true } }),
      addCommandCenterItem: (item: { onSelect(context: unknown): void }) => {
        items.push(item);
        return () => {};
      },
    };
    contributeTasks(client as never);
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    rememberBoardParams("host-1", { ...EMPTY_PARAMS, query: "ring" });
    const openScreen = vi.fn();
    items[0]!.onSelect({ context: "global", openScreen });
    expect(openScreen).toHaveBeenCalledWith({ screenId: "tasks", params: { q: "ring" } });
  });
});
