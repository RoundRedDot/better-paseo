import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { measureHostTree } from "./helpers/yoga-host-layout";
import * as todoSummary from "../../client/tasks/data/todo-summary";

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
      { ref: props.ref, testID: props.testID, refreshing: props.refreshing, onRefresh: props.onRefresh, alwaysBounceVertical: props.alwaysBounceVertical, onContentSizeChange: props.onContentSizeChange, onScroll: props.onScroll, contentContainerStyle: props.contentContainerStyle, onScrollToIndexFailed: props.onScrollToIndexFailed, onEndReached: props.onEndReached, data: props.data, viewabilityConfigCallbackPairs: props.viewabilityConfigCallbackPairs },
      data.length
        ? data.map((item, index) => {
            host.rowRenders += 1;
            const lane = (item as TaskCard).lane;
            host.laneRowRenders[lane] = (host.laneRowRenders[lane] ?? 0) + 1;
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
    Icon: (props: Props) => React.createElement("Icon", { name: props.name, icon: props.icon, size: props.size, color: props.color }),
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
  /** The automatic title settings; loading while null. */
  titleSettings: null as Record<string, unknown> | null,
  counts: null as { running: number; needsInput: number; review: number; done: number; hidden?: import("../../client/tasks/model").TaskCard[] } | null,
  /** The filters the sidebar row last counted with. */
  countScope: null as unknown,
  canStop: false,
  updateState: { state: "idle" } as unknown,
  save: vi.fn(async (_values: unknown, _revision: string) => true),
  reload: vi.fn(async () => {}),
  /** Rows a lane's list drew, counted by the FlatList mock. */
  rowRenders: 0,
  laneRowRenders: {} as Record<string, number>,
  /** A fake daemon's API: the board then reads the real store (`useTasks`) instead of the samples. */
  liveTasks: null as unknown,
}));
// The details read a card's first prompt from its timeline: one stable client whose timelines are empty.
const paseo = vi.hoisted(() => ({
  agents: { ref: () => ({ timeline: {
    refetch: () => Promise.resolve({ error: null, entries: [], epoch: "test", endCursor: null, window: { nextSeq: 0 } }),
    subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
  } }) },
}));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => paseo,
  useRpc: (contract: { name: string }) => (input: { agentIds?: string[] }) => Promise.resolve(contract.name === "tasks.availability" ? { entries: input.agentIds!.map((agentId) => ({ agentId, availability: { issue: null, blocked: {} } })) } : contract.name === "settings.update-check" ? host.updateState : { stop: host.canStop }),
  useSettings: (definition: { id: string }) => {
    const values = definition.id === "title-generation" ? host.titleSettings : host.settings;
    return values ? { status: "ready", values, revision: "1", saving: false, saveError: null, save: host.save, reload: host.reload } : { status: "loading" };
  },
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
    refresh: vi.fn(),
    loadMoreDone: vi.fn(),
    resolveParent: vi.fn(),
    refreshParent: vi.fn(async () => false),
    requestProjectIcon: vi.fn(),
  };
  return {
    ...actual,
    __handle: handle,
    // A test that sets `host.liveTasks` draws the board from the real store over that fake daemon.
    useTasks: (_paseo: unknown, options: Parameters<typeof actual.useTasks>[1]) => (host.liveTasks ? actual.useTasks(host.liveTasks as never, options) : handle),
    useTaskCounts: (_paseo: unknown, _review: boolean, scope?: unknown) => {
      host.countScope = scope ?? null;
      return { ...(host.counts ?? handle.counts), ready: true };
    },
  };
});

import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { ProviderLogo } from "../../client/components/provider-logo";
import * as data from "../../client/tasks/data";
import { firstPromptStoreFor } from "../../client/tasks/data/first-prompt";
import { TasksBoardScreen } from "../../client/tasks/board/board-screen";
import { CardCell, RollingCount, RollingTotal, SlashMark, WindowSegments } from "../../client/tasks/board/board-parts";
import { createLaneMotionStore, LaneMotionLayer, LaneMotionProvider } from "../../client/tasks/board/lane-motion";
import { TasksSidebarEntry } from "../../client/tasks/board/sidebar-entry";
import { contributeTasks } from "../../client/tasks/contribute";
import { boardClearCount, lastBoardParams, rememberBoardParams, rememberCollapsed, rememberedCollapsed, requestBoardClear, resetBoardSessions, EMPTY_PARAMS, type BoardParams } from "../../client/tasks/board/params";
import { TabletToolbar } from "../../client/tasks/board/tablet-toolbar";
import { DesktopFilterBar as DesktopFilterBarMemo, DesktopToolbar as DesktopToolbarMemo } from "../../client/tasks/board/filter-bar";
import { LaneWidthMark } from "../../client/tasks/board/lane-width-mark";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { NOTICE_MS } from "../../client/tasks/board/use-board";
import { ANNOUNCE_AFTER_MS, FLASH_AFTER_ENTER_MS, FLASH_AFTER_SCROLL_MS, newCardStore, resetNewCards } from "../../client/tasks/board/new-cards";
import { readSidebarPreference, resetSidebarPreference, writeSidebarPreference } from "../../client/tasks/board/sidebar-model";
import { MOTION } from "../../client/tasks/board/board-style";
import { ACTIVE_LANE_ORDER as LANE_ORDER, type TaskCard } from "../../client/tasks/model";
import { BrandMark, DetailActionBar, PiMark, TagMark, TaskCardView, TaskDetailCards, taskTokens } from "../../client/tasks/cards";
import { deviceTasksStore } from "../../client/tasks/device-preferences";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS } from "../../shared/tasks-settings";
import { resetTasksEnabled, setTasksSettingsOpener } from "../../client/tasks/board/enabled";
import { createFakePaseo, makeAgent } from "./helpers/fake-paseo";
import { TitleLoading } from "../../client/tasks/cards/title-loading";
import { titleGenerationSettingsSchema, type TitleUpdateState } from "../../shared/title-generation";
import { APP_SETTINGS_KEY, resetHostAppearanceForTests, setNativeSettingsReaderForTests, triggerHostAppearanceCheck } from "../../client/ui/tokens/host-appearance-shim";

// These tests draw the board on and the archived lane off unless they turn it on
// (tasks-board-enabled.test.ts covers the board off).
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: true, board: { ...STOCK_SETTINGS.board, showArchived: false } };
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

// The bars are memoized: a rendered instance's type is the component inside the memo.
const DesktopFilterBar = (DesktopFilterBarMemo as unknown as { type: React.ComponentType }).type;
const DesktopToolbar = (DesktopToolbarMemo as unknown as { type: React.ComponentType }).type;

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

/** A style number, or what an animated value holds now (the RN mock's `__value`). */
function liveNumber(value: unknown): unknown {
  return typeof value === "object" && value !== null && "__value" in value ? (value as { __value: number }).__value : value;
}

function layOut(width: number) {
  const laidOut = new Set<unknown>();
  for (let pass = 0; pass < 4; pass++) {
    const views = renderer!.root.findAll(
      // Intrinsic lane-choice measurements are supplied explicitly by the responsive-toolbar tests.
      (node) => (node.type as unknown) === "View" && node.props.testID !== "lane-width-measure" && node.props.testID !== "filter-bar" && typeof node.props.onLayout === "function" && !laidOut.has(node.props.onLayout),
    );
    if (views.length === 0) return;
    act(() => {
      for (const view of views) {
        laidOut.add(view.props.onLayout);
        const measured = view.props.testID === "desktop-toolbar-end"
          ? measureHostTree(hostsById("desktop-toolbar")[0]!, { width }).get(view)!.width : width;
        view.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: measured, height: 800 } } });
      }
    });
  }
}

function finishSidebarCloseImmediately() {
  const timing = Animated.timing;
  vi.spyOn(Animated, "timing").mockImplementation((value, config) => config.toValue === 0 && config.duration === 180
    ? { start: (done) => { (value as Animated.Value).setValue(0); done?.({ finished: true }); }, stop: () => {}, reset: () => {} }
    : timing(value, config));
}

/** Host nodes with a test id (composites carry the same props). */
/** Past the wait of the lanes behind an open filter panel (`useLaggedWhile` in the desktop board). */
async function panelLag() {
  await act(async () => {
    vi.advanceTimersByTime(260);
  });
}

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

interface HeldRun { value: Animated.Value; to: number; duration: number; done?: (result: { finished: boolean }) => void; over: boolean }

/**
 * `Animated.timing` runs that end only when the test finishes them; a stop
 * ends one unfinished, as React Native does. `sheet` lists the bottom
 * sheet's height runs.
 */
function holdTimings() {
  const runs: HeldRun[] = [];
  const spy = vi.spyOn(Animated, "timing").mockImplementation((value, config) => {
    const run: HeldRun = { value: value as Animated.Value, to: config.toValue as number, duration: config.duration as number, over: false };
    runs.push(run);
    return {
      start: (done) => { run.done = done; },
      stop: () => {
        if (run.over) return;
        run.over = true;
        run.done?.({ finished: false });
      },
      reset: () => {},
    };
  });
  const sheetValue = () => StyleSheet.flatten(hostsById("board-sheet")[0]!.props.style).height as unknown as Animated.Value;
  const sheet = () => runs.filter((run) => run.value === sheetValue());
  const finish = (run: HeldRun) => act(() => {
    run.over = true;
    run.value.setValue(run.to);
    run.done?.({ finished: true });
  });
  return { sheet, sheetValue, finish, restore: () => spy.mockRestore() };
}

/** The card ids a phone pager page draws. */
function laneCards(lane: string): string[] {
  return renderer!.root.findByProps({ testID: `phone-lane-${lane}` }).findAllByType(TaskCardView).map((card) => card.props.card.id);
}

function pressable(label: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}

function menuOption(label: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && textOf(node).startsWith(label));
}

function toggleSidebarControl() {
  if (hostsById("sidebar-switch").length) act(() => hostsById("sidebar-switch")[0]!.props.onPress());
  else {
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    const strings = renderer!.root.findByType(TabletToolbar).props.board.strings;
    act(() => menuOption(strings.sidebar.show).props.onPress());
  }
}

function failDeviceWrite() {
  const storage = (globalThis as Record<string, unknown>).__betterPaseoDeviceTasksStorageForTests as { write(value: string): void };
  vi.spyOn(storage, "write").mockImplementationOnce(() => { throw new Error("Disk full"); });
}

/** Browser focus and both key phases, without RNW swallowing a card's activation. */
function renderFocusBoard() {
  const windowCapture = new Set<(event: unknown) => void>();
  const capture = new Set<(event: unknown) => void>();
  const bubble = new Set<(event: unknown) => void>();
  const doc = {
    activeElement: null as unknown, body: {}, visibilityState: "visible",
    addEventListener: (type: string, listener: (event: unknown) => void, useCapture?: boolean) => {
      if (type === "keydown") (useCapture ? capture : bubble).add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void, useCapture?: boolean) => {
      if (type === "keydown") (useCapture ? capture : bubble).delete(listener);
    },
  };
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: unknown) => void, useCapture?: boolean) => type === "keydown" && useCapture && windowCapture.add(listener),
    removeEventListener: (type: string, listener: (event: unknown) => void) => type === "keydown" && windowCapture.delete(listener),
  });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("HTMLElement", class {});
  const board = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.tabIndex === -1 && node.props.role === "group");
  const root = {
    contains: (node: unknown) => node === root || (node as { inBoard?: boolean })?.inBoard === true,
    querySelector: vi.fn(() => null),
    focus: vi.fn(() => {
      board().props.onBlur();
      doc.activeElement = root;
      board().props.onFocus({ target: root });
    }),
  };
  act(() => { renderer = TestRenderer.create(screen(false), {
    createNodeMock: (element) => {
      const props = element.props as Record<string, unknown>;
      return props.tabIndex === -1 && props.role === "group" ? root : null;
    },
  }); });
  layOut(2000);
  const focus = (id?: string) => {
    const node = { inBoard: true, getAttribute: (name: string) => name === "data-bctaskcard" ? id ?? null : null };
    act(() => {
      board().props.onBlur();
      doc.activeElement = node;
      board().props.onFocus({ target: node });
    });
  };
  const key = (value: string, hostConsumes = false, options: Partial<KeyboardEvent> = {}) => {
    let stopped = hostConsumes;
    const event = {
      key: value, defaultPrevented: hostConsumes, ...options,
      preventDefault: vi.fn(() => { event.defaultPrevented = true; }),
      stopPropagation: vi.fn(() => { stopped = true; }),
    };
    act(() => {
      // stopPropagation at window leaves the other listeners on window running.
      for (const listener of windowCapture) listener(event);
      if (!stopped) for (const listener of capture) listener(event);
      if (!stopped) for (const listener of bubble) listener(event);
    });
    return event;
  };
  return { doc, root, board, focus, key };
}

beforeEach(() => {
  resetHostAppearanceForTests();
  host.settings = { ...DEFAULT_TASKS_SETTINGS };
  host.titleSettings = null;
  host.counts = null;
  host.canStop = false;
  host.updateState = { state: "idle" };
  host.rowRenders = 0;
  host.laneRowRenders = {};
  host.liveTasks = null;
  resetBoardSessions();
  resetNewCards();
  resetSidebarPreference();
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetHostAppearanceForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  resetEnhancerPreferences();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  resetTasksEnabled();
});

describe("plan subscription", () => {
  it("enables the todo subscription from plan independently of subtasks", () => {
    const todo = vi.spyOn(todoSummary, "useTodoSummary").mockReturnValue(null);
    host.settings = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, plan: false, subtasks: true } };
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    expect(todo.mock.calls.length).toBeGreaterThan(0);
    expect(todo.mock.calls.every((call) => call[2] === false)).toBe(true);
    todo.mockClear();
    host.settings = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, plan: true, subtasks: false } };
    act(() => renderer!.update(screen(false)));
    expect(todo.mock.calls.some((call) => call[2] === true)).toBe(true);
  });
});

describe("search coverage render isolation", () => {
  it.each([false, true])("updates counts without redrawing lane rows (phone=%s)", async (phone) => {
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }>; byId: Map<string, TaskCard> } }).__handle;
    const saved = { lanes: handle.lanes, byId: handle.byId };
    const task = { ...handle.lanes.needs_input!.cards[0]!, id: `coverage-render-${phone}`, title: "coverage probe", closed: false };
    handle.lanes = { ...handle.lanes, needs_input: { ...handle.lanes.needs_input!, cards: [task] } };
    handle.byId = new Map(handle.byId).set(task.id, task);
    let finish!: () => void;
    const ref = vi.spyOn(paseo.agents, "ref").mockImplementation(() => ({ timeline: {
      refetch: () => new Promise((resolve) => { finish = () => resolve({ error: "offline", entries: [] } as never); }),
      subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
    } }));
    try {
      await act(async () => { renderer = TestRenderer.create(screen(phone, { q: "coverage probe" })); });
      if (!phone) layOut(1600);
      const before = host.rowRenders;
      let request!: Promise<void>;
      act(() => { request = firstPromptStoreFor(paseo as never).request(task.id); });
      expect(host.rowRenders).toBe(before);
      expect(textOf(hostsById("search-coverage-loaded")[0]!)).toBe(BOARD_STRINGS.en.searchCoverage.loaded(0));
      await act(async () => { finish(); await request; });
      // A failed read is neither counted nor offered a retry; the notice keeps its loaded-count wording.
      expect(textOf(hostsById("search-coverage-loaded")[0]!)).toBe(BOARD_STRINGS.en.searchCoverage.loaded(0));
      expect(hostsById("search-coverage-failure")).toHaveLength(0);
      expect(hostsById("search-coverage-retry")).toHaveLength(0);
      if (phone) {
        const summary = hostsById("phone-search-summary")[0]!;
        expect(summary.props.horizontal).toBe(true);
        expect(textOf(summary)).toContain("coverage probe");
      }
      expect(host.rowRenders).toBe(before);
      expect(hostsById("tasks-search-coverage")).toHaveLength(0);
    } finally {
      act(() => renderer?.unmount()); renderer = undefined;
      handle.lanes = saved.lanes; handle.byId = saved.byId; ref.mockRestore();
    }
  });
});

describe("Tasks search coverage and centred toolbar", () => {
  beforeEach(() => {
    const Value = Animated.Value;
    vi.spyOn(Animated, "Value").mockImplementation(function (initial) {
      const value = new Value(initial);
      const interpolate = value.interpolate.bind(value);
      value.interpolate = ((config) => {
        if (config.inputRange.length !== 2 || !config.outputRange.every((entry) => typeof entry === "number")) return interpolate(config);
        const progress = (Number(liveNumber(value)) - config.inputRange[0]!) / (config.inputRange[1]! - config.inputRange[0]!);
        return Number(config.outputRange[0]) + progress * (Number(config.outputRange[1]) - Number(config.outputRange[0]));
      }) as typeof value.interpolate;
      return value;
    });
    vi.spyOn(Animated, "timing").mockImplementation((value, config) => ({
      start: (done) => { (value as Animated.Value).setValue(config.toValue as number); done?.({ finished: true }); },
      stop() {}, reset() {},
    }));
  });
  afterEach(() => {
    vi.mocked(Animated.timing).mockRestore();
    vi.mocked(Animated.Value).mockRestore();
  });

  it.each([600, 800, 959].flatMap((width) => ([14, 21] as const).filter((base) => width > 600 || base === 14).flatMap((base) => (["en", "zh"] as const).map((language) => ({ width, base, language })))))
  ("keeps $language search inline at $width/UI$base without a repeated search icon", ({ width, base, language }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(width);
    const actions = hostsById("desktop-toolbar-end")[0]!.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID);
    act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
    expect(hostsById("desktop-search-row")).toHaveLength(0);
    const toolbar = hostsById("desktop-toolbar")[0]!;
    const field = hostsById("desktop-toolbar-search")[0]!;
    expect(toolbar.findAll((node) => node === field)).toHaveLength(1);
    expect(field.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "Search")).toHaveLength(0);
    const frames = measureHostTree(toolbar, { width });
    const total = frames.get(hostsById("desktop-toolbar-total")[0]!)!;
    const input = frames.get(field)!;
    const mode = frames.get(hostsById("search-full-conversation-toggle")[0]!)!;
    expect(input.width).toBeGreaterThanOrEqual(140 * base / 14 - 1);
    expect(input.left + input.width).toBeLessThan(total.left);
    expect(mode.left + mode.width).toBeLessThan(total.left);
    expect(total.left + total.width / 2).toBeCloseTo(width / 2, 0);
    expect(hostsById("desktop-toolbar-end")[0]!.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID)).toEqual(actions);
    act(() => field.find((node) => (node.type as unknown) === "TextInput").props.onChangeText("needle"));
    if (width > 600) {
      const queried = measureHostTree(hostsById("desktop-toolbar")[0]!, { width });
      const summary = queried.get(hostsById("desktop-toolbar-search-summary")[0]!)!;
      expect(summary.left + summary.width).toBeLessThanOrEqual(queried.get(hostsById("desktop-toolbar-total")[0]!)!.left);
    }
    act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
    expect(hostsById("desktop-toolbar-search")).toHaveLength(0);
    expect(lastBoardParams("host-1").query).toBe("needle");
  });

  it("moves open search to its own row only when its measured slot stops fitting", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(600);
    act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
    act(() => hostsById("desktop-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput").props.onChangeText("needle"));
    for (const width of [320, 600, 400, 800]) {
      layOut(width);
      expect(hostsById("desktop-search-row")).toHaveLength(width <= 400 ? 1 : 0);
      expect(hostsById("desktop-toolbar-search")).toHaveLength(1);
      expect(hostsById("desktop-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput").props.value).toBe("needle");
    }
  });

  it("moves the query from the chip into the field only while the field is on screen", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false, { q: "status" })); });
    layOut(800);
    expect(textOf(hostsById("desktop-toolbar-search-summary")[0]!)).toContain("Contains「status」");
    act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
    expect(hostsById("desktop-toolbar-search")).toHaveLength(1);
    const summary = hostsById("desktop-toolbar-search-summary")[0]!;
    expect(textOf(summary)).not.toContain("Contains");
    expect(textOf(summary)).not.toContain("status");
    expect(textOf(summary)).toContain("Clear filters");
    act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
    expect(textOf(hostsById("desktop-toolbar-search-summary")[0]!)).toContain("Contains「status」");
  });

  it("puts the loaded count inside the desktop search field instead of a query chip", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }>; byId: Map<string, TaskCard> } }).__handle;
    const saved = { lanes: handle.lanes, byId: handle.byId };
    const task = { ...handle.lanes.needs_input!.cards[0]!, id: "coverage-in-field", title: "badge probe", closed: false };
    handle.lanes = { ...handle.lanes, needs_input: { ...handle.lanes.needs_input!, cards: [task] } };
    handle.byId = new Map(handle.byId).set(task.id, task);
    let finish!: () => void;
    const ref = vi.spyOn(paseo.agents, "ref").mockImplementation(() => ({ timeline: {
      // The repo's tsconfig predates Promise.withResolvers; match the neighbouring test.
      refetch: () => new Promise((resolve) => { finish = () => resolve({ error: "offline", entries: [] } as never); }),
      subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
    } }));
    let request!: Promise<void>;
    try {
      await act(async () => { renderer = TestRenderer.create(screen(false, { q: "badge probe" })); });
      layOut(1200);
      act(() => { request = firstPromptStoreFor(paseo as never).request(task.id); });
      const field = hostsById("desktop-toolbar-search")[0]!;
      const badge = hostsById("search-coverage-items")[0]!;
      expect(field.findAll((node) => node === badge)).toHaveLength(1);
      expect(textOf(badge)).toBe("0");
      // The inline field keeps its magnifier; the count badge carries the loading state.
      expect(field.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "Search")).toHaveLength(1);
      expect(hostsById("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner")).toHaveLength(0);
      const summary = hostsById("desktop-toolbar-search-summary")[0]!;
      expect(textOf(summary)).not.toContain("Contains");
      expect(textOf(summary)).toContain("Clear filters");
      const frames = measureHostTree(hostsById("desktop-toolbar")[0]!, { width: 1200 });
      const fieldFrame = frames.get(field)!;
      const badgeFrame = frames.get(badge)!;
      expect(badgeFrame.left).toBeGreaterThanOrEqual(fieldFrame.left);
      expect(badgeFrame.left + badgeFrame.width).toBeLessThanOrEqual(fieldFrame.left + fieldFrame.width);
      // The count precedes the stop toggle that used to sit before it.
      const cancelFrame = frames.get(hostsById("search-cancel-toggle")[0]!)!;
      expect(badgeFrame.left + badgeFrame.width).toBeLessThanOrEqual(cancelFrame.left);
      await act(async () => { finish(); await request; });
    } finally {
      act(() => renderer?.unmount()); renderer = undefined;
      handle.lanes = saved.lanes; handle.byId = saved.byId; ref.mockRestore();
    }
  });

  it.each([320, 600])("respects reduced motion when search opens and closes at %s", (width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    let onReduce = (_on: boolean) => {};
    const addListener = AccessibilityInfo.addEventListener;
    const subscription = vi.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, listener: (enabled: boolean) => void) => {
      if (name === "reduceMotionChanged") onReduce = listener;
      return addListener("reduceMotionChanged", listener);
    }) as typeof AccessibilityInfo.addEventListener);
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(width);
      act(() => onReduce(true));
      vi.mocked(Animated.timing).mockClear();
      act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
      const reveal = hostsById("desktop-search-reveal")[0]!;
      expect(reveal.props.style.opacity).toBe(1);
      expect(reveal.props.style[width === 320 ? "height" : "width"]).toBeGreaterThan(0);
      act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
      expect(hostsById("desktop-toolbar-search")).toHaveLength(0);
      expect(vi.mocked(Animated.timing).mock.calls.filter(([, config]) => config.duration === 180 && config.isInteraction === false)).toHaveLength(0);
    } finally {
      act(() => onReduce(false));
      subscription.mockRestore();
    }
  });

  it.each([320, 600])("animates search entry and exit at %s and reverses closing without losing the input", (width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const { key } = renderFocusBoard();
    try {
      layOut(width);
      vi.mocked(Animated.timing).mockImplementation((value, config) => {
        let timer: ReturnType<typeof setTimeout>;
        return {
          start: (done) => { timer = setTimeout(() => { (value as Animated.Value).setValue(config.toValue as number); done?.({ finished: true }); }, config.duration); },
          stop: () => clearTimeout(timer), reset() {},
        };
      });
      key("/");
      const field = hostsById("desktop-toolbar-search")[0]!;
      const progress = hostsById("desktop-search-reveal")[0]!.props.style.opacity;
      expect(Animated.timing).toHaveBeenCalledWith(progress, expect.objectContaining({ toValue: 1, duration: 180, useNativeDriver: false }));
      act(() => field.find((node) => (node.type as unknown) === "TextInput").props.onChangeText("needle"));
      act(() => { vi.advanceTimersByTime(180); });
      act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
      expect(hostsById("desktop-toolbar-search")[0]).toBe(field);
      expect(hostsById("desktop-search-reveal")[0]!.props).toMatchObject({ pointerEvents: "none", accessibilityElementsHidden: true, "aria-hidden": true });
      expect(Animated.timing).toHaveBeenCalledWith(progress, expect.objectContaining({ toValue: 0, duration: 180 }));
      act(() => { vi.advanceTimersByTime(90); });
      key("/");
      act(() => { vi.advanceTimersByTime(180); });
      expect(hostsById("desktop-toolbar-search")[0]).toBe(field);
      expect(hostsById("desktop-search-reveal")[0]!.props.pointerEvents).toBe("auto");
      act(() => hostsById("desktop-search-toggle")[0]!.props.onPress());
      act(() => { vi.advanceTimersByTime(180); });
      expect(hostsById("desktop-toolbar-search")).toHaveLength(0);
      expect(lastBoardParams("host-1").query).toBe("needle");
    } finally {
      act(() => renderer?.unmount()); renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each(["web", "ios", "android"])("keeps %s inline search matched to the current lane across presets, folding and resizing", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: 14 } } })); });
    layOut(1600);
    const prefix = os === "web" ? "desktop" : "tablet";
    const controller = () => renderer!.root.findByType(os === "web" ? DesktopToolbar : TabletToolbar).props.board;
    const lane = () => StyleSheet.flatten(hostsById("lane-surface-running")[0]!.props.style).width;
    const field = () => StyleSheet.flatten(hostsById(`${prefix}-toolbar-search`)[0]!.props.style).width;
    for (const [size, expected] of [["narrow", 280], ["default", 340], ["wide", 388]] as const) {
      await act(async () => { controller().setLaneWidth(size); });
      expect(field()).toBe(expected);
      expect(field()).toBe(lane());
      const frames = measureHostTree(hostsById(`${prefix}-toolbar`)[0]!, { width: 1600 });
      expect(frames.get(hostsById(`${prefix}-toolbar-search`)[0]!)!.width).toBe(expected);
      expect(frames.get(hostsById(`${prefix}-toolbar-search`)[0]!)!.left).toBe(lanesScroll().props.contentContainerStyle.paddingLeft);
      if (os === "web") {
        const filters = hostsById("filter-bar")[0]!;
        expect(measureHostTree(filters, { width: 1600 }).get(hostsById("filter-bar-controls")[0]!)!.left).toBe(lanesScroll().props.contentContainerStyle.paddingLeft);
      }
    }
    await act(async () => { controller().setLaneWidth("default"); });
    layOut(1300);
    expect(field()).toBe(313);
    act(() => hostsById("lane-needs_input")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane")[0]!.props.onPress());
    expect(field()).toBe(os === "web" ? 340 : 313);
    expect(field()).toBe(lane());
    layOut(1200);
    expect(field()).toBe(os === "web" ? 340 : 300);
    expect(field()).toBe(lane());
  });

  it.each(["web", "ios", "android"])("keeps %s separate-row search independent of lane width", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: 21 } } })); });
    layOut(600);
    const prefix = os === "web" ? "desktop" : "tablet";
    const controller = () => renderer!.root.findByType(os === "web" ? DesktopToolbar : TabletToolbar).props.board;
    act(() => hostsById(`${prefix}-search-toggle`)[0]!.props.onPress());
    for (const [size, expected] of [["narrow", 244], ["default", 284], ["wide", 300]] as const) {
      await act(async () => { controller().setLaneWidth(size); });
      expect(StyleSheet.flatten(hostsById("lane-surface-running")[0]!.props.style).width).toBe(expected);
      const row = hostsById(`${prefix}-search-row`)[0]!;
      const field = hostsById(`${prefix}-toolbar-search`)[0]!;
      expect(StyleSheet.flatten(field.props.style).width).toBe(320);
      const frame = measureHostTree(row, { width: 600 }).get(field)!;
      expect(frame.width).toBe(320);
      expect(frame.left).toBe(lanesScroll().props.contentContainerStyle.paddingLeft);
    }
    layOut(480);
    const field = hostsById(`${prefix}-toolbar-search`)[0]!;
    expect(StyleSheet.flatten(field.props.style).width).toBe(320);
    expect(measureHostTree(hostsById(`${prefix}-search-row`)[0]!, { width: 480 }).get(field)!.width).toBe(320);
  });

  it.each(["web", "ios", "android"].flatMap((os) => (["en", "zh"] as const).map((language) => ({ os, language }))))("sizes $os/$language search with the lanes across layouts and filter measurements", ({ os, language }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false, { q: "needle", agent: "claude" }, { ...(theme as object), typography: { fontSize: { ui: 14 } } })); });
    const prefix = os === "web" ? "desktop" : "tablet";
    for (const [width, expected] of [[960, 300], [1200, 300], [1300, 313], [1600, 340], [960, 300]] as const) {
      layOut(width);
      if (os === "web") act(() => hostsById("filter-bar-controls")[0]!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: width / 3, height: 30 } } }));
      const bar = hostsById(`${prefix}-toolbar`)[0]!;
      const field = hostsById(`${prefix}-toolbar-search`)[0]!;
      const frames = measureHostTree(bar, { width });
      expect(frames.get(field)!.width).toBeCloseTo(expected, 0);
      const group = frames.get(hostsById(`${prefix}-toolbar-search-group`)[0]!)!;
      expect(group.left + group.width).toBeLessThanOrEqual(frames.get(hostsById(`${prefix}-toolbar-total`)[0]!)!.left);
      expect(hostsById(`${prefix}-search-toggle`)).toHaveLength(0);
      expect(hostsById(`${prefix}-search-row`)).toHaveLength(0);
    }
  });

  it.each(([
    ["web", 320, 14], ["web", 600, 21],
    ["ios", 320, 14], ["ios", 600, 21], ["ios", 960, 28],
    ["android", 320, 14], ["android", 600, 21], ["android", 960, 28],
  ] as const).flatMap(([os, width, base]) => (["en", "zh"] as const).map((language) => ({ os, width, base, language }))))("$os/$language at $width/UI$base opens a bounded search row and preserves its query on close", ({ os, width, base, language }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(width);
    const prefix = os === "web" ? "desktop" : "tablet";
    expect(hostsById(`${prefix}-toolbar-search`)).toHaveLength(0);
    const actions = hostsById(`${prefix}-toolbar-end`)[0]!.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID);
    act(() => hostsById(`${prefix}-search-toggle`)[0]!.props.onPress());
    const row = hostsById(`${prefix}-search-row`)[0]!;
    const field = hostsById(`${prefix}-toolbar-search`)[0]!;
    expect(hostParentOf(hostsById(`${prefix}-toolbar-search-group`)[0]!)).toBe(row);
    const input = field.find((node) => (node.type as unknown) === "TextInput");
    expect(input.props.autoFocus).toBe(true);
    expect(hostsById(`${prefix}-toolbar-total`)).toHaveLength(1);
    expect(hostsById(`${prefix}-toolbar-end`)[0]!.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID)).toEqual(actions);
    const frames = measureHostTree(row, { width });
    expect(frames.get(field)!.width).toBeLessThanOrEqual(320);
    expect(frames.get(field)!.width).toBeGreaterThan(100);
    for (const node of [field, hostsById("search-full-conversation-toggle")[0]!, hostsById(`${prefix}-search-close`)[0]!]) {
      const frame = frames.get(node)!;
      expect(frame.left).toBeGreaterThanOrEqual(0);
      expect(frame.left + frame.width).toBeLessThanOrEqual(width);
    }
    act(() => input.props.onChangeText("needle"));
    act(() => hostsById(`${prefix}-search-close`)[0]!.props.onPress());
    expect(hostsById(`${prefix}-toolbar-search`)).toHaveLength(0);
    expect(lastBoardParams("host-1").query).toBe("needle");
    act(() => hostsById(`${prefix}-search-toggle`)[0]!.props.onPress());
    expect(hostsById(`${prefix}-toolbar-search`)[0]!.find((node) => (node.type as unknown) === "TextInput").props.value).toBe("needle");
  });

  it.each(["web", "ios", "android"])("preserves %s search through breakpoint and font-size changes", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const boardTheme = (base: number) => ({ ...(theme as object), typography: { fontSize: { ui: base } } });
    act(() => { renderer = TestRenderer.create(screen(false, {}, boardTheme(14))); });
    layOut(959);
    const prefix = os === "web" ? "desktop" : "tablet";
    act(() => hostsById(`${prefix}-search-toggle`)[0]!.props.onPress());
    act(() => hostsById(`${prefix}-toolbar-search`)[0]!.find((node) => (node.type as unknown) === "TextInput").props.onChangeText("needle"));
    layOut(960);
    expect(hostsById(`${prefix}-search-row`)).toHaveLength(0);
    expect(hostsById(`${prefix}-search-toggle`)).toHaveLength(0);
    expect(hostsById(`${prefix}-toolbar-search`)[0]!.find((node) => (node.type as unknown) === "TextInput").props.value).toBe("needle");
    act(() => renderer!.update(screen(false, {}, boardTheme(21))));
    expect(hostsById(`${prefix}-search-row`)).toHaveLength(os === "web" ? 0 : 1);
    expect(hostsById(`${prefix}-toolbar-search`)[0]!.find((node) => (node.type as unknown) === "TextInput").props.value).toBe("needle");
    act(() => hostsById(`${prefix}-search-${os === "web" ? "toggle" : "close"}`)[0]!.props.onPress());
    layOut(1600);
    expect(hostsById(`${prefix}-search-row`)).toHaveLength(0);
    expect(hostsById(`${prefix}-toolbar-search`)[0]!.find((node) => (node.type as unknown) === "TextInput").props.value).toBe("needle");
    layOut(600);
    expect(hostsById(`${prefix}-toolbar-search`)).toHaveLength(0);
    expect(lastBoardParams("host-1").query).toBe("needle");
  });

  it("opens compact search with / and closes it with Escape without clearing the query", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const { doc, key } = renderFocusBoard();
    try {
      layOut(600);
      expect(hostsById("desktop-search-row")).toHaveLength(0);
      expect(key("/").preventDefault).toHaveBeenCalled();
      const input = hostsById("desktop-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput");
      expect(input.props.autoFocus).toBe(true);
      act(() => input.props.onChangeText("needle"));
      const blur = vi.fn();
      doc.activeElement = { tagName: "INPUT", inBoard: true, blur };
      expect(key("Escape").preventDefault).toHaveBeenCalled();
      expect(blur).toHaveBeenCalled();
      expect(hostsById("desktop-search-row")).toHaveLength(0);
      expect(lastBoardParams("host-1").query).toBe("needle");
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });
  it("lets Escape close details after compact search moves inline", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    writeSidebarPreference({ open: false, width: 380 });
    const { key } = renderFocusBoard();
    try {
      layOut(600);
      key("/");
      expect(hostsById("desktop-search-row")).toHaveLength(0);
      layOut(2000);
      const card = cards()[0]!;
      act(() => card.props.onSelect(card.props.card));
      expect(hostsById("sidebar-floating")).toHaveLength(1);
      key("Escape");
      expect(hostsById("sidebar-floating")).toHaveLength(0);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("shows desktop toolbar outlines only on hover and enlarges their icons", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(2400);
    for (const id of ["search-full-conversation-toggle", "desktop-toolbar-more", "sidebar-switch", "empty-lanes-toggle", "subtasks-toggle", "archived-lane-toggle"]) {
      const button = () => hostsById(id)[0]!;
      const outline = () => {
        const node = id === "desktop-toolbar-more" || id === "empty-lanes-toggle"
          ? button().findAll((child) => (child.type as unknown) === "View")[0]!
          : button();
        return StyleSheet.flatten(node.props.style);
      };
      expect(outline(), id).toMatchObject({ borderColor: "transparent", borderRadius: 7, width: 30, height: 30 });
      act(() => button().props.onHoverIn());
      expect(outline(), id).toMatchObject({ borderColor: id === "empty-lanes-toggle" ? "#e2e2e6" : taskTokens(theme).borderStrong, borderRadius: 7, width: 30, height: 30 });
      act(() => button().props.onHoverOut());
      expect(outline(), id).toMatchObject({ borderColor: "transparent", borderRadius: 7 });
      if (id !== "sidebar-switch") expect(button().find((node) => (node.type as unknown) === "Icon").props.size, id).toBe(17);
    }
    expect(StyleSheet.flatten(hostsById("panel-mark")[0]!.props.style)).toMatchObject({ width: 16, height: 13 });
  });
  it("places the full-text switch outside the search field with an explanatory hover tip", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1200);
    const field = hostsById("desktop-toolbar-search")[0]!;
    expect(field.findAll((node) => node.props.testID === "search-full-conversation-toggle")).toHaveLength(0);
    const toggle = hostsById("search-full-conversation-toggle")[0]!;
    // The fixture uses a 15/14 font scale, so the 28-point button rounds to 30.
    expect(StyleSheet.flatten(toggle.props.style)).toMatchObject({ width: 30, height: 30, borderRadius: 7 });
    expect(toggle.props.dataSet?.bctip).toBe(BOARD_STRINGS.en.fullConversationHint(false));
    expect(toggle.props.accessibilityState.selected).toBe(false);
    act(() => toggle.props.onHoverIn());
    expect(StyleSheet.flatten(hostsById("search-full-conversation-toggle")[0]!.props.style).boxShadow).toBe(taskTokens(theme).card.buttonShadowHover);
    act(() => toggle.props.onHoverOut());
    expect(StyleSheet.flatten(hostsById("search-full-conversation-toggle")[0]!.props.style).boxShadow).toBeUndefined();
    act(() => toggle.props.onPress());
    expect(hostsById("search-full-conversation-toggle")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("search-full-conversation-toggle")[0]!.props.dataSet?.bctip).toBe(BOARD_STRINGS.en.fullConversationHint(true));
    expect(host.toast).toHaveBeenLastCalledWith(BOARD_STRINGS.en.fullConversationToast(true));
  });
  it.each(["en", "zh"] as const)("toasts the full-search mode just entered (%s)", (language) => {
    updateEnhancerPreferences({ language });
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1200);
    const toggle = () => hostsById("search-full-conversation-toggle")[0]!;
    act(() => toggle().props.onPress());
    expect(host.toast).toHaveBeenLastCalledWith(BOARD_STRINGS[language].fullConversationToast(true));
    expect(toggle().props.accessibilityState.selected).toBe(true);
    act(() => toggle().props.onPress());
    expect(host.toast).toHaveBeenLastCalledWith(BOARD_STRINGS[language].fullConversationToast(false));
    expect(toggle().props.accessibilityState.selected).toBe(false);
  });
  it("shows the full-search notice on the phone board instead of the host toast", () => {
    act(() => { renderer = TestRenderer.create(screen(true)); });
    act(() => pressable("Search").props.onPress());
    act(() => hostsById("search-full-conversation-toggle")[0]!.props.onPress());
    expect(host.toast).not.toHaveBeenCalled();
    const notice = renderer!.root.find((node) => node.props.testID === "phone-board-notice");
    expect(textOf(notice)).toBe(BOARD_STRINGS.en.fullConversationToast(true));
  });
  it("keeps the active search summary beside the desktop search field", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false, { q: "status", label: "api" })); });
    layOut(1600);
    const start = hostsById("desktop-toolbar-start")[0]!;
    const summary = hostsById("desktop-toolbar-search-summary")[0]!;
    expect(hostParentOf(summary)).toBe(start);
    // The field is on screen: the query and its clear live there, not in a chip.
    expect(hostsById("desktop-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput").props.value).toBe("status");
    expect(textOf(summary)).not.toContain("Contains");
    expect(textOf(summary)).not.toContain("status");
    expect(textOf(summary)).toContain("api");
    expect(summary.find((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel === "Labels")).toBeDefined();
    expect(textOf(summary)).toContain("Clear filters");
    const filterBar = hostsById("filter-bar")[0]!;
    expect(textOf(filterBar)).not.toContain("Contains");
    expect(textOf(filterBar)).not.toContain("api");
    expect(textOf(filterBar)).not.toContain("Clear filters");
  });
  it("drops its search and filters when the hidden-task dialog asks it to clear", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false, { q: "status", label: "api" })); });
    layOut(1600);
    expect(textOf(hostsById("desktop-toolbar-search-summary")[0]!)).toContain("api");
    act(() => requestBoardClear("host-1"));
    expect(lastBoardParams("host-1")).toMatchObject({ query: "", workspaceIds: [], providers: [], labels: [] });
    expect(hostsById("desktop-toolbar-search-summary")).toHaveLength(0);
  });
  it.each(["en", "zh"] as const)("shows all six toolbar shortcuts in %s hover tips without a sidebar key hint", (language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    updateEnhancerPreferences({ language });
    setTasksSettingsOpener(vi.fn());
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(2400);
    for (const [id, key] of [
      ["empty-lanes-toggle", "E"], ["subtasks-toggle", "S"], ["archived-lane-toggle", "A"],
      ["sidebar-switch", "]"],
    ] as const) {
      expect(hostsById(id)[0]!.props.dataSet.bctip.endsWith(`(${key})`)).toBe(true);
    }
    act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
    expect(textOf(menuOption(BOARD_STRINGS[language].emptyGroups.hide))).toContain("G");
    expect(textOf(menuOption(BOARD_STRINGS[language].openSettings))).toContain(",");
    const toolbarText = textOf(hostsById("desktop-toolbar")[0]!);
    expect(toolbarText).toContain(language === "zh" ? "空格" : "Space");
    expect(toolbarText).not.toContain(language === "zh" ? "Space" : "空格");
    expect(toolbarText).toContain(BOARD_STRINGS[language].keys.search);
    expect(toolbarText).not.toContain(BOARD_STRINGS[language].sidebar.key);
  });

  it("runs toolbar shortcuts through the same controls and toggles their latest state", async () => {
    const openSettings = vi.fn();
    setTasksSettingsOpener(openSettings);
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const browser = renderFocusBoard();
    try {
      const selected = (id: string) => hostsById(id)[0]!.props.accessibilityState.selected;
      const checked = (id: string) => hostsById(id)[0]!.props.accessibilityState.checked;
      const initialSidebar = selected("sidebar-switch");
      browser.key("i");
      expect(selected("sidebar-switch")).toBe(initialSidebar);
      browser.key("]");
      expect(selected("sidebar-switch")).toBe(!initialSidebar);
      browser.key("]");
      expect(selected("sidebar-switch")).toBe(initialSidebar);
      browser.key(",");
      expect(openSettings).toHaveBeenCalledTimes(1);
      for (const [key, id] of [["s", "subtasks-toggle"], ["a", "archived-lane-toggle"]] as const) {
        const initial = checked(id);
        await act(async () => { browser.key(key); });
        expect(checked(id)).toBe(!initial);
        await act(async () => { browser.key(key); });
        expect(checked(id)).toBe(initial);
      }
      const groups = deviceTasksStore().snapshot().values?.showEmptyGroups;
      await act(async () => { browser.key("g"); });
      expect(deviceTasksStore().snapshot().values?.showEmptyGroups).toBe(!groups);
      await act(async () => { browser.key("g"); });
      expect(deviceTasksStore().snapshot().values?.showEmptyGroups).toBe(groups);
      act(() => renderer!.root.findByType(DesktopToolbar).props.board.setParams((params: object) => ({ ...params, query: "no matching tasks" })));
      expect(hostsById("empty-lanes-toggle")[0]!.props.disabled).toBe(false);
      browser.key("e");
      expect(selected("empty-lanes-toggle")).toBe(true);
      browser.key("e");
      expect(selected("empty-lanes-toggle")).toBe(false);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("yields toolbar shortcuts to typing, other surfaces, modifiers and composition, and ignores repeats", () => {
    const openSettings = vi.fn();
    setTasksSettingsOpener(openSettings);
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const browser = renderFocusBoard();
    try {
      const state = () => [...["sidebar-switch", "subtasks-toggle", "archived-lane-toggle"].map((id) => hostsById(id)[0]!.props.accessibilityState), deviceTasksStore().snapshot().values?.showEmptyGroups];
      const initial = state();
      for (const key of ["]", ",", "e", "s", "a", "g"]) {
        for (const active of [{ tagName: "INPUT", inBoard: true }, { tagName: "TEXTAREA", inBoard: true }, { isContentEditable: true, inBoard: true }, { inBoard: false }]) {
          browser.doc.activeElement = active;
          expect(browser.key(key).preventDefault).not.toHaveBeenCalled();
        }
        browser.doc.activeElement = browser.root;
        for (const options of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }]) {
          expect(browser.key(key, false, options).preventDefault).not.toHaveBeenCalled();
        }
        browser.key(key, false, { repeat: true });
      }
      expect(state()).toEqual(initial);
      expect(openSettings).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each(["en", "zh"] as const)("opens settings between the group and sidebar switches, including the compact %s menu", (language) => {
    updateEnhancerPreferences({ language });
    const openSettings = vi.fn();
    setTasksSettingsOpener(openSettings);
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(2400);
    const controls = hostsById("desktop-toolbar-end")[0]!.findAll((node) => (node.type as unknown) === "Pressable");
    expect(controls.map((node) => node.props.testID)).toEqual(["desktop-toolbar-more", "sidebar-switch"]);
    act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
    act(() => menuOption(BOARD_STRINGS[language].openSettings).props.onPress());
    expect(openSettings).toHaveBeenCalledTimes(1);
    // Two controls fit in this slot; adding settings must fold the actions.
    act(() => hostsById("desktop-toolbar-end")[0]!.props.onLayout({ nativeEvent: { layout: { width: 20 } } }));
    act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
    act(() => menuOption(BOARD_STRINGS[language].openSettings).props.onPress());
    expect(openSettings).toHaveBeenCalledTimes(2);
  });

  it("shows the update dot on the desktop more button and settings item only for a newer release", async () => {
    setTasksSettingsOpener(vi.fn());
    host.updateState = { state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.1.0", currentBuild: 202610311637, latestBuild: 202610311700 }, notes: { status: "missing" } };
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    expect(hostsById("desktop-more-update-dot")).toHaveLength(1);
    act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
    expect(hostsById("desktop-settings-update-dot")).toHaveLength(1);
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === `${BOARD_STRINGS.en.openSettings}, Update available`)).toHaveLength(1);
    for (const result of [
      { state: "done", versions: { status: "available", current: "1.0.1", latest: "1.0.1", currentBuild: 202610311637, latestBuild: 202610311637 } },
      { state: "done", versions: { status: "unavailable" } },
      { state: "failed" },
    ]) {
      host.updateState = result;
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(hostsById("desktop-more-update-dot")).toHaveLength(0);
      expect(hostsById("desktop-settings-update-dot")).toHaveLength(0);
    }
  });

  it("does not show desktop update indicators on mobile", async () => {
    host.updateState = { state: "done", versions: { status: "available", current: "1.0.0", latest: "1.1.0", currentBuild: 202610311637, latestBuild: 202610311700 } };
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    expect(hostsById("desktop-more-update-dot")).toHaveLength(0);
    expect(hostsById("desktop-settings-update-dot")).toHaveLength(0);
  });

  it.each(["web", "ios"] as const)("%s keeps every action available when a narrow side slot needs the View menu", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(400);
    const prefix = os === "web" ? "desktop" : "tablet";
    act(() => hostsById(`${prefix}-toolbar-end`)[0]!.props.onLayout({ nativeEvent: { layout: { width: os === "web" ? 100 : 70 } } }));
    const open = hostsById(os === "web" ? "desktop-toolbar-more" : "tablet-view")[0]!;
    act(() => open.props.onPress());
    expect(menuOption(BOARD_STRINGS.en.archivedLane.row)).toBeDefined();
    expect(menuOption(BOARD_STRINGS.en.emptyLanes.collapse)).toBeDefined();
    if (os === "web") expect(menuOption(BOARD_STRINGS.en.sidebar.show)).toBeDefined();
    expect(hostsById("toolbar-filters")).toHaveLength(1);
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    expect(hostsById("filter-sheet-scroll")).toHaveLength(1);
  });

  it.each(["en", "zh"] as const)("keeps search left, the complete %s count centred and actions right on web and Pad", (language) => {
    updateEnhancerPreferences({ language });
    for (const [os, width] of [["web", 1600], ["web", 600], ["ios", 1024], ["ios", 800], ["ios", 400], ["android", 1024], ["android", 600], ["android", 400]] as const) {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(width);
      const prefix = os === "web" ? "desktop" : "tablet";
      const bar = hostsById(`${prefix}-toolbar`)[0]!;
      const start = hostsById(`${prefix}-toolbar-start`)[0]!;
      const end = hostsById(`${prefix}-toolbar-end`)[0]!;
      const total = hostsById(`${prefix}-toolbar-total`)[0]!;
      expect(hostParentOf(start)).toBe(bar);
      expect(hostParentOf(total)).toBe(bar);
      expect(hostParentOf(end)).toBe(bar);
      if (os !== "web") expect(StyleSheet.flatten(start.props.style)).toMatchObject({ marginLeft: -8, marginRight: 8 });
      expect(StyleSheet.flatten(start.props.style)).toMatchObject({ flex: 1, flexBasis: 0 });
      expect(StyleSheet.flatten(end.props.style)).toMatchObject(os !== "web" && width < 440 ? { flex: 0, flexBasis: "auto" } : { flex: 1, flexBasis: 0 });
      // Equal flex alone is insufficient in Yoga when one side has a larger minimum.
      expect(StyleSheet.flatten(start.props.style).minWidth).toBe(StyleSheet.flatten(end.props.style).minWidth);
      if (os !== "web" && width >= 440 && width < 680) expect(StyleSheet.flatten(end.props.style).minWidth).toBeGreaterThan(0);
      else expect(StyleSheet.flatten(end.props.style).minWidth).toBe(0);
      expect(StyleSheet.flatten(end.props.style).justifyContent).toBe("flex-end");
      expect(start.findAll((node) => (node.type as unknown) === "TextInput" || ["tablet-search-toggle", "desktop-search-toggle"].includes(node.props.testID)).length).toBeGreaterThan(0);
      expect(StyleSheet.flatten(total.props.style).flexShrink).toBe(0);
      expect(textOf(total.findByType(RollingTotal))).toBe(BOARD_STRINGS[language].total(6));
      const slots = bar.children.filter((node) => typeof node !== "string" && /toolbar-(start|total|end)$/.test(node.props.testID ?? ""));
      expect(slots.map((node) => (node as ReactTestInstance).props.testID)).toEqual([`${prefix}-toolbar-start`, `${prefix}-toolbar-total`, `${prefix}-toolbar-end`]);
      act(() => renderer!.unmount());
    }
    renderer = undefined;
    expect(BOARD_STRINGS.zh.total(116)).toBe("116 个任务");
    expect(BOARD_STRINGS.en.total(1)).toBe("1 task");
    expect(BOARD_STRINGS.en.total(116)).toBe("116 tasks");
  });


});

describe("Two-state toolbar icons", () => {
  it.each([
    ["web", 1600, false], ["web", 600, false],
    ["ios", 1200, false], ["android", 1200, false],
    ["web", 390, true], ["ios", 390, true], ["android", 390, true],
  ] as const)("keeps %s icons unfilled at %i pt (phone=%s)", async (os, width, phone) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(phone)); });
    if (!phone) layOut(width);
    const ids = phone ? ["phone-subtasks", "phone-archived"]
      : os === "web" ? width === 600 ? ["toolbar-archived", "sidebar-switch"]
        : ["subtasks-toggle", "archived-lane-toggle", "sidebar-switch", "search-full-conversation-toggle"]
        : ["subtasks-toggle", "sidebar-switch", "search-full-conversation-toggle"];
    for (const id of ids) {
      const button = () => hostsById(id)[0]!;
      const state = () => button().props.accessibilityState;
      const glyph = () => button().findAll((node) => (node.type as unknown) === "Icon")
        .map((node) => node.props.icon ?? node.props.name);
      const unfilled = () => {
        for (const node of [button(), ...button().findAll((node) => typeof node.type === "string")]) {
          expect(StyleSheet.flatten(node.props.style)?.backgroundColor, id).not.toBe("#e4e4e7");
        }
      };
      const initial = state();
      const initialGlyph = glyph();
      const initialSlash = button().findAllByType(SlashMark).length;
      const initialPanel = hostsById("panel-mark-fill")[0]?.props.style;
      unfilled();
      await act(async () => button().props.onPress());
      expect(state(), id).not.toEqual(initial);
      unfilled();
      if (id.includes("archived")) expect(button().findAllByType(SlashMark).length).not.toBe(initialSlash);
      else if (id === "sidebar-switch") expect(hostsById("panel-mark-fill")[0]!.props.style).not.toEqual(initialPanel);
      else expect(glyph(), id).not.toEqual(initialGlyph);
      if (id.includes("subtasks")) {
        const badge = hostsById(`${id}-count`)[0]!;
        expect(textOf(badge)).toBe("1");
        expect(StyleSheet.flatten(hostParentOf(badge)!.props.style).borderColor).toBe("#ffffff");
      }
      await act(async () => button().props.onPress());
      expect(state(), id).toEqual(initial);
      unfilled();
    }
  });
});

describe("F1: Web switch Space activation", () => {
  const key = (extra: Record<string, unknown> = {}) => {
    const target = {};
    return { key: " ", target, currentTarget: target, nativeEvent: {}, preventDefault: vi.fn(), ...extra };
  };
  const setup = (width: number) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    if (width === 600) act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    return () => hostsById(width === 600 ? "filter-sheet-empty-groups" : "subtasks-toggle")[0]!;
  };

  it.each([1600, 600])("at %i pt prevents Space scrolling and toggles once on release", (width) => {
    const toggle = setup(width);
    expect(toggle().props["aria-checked"]).toBe(true);
    const down = key();
    act(() => toggle().props.onKeyDown(down));
    expect(down.preventDefault).toHaveBeenCalledOnce();
    const repeat = key({ repeat: true });
    act(() => toggle().props.onKeyDown(repeat));
    expect(repeat.preventDefault).toHaveBeenCalledOnce();
    expect(toggle().props["aria-checked"]).toBe(true);
    act(() => toggle().props.onKeyUp(key()));
    expect(toggle().props["aria-checked"]).toBe(false);
    act(() => toggle().props.onKeyUp(key()));
    expect(toggle().props["aria-checked"]).toBe(false);
    for (const flags of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { nativeEvent: { isComposing: true } }]) {
      const event = key(flags);
      act(() => { toggle().props.onKeyDown(event); toggle().props.onKeyUp(event); });
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(toggle().props["aria-checked"]).toBe(false);
    }
    const enter = key({ key: "Enter" });
    act(() => { toggle().props.onKeyDown(enter); toggle().props.onKeyUp(enter); });
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(toggle().props["aria-checked"]).toBe(false);
    // RNW owns Enter's existing press callback; the Space handlers leave it alone.
    act(() => toggle().props.onPress());
    expect(toggle().props["aria-checked"]).toBe(true);
  });

  it("badges the subtasks switch with the pending cards hiding subtasks leaves out", () => {
    setup(1600);
    expect(hostsById("subtasks-toggle-count")).toHaveLength(0);
    act(() => hostsById("subtasks-toggle")[0]!.props.onPress());
    // The running child shows on its running parent's card, so the sidebar counts one card more than the lane.
    expect(textOf(hostsById("subtasks-toggle-count")[0]!)).toBe("1");
    expect(StyleSheet.flatten(hostParentOf(hostsById("subtasks-toggle-count")[0]!)!.props.style).borderColor).toBe("#ffffff");
    act(() => hostsById("subtasks-toggle")[0]!.props.onPress());
    expect(hostsById("subtasks-toggle-count")).toHaveLength(0);
  });

  it.each(["selected", "virtual"])("gives a focused BarSwitch Space while a card is %s", (mode) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    try {
      const board = renderFocusBoard();
      const selected = cards().find((card) => card.props.card.id === "sample-running")!;
      act(() => selected.props.onSelect(selected.props.card));
      if (mode === "virtual") board.key("j");
      board.focus(); // A toolbar control inside the board, with no data-bctaskcard attribute.
      const title = textOf(hostsById("detail-title")[0]!);
      const toggle = () => hostsById("subtasks-toggle")[0]!;
      const down = board.key(" ");
      expect(down.preventDefault).not.toHaveBeenCalled();
      expect(down.stopPropagation).not.toHaveBeenCalled();
      act(() => toggle().props.onKeyDown(key()));
      act(() => toggle().props.onKeyUp(key()));
      expect(toggle().props["aria-checked"]).toBe(false);
      expect(textOf(hostsById("detail-title")[0]!)).toBe(title);
      expect(openAgent).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each(["ios", "android"])("adds no keyboard props to native visibility menu items on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    const switches = renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem" && node.props.accessibilityState?.checked !== undefined);
    expect(switches.length).toBeGreaterThan(1);
    for (const toggle of switches) for (const prop of ["onKeyDown", "onKeyUp", "onBlur"]) expect(toggle.props).not.toHaveProperty(prop);
  });
});

describe("Tasks board, desktop", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });

  it("restores the selected window after a page reload and honors a different route", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    try {
      await act(async () => { renderer = TestRenderer.create(screen(false, { win: "24h" })); });
      layOut(1600);
      act(() => renderer!.root.findAllByType(WindowSegments)[0]!.props.onChange("7d"));
      expect(renderer!.root.findAllByType(WindowSegments)[0]!.props.value).toBe("7d");
      act(() => renderer!.unmount());
      resetBoardSessions();
      await act(async () => { renderer = TestRenderer.create(screen(false, { win: "24h" })); });
      layOut(1600);
      expect(renderer!.root.findAllByType(WindowSegments)[0]!.props.value).toBe("7d");
      await act(async () => renderer!.update(screen(false, { win: "all" })));
      expect(renderer!.root.findAllByType(WindowSegments)[0]!.props.value).toBe("all");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["web", 1600, "en"],
    ["web", 600, "zh"],
    ["ios", 800, "zh"],
    ["android", 800, "en"],
  ] as const)("%s at %i pt clears the title search in %s without changing other filters", async (os, width, language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    await act(async () => { renderer = TestRenderer.create(screen(false, { agent: "codex", ws: "wks_sample", win: "7d", sort: "title-asc" })); });
    layOut(width);
    const toggle = hostsById(os === "web" ? "desktop-search-toggle" : "tablet-search-toggle")[0];
    if (toggle) act(() => toggle.props.onPress());
    const field = () => renderer!.root.find((node) => (node.type as unknown) === "TextInput" && node.props.accessibilityLabel === BOARD_STRINGS[language].search);
    const clear = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === BOARD_STRINGS[language].menuSearch.clear);
    const before = lastBoardParams("host-1");
    const frameStyle = StyleSheet.flatten(hostParentOf(field())!.props.style);
    expect(clear()).toHaveLength(0);
    for (const query of ["ping", "   "]) {
      await act(async () => field().props.onChangeText(query));
      expect(clear()).toHaveLength(1);
      expect(clear()[0]!.props.accessibilityRole).toBe("button");
      const frame = hostParentOf(field())!;
      expect(hostParentOf(clear()[0]!)).toBe(frame);
      expect(StyleSheet.flatten(frame.props.style)).toEqual(frameStyle);
      expect(frame.findAll((node) => typeof node.type === "string" && hostParentOf(node) === frame).at(-1)).toBe(clear()[0]);
      await act(async () => clear()[0]!.props.onPress());
      expect(field().props.value).toBe("");
      expect(clear()).toHaveLength(0);
      expect(lastBoardParams("host-1")).toEqual(before);
      expect(cards().map((card) => card.props.card.id)).toContain("sample-running");
    }
  });

  it("rolls the counts and moves the cards through a filter, a done window or the subtasks switch, never through a search or a sort", async () => {
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
    act(() => renderer!.root.find((node) => (node.type as unknown) === "TextInput" && [BOARD_STRINGS.en.search, BOARD_STRINGS.zh.search].includes(node.props.accessibilityLabel)).props.onChangeText("api"));
    expect(scopes().every((scope, index) => scope !== before[index])).toBe(true);
    act(() => renderer!.unmount());

    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    act(() => hostsById(hostsById("tablet-toolbar").length ? "toolbar-filters" : "filter-bar-more")[0]!.props.onPress());
    const tablet = scopes();
    // The total shows its number at once there; the lanes' counts roll as on web.
    const totals = renderer!.root.findAll((node) => node.type === RollingTotal);
    expect(totals.length).toBeGreaterThan(0);
    for (const total of totals) expect(total.findAll((node) => node.type === RollingCount)).toHaveLength(0);
    act(() => hostsById("subtasks-toggle")[0]!.props.onPress());
    pick("24h");
    expect(scopes()).toEqual(tablet);
    act(() => renderer!.root.findByType(TabletToolbar).props.board.setParams((params: BoardParams) => ({ ...params, sort: { key: "title", direction: "asc" } })));
    // With the filter panel open, the lanes behind it take the change once its switch has slid.
    await panelLag();
    expect(scopes().every((scope, index) => scope !== tablet[index])).toBe(true);
  });

  it.each([10, 14, 21])("follows Paseo's %i px UI setting across the toolbar, cards and sort menu", (base) => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => key === APP_SETTINGS_KEY ? JSON.stringify({ uiBaseFontSize: base, contentFontSize: 19, codeFontSize: 18 }) : null,
    });
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(2400);
      const font = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style).fontSize;
      const text = (value: string) => renderer!.root.find((node) => (node.type as unknown) === "Text" && textOf(node) === value);
      // Every size is a step of the host's ramp (sm 12, base 14), scaled as the host scales it.
      expect(font(text("Move"))).toBe(Math.round(12 * base / 14));
      const search = renderer!.root.find((node) => (node.type as unknown) === "TextInput" && [BOARD_STRINGS.en.search, BOARD_STRINGS.zh.search].includes(node.props.accessibilityLabel));
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
      act(() => hostsById("detail-tab-info")[0]!.props.onPress());
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
      const search = renderer!.root.find((node) => (node.type as unknown) === "TextInput" && [BOARD_STRINGS.en.search, BOARD_STRINGS.zh.search].includes(node.props.accessibilityLabel));
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
    for (const name of ["Waiting", "Running", "Review", "Done"]) expect(text).toContain(name);
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
    expect(textOf(renderer!.root)).toContain("Clear filters");
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

  it("changes only the collapsed lane background while pressed on iPad", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    act(() => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane")[1]!.props.onPress());
    const strip = () => pressable("Expand lane: Running");
    const idle = StyleSheet.flatten(strip().props.style);
    vi.useFakeTimers();
    act(() => strip().props.onPressIn({ nativeEvent: { pageX: 100, pageY: 40 } }));
    expect(StyleSheet.flatten(strip().props.style)).toEqual(idle);
    act(() => { vi.advanceTimersByTime(100); });
    const pressed = StyleSheet.flatten(strip().props.style);
    expect(pressed.backgroundColor).not.toBe(idle.backgroundColor);
    expect({ ...pressed, backgroundColor: idle.backgroundColor }).toEqual(idle);
    act(() => strip().props.onPressOut({}));
    expect(StyleSheet.flatten(strip().props.style)).toEqual(idle);
    vi.useRealTimers();
    act(() => strip().props.onPress());
    expect(cards().map((card) => card.props.card.id)).toContain("sample-running");
  });

  it.each(["web", "ios"])("toggles only the displayed empty lanes on %s and remembers their state", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, { q: "ring" })); });
    layOut(1600);
    if (os === "ios") act(() => hostsById("tablet-view")[0]!.props.onPress());
    const button = () => os === "ios" ? renderer!.root.find((n) => (n.type as unknown) === "Pressable" && n.props.accessibilityRole === "menuitem" && /^(Expand|Collapse) empty lanes/.test(textOf(n))) : hostsById("empty-lanes-toggle")[0]!;
    const icon = () => button().findAll((node) => (node.type as unknown) === "Icon")[0]!.props.name;
    expect(button().props.accessibilityState[os === "ios" ? "checked" : "selected"]).toBe(false);
    expect(icon()).toBe("FoldHorizontal");
    if (os === "web") expect(StyleSheet.flatten(button().props.style).width).toBe(StyleSheet.flatten(hostsById("sidebar-switch")[0]!.props.style).width);
    // Keep a manually folded nonempty lane folded through both bulk operations.
    act(() => hostsById("lane-header-running")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Collapse lane")[0]!.props.onPress());
    act(() => button().props.onPress());
    expect(rememberedCollapsed("host-1")).toEqual(["running", "needs_input", "review", "done"]);
    expect(button().props.accessibilityState[os === "ios" ? "checked" : "selected"]).toBe(true);
    expect(os === "ios" ? textOf(button()) : button().props.accessibilityLabel).toBe("Expand empty lanes");
    expect(icon()).toBe("UnfoldHorizontal");
    // A manual expansion changes the bulk switch back to collapse.
    act(() => pressable("Expand lane: Done").props.onPress());
    expect(button().props.accessibilityState[os === "ios" ? "checked" : "selected"]).toBe(false);
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
    const swap = hostParentOf(pressable("Expand lane: Waiting").findAll((node) => typeof node.type === "string")[0]!)!;
    expect(StyleSheet.flatten(swap.props.style)).toMatchObject({ width: 40, opacity: { __value: 0 } });
    expect(clip("running")).toBe(340);
    // A window resize changes lane sizing at once, independently of the sidebar.
    const share = (1100 - 2 * 12 - 3 * 8 - 40) / 3;
    layOut(1100);
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

  it.each([
    ["web", 600, false], ["web", 1300, false], ["web", 2000, false], ["web", 1300, true],
    ["ios", 600, false], ["ios", 1300, true], ["android", 600, false],
  ] as const)("%s slides the whole archived lane without resizing the other lanes at %i pt (folded=%s)", (os, viewport, folded) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    if (folded) rememberCollapsed("host-1", ["archived"]);
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(viewport);
    const clip = (lane: string) => {
      const width = StyleSheet.flatten(hostsById(`lane-${lane}`)[0]!.props.style).width as number | { __value: number };
      return typeof width === "number" ? width : { easing: width.__value };
    };
    // Archived uses the four active lanes' width, extending the scrollable row.
    const four = clip("done") as number;
    const before = lanesScroll().props.contentContainerStyle.width;
    act(() => { void deviceTasksStore().update({ showArchived: true }); renderer!.update(screen(false)); });
    // The full panel travels, including its background; no width animation or content fade.
    const archivedWidth = folded ? 40 : four;
    expect(clip("archived")).toBe(archivedWidth);
    const surface = hostsById("lane-surface-archived")[0]!;
    expect(StyleSheet.flatten(surface.props.style)).toMatchObject({ width: archivedWidth, transform: [{ translateX: { __value: archivedWidth + 8 } }] });
    expect(LANE_ORDER.map(clip)).toEqual([four, four, four, four]);
    const shownWidth = Math.max(before, 2 * 12 + 4 * 8 + 4 * four + archivedWidth);
    expect(lanesScroll().props.contentContainerStyle.width).toBe(shownWidth);
    const inside = (lane: string) => {
      const swap = hostsById(`lane-${lane}`)[0]!.findAll((node) => {
        const style = typeof node.type === "string" ? StyleSheet.flatten(node.props.style) : null;
        return !!style && style.flex === 1 && style.flexDirection === "row" && typeof style.width === "number";
      })[0]!;
      return StyleSheet.flatten(swap.props.style).width as number;
    };
    expect(inside("done")).toBe(four);
    expect(inside("archived")).toBe(archivedWidth);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => { void deviceTasksStore().update({ showArchived: false }); renderer!.update(screen(false)); });
    // Keep the entire scroll extent until the outgoing panel has left.
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(hostsById("lane-archived")[0]!.props.pointerEvents).toBe("none");
    expect(inside("archived")).toBe(archivedWidth);
    expect(inside("done")).toBe(four);
    expect(LANE_ORDER.map(clip)).toEqual([four, four, four, four]);
    expect(clip("archived")).toBe(archivedWidth);
    expect(lanesScroll().props.contentContainerStyle.width).toBe(shownWidth);
    for (const lane of [...LANE_ORDER, "archived"]) expect(StyleSheet.flatten(hostsById(`lane-${lane}`)[0]!.props.style).flexShrink).toBe(0);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(hostsById("lane-archived")).toHaveLength(0);
    expect(lanesScroll().props.contentContainerStyle.width).toBe(before);
  });

  it("reverses an archived lane slide from its current position and cancels its pending removal", () => {
    const timing = vi.spyOn(Animated, "timing");
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(1300);
      const toggle = (on: boolean) => act(() => { void deviceTasksStore().update({ showArchived: on }); renderer!.update(screen(false)); });
      const position = () => StyleSheet.flatten(hostsById("lane-surface-archived")[0]!.props.style).transform[0].translateX as Animated.Value;
      toggle(true);
      const x = position();
      const distance = StyleSheet.flatten(hostsById("lane-archived")[0]!.props.style).width + 8;
      expect(timing).toHaveBeenCalledWith(x, expect.objectContaining({ toValue: 0, duration: 220 }));
      act(() => x.setValue(distance / 2));
      act(() => { vi.advanceTimersByTime(100); });
      toggle(false);
      expect(timing).toHaveBeenCalledWith(x, expect.objectContaining({ toValue: distance, duration: 220 }));
      expect(position()).toBe(x);
      expect((x as unknown as { __value: number }).__value).toBe(distance / 2);
      act(() => { vi.advanceTimersByTime(100); });
      toggle(true);
      expect(position()).toBe(x);
      expect((x as unknown as { __value: number }).__value).toBe(distance / 2);
      expect(hostsById("lane-archived")[0]!.props.pointerEvents).toBe("auto");
      act(() => { vi.advanceTimersByTime(300); });
      expect(hostsById("lane-archived")).toHaveLength(1);
      expect((x as unknown as { __value: number }).__value).toBe(0);
    } finally {
      timing.mockRestore();
    }
  });

  it("finishes the archived exit immediately when reduced motion is enabled mid-slide", async () => {
    let onReduce: (enabled: boolean) => void = () => {};
    const addListener = AccessibilityInfo.addEventListener;
    const subscription = vi.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, listener: (enabled: boolean) => void) => {
      if (name === "reduceMotionChanged") onReduce = listener;
      return addListener("reduceMotionChanged", listener);
    }) as typeof AccessibilityInfo.addEventListener);
    try {
      await act(async () => { renderer = TestRenderer.create(screen(false)); });
      layOut(1300);
      const toggle = (on: boolean) => act(() => { void deviceTasksStore().update({ showArchived: on }); renderer!.update(screen(false)); });
      toggle(true);
      toggle(false);
      expect(hostsById("lane-archived")).toHaveLength(1);
      act(() => onReduce(true));
      expect(hostsById("lane-archived")).toHaveLength(0);
      toggle(true);
      expect(StyleSheet.flatten(hostsById("lane-surface-archived")[0]!.props.style)).toMatchObject({ transform: [{ translateX: { __value: 0 } }] });
      toggle(false);
      expect(hostsById("lane-archived")).toHaveLength(0);
    } finally {
      act(() => onReduce(false));
      subscription.mockRestore();
    }
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
    finishSidebarCloseImmediately();
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
    const mark = () => StyleSheet.flatten(hostsById("panel-mark-fill")[0]!.props.style);
    expect(mark()).toMatchObject({ width: 3.5, height: 7 });
    // Closing immediately releases the sidebar's slot back to the lanes.
    act(() => renderer!.root.findByProps({ testID: "sidebar-switch" }).props.onPress());
    expect(hostsById("sidebar-slot")).toHaveLength(0);
    expect(lanesScroll().props.contentContainerStyle).toMatchObject({ width: 2000 });
    expect(readSidebarPreference().open).toBe(false);
    expect(mark()).toMatchObject({ width: 1.5, height: 7 });
  });

  it("aligns the desktop sidebar cards with the filter bar and uses a smaller left inset", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(2000);
    const sidebar = StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style);
    const filters = StyleSheet.flatten(hostsById("filter-bar")[0]!.props.style);
    expect(sidebar.paddingLeft).toBe(10);
    expect(sidebar.paddingRight + sidebar.right).toBe(filters.paddingRight);
    expect(sidebar.width - sidebar.paddingLeft - sidebar.paddingRight).toBe(366);
    expect(lanesScroll().props.contentContainerStyle.width).toBe(2000 - 380 - 12);
  });

  it.each([900, 1600])("moves the complete desktop sidebar with its layout slot at %i pt", (viewport) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const Value = Animated.Value;
    vi.spyOn(Animated, "Value").mockImplementation(function (initial) {
      const value = new Value(initial);
      const interpolate = value.interpolate.bind(value);
      value.interpolate = ((config) => {
        if (config.inputRange.length !== 2 || !config.outputRange.every((entry) => typeof entry === "number")) return interpolate(config);
        return { get __value() {
          const fraction = (Number(liveNumber(value)) - config.inputRange[0]!) / (config.inputRange[1]! - config.inputRange[0]!);
          return Number(config.outputRange[0]) + fraction * (Number(config.outputRange[1]) - Number(config.outputRange[0]));
        } };
      }) as typeof value.interpolate;
      return value;
    });
    const timing = vi.spyOn(Animated, "timing");
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(viewport);
    if (viewport === 900) toggleSidebarControl();
    const panel = hostsById(viewport === 900 ? "sidebar-floating" : "sidebar-inline")[0]!;
    const content = hostsById("details-sidebar")[0]!;
    const progress = timing.mock.calls.filter(([, config]) => config.toValue === 1 && config.duration === 240).at(-1)![0] as Animated.Value;
    expect(timing).toHaveBeenCalledWith(progress, expect.objectContaining({ duration: 240, easing: MOTION.ease }));
    expect(hostParentOf(content)).toBe(panel);
    expect(panel.findAll((node) => node === hostsById("sidebar-resize")[0])).toHaveLength(1);
    expect(StyleSheet.flatten(hostsById("tasks-board-area")[0]!.props.style).overflow).toBe("hidden");
    const sample = (fraction: number) => {
      act(() => progress.setValue(fraction));
      const slot = StyleSheet.flatten(hostsById("sidebar-slot")[0]!.props.style);
      const surface = StyleSheet.flatten(panel.props.style);
      const reserved = Number(liveNumber(slot.width));
      const shift = Number(liveNumber(surface.transform[0].translateX));
      // Its background, border/shadow, handle and bottom share one fixed-size moving ancestor.
      expect(surface).toMatchObject({ width: 380, top: 0, bottom: 0, paddingTop: 4, paddingBottom: 12, opacity: 1 });
      expect(surface.boxShadow).toBeTruthy();
      expect(reserved).toBeCloseTo(392 * fraction);
      expect(shift).toBeCloseTo(392 * (1 - fraction));
      expect(shift + reserved).toBeCloseTo(392);
      expect(viewport - surface.right - surface.width + shift).toBeCloseTo(viewport - reserved);
      expect(hostsById("details-sidebar")[0]).toBe(content);
    };
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) sample(fraction);
    toggleSidebarControl();
    for (const fraction of [0.75, 0.5]) sample(fraction);
    toggleSidebarControl();
    sample(0.5);
    sample(1);
    toggleSidebarControl();
    for (const fraction of [0.5, 0.25, 0]) sample(fraction);
  });

  it("redraws only the selected lane when the desktop sidebar opens or closes", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    finishSidebarCloseImmediately();
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(2400);
    const target = cards().find((node) => node.props.card.id === "sample-running")!;
    const count = cards().filter((node) => node.props.card.lane === "running").length;
    for (const action of [() => target.props.onSelect(target.props.card), toggleSidebarControl, toggleSidebarControl]) {
      const before = { ...host.laneRowRenders };
      await act(async () => action());
      expect(Object.fromEntries(LANE_ORDER.map((lane) => [lane, (host.laneRowRenders[lane] ?? 0) - (before[lane] ?? 0)]))).toEqual({ needs_input: 0, running: count, review: 0, done: 0 });
    }
    expect(cards().find((node) => node.props.card.id === target.props.card.id)!.props.current).toBe(true);
  });

  it("keeps selection in the rendered lane while the live lookup has moved ahead", async () => {
    const handle = (data as unknown as { __handle: { byId: Map<string, TaskCard> } }).__handle;
    const saved = handle.byId;
    try {
      await act(async () => { renderer = TestRenderer.create(screen(false)); });
      layOut(900);
      const selected = () => cards().find((node) => node.props.card.id === "sample-running")!;
      await act(async () => selected().props.onSelect(selected().props.card));
      handle.byId = new Map(saved).set("sample-running", { ...saved.get("sample-running")!, lane: "review" });
      await act(async () => renderer!.update(screen(false)));
      expect(selected().props.card.lane).toBe("running");
      expect(selected().props.current).toBe(true);
      expect(cards().filter((node) => node.props.current).map((node) => node.props.card.id)).toEqual(["sample-running"]);
    } finally {
      handle.byId = saved;
    }
  });

  it.each(["child", "provider"] as const)("keeps a selected %s subtask current across lane moves, floating close and deletion", async (kind) => {
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }>; byId: Map<string, TaskCard> } }).__handle;
    const saved = { lanes: handle.lanes, byId: handle.byId };
    const parent = saved.byId.get("sample-running")!;
    const child = saved.byId.get("sample-child-1")!;
    try {
      if (kind === "provider") {
        const next: TaskCard = { ...parent, children: [{ id: "provider-selection", title: "Provider child", kind: "provider" as const, lane: "running" as const, status: "running", timing: child.timing }] };
        handle.lanes = { ...saved.lanes, running: { ...saved.lanes.running!, cards: [next] } };
        handle.byId = new Map(saved.byId).set(parent.id, next);
      }
      finishSidebarCloseImmediately();
      await act(async () => { renderer = TestRenderer.create(screen(false)); });
      layOut(900);
      const id = kind === "provider" ? "provider-selection" : child.id;
      const selected = () => cards().find((node) => node.props.card.id === id)!;
      await act(async () => selected().props.onSelect(selected().props.card));
      expect(cards().filter((node) => node.props.current).map((node) => node.props.card.id)).toEqual([id]);
      expect(hostsById("sidebar-floating")).toHaveLength(1);
      await act(async () => toggleSidebarControl());
      expect(selected().props.current).toBe(false);
      await act(async () => toggleSidebarControl());
      expect(selected().props.current).toBe(true);
      const moved: TaskCard = { ...selected().props.card, lane: "review" };
      const movedParent: TaskCard = { ...parent, children: [{ id, title: moved.title, kind: "provider" as const, lane: "review" as const, status: "running", timing: moved.timing }] };
      handle.lanes = {
        ...handle.lanes,
        running: { ...handle.lanes.running!, cards: kind === "provider" ? [movedParent] : handle.lanes.running!.cards.filter((card) => card.id !== id) },
        review: { ...handle.lanes.review!, cards: kind === "provider" ? handle.lanes.review!.cards : [...handle.lanes.review!.cards, moved] },
      };
      handle.byId = new Map(handle.byId).set(kind === "provider" ? parent.id : id, kind === "provider" ? movedParent : moved);
      await act(async () => renderer!.update(screen(false)));
      expect(selected().props.card.lane).toBe("review");
      expect(selected().props.current).toBe(true);
      handle.lanes = {
        ...handle.lanes,
        running: { ...handle.lanes.running!, cards: kind === "provider" ? [{ ...parent, children: [] }] : handle.lanes.running!.cards },
        review: { ...handle.lanes.review!, cards: handle.lanes.review!.cards.filter((card) => card.id !== id) },
      };

      handle.byId = new Map(handle.byId);
      if (kind === "provider") handle.byId.set(parent.id, { ...parent, children: [] });
      else handle.byId.delete(id);
      await act(async () => renderer!.update(screen(false)));
      expect(cards().some((node) => node.props.card.id === id)).toBe(false);
      expect(cards().some((node) => node.props.current)).toBe(false);
    } finally {
      handle.lanes = saved.lanes;
      handle.byId = saved.byId;
    }
  });

  it.each([560, 900])("mounts desktop Info once and retains local state and scroll bookkeeping at %i pt height", async (height) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const scrollTo = vi.fn();
    await act(async () => { renderer = TestRenderer.create(screen(false), {
      createNodeMock: (element) => (element.props as { testID?: string }).testID === "detail-tab-short-scroll" ? { scrollTo } : null,
    }); });
    layOut(2000);
    act(() => hostsById("details-sidebar")[0]!.props.onLayout({ nativeEvent: { layout: { width: 366, height } } }));
    const select = async (id: string) => {
      const card = cards().find((node) => node.props.card.id === id)!;
      await act(async () => card.props.onSelect(card.props.card));
    };
    await select("sample-running");
    expect(hostsById("detail-tab-messages")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("detail-prompt")).toHaveLength(1);
    expect(hostsById("detail-location")).toHaveLength(0);
    expect(hostsById("detail-usage")).toHaveLength(0);
    await act(async () => hostsById("detail-tab-info")[0]!.props.onPress());
    const info = hostsById("detail-location")[0]!;
    const properties = hostsById("detail-properties")[0]!;
    act(() => properties.props.onLayout({ nativeEvent: { layout: { width: 500 } } }));
    expect(properties.findAll((node) => (node.type as unknown) === "Text" && StyleSheet.flatten(node.props.style).width === 72).length).toBeGreaterThan(0);
    const scroll = hostsById(height < 640 ? "detail-tab-short-scroll" : "detail-tab-info-scroll")[0]!;
    if (height < 640) {
      act(() => {
        scroll.props.onLayout({ nativeEvent: { layout: { height: 300 } } });
        hostsById("detail-tab-anchor")[0]!.props.onLayout({ nativeEvent: { layout: { y: 200, height: 46 } } });
        hostsById("detail-tab-info-content")[0]!.props.onLayout();
        scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 330 } } });
      });
    } else {
      act(() => scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 123 }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } }));
    }
    await act(async () => hostsById("detail-tab-messages")[0]!.props.onPress());
    if (height < 640) {
      expect(StyleSheet.flatten(hostsById("detail-tab-info-content")[0]!.props.style)).toMatchObject({ height: 0, overflow: "hidden", visibility: "hidden" });
      act(() => hostsById("detail-tab-messages-content")[0]!.props.onLayout());
    } else {
      expect(StyleSheet.flatten(scroll.parent!.parent!.props.style)).toMatchObject({ position: "absolute", inset: 0, visibility: "hidden" });
    }
    await act(async () => hostsById("detail-tab-info")[0]!.props.onPress());
    if (height < 640) {
      act(() => hostsById("detail-tab-info-content")[0]!.props.onLayout());
      expect(scrollTo).toHaveBeenLastCalledWith({ y: 330, animated: false });
    } else {
      expect(hostsById("detail-tab-info-scroll")[0]).toBe(scroll);
      expect(StyleSheet.flatten(hostsById("detail-tabs")[0]!.props.style).boxShadow).toContain("0px 5px");
    }
    expect(hostsById("detail-location")[0]).toBe(info);
    expect(hostsById("detail-properties")[0]).toBe(properties);
    expect(properties.findAll((node) => (node.type as unknown) === "Text" && StyleSheet.flatten(node.props.style).width === 72).length).toBeGreaterThan(0);
    await select("sample-failed");
    expect(hostsById("detail-tab-messages")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("detail-location")).toHaveLength(0);
    await act(async () => hostsById("detail-tab-info")[0]!.props.onPress());
    expect(hostsById("detail-location")[0]).not.toBe(info);
  });

  it.each([["ios", false], ["android", false], ["ios", true], ["android", true], ["web", true]] as const)("keeps both Info and Messages mounted on %s touch layouts (phone=%s)", async (os, phone) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(phone)); });
    if (!phone) layOut(1400);
    await act(async () => cards()[0]!.props.onSelect(cards()[0]!.props.card));
    expect(hostsById("detail-tab-messages")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("detail-location")).toHaveLength(1);
    expect(hostsById("detail-prompt")).toHaveLength(1);
    const hidden = hostsById("detail-tab-info-content")[0];
    if (hidden) expect(StyleSheet.flatten(hidden.props.style).display).toBe("none");
    else expect(StyleSheet.flatten(hostsById("detail-tab-info-scroll")[0]!.parent!.parent!.props.style).display).toBe("none");
  });

  it("animates the desktop sidebar closed and can reverse during entry or exit", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const timing = vi.spyOn(Animated, "timing").mockImplementation((value, config) => {
      let timer: ReturnType<typeof setTimeout>;
      return {
        start: (done) => { timer = setTimeout(() => { (value as Animated.Value).setValue(config.toValue as number); done?.({ finished: true }); }, config.duration); },
        stop: () => clearTimeout(timer),
        reset: () => clearTimeout(timer),
      };
    });
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(2000);
      const progress = timing.mock.calls.find(([, config]) => config.toValue === 1 && config.duration === 240)![0] as Animated.Value;
      expect(hostsById("sidebar-slot")[0]!.props.pointerEvents).toBe("auto");
      act(() => { vi.advanceTimersByTime(50); progress.setValue(0.5); });
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(hostsById("sidebar-slot")[0]!.props.pointerEvents).toBe("none");
      expect(timing).toHaveBeenCalledWith(progress, expect.objectContaining({ toValue: 0, duration: 180 }));
      expect((progress as unknown as { __value: number }).__value).toBe(0.5);
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(hostsById("sidebar-inline")).toHaveLength(1);
      expect(hostsById("sidebar-slot")[0]!.props.pointerEvents).toBe("auto");
      expect(timing).toHaveBeenCalledWith(progress, expect.objectContaining({ toValue: 1, duration: 240 }));
      act(() => { vi.advanceTimersByTime(240); });
      expect((progress as unknown as { __value: number }).__value).toBe(1);
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(hostsById("sidebar-slot")[0]!.props.pointerEvents).toBe("none");
      act(() => { vi.advanceTimersByTime(180); });
      expect(hostsById("sidebar-slot")).toHaveLength(0);
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(hostsById("sidebar-inline")).toHaveLength(1);
    } finally {
      timing.mockRestore();
    }
  });

  it("finishes the sidebar transition immediately when reduced motion is enabled", async () => {
    let onReduce: (enabled: boolean) => void = () => {};
    const addListener = AccessibilityInfo.addEventListener;
    const subscription = vi.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, listener: (enabled: boolean) => void) => {
      if (name === "reduceMotionChanged") onReduce = listener;
      return addListener("reduceMotionChanged", listener);
    }) as typeof AccessibilityInfo.addEventListener);
    try {
      await act(async () => { renderer = TestRenderer.create(screen(false)); });
      layOut(2000);
      act(() => onReduce(true));
      expect(StyleSheet.flatten(hostsById("sidebar-slot")[0]!.props.style).width).toBe(392);
      expect(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style)).toMatchObject({ opacity: 1, transform: [{ translateX: 0 }] });
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(hostsById("sidebar-slot")).toHaveLength(0);
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).opacity).toBe(1);
    } finally {
      act(() => onReduce(false));
      subscription.mockRestore();
    }
  });

  it("keeps the floating desktop sidebar until its close animation finishes", () => {
    const timing = vi.spyOn(Animated, "timing").mockImplementation((value, config) => {
      let timer: ReturnType<typeof setTimeout>;
      return {
        start: (done) => { timer = setTimeout(() => { (value as Animated.Value).setValue(config.toValue as number); done?.({ finished: true }); }, config.duration); },
        stop: () => clearTimeout(timer),
        reset: () => clearTimeout(timer),
      };
    });
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    toggleSidebarControl();
    expect(hostsById("sidebar-floating")).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(240); });
    toggleSidebarControl();
    expect(hostsById("sidebar-slot")[0]!.props.pointerEvents).toBe("none");
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, duration: 180 }));
    act(() => { vi.advanceTimersByTime(180); });
    expect(hostsById("sidebar-floating")).toHaveLength(0);
  });

  it.each([
    [1300, "narrow"], [1300, "default"], [1300, "wide"],
    [1600, "narrow"], [1600, "default"], [1600, "wide"],
  ] as const)("keeps %s pt %s lanes stable while the desktop sidebar is resized and toggled", (width, size) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true, laneWidth: size } };
    const listeners = new Map<string, (event: { pageX: number; clientY: number }) => void>();
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("document", {
      body: { style: {} },
      addEventListener: (name: string, handler: (event: { pageX: number; clientY: number }) => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(width);
      const laneWidths = () => [...LANE_ORDER, "archived"].map((id) => StyleSheet.flatten(hostsById(`lane-surface-${id}`)[0]!.props.style).width);
      const originalWidths = laneWidths();
      const handle = hostsById("sidebar-resize")[0]!;
      const panel = StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style);
      const handleStyle = StyleSheet.flatten(handle.props.style);
      expect(handleStyle.left).toBe(0);
      expect(handleStyle.width).toBeLessThanOrEqual(panel.paddingLeft);
      expect(handle.findAll((node) => typeof node.type === "string" && node.props.testID === "sidebar-resize-grabber")).toHaveLength(1);
      const grabberOpacity = () => StyleSheet.flatten(hostsById("sidebar-resize-grabber")[0]!.props.style).opacity;
      expect(StyleSheet.flatten(hostsById("sidebar-resize-grabber")[0]!.props.style)).toMatchObject({
        transitionProperty: "opacity", transitionDuration: "150ms", transitionTimingFunction: "ease-out",
      });
      expect(grabberOpacity()).toBe(0);
      act(() => hostsById("sidebar-inline")[0]!.props.onPointerEnter());
      expect(grabberOpacity()).toBe(0.5);
      act(() => hostsById("sidebar-inline")[0]!.props.onPointerLeave());
      expect(grabberOpacity()).toBe(0);
      act(() => hostsById("sidebar-inline")[0]!.props.onPointerEnter());
      act(() => handle.props.onPointerDown({ nativeEvent: { pageX: 1000, clientY: 200 } }));
      act(() => hostsById("sidebar-inline")[0]!.props.onPointerLeave());
      expect(grabberOpacity()).toBe(0.5);
      const sidebar = () => hostsById("details-sidebar")[0]!;
      const layoutSidebar = (width: number) => sidebar().props.onLayout({ nativeEvent: { layout: { width, height: 800 } } });
      act(() => layoutSidebar(380));
      const content = sidebar().props.children;
      let redraws = 0;
      for (let delta = 1; delta <= 50; delta++) {
        act(() => listeners.get("pointermove")!({ pageX: 1000 - delta, clientY: 200 }));
        act(() => { vi.advanceTimersByTime(16); });
        act(() => layoutSidebar(380 + delta));
        if (sidebar().props.children !== content) redraws++;
      }
      expect(redraws).toBe(0);
      expect(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).width).toBe(430);
      expect(laneWidths()).toEqual(originalWidths);
      act(() => listeners.get("pointerup")!({ pageX: 950, clientY: 200 }));
      expect(grabberOpacity()).toBe(0);
      expect(readSidebarPreference().width).toBe(430);
      expect(laneWidths()).toEqual(originalWidths);
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(laneWidths()).toEqual(originalWidths);
      act(() => hostsById("sidebar-switch")[0]!.props.onPress());
      expect(laneWidths()).toEqual(originalWidths);
      expect(listeners.has("pointermove")).toBe(false);
      expect(listeners.has("pointerup")).toBe(false);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("draws a dragged sidebar on the page and renders the board only when the lanes' view changes", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, laneWidth: "narrow" } };
    const listeners = new Map<string, (event: { pageX: number; clientY: number }) => void>();
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("document", {
      body: { style: {} },
      addEventListener: (name: string, handler: (event: { pageX: number; clientY: number }) => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    // Page nodes for the column, the handle and the indicator: what a drag frame writes to.
    const nodes = new Map<string, { style: Record<string, string> }>();
    const createNodeMock = (element: React.ReactElement) => {
      const id = (element.props as { testID?: string }).testID;
      if (id !== "sidebar-slot" && id !== "sidebar-inline" && id !== "sidebar-resize") return null;
      const node = { style: {} as Record<string, string>, setAttribute() {}, removeAttribute() {}, getBoundingClientRect: () => ({ top: 0, height: 800 }) };
      nodes.set(id, node);
      return node;
    };
    try {
      act(() => { renderer = TestRenderer.create(screen(false), { createNodeMock }); });
      layOut(1600);
      const drawnWidth = () => StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).width;
      const row = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.horizontal === true);
      expect(drawnWidth()).toBe(380);
      expect(row().props.scrollEnabled).toBe(false);
      act(() => hostsById("sidebar-resize")[0]!.props.onPointerDown({ nativeEvent: { pageX: 1000, clientY: 200 } }));
      const drawn = new Set<number>();
      let pageX = 1000;
      const frame = (to: number) => {
        pageX = to;
        act(() => listeners.get("pointermove")!({ pageX, clientY: 200 }));
        act(() => { vi.advanceTimersByTime(16); });
        drawn.add(drawnWidth());
      };
      for (let delta = 1; delta <= 40; delta++) frame(1000 - delta);
      // Every frame reached the page; the board drew the first one only, the lanes' view holding.
      expect(nodes.get("sidebar-inline")!.style.width).toBe("420px");
      expect(nodes.get("sidebar-slot")!.style.width).toBe("432px");
      expect([...drawn]).toEqual([381]);
      expect(row().props.scrollEnabled).toBe(false);
      // Wide enough that the lanes no longer fit beside it: the board draws, and the row scrolls.
      let step = 0;
      while (!row().props.scrollEnabled && step++ < 400) frame(pageX - 1);
      expect(row().props.scrollEnabled).toBe(true);
      expect(drawnWidth()).toBe(380 + 1000 - pageX);
      const before = drawn.size;
      for (let delta = 1; delta <= 10; delta++) frame(pageX - 1);
      expect(drawn.size).toBe(before);
      expect(nodes.get("sidebar-inline")!.style.width).toBe(`${380 + 1000 - pageX}px`);
      act(() => listeners.get("pointerup")!({ pageX, clientY: 200 }));
      expect(drawnWidth()).toBe(380 + 1000 - pageX);
      expect(readSidebarPreference().width).toBe(380 + 1000 - pageX);
      expect(listeners.has("pointermove")).toBe(false);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each([false, true])("keeps sidebar content stable during window resizing (selected=%s)", (selected) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1300);
    if (selected) act(() => cards()[0]!.props.onSelect(cards()[0]!.props.card));
    const sidebar = () => hostsById("details-sidebar")[0]!;
    const layoutSidebar = (height: number) => sidebar().props.onLayout({ nativeEvent: { layout: { width: 380, height } } });
    act(() => layoutSidebar(800));
    const content = sidebar().props.children;
    for (let delta = 1; delta <= 50; delta++) {
      act(() => hostsById("tasks-board-area")[0]!.props.onLayout({ nativeEvent: { layout: { width: 1300 + delta, height: 800 - delta } } }));
      act(() => layoutSidebar(800 - delta));
      expect(sidebar().props.children).toBe(content);
    }
    // Window resizing still changes lane widths and switches the short-column layout.
    expect(StyleSheet.flatten(hostsById("lane-surface-running")[0]!.props.style).width).toBe((1350 - 48) / 4);
    act(() => layoutSidebar(639));
    expect(hostsById(selected ? "detail-tab-short-scroll" : "details-sidebar-scroll")).toHaveLength(1);
    act(() => layoutSidebar(640));
    expect(hostsById("details-sidebar-scroll")).toHaveLength(0);
  });

  it.each([2000, 600])("preserves the panel silhouette without a selected fill at %i pt", (width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    const button = () => hostsById("sidebar-switch")[0]!;
    const frame = () => StyleSheet.flatten(hostsById("panel-mark")[0]!.props.style);
    const fill = () => StyleSheet.flatten(hostsById("panel-mark-fill")[0]!.props.style);
    const bottom = width === 600;
    const check = (open: boolean) => {
      expect(frame()).toMatchObject({ width: 16, height: 13, borderWidth: 1.5, borderRadius: 2.5, flexDirection: bottom ? "column" : "row", ...(bottom ? { paddingBottom: 1.5 } : { paddingRight: 1.5 }) });
      expect(fill()).toMatchObject({ width: bottom ? 10 : open ? 3.5 : 1.5, height: bottom ? open ? 3 : 1.5 : 7, borderRadius: 0.75, backgroundColor: open ? "#1b1b1f" : "#6b6b75" });
      expect(StyleSheet.flatten(button().props.style).backgroundColor).toBe("#ffffff");
      expect(button().findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(0);
    };
    const initial = button().props.accessibilityState.selected;
    check(initial);
    expect(textOf(button())).toBe("");
    act(() => button().props.onPress());
    expect(button().props.accessibilityState.selected).toBe(!initial);
    check(!initial);
  });

  it.each([false, true])("keeps all stat counts on one line at a shared size with archived=%s", (showArchived) => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived } };
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    const layout = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } }));
    layout(hostsById("sidebar-stats-row")[0]!, 130);
    layout(hostsById("sidebar-stat-count-measure")[0]!, 20);
    const counts = renderer!.root.findByProps({ testID: "sidebar-stats" }).findAllByType(RollingCount).filter((node) => node.props.singleLine);
    expect(counts).toHaveLength(showArchived ? 5 : 4);
    const sizes = counts.map((node) => StyleSheet.flatten(node.props.style).fontSize);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeLessThan(14);
    layout(hostsById("sidebar-stats-row")[0]!, 400);
    expect(StyleSheet.flatten(counts[0]!.props.style).fontSize).toBe(14);
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
    const measure = () => hostsById("sidebar-stat-measure-running")[0]!;
    const stat = () => hostsById("sidebar-stat-running")[0]!;
    const layout = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } }));
    // The cells share the stats row, so it alone is laid out: a heading `width` wide in each cell.
    const lanes = renderer!.root.findAll((node) => typeof node.type === "string" && /^sidebar-stat-heading-/.test(node.props.testID ?? "")).length;
    expect(hostsById("sidebar-stat-heading-running")[0]!.props.onLayout).toBeUndefined();
    const heading = () => ({ props: { onLayout: (event: { nativeEvent: { layout: { width: number } } }) => hostsById("sidebar-stats-row")[0]!.props.onLayout({
      nativeEvent: { layout: { ...event.nativeEvent.layout, width: (event.nativeEvent.layout.width + 2 * StyleSheet.hairlineWidth + 16) * lanes + 4 * (lanes - 1) } },
    }) } }) as unknown as ReactTestInstance;
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
  ] as const)("%s group tabs show all %s labels or none at UI base %i", (os, language, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(os === "ios" ? 900 : 1600);
    if (os === "ios") toggleSidebarControl();
    const layout = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } }));
    const tabs = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "tab");
    const labels = () => hostsById("sidebar-group-tab-label");
    const measureTab = (tab: ReactTestInstance, width: number) => layout(tab.find((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-measure"), width);
    // The tabs share their row equally, so it alone is laid out: four tabs `width` wide.
    expect(tabs()[0]!.props.onLayout).toBeUndefined();
    const tabsAt = (width: number) => layout(hostsById("sidebar-group-tabs")[0]!, 4 * width + 2 * 10 + 3 * 6);
    expect(labels()).toHaveLength(0);
    // Three short labels fit, but the longest still forces the entire row to icons.
    tabsAt(100);
    tabs().forEach((tab, index) => measureTab(tab, index === 2 ? 90 : 40));
    expect(labels()).toHaveLength(0);
    measureTab(tabs()[2]!, 60);
    expect(labels()).toHaveLength(4);
    for (const kind of ["agent", "project", "workspace", "label"] as const) {
      const word = BOARD_STRINGS[language].sidebar.groups[kind];
      const tab = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "tab" && node.props.accessibilityLabel === word);
      const measure = () => tab().find((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-measure");
      const label = () => tab().findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-label");
      expect(label()).toHaveLength(1);
      const basis = StyleSheet.flatten(tab().props.style).flexBasis;
      tabsAt(50);
      expect(labels()).toHaveLength(0);
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
      tabsAt(120);
      expect(labels()).toHaveLength(4);
      expect(textOf(label()[0]!)).toBe(word);
      // An updated measurement (font or translation) can hide the label without a resize.
      layout(measure(), 140);
      expect(labels()).toHaveLength(0);
      layout(measure(), 60);
      expect(labels()).toHaveLength(4);
    }
    // A new language or font size invalidates the whole row until remeasured.
    act(() => renderer!.update(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base + 2 } } })));
    expect(labels()).toHaveLength(0);
    tabs().forEach((tab) => measureTab(tab, 60));
    expect(labels()).toHaveLength(4);
  });

  it("keeps all four icon-only group tabs equal and their labels stable through repeated clicks", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    toggleSidebarControl();
    const tabs = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "tab");
    const layout = (node: ReactTestInstance, width: number) => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 36 } } });
    act(() => {
      tabs().forEach((tab, index) => layout(tab.find((node) => (node.type as unknown) === "Text" && node.props.testID === "sidebar-group-tab-measure"), 60 + index * 20));
      layout(hostsById("sidebar-group-tabs")[0]!, 4 * 50 + 2 * 10 + 3 * 6);
    });
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
    act(() => layout(hostsById("sidebar-group-tabs")[0]!, 4 * 180 + 2 * 10 + 3 * 6));
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
    // The workspace, its project muted after it, and every loaded card in it, including done and archived.
    const active = (["needs_input", "running", "review", "done", "archived"] as const).reduce((sum, lane) => sum + (data as unknown as { __handle: { lanes: Record<string, { cards: unknown[] }> } }).__handle.lanes[lane]!.cards.length, 0);
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

  it("keeps a selected card and its floating panel across every lane change", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const lanes = ["needs_input", "running", "review", "done", "archived"] as const;
    const agent = (lane: typeof lanes[number]) => {
      const updatedAt = new Date().toISOString();
      const base = { id: "moving-selection", title: "Selected task", workspaceId: "ws", updatedAt, lastUserMessageAt: updatedAt };
      if (lane === "needs_input") return makeAgent({ ...base, status: "running", pendingPermissions: [{ id: "p", provider: "claude", name: "Bash", kind: "tool", input: { command: "test" } }] as never });
      if (lane === "running") return makeAgent({ ...base, status: "running" });
      if (lane === "review") return makeAgent({ ...base, status: "idle", requiresAttention: true, attentionReason: "finished" });
      return makeAgent({ ...base, status: "idle", requiresAttention: false, ...(lane === "archived" ? { archivedAt: updatedAt } : {}) });
    };
    const fake = createFakePaseo({ agents: [agent("running")] });
    host.liveTasks = fake.paseo;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } };
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    await act(async () => { await deviceTasksStore().update({ showArchived: true }); });
    layOut(900);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const selected = () => cards().find((node) => node.props.card.id === "moving-selection")!;
    act(() => selected().props.onSelect(selected().props.card));
    for (const from of lanes) {
      for (const to of lanes) {
        if (from === to) continue;
        for (const lane of [from, to]) {
          const next = agent(lane);
          fake.setAgentSilently(next);
          act(() => fake.removeFromAgentSubscriptions("moving-selection"));
          expect(hostsById("sidebar-floating")).toHaveLength(1);
          expect(textOf(hostsById("detail-title")[0]!)).toBe("Selected task");
          await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); });
          expect(selected().props.card.lane).toBe(lane);
          expect(selected().props.current).toBe(true);
          expect(hostsById("sidebar-floating")).toHaveLength(1);
          await act(async () => fake.upsertAgent(next));
        }
      }
    }
  });

  it("scrolls a short sidebar's header with its content while keeping actions outside", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2000);
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    act(() => card.props.onSelect(card.props.card));
    const column = () => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "details-sidebar");
    expect(hostsById("details-sidebar-scroll")).toHaveLength(0);
    act(() => column().props.onLayout({ nativeEvent: { layout: { width: 380, height: 560 } } }));
    expect(hostsById("detail-tab-short-scroll")).toHaveLength(1);
    expect(hostsById("detail-action-bar")).toHaveLength(1);
    expect(textOf(renderer!.root.findByProps({ testID: "detail-title" }))).toBe(card.props.card.title);
    act(() => column().props.onLayout({ nativeEvent: { layout: { width: 380, height: 900 } } }));
    expect(hostsById("details-sidebar-scroll")).toHaveLength(0);
    expect(hostsById("detail-tab-short-scroll")).toHaveLength(0);
  });

  it.each(["ios", "android"])("scrolls a tall %s tablet sidebar's header with sticky tabs and fixed actions", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(1400);
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    await act(async () => card.props.onSelect(card.props.card));
    expect(hostsById("detail-sheet-toggle")).toHaveLength(0);
    const column = hostsById("details-sidebar")[0]!;
    for (const height of [900, 560, 1100]) {
      await act(async () => column.props.onLayout({ nativeEvent: { layout: { width: 380, height } } }));
      const scroll = hostsById("detail-tab-short-scroll")[0]!;
      expect(scroll.props.stickyHeaderIndices).toEqual([1]);
      expect(scroll.findAll((node) => typeof node.type === "string" && node.props.testID === "detail-header")).toHaveLength(1);
      expect(scroll.findAll((node) => typeof node.type === "string" && node.props.testID === "detail-action-bar")).toHaveLength(0);
      expect(hostsById("detail-action-bar")).toHaveLength(1);
    }
  });

  it.each(["ios", "android"])("uses the detail tabs in a narrow %s tablet sheet", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(600);
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    await act(async () => card.props.onSelect(card.props.card));
    expect(hostsById("board-sheet")).toHaveLength(1);
    expect(hostsById("detail-tab-short-scroll")).toHaveLength(1);
    expect(hostsById("detail-tab-messages")[0]!.props.accessibilityState.selected).toBe(true);
    await act(async () => hostsById("detail-tab-info")[0]!.props.onPress());
    expect(hostsById("detail-location")).toHaveLength(1);
    expect(hostsById("detail-action-bar")).toHaveLength(1);
  });

  it("raises the details from the bottom of a board too narrow to float them, and the lanes make room", () => {
    const timings = holdTimings();
    try {
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
    const toggle = () => hostsById("detail-sheet-toggle")[0]!;
    expect(toggle().props.accessibilityLabel).toBe("Expand details");
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.name).toBe("Maximize2");
    act(() => toggle().props.onPress());
    // The sheet moves first; the board hears of the new height once it is there.
    expect(toggle().props.accessibilityLabel).toBe("Expand details");
    expect(timings.sheet().at(-1)).toMatchObject({ to: 792, duration: 240 });
    timings.finish(timings.sheet().at(-1)!);
    expect(toggle().props.accessibilityLabel).toBe("Collapse details");
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.name).toBe("Minimize2");
    act(() => toggle().props.onPress());
    timings.finish(timings.sheet().at(-1)!);
    expect(toggle().props.accessibilityLabel).toBe("Expand details");
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
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(8 + 464);
    timings.finish(timings.sheet().at(-1)!);
    expect(handle().props.accessibilityLabel).toBe("Collapse details");
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.name).toBe("Minimize2");
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
    expect(timings.sheet().at(-1)).toMatchObject({ to: 464, duration: 240 });
    timings.finish(timings.sheet().at(-1)!);
    expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(8 + 464);
    // A tap on the lanes' blank space puts it away.
    let blank = lanesScroll().parent!;
    while (!blank.props.onResponderGrant) blank = blank.parent!;
    act(() => {
      blank.props.onResponderGrant({ nativeEvent: { pageX: 10, pageY: 10 } });
      blank.props.onResponderRelease({ nativeEvent: { pageX: 10, pageY: 10 } });
    });
    expect(hostsById("board-sheet")).toHaveLength(0);
    } finally {
      timings.restore();
    }
  });

  it.each(["web", "ios", "android"])("on %s moves the sheet before the board hears of a new height, and a switch can be turned back, caught or closed on its way", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const timings = holdTimings();
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(600);
      const open = () => {
        const card = cards().find((node) => node.props.card.id === "sample-running")!;
        act(() => card.props.onSelect(card.props.card));
      };
      open();
      const toggle = () => hostsById("detail-sheet-toggle")[0]!;
      const handle = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "board-sheet-handle");
      const label = () => toggle().props.accessibilityLabel;
      const room = () => StyleSheet.flatten(renderer!.root.findAll((node) => typeof node.props.renderItem === "function" && node.props.contentContainerStyle !== undefined)[0]!.props.contentContainerStyle).paddingBottom;
      const last = () => timings.sheet().at(-1)!;
      const height = () => (timings.sheetValue() as unknown as { __value: number }).__value;
      timings.finish(last());
      expect(height()).toBe(464);

      // A second tap before the sheet is there turns it back; the stopped run tells the board nothing.
      act(() => toggle().props.onPress());
      const up = last();
      expect(up).toMatchObject({ to: 792, duration: 240 });
      expect([label(), room()]).toEqual(["Expand details", 8 + 464]);
      act(() => toggle().props.onPress());
      expect(up.over).toBe(true);
      expect(last()).toMatchObject({ to: 464, duration: 240 });
      expect([label(), room()]).toEqual(["Expand details", 8 + 464]);
      timings.finish(last());
      expect([label(), room()]).toEqual(["Expand details", 8 + 464]);

      // Three taps, the handle's among them, count from where each switch is heading.
      act(() => toggle().props.onPress());
      act(() => handle().props.onPress());
      act(() => toggle().props.onPress());
      expect(timings.sheet().slice(-3).map((run) => [run.to, run.over])).toEqual([[792, true], [464, true], [792, false]]);
      expect(label()).toBe("Expand details");
      const runs = timings.sheet().length;
      timings.finish(last());
      expect([label(), room(), height()]).toEqual(["Collapse details", 8 + 792, 792]);
      // The board catching up starts no second run to where the sheet already is.
      expect(timings.sheet()).toHaveLength(runs);

      // A drag catches a switch where it is, and a short one leaves the height the board knows.
      act(() => toggle().props.onPress());
      const down = last();
      act(() => timings.sheetValue().setValue(600));
      const strip = handle().parent!.parent!;
      act(() => {
        strip.props.onStartShouldSetPanResponderCapture({ nativeEvent: { pageY: 300 } });
        strip.props.onPanResponderGrant({ nativeEvent: { pageY: 300 } }, { dy: 0, vy: 0 });
      });
      expect(down.over).toBe(true);
      act(() => strip.props.onPanResponderMove({ nativeEvent: { pageY: 310 } }, { dy: 10, vy: 0 }));
      expect(height()).toBe(590);
      act(() => strip.props.onPanResponderRelease({ nativeEvent: { pageY: 310 } }, { dy: 10, vy: 0 }));
      expect(last()).toMatchObject({ to: 792, duration: 200 });
      timings.finish(last());
      expect([label(), room()]).toEqual(["Collapse details", 8 + 792]);

      // A long drag down goes to half: the sheet gets there before the lanes change.
      act(() => {
        strip.props.onStartShouldSetPanResponderCapture({ nativeEvent: { pageY: 300 } });
        strip.props.onPanResponderGrant({ nativeEvent: { pageY: 300 } }, { dy: 0, vy: 0 });
        strip.props.onPanResponderRelease({ nativeEvent: { pageY: 400 } }, { dy: 100, vy: 0 });
      });
      expect(last()).toMatchObject({ to: 464, duration: 240 });
      expect([label(), room()]).toEqual(["Collapse details", 8 + 792]);
      timings.finish(last());
      expect([label(), room()]).toEqual(["Expand details", 8 + 464]);
      act(() => { vi.advanceTimersByTime(300); });

      // Closed while a switch moves: the switch never reaches the board, and the sheet opens at half again.
      act(() => toggle().props.onPress());
      const lost = last();
      act(() => hostsById("detail-close")[0]!.props.onPress());
      expect(hostsById("board-sheet")).toHaveLength(0);
      expect(lost.over).toBe(true);
      open();
      expect([label(), room()]).toEqual(["Expand details", 8 + 464]);
    } finally {
      timings.restore();
    }
  });

  it("switches the sheet at once under reduced motion", () => {
    let onReduce = (_on: boolean) => {};
    const addListener = AccessibilityInfo.addEventListener;
    const subscription = vi.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, listener: (enabled: boolean) => void) => {
      if (name === "reduceMotionChanged") onReduce = listener;
      return addListener("reduceMotionChanged", listener);
    }) as typeof AccessibilityInfo.addEventListener);
    const timings = holdTimings();
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(600);
      act(() => onReduce(true));
      const card = cards().find((node) => node.props.card.id === "sample-running")!;
      act(() => card.props.onSelect(card.props.card));
      const toggle = () => hostsById("detail-sheet-toggle")[0]!;
      const runs = timings.sheet().length;
      act(() => toggle().props.onPress());
      expect(timings.sheet()).toHaveLength(runs);
      expect((timings.sheetValue() as unknown as { __value: number }).__value).toBe(792);
      expect(toggle().props.accessibilityLabel).toBe("Collapse details");
      act(() => toggle().props.onPress());
      expect((timings.sheetValue() as unknown as { __value: number }).__value).toBe(464);
      expect(toggle().props.accessibilityLabel).toBe("Expand details");
    } finally {
      act(() => onReduce(false));
      subscription.mockRestore();
      timings.restore();
    }
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

  it.each([2000, 900, 600])("opens a hidden sidebar when a card is clicked at %i pt, including the same card again", (width) => {
    finishSidebarCloseImmediately();
    writeSidebarPreference({ open: false, width: 380 });
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    const panel = width < 760 ? "board-sheet" : "sidebar-floating";
    const card = () => cards().find((node) => node.props.card.id === "sample-running")!;
    expect(hostsById(panel)).toHaveLength(0);
    act(() => card().props.onSelect(card().props.card));
    expect(hostsById(panel)).toHaveLength(1);
    expect(textOf(hostsById("detail-title")[0]!)).toBe(card().props.card.title);
    toggleSidebarControl();
    expect(hostsById(panel)).toHaveLength(0);
    act(() => card().props.onSelect(card().props.card));
    expect(hostsById(panel)).toHaveLength(1);
    expect(textOf(hostsById("detail-title")[0]!)).toBe(card().props.card.title);
    expect(readSidebarPreference().open).toBe(false);
    expect(openAgent).not.toHaveBeenCalled();
  });

  it("floats the sidebar over a narrow board only on demand, and puts it away on a tap outside", () => {
    finishSidebarCloseImmediately();
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

  it.each([
    ["ios", 1100], ["ios", 1600], ["android", 1100], ["android", 1600],
  ] as const)("%s shows and resizes the inline details handle at %i pt", async (os, viewport) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const { TurboModuleRegistry } = await import("react-native");
    const handleSetJSResponder = vi.fn();
    const flushOperations = vi.fn();
    const module = vi.spyOn(TurboModuleRegistry, "get").mockImplementation(((name: string) =>
      name === "RNGestureHandlerModule" ? { handleSetJSResponder, flushOperations } : null) as typeof TurboModuleRegistry.get);
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(viewport);
      const handle = () => hostsById("sidebar-resize")[0]!;
      const width = () => liveNumber(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).width);
      const event = (pageX: number) => ({ nativeEvent: { pageX } });
      const start = () => act(() => {
        handle().props.onStartShouldSetPanResponderCapture(event(700));
        expect(handle().props.onStartShouldSetPanResponder()).toBe(true);
        handle().props.onPanResponderGrant();
      });
      const max = Math.min(800, viewport - 12 - 612);
      expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
      expect(StyleSheet.flatten(hostsById("sidebar-resize-grabber")[0]!.props.style).opacity).toBe(0.5);
      expect(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).paddingLeft).toBeGreaterThan(StyleSheet.flatten(handle().props.style).width);
      const panelStyle = StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style);
      expect(panelStyle.right + panelStyle.paddingRight).toBe(panelStyle.paddingLeft);
      expect(handle().props.accessibilityValue).toEqual({ min: 260, max, now: 380 });
      start();
      if (os === "ios") {
        expect(handleSetJSResponder).toHaveBeenCalledWith(expect.any(Number), true);
        expect(flushOperations).toHaveBeenCalledTimes(1);
      }
      expect(handle().props.onPanResponderTerminationRequest()).toBe(false);
      act(() => handle().props.onPanResponderMove(event(0)));
      expect(width()).toBe(max);
      act(() => handle().props.onPanResponderMove(event(1000)));
      expect(width()).toBe(260);
      expect(readSidebarPreference().width).toBe(380);
      act(() => handle().props.onPanResponderTerminate());
      expect(width()).toBe(380);
      start();
      act(() => handle().props.onPanResponderMove(event(660)));
      expect(width()).toBe(420);
      act(() => handle().props.onPanResponderRelease(event(650)));
      expect(width()).toBe(430);
      expect(readSidebarPreference().width).toBe(430);
      act(() => handle().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
      expect(width()).toBe(450);
      act(() => { renderer!.unmount(); renderer = TestRenderer.create(screen(false)); });
      layOut(viewport);
      expect(width()).toBe(450);
    } finally {
      module.mockRestore();
    }
  });

  it.each([14, 21])("iPad floating sidebar uses smaller text at UI base %i and keeps other layouts unchanged", (base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    const uiTheme = { ...(theme as object), typography: { fontSize: { ui: base } } };
    act(() => { renderer = TestRenderer.create(screen(false, {}, uiTheme)); });
    layOut(900);
    toggleSidebarControl();
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).width).toBe(340);
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).right).toBe(0);
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).paddingLeft).toBe(12);
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style)).toMatchObject({
      borderRadius: 0, borderWidth: 0, backgroundColor: "#ffffff",
      top: 0, bottom: 0, paddingTop: 4, paddingBottom: 12, paddingRight: 10,
    });
    expect(StyleSheet.flatten(hostsById("floating-sidebar-resize")[0]!.props.style).width).toBe(12);
    expect(StyleSheet.flatten(hostsById("sidebar-stat-label-running")[0]!.props.style).fontSize).toBe(Math.round(12 * base / 14 * 0.9));
    expect(hostsById("floating-sidebar-grabber")).toHaveLength(1);
    layOut(1600);
    expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
    expect(StyleSheet.flatten(hostsById("sidebar-stat-label-running")[0]!.props.style).fontSize).toBe(Math.round(12 * base / 14));
    expect(StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style).width).toBe(380);
    layOut(600);
    toggleSidebarControl();
    expect(hostsById("board-sheet")).toHaveLength(1);
    expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
    expect(StyleSheet.flatten(hostsById("sidebar-stat-label-running")[0]!.props.style).fontSize).toBe(Math.round(12 * base / 14));
  });

  it.each(["release", "cancel"])("iPad owns a resize touch before its first move and can drag again after %s", async (finish) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    const { TurboModuleRegistry } = await import("react-native");
    const handleSetJSResponder = vi.fn();
    const flushOperations = vi.fn();
    const module = vi.spyOn(TurboModuleRegistry, "get").mockImplementation(((name: string) =>
      name === "RNGestureHandlerModule" ? { handleSetJSResponder, flushOperations } : null) as typeof TurboModuleRegistry.get);
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(900);
      toggleSidebarControl();
      const handle = () => hostsById("floating-sidebar-resize")[0]!;
      const panel = () => hostsById("sidebar-floating")[0]!;
      const width = () => liveNumber(StyleSheet.flatten(panel().props.style).width);
      const event = (pageX: number) => ({ nativeEvent: { pageX } });
      const mountedPanel = panel();
      const mountedHandle = handle();
      // The host's native right swipe can activate before JS receives its first move.
      act(() => {
        handle().props.onStartShouldSetPanResponderCapture(event(560));
        expect(handle().props.onStartShouldSetPanResponder()).toBe(true);
        handle().props.onPanResponderGrant();
      });
      expect(handleSetJSResponder).toHaveBeenCalledWith(expect.any(Number), true);
      expect(flushOperations).toHaveBeenCalledTimes(1);
      expect(width()).toBe(340);
      // The panel takes each move itself; the board draws only the first, while the lanes' view holds.
      act(() => handle().props.onPanResponderMove(event(570)));
      const board = hostsById("tasks-board-area")[0]!.props;
      for (const x of [572, 575, 579]) {
        act(() => handle().props.onPanResponderMove(event(x)));
        expect(width()).toBe(340 - (x - 560));
        expect(hostsById("tasks-board-area")[0]!.props).toBe(board);
      }
      for (const [x, expected] of [[600, 300], [660, 240], [700, 210], [740, 210], [680, 220]] as const) {
        act(() => handle().props.onPanResponderMove(event(x)));
        expect(width()).toBe(expected);
        expect(panel()).toBe(mountedPanel);
        expect(handle()).toBe(mountedHandle);
        expect(handle().props.onPanResponderTerminationRequest()).toBe(false);
      }
      act(() => {
        if (finish === "release") handle().props.onPanResponderRelease(event(680));
        else handle().props.onPanResponderTerminate();
      });
      const saved = finish === "release" ? 220 : 340;
      expect(width()).toBe(saved);
      act(() => {
        handle().props.onStartShouldSetPanResponderCapture(event(900 - saved));
        expect(handle().props.onStartShouldSetPanResponder()).toBe(true);
        handle().props.onPanResponderGrant();
      });
      expect(flushOperations).toHaveBeenCalledTimes(2);
      act(() => handle().props.onPanResponderMove(event(900 - saved - 40)));
      expect(width()).toBe(saved + 40);
      act(() => handle().props.onPanResponderRelease(event(900 - saved - 40)));
      expect(readSidebarPreference().floatingWidth).toBe(saved + 40);
    } finally {
      module.mockRestore();
    }
  });

  it.each(["ios", "android"])("%s drags the floating edge, clamps both ends, cancels and remembers a released width", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    toggleSidebarControl();
    const handle = () => hostsById("floating-sidebar-resize")[0]!;
    const width = () => liveNumber(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).width);
    const event = (pageX: number) => ({ nativeEvent: { pageX } });
    expect(handle().props.accessibilityValue.min).toBe(210);
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
    expect(width()).toBe(210);
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
    toggleSidebarControl();
    toggleSidebarControl();
    expect(width()).toBe(390);
    act(() => handle().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    expect(width()).toBe(410);
    act(() => { renderer!.unmount(); renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    toggleSidebarControl();
    expect(width()).toBe(410);
  });

  it("uses the desktop handle for the web floating sidebar", () => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(900);
    toggleSidebarControl();
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).width).toBe(380);
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).right).toBe(12);
    expect(StyleSheet.flatten(hostsById("sidebar-floating")[0]!.props.style).paddingLeft).toBe(10);
    expect(hostsById("sidebar-resize")).toHaveLength(1);
    expect(hostsById("floating-sidebar-resize")).toHaveLength(0);
  });

  it.each([900, 1600])("resizes a sidebar opened from a card after hiding it at %i pt", (viewport) => {
    finishSidebarCloseImmediately();
    const listeners = new Map<string, (event: { pageX: number; clientY: number }) => void>();
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("document", {
      body: { style: {} },
      addEventListener: (name: string, handler: (event: { pageX: number; clientY: number }) => void) => listeners.set(name, handler),
      removeEventListener: (name: string) => listeners.delete(name),
    });
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(1600);
      const inlineStyle = { ...StyleSheet.flatten(hostsById("sidebar-inline")[0]!.props.style) };
      delete inlineStyle.opacity;
      delete inlineStyle.transform;
      toggleSidebarControl();
      layOut(viewport);
      expect(readSidebarPreference().open).toBe(false);
      const select = () => {
        const card = cards().find((node) => node.props.card.id === "sample-running")!;
        act(() => card.props.onSelect(card.props.card));
      };
      select();
      const panel = () => hostsById("sidebar-floating")[0]!;
      const width = () => StyleSheet.flatten(panel().props.style).width;
      const grabberOpacity = () => StyleSheet.flatten(hostsById("sidebar-resize-grabber")[0]!.props.style).opacity;
      const laneWidths = () => LANE_ORDER.map((id) => StyleSheet.flatten(hostsById(`lane-surface-${id}`)[0]!.props.style).width);
      const originalWidths = laneWidths();
      expect(width()).toBe(380);
      const floatingStyle = { ...StyleSheet.flatten(panel().props.style) };
      delete floatingStyle.opacity;
      delete floatingStyle.transform;
      expect(floatingStyle).toEqual(inlineStyle);
      expect(StyleSheet.flatten(hostsById("sidebar-slot")[0]!.props.style)).toMatchObject({ top: 0, bottom: 0 });
      expect(hostsById("sidebar-inline")).toHaveLength(0);
      act(() => panel().props.onPointerEnter());
      expect(grabberOpacity()).toBe(0.5);
      act(() => hostsById("sidebar-resize")[0]!.props.onPointerDown({ nativeEvent: { pageX: 1000, clientY: 200 } }));
      act(() => panel().props.onPointerLeave());
      expect(grabberOpacity()).toBe(0.5);
      for (const [pageX, expected] of [[0, 800], [2000, 260], [950, 430]] as const) {
        act(() => listeners.get("pointermove")!({ pageX, clientY: 200 }));
        act(() => { vi.advanceTimersByTime(16); });
        expect(width()).toBe(expected);
        expect(laneWidths()).toEqual(originalWidths);
      }
      act(() => listeners.get("pointerup")!({ pageX: 950, clientY: 200 }));
      expect(grabberOpacity()).toBe(0);
      expect(readSidebarPreference()).toMatchObject({ open: false, width: 430 });
      expect(listeners.has("pointermove")).toBe(false);
      expect(listeners.has("pointerup")).toBe(false);
      toggleSidebarControl();
      expect(hostsById("sidebar-floating")).toHaveLength(0);
      select();
      expect(width()).toBe(430);
      expect(readSidebarPreference().open).toBe(false);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
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

  it.each([false, true])("opens a hidden subtask's details from its parent (compact: %s)", (compact) => {
    act(() => { renderer = TestRenderer.create(screen(compact, { q: "ring", sub: "1" })); });
    if (!compact) layOut(1600);
    else act(() => pressable("Running 1").props.onPress());
    const parent = cards().find((card) => card.props.card.id === "sample-running")!;
    expect(cards().some((card) => card.props.card.id === "sample-child-1")).toBe(false);
    act(() => parent.props.onReveal("sample-child-1", "sample-running"));
    expect(renderer!.root.findByType(TaskDetailCards).props.card.id).toBe("sample-child-1");
    expect(host.toast).not.toHaveBeenCalled();
    expect(openAgent).not.toHaveBeenCalled();
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

  it.each([[2000, true], [2000, false], [900, true], [900, false], [600, false]] as const)("toggles the focused card preview with Space at %i pt (sidebar preference=%s)", (width, preferred) => {
    finishSidebarCloseImmediately();
    writeSidebarPreference({ open: preferred, width: 380 });
    const keys = new Set<(event: unknown) => void>();
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    vi.stubGlobal("document", {
      activeElement: null, body: {}, visibilityState: "visible",
      addEventListener: (type: string, listener: (event: unknown) => void, capture?: boolean) => type === "keydown" && !capture && keys.add(listener),
      removeEventListener: (type: string, listener: (event: unknown) => void) => type === "keydown" && keys.delete(listener),
    });
    const key = (value: string, repeat = false) => {
      const preventDefault = vi.fn();
      act(() => { for (const listener of keys) listener({ key: value, repeat, preventDefault }); });
      return preventDefault;
    };
    try {
      act(() => { renderer = TestRenderer.create(screen(false)); });
      layOut(width);
      expect(key(" ")).not.toHaveBeenCalled();
      key("j");
      const first = cards().find((card) => card.props.focused)!.props.card;
      expect(hostsById("detail-title")).toHaveLength(0);
      expect(key(" ")).toHaveBeenCalledTimes(1);
      const title = () => textOf(hostsById("detail-title")[0]!);
      expect(title()).toBe(first.title);
      const panel = width < 760 ? "board-sheet" : width < 1020 || !preferred ? "sidebar-floating" : "sidebar-inline";
      expect(hostsById(panel)).toHaveLength(1);
      key(" ", true);
      expect(title()).toBe(first.title);
      key(" ");
      expect(hostsById("detail-title")).toHaveLength(0);
      if (panel !== "sidebar-inline") expect(hostsById(panel)).toHaveLength(0);
      key(" ", true);
      expect(hostsById("detail-title")).toHaveLength(0);
      key(" ");
      expect(title()).toBe(first.title);
      key("l");
      const next = cards().find((card) => card.props.focused)!.props.card;
      expect(next.id).not.toBe(first.id);
      expect(title()).toBe(first.title);
      key(" ");
      expect(title()).toBe(next.title);
      expect(openAgent).not.toHaveBeenCalled();
      key("Enter");
      expect(openAgent).toHaveBeenCalledWith({ agentId: next.id });
      key("Escape");
      expect(hostsById("detail-title")).toHaveLength(0);
      if (panel !== "sidebar-inline") expect(hostsById(panel)).toHaveLength(0);
      // A later click takes over from an older keyboard focus.
      act(() => cards().find((card) => card.props.card.id === first.id)!.props.onSelect(first));
      expect(cards().some((card) => card.props.focused)).toBe(false);
      key(" ");
      expect(hostsById("detail-title")).toHaveLength(0);
      key(" ");
      expect(title()).toBe(first.title);
      expect(readSidebarPreference().open).toBe(preferred);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("hands DOM focus to the board during navigation, and releases virtual focus to Tab and inner controls", () => {
    try {
      const { doc, root, board, focus, key } = renderFocusBoard();
      expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.dataSet?.bcroot === "")).toHaveLength(1);
      const selected = cards().find((card) => card.props.card.id === "sample-running")!.props.card;
      focus(selected.id);
      act(() => cards().find((card) => card.props.card.id === selected.id)!.props.onSelect(selected));
      key("ArrowDown");
      const focused = cards().find((card) => card.props.focused)!;
      expect(focused.props.card.id).not.toBe(selected.id);
      expect(doc.activeElement).toBe(root);
      expect(root.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(cards().filter((card) => card.props.current).map((card) => card.props.card.id)).toEqual([selected.id]);
      expect(board().props["aria-activedescendant"]).toBe(focused.props.focusId);
      expect(hostsById(`task-card-${focused.props.card.id}`)[0]!.props.nativeID).toBe(focused.props.focusId);
      // Tab hands focus to a card, clearing the old virtual ring.
      focus("sample-done");
      expect(cards().some((card) => card.props.focused)).toBe(false);
      expect(board().props["aria-activedescendant"]).toBeUndefined();
      key("ArrowLeft");
      expect(doc.activeElement).toBe(root);
      expect(cards().find((card) => card.props.focused)!.props.card.lane).toBe("review");
      // An inner button or toolbar control keeps its own activation.
      focus();
      expect(cards().some((card) => card.props.focused)).toBe(false);
      expect(key(" ").preventDefault).not.toHaveBeenCalled();
      expect(key("Enter").preventDefault).not.toHaveBeenCalled();
      expect(openAgent).not.toHaveBeenCalled();
      // A blank press clears selection and browser focus together.
      focus(selected.id);
      let blank = lanesScroll().parent!;
      while (!blank.props.onResponderGrant) blank = blank.parent!;
      act(() => {
        blank.props.onResponderGrant({ nativeEvent: { pageX: 10, pageY: 10 } });
        blank.props.onResponderRelease({ nativeEvent: { pageX: 10, pageY: 10 } });
      });
      expect(doc.activeElement).toBe(root);
      expect(cards().some((card) => card.props.focused || card.props.current)).toBe(false);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("uses the Tab-focused card for Space and Enter before RNW synthesizes a click", () => {
    try {
      const { doc, root, board, focus, key } = renderFocusBoard();
      const selected = cards().find((card) => card.props.card.id === "sample-running")!.props.card;
      act(() => cards().find((card) => card.props.card.id === selected.id)!.props.onSelect(selected));
      focus("sample-done");
      const preview = key(" ");
      expect(preview.preventDefault).toHaveBeenCalledTimes(1);
      expect(preview.stopPropagation).toHaveBeenCalledTimes(1);
      expect(cards().filter((card) => card.props.current).map((card) => card.props.card.id)).toEqual(["sample-done"]);
      const open = key("Enter");
      expect(open.stopPropagation).toHaveBeenCalledTimes(1);
      expect(doc.activeElement).toBe(root);
      expect(board().props["aria-activedescendant"]).toBe("task-card-sample-done");
      expect(openAgent.mock.calls).toEqual([[{ agentId: "sample-done" }]]);
      key(" ");
      expect(cards().some((card) => card.props.current)).toBe(false);
      expect(cards().filter((card) => card.props.focused).map((card) => card.props.card.id)).toEqual(["sample-done"]);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each(["selected", "virtual", "dom"])("opens the %s card menu with period, Shift+F10 and ContextMenu", (mode) => {
    try {
      const browser = renderFocusBoard();
      const dispatchEvent = vi.fn();
      const node = { inBoard: true, dispatchEvent, getBoundingClientRect: () => ({ left: 80, top: 120 }) };
      const lookup = vi.fn(() => node);
      Object.assign(browser.doc, { getElementById: lookup });
      vi.stubGlobal("MouseEvent", class {
        constructor(public type: string, init: object) { Object.assign(this, init); }
      });
      expect(browser.key(".").preventDefault).not.toHaveBeenCalled();
      const selected = cards().find((card) => card.props.card.id === "sample-running")!;
      if (mode === "selected") act(() => selected.props.onSelect(selected.props.card));
      if (mode === "virtual") browser.key("j");
      if (mode === "dom") browser.focus("sample-done");
      const id = mode === "selected" ? selected.props.card.id : mode === "dom" ? "sample-done" : cards().find((card) => card.props.focused)!.props.card.id;
      for (const [key, options] of [[".", {}], ["F10", { shiftKey: true }], ["ContextMenu", {}]] as const) {
        expect(browser.key(key, false, options).preventDefault).toHaveBeenCalledOnce();
        expect(lookup).toHaveBeenLastCalledWith(`task-card-${id}`);
        expect(dispatchEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: "contextmenu", clientX: 96, clientY: 136, bubbles: true, cancelable: true }));
      }
      dispatchEvent.mockClear();
      for (const flags of [{ repeat: true }, { isComposing: true }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) browser.key(".", false, flags);
      expect(dispatchEvent).not.toHaveBeenCalled();
      browser.doc.activeElement = { inBoard: true, tagName: "INPUT" };
      expect(browser.key(".").preventDefault).not.toHaveBeenCalled();
      browser.doc.activeElement = { inBoard: false };
      expect(browser.key(".").preventDefault).not.toHaveBeenCalled();
      browser.doc.activeElement = browser.root;
      Object.assign(browser.root, { querySelector: () => ({}) });
      expect(browser.key("Enter").preventDefault).not.toHaveBeenCalled();
      expect(browser.key("a").preventDefault).not.toHaveBeenCalled();
      expect(browser.key(".").preventDefault).not.toHaveBeenCalled();
      expect(openAgent).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("handles preview and open when the host consumes activation at window capture", () => {
    writeSidebarPreference({ open: false, width: 380 });
    try {
      const { doc, root, focus, key } = renderFocusBoard();
      const selected = cards().find((card) => card.props.card.id === "sample-running")!;
      focus(selected.props.card.id);
      act(() => selected.props.onSelect(selected.props.card));
      expect(textOf(hostsById("detail-title")[0]!)).toBe(selected.props.card.title);
      toggleSidebarControl();
      // The host's global shortcut can preventDefault and stopPropagation before document.
      const clickedPreview = key(" ", true);
      expect(clickedPreview.preventDefault).toHaveBeenCalledTimes(1);
      expect(textOf(hostsById("detail-title")[0]!)).toBe(selected.props.card.title);
      key(" ", true);
      expect(hostsById("detail-title")).toHaveLength(0);
      key("ArrowRight");
      const focused = cards().find((card) => card.props.focused)!;
      expect(doc.activeElement).toBe(root);
      const preview = key(" ", true);
      expect(preview.preventDefault).toHaveBeenCalledTimes(1);
      expect(preview.stopPropagation).toHaveBeenCalledTimes(1);
      expect(textOf(hostsById("detail-title")[0]!)).toBe(focused.props.card.title);
      key(" ", true);
      expect(hostsById("detail-title")).toHaveLength(0);
      const open = key("Enter", true);
      expect(open.stopPropagation).toHaveBeenCalledTimes(1);
      expect(openAgent.mock.calls).toEqual([[{ agentId: focused.props.card.id }]]);
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("leaves room for the first card's complete focus outline inside every web lane", () => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    const lists = renderer!.root.findAll((node) => typeof node.props.renderItem === "function" && node.props.dataSet?.bclane === "");
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      const padding = StyleSheet.flatten(list.props.contentContainerStyle);
      expect(padding.paddingTop).toBeGreaterThanOrEqual(4);
      expect(padding.paddingLeft ?? padding.paddingHorizontal).toBeGreaterThanOrEqual(4);
      expect(padding.paddingRight ?? padding.paddingHorizontal).toBeGreaterThanOrEqual(4);
    }
  });

  it("previews a clicked card with Space while leaving text entry, other app focus and modified keys alone", () => {
    finishSidebarCloseImmediately();
    writeSidebarPreference({ open: false, width: 380 });
    const keys = new Set<(event: unknown) => void>();
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
    const doc = {
      activeElement: null as unknown, body: {}, visibilityState: "visible",
      addEventListener: (type: string, listener: (event: unknown) => void, capture?: boolean) => type === "keydown" && !capture && keys.add(listener),
      removeEventListener: (type: string, listener: (event: unknown) => void) => type === "keydown" && keys.delete(listener),
    };
    vi.stubGlobal("document", doc);
    try {
      act(() => { renderer = TestRenderer.create(screen(false), {
        createNodeMock: (element: React.ReactElement) => (element.props as { collapsable?: boolean }).collapsable === false
          ? { contains: (node: { inBoard?: boolean }) => node?.inBoard === true } : null,
      }); });
      layOut(1600);
      const selected = cards().find((card) => card.props.card.id === "sample-running")!;
      act(() => selected.props.onSelect(selected.props.card));
      expect(textOf(hostsById("detail-title")[0]!)).toBe(selected.props.card.title);
      toggleSidebarControl();
      expect(hostsById("detail-title")).toHaveLength(0);
      for (const active of [{ tagName: "INPUT", inBoard: true }, { tagName: "TEXTAREA", inBoard: true }, { isContentEditable: true, inBoard: true }, { inBoard: false }]) {
        doc.activeElement = active;
        const preventDefault = vi.fn();
        act(() => { for (const listener of keys) listener({ key: " ", preventDefault }); });
        expect(preventDefault).not.toHaveBeenCalled();
        expect(hostsById("detail-title")).toHaveLength(0);
      }
      doc.activeElement = null;
      for (const flags of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { defaultPrevented: true }]) {
        const preventDefault = vi.fn();
        act(() => { for (const listener of keys) listener({ key: " ", preventDefault, ...flags }); });
        expect(preventDefault).not.toHaveBeenCalled();
        expect(hostsById("detail-title")).toHaveLength(0);
      }
      const preventDefault = vi.fn();
      act(() => { for (const listener of keys) listener({ key: " ", preventDefault }); });
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(textOf(hostsById("detail-title")[0]!)).toBe(selected.props.card.title);
      expect(hostsById("sidebar-floating")).toHaveLength(1);
      act(() => { for (const listener of keys) listener({ key: " ", preventDefault }); });
      expect(hostsById("detail-title")).toHaveLength(0);
      expect(hostsById("sidebar-floating")).toHaveLength(0);
      act(() => { for (const listener of keys) listener({ key: " ", preventDefault }); });
      expect(textOf(hostsById("detail-title")[0]!)).toBe(selected.props.card.title);
      expect(openAgent).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it.each(["en", "zh"] as const)("shows the Space preview hint after Open in %s, hiding the hints on narrow boards", (language) => {
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    const toolbar = () => textOf(renderer!.root.findByType(DesktopToolbar));
    const strings = BOARD_STRINGS[language];
    expect(toolbar()).toContain(`↵${strings.keys.open}${strings.keys.space}${strings.keys.preview}/${strings.keys.search}`);
    layOut(800);
    expect(toolbar()).not.toContain(strings.keys.space);
  });

  it("disarms an armed stop on Esc, whatever has the keyboard focus", async () => {
    host.canStop = true;
    const keys: Array<(event: unknown) => void> = [];
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
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
    vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
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
      expect(capture).toHaveLength(2);
      const running = () => cards().find((card) => card.props.card.id === "sample-running")!;
      for (const focus of [search, sidebar]) {
        act(() => running().props.onStop(running().props.card));
        expect(running().props.stopPhase).toBe("confirming");
        doc.activeElement = focus;
        act(() => {
          for (const listener of capture) listener({ key: "Escape", preventDefault() {} });
        });
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
    expect(textOf(filters)).not.toContain("Clear filters");
    expect(textOf(hostsById("desktop-toolbar")[0]!)).toContain("Clear filters");
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
    expect(words()).toEqual(["Agent", "Project", "Workspace", "Labels"]);
    const dividers = () => ["board-switches-divider", "lane-width-divider", "done-window-divider"].flatMap(hostsById);
    expect(dividers()).toHaveLength(3);

    // The buttons need 700 of the group's 500: they drop their words, and read them out.
    lay(group(), { width: 500 });
    lay(view("filter-bar-end"), { width: 420 });
    lay(controls(), { width: 700 });
    expect(words()).toEqual([]);
    expect(dividers()).toHaveLength(0);
    expect(view("filter-bar-end").findAll((node) => (node.type as unknown) === "Text" && textOf(node) === "Sort")).toHaveLength(0);
    const named = (bar: ReactTestInstance) => bar.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.accessibilityLabel);
    expect(named(controls())).toEqual(["Agent", "Project", "Workspace", "Labels"]);
    expect(named(view("filter-bar-end"))).toContain("Sort");

    // Restoring five labels also restores each chevron and rectangular padding: 5 * (40 + 27) = 335.
    const hidden = view("filter-bar-words");
    expect(hidden.props["aria-hidden"]).toBe(true);
    expect(StyleSheet.flatten(hidden.props.style)).toMatchObject({ position: "absolute", opacity: 0 });
    const dropped = hidden.findAll((node) => (node.type as unknown) === "Text");
    expect(dropped.map(textOf)).toEqual(["Agent", "Project", "Workspace", "Labels", "Sort"]);
    lay(controls(), { width: 300 });
    lay(view("filter-bar-end"), { width: 300 });
    for (const text of dropped) act(() => text.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 40, height: 18 } } }));
    expect(words()).toEqual([]);
    // Circular buttons retain their geometry while labels wait for enough room.
    for (const button of controls().findAll((node) => (node.type as unknown) === "Pressable")) {
      expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 24, height: 24, borderRadius: 12 });
      expect(button.findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(1);
    }
    lay(group(), { width: 630 });
    expect(words()).toEqual([]);
    // Words alone fit at 675, but restoring them must also leave room for all three dividers.
    lay(group(), { width: 675 });
    expect(words()).toEqual([]);
    expect(dividers()).toHaveLength(0);
    // 300 + 335 + 3 * (1 + 8 + 10), plus the 12pt slack, fits at 704.
    lay(group(), { width: 704 });
    expect(words()).toEqual(expect.arrayContaining(["Project", "Labels"]));
    expect(dividers()).toHaveLength(3);
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-bar-words")).toHaveLength(0);

    // The done window and the sort pushed to a row of their own drop the words too.
    lay(controls(), { width: 660 });
    lay(view("filter-bar-end"), { y: 44, width: 420 });
    expect(words()).toEqual([]);
    expect(dividers()).toHaveLength(0);
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
  it.each([
    ["en", 14], ["zh", 14], ["en", 21], ["zh", 21],
  ] as const)("keeps moderate menu widths and spacing in %s at font size %i", (language, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    updateEnhancerPreferences({ language });
    const strings = BOARD_STRINGS[language];
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(2400);
    const toggle = (tip: string) => act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.dataSet?.bctip === tip).props.onPress());
    toggle(strings.tips.agent);
    expect(StyleSheet.flatten(hostsById("menu-panel")[0]!.props.style).width).toBe(Math.round(240 * base / 14));
    expect(menuOption(strings.emptyGroups.row)).toBeDefined();
    expect(menuOption("Claude")).toBeDefined();
    const rowStyle = StyleSheet.flatten(menuOption("Claude").props.style);
    expect(rowStyle).toMatchObject({ paddingHorizontal: 8, marginHorizontal: 6, gap: 8 });
    for (const [tip, width] of [[strings.tips.project, 280], [strings.tips.workspace, 260], [strings.tips.labels, 200]] as const) {
      toggle(tip);
      expect(StyleSheet.flatten(hostsById("menu-panel")[0]!.props.style).width).toBe(Math.min(Math.round(width * base / 14), 390 - 16));
      expect(hostsById("menu-search")).toHaveLength(tip === strings.tips.labels ? 0 : 1);
    }
    const laneWidth = hostsById("lane-width-control")[0]!.find((node) => (node.type as unknown) === "Pressable");
    act(() => laneWidth.props.onPress());
    expect(StyleSheet.flatten(hostsById("lane-width-menu")[0]!.props.style).width).toBe(Math.round(180 * base / 14));
    toggle(strings.tips.sort);
    expect(StyleSheet.flatten(hostsById("sort-menu")[0]!.props.style).width).toBe(Math.round(220 * base / 14));
    for (const label of Object.values(strings.sortKeys)) expect(menuOption(label)).toBeDefined();
    act(() => menuOption(strings.sortKeys.context).props.onPress());
    expect(hostsById("menu-submenu-panel")).toHaveLength(1);
    expect(StyleSheet.flatten(hostsById("menu-submenu-panel")[0]!.props.style).width).toBe(Math.round(190 * base / 14));
    act(() => menuOption(strings.sortDefault).props.onPress());
    act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
    expect(StyleSheet.flatten(hostsById("desktop-more-menu")[0]!.props.style).maxWidth).toBe(Math.round(200 * base / 14));
  });

  it.each([14, 21])("sizes selected-filter groups with the same width rule at UI%i", (base) => {
    act(() => { renderer = TestRenderer.create(screen(false, { agent: "claude,codex" }, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(2400);
    act(() => hostsById("chip-group-agent")[0]!.props.onPress());
    expect(StyleSheet.flatten(hostsById("chip-group-menu")[0]!.props.style).width).toBe(Math.min(Math.round(280 * base / 14), 390 - 16));
    expect(menuOption(BOARD_STRINGS.en.clearFilters)).toBeDefined();
  });

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
    const summary = hostsById("desktop-toolbar-search-summary")[0]!;
    const text = textOf(summary);
    // A single pick's chip draws its filter's icon, not the word, and reads the word out; a label's is its own solid tag.
    expect(text).toContain("api");
    const kind = summary.find((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel === "Labels");
    expect(kind.findAllByType(TagMark)).toHaveLength(1);
    // The switch and the done window show themselves: no chip, no hint line.
    expect(text).not.toContain("still show");
    expect(text).not.toContain("Hide subtasks");
    expect(text).not.toContain("Show subtasks");
    expect(text).not.toContain("7 days");
    expect(text).toContain("Clear filters");

    // The folded chip draws the agent icon and the count; the sentence is read out.
    const chip = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "chip-group-agent");
    expect(chip.props.accessibilityLabel).toBe("2 Agents selected");
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
    expect(textOf(summary)).toContain("apiCodex");
    expect(summary.find((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel === "Agent").findAll((node) => node.props.name === "Bot")).not.toHaveLength(0);
  });

  it("leaves out Clear filters while only the switches or the done window are set", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false, { sub: "1", win: "7d" }));
    });
    layOut(1600);
    expect(textOf(renderer!.root)).not.toContain("Clear filters");
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
    act(() => pressable("More").props.onPress());
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

  it.each([["en", 14], ["zh", 21]] as const)("shows inline %s lane widths at UI base %i before the time range, and folds them without losing the choice", async (language, base) => {
    updateEnhancerPreferences({ language });
    await act(async () => {
      renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } }));
    });
    layOut(1800);
    const strings = BOARD_STRINGS[language];
    const buttonSize = Math.round(28 * Math.max(1, base / 14));
    const segmentsWidth = 3 * (buttonSize + 2) + 6;
    const inlineWidth = segmentsWidth + 10 + (language === "zh" ? 2 : 5) * base;
    const controls = () => hostsById("filter-bar-controls")[0]!;
    const group = () => hostParentOf(controls())!;
    const end = () => hostsById("filter-bar-end")[0]!;
    const laneControl = () => hostsById("lane-width-control")[0]!;
    const inline = () => hostsById("toolbar-lane-width");
    const button = () => pressable(strings.laneWidth.button(strings.laneWidth.names[deviceTasksStore().snapshot().values?.laneWidth ?? "default"]));
    const lay = (node: ReactTestInstance, width: number) => act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 28 } } }));
    expect(inline()).toHaveLength(0);
    expect(hostsById("lane-width-label")).toHaveLength(0);
    expect(end().findAll((node) => typeof node.type === "string" && hostParentOf(node) === end()).indexOf(laneControl())).toBe(4);
    lay(controls(), 500);
    lay(group(), 1000);
    lay(end(), 650);
    lay(laneControl(), buttonSize);
    lay(hostsById("filter-bar")[0]!, 1800);
    const measure = hostsById("lane-width-measure")[0]!;
    expect(measure.props["aria-hidden"]).toBe(true);
    expect(textOf(measure)).toBe(language === "zh" ? "列宽" : "Lane width");
    // Enough room for the marks alone must not restore a heading that would overflow.
    lay(group(), 500 + segmentsWidth - buttonSize + 12);
    lay(measure, inlineWidth);
    expect(inline()).toHaveLength(0);
    expect(hostsById("lane-width-label")).toHaveLength(0);
    lay(group(), 1000);
    expect(inline()).toHaveLength(1);
    const label = () => hostsById("lane-width-label")[0]!;
    expect(textOf(label())).toBe(strings.laneWidth.label);
    expect(StyleSheet.flatten(label().props.style)).toMatchObject({ fontSize: base, color: "#6b6b75" });
    expect(hostParentOf(label())).toBe(laneControl());
    const laneChildren = laneControl().findAll((node) => typeof node.type === "string" && hostParentOf(node) === laneControl());
    expect(laneChildren.indexOf(label())).toBeLessThan(laneChildren.indexOf(inline()[0]!));
    const endGroups = () => end().findAll((node) => typeof node.type === "string" && hostParentOf(node) === end());
    expect(endGroups().filter((node) => node.props.testID).map((node) => node.props.testID)).toEqual([
      "empty-lanes-toggle", "subtasks-toggle", "archived-lane-toggle", "board-switches-divider",
      "lane-width-control", "lane-width-divider", "done-window", "done-window-divider",
    ]);
    for (const id of ["board-switches-divider", "lane-width-divider", "done-window-divider"]) {
      expect(StyleSheet.flatten(hostsById(id)[0]!.props.style)).toMatchObject({ height: 16, marginHorizontal: 4, backgroundColor: "#e2e2e6" });
    }
    const choices = () => inline()[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "radio");
    expect(choices().map(textOf)).toEqual(["", "", ""]);
    expect(choices().map((node) => node.props.accessibilityLabel)).toEqual([strings.laneWidth.names.narrow, strings.laneWidth.names.default, strings.laneWidth.names.wide]);
    expect(choices().map((node) => node.findByType(LaneWidthMark).props.laneWidth)).toEqual(["narrow", "default", "wide"]);
    expect(choices().map((node) => node.props.accessibilityState.selected)).toEqual([false, true, false]);
    expect(end().findAll((node) => typeof node.type === "string" && hostParentOf(node) === end()).indexOf(laneControl())).toBe(4);
    expect(StyleSheet.flatten(inline()[0]!.props.style).height).toBe(Math.round(28 * Math.max(1, base / 14)));
    await act(async () => choices()[2]!.props.onPress());
    expect(deviceTasksStore().snapshot().values?.laneWidth).toBe("wide");
    expect(choices().map((node) => node.props.accessibilityState.selected)).toEqual([false, false, true]);

    // Actual inline geometry: a narrower row first folds the choices, retaining the other labels.
    lay(laneControl(), inlineWidth);
    lay(end(), 650 + inlineWidth - buttonSize);
    // A direct window shrink can move the end to a new row without firing its onLayout.
    lay(hostsById("filter-bar")[0]!, 1000);
    expect(inline()).toHaveLength(0);
    expect(hostsById("lane-width-label")).toHaveLength(0);
    lay(group(), 600);
    lay(hostsById("filter-bar")[0]!, 1200);
    lay(laneControl(), buttonSize);
    lay(end(), 650);
    expect(textOf(controls())).toContain(strings.project);
    expect(textOf(button())).toBe("");
    expect(hostsById("lane-width-divider")).toHaveLength(1);
    expect(hostsById("done-window-divider")).toHaveLength(1);
    expect(button().findByType(LaneWidthMark).props.laneWidth).toBe("wide");
    await act(async () => button().props.onPress());
    expect(hostsById("lane-width-menu")).toHaveLength(1);
    const menuMarks = hostsById("lane-width-menu")[0]!.findAllByType(LaneWidthMark);
    expect(menuMarks.map((mark) => mark.props.laneWidth)).toEqual(["narrow", "default", "wide"]);
    expect(menuMarks.every((mark) => mark.props.color === "#6b6b75")).toBe(true);

    // Growing again also dismisses a menu that is no longer the active control.
    lay(hostsById("filter-bar")[0]!, 1800);
    lay(group(), 1000);
    expect(inline()).toHaveLength(1);
    expect(textOf(label())).toBe(strings.laneWidth.label);
    expect(hostsById("lane-width-menu")).toHaveLength(0);
    expect(choices().map((node) => node.props.accessibilityState.selected)).toEqual([false, false, true]);
    failDeviceWrite();
    await act(async () => choices()[0]!.props.onPress());
    expect(deviceTasksStore().snapshot().values?.laneWidth).toBe("wide");
    expect(choices().map((node) => node.props.accessibilityState.selected)).toEqual([false, false, true]);
    expect(host.toast).toHaveBeenCalledWith(strings.laneWidth.saveFailed);
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
    if (os === "web") act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    for (const [index, width, value, label] of [[0, 220, "narrow", "Narrow"], [1, 260, "default", "Default"], [2, 300, "wide", "Wide"], [0, 220, "narrow", "Narrow"]] as const) {
      if (os === "web") {
        const choices = hostsById("filter-sheet-lane-width")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "radio");
        await act(async () => choices[index]!.props.onPress());
      } else {
        act(() => hostsById("tablet-view")[0]!.props.onPress());
        act(() => menuOption("Lane width").props.onPress());
        await act(async () => menuOption(label).props.onPress());
      }
      await panelLag();
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
    expect(textOf(button())).toBe("");
    expect(button().findByType(LaneWidthMark).props.laneWidth).toBe("default");
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: false, contentContainerStyle: { width: 1300 } });
    act(() => button().props.onPress());
    const menu = renderer!.root.find((node) => node.props.testID === "lane-width-menu");
    const items = menu.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
    expect(items.map(textOf)).toEqual(["Narrow", "Default", "Wide"]);
    expect(textOf(menu)).not.toContain("Lane width");
    await act(async () => items[2]!.props.onPress());
    expect(renderer!.root.findAll((node) => node.props.testID === "lane-width-menu")).toHaveLength(0);
    expect(textOf(button())).toBe("");
    expect(button().findByType(LaneWidthMark).props.laneWidth).toBe("wide");
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
    expect(textOf(button())).toBe("");
    expect(button().findByType(LaneWidthMark).props.laneWidth).toBe("default");
    expect(host.reload).not.toHaveBeenCalled();
    expect(host.toast).toHaveBeenCalledWith("Couldn't save the lane width");
  });
});

describe("Tasks board, archived lane switch", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });

  const toggle = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "archived-lane-toggle")[0]!;

  it("shows the archived lane from the filter bar's switch, and saves it", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    // A round Archive switch: no word, struck through while the lane hides.
    const slashed = () => toggle().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    expect(textOf(toggle())).toBe("");
    expect(toggle().props).toMatchObject({ accessibilityRole: "switch", accessibilityLabel: "Show the archived lane", accessibilityState: { checked: false } });
    expect(slashed()).toBe(true);
    const outline = () => StyleSheet.flatten(toggle().props.style).borderColor;
    const offOutline = outline();
    expect(hostsById("lane-archived")).toHaveLength(0);
    // Full-text search sits beside the input; board visibility controls retain their order.
    const toolbar = renderer!.root.findByType(DesktopToolbar);
    expect(toolbar.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID)).toEqual(["search-full-conversation-toggle", "desktop-toolbar-more", "sidebar-switch"]);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    expect(end.findAll((node) => (node.type as unknown) === "Pressable" && /-toggle$/.test(node.props.testID ?? "")).map((node) => node.props.testID)).toEqual(["empty-lanes-toggle", "subtasks-toggle", "archived-lane-toggle"]);
    expect(hostsById("toolbar-archived")).toHaveLength(0);
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

describe("Tasks board, desktop refresh button", () => {
  const handle = () => (data as unknown as { __handle: { refresh: ReturnType<typeof vi.fn> } }).__handle;
  const refreshButton = () => hostsById("desktop-toolbar-more")[0]!;
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  });

  it.each([600, 1600])("keeps the more menu above the filter bar and lanes at %i pt", (width) => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    act(() => refreshButton().props.onPress());
    const toolbar = hostsById("desktop-toolbar")[0]!;
    const area = hostsById("tasks-board-area")[0]!;
    const filterBar = hostsById("filter-bar")[0];
    const layer = StyleSheet.flatten(toolbar.props.style).zIndex ?? 0;
    expect(hostParentOf(toolbar)).toBe(hostParentOf(area));
    expect(layer).toBeGreaterThan(StyleSheet.flatten(area.props.style).zIndex ?? 0);
    if (width === 1600) {
      expect(filterBar).toBeDefined();
      expect(hostParentOf(filterBar!)).toBe(hostParentOf(toolbar));
      expect(layer).toBeGreaterThan(StyleSheet.flatten(filterBar!.props.style).zIndex ?? 0);
    }
    expect(toolbar.findAll((node) => typeof node.type === "string" && node.props.testID === "desktop-more-menu")).toHaveLength(1);
    expect(menuOption(BOARD_STRINGS.en.refreshTasks)).toBeDefined();
    act(() => refreshButton().props.onPress());
    expect(hostsById("desktop-more-menu")).toHaveLength(0);
  });

  it.each(["en", "zh"] as const)("keeps the count centred and offers refresh in the %s more menu", (language) => {
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    const middle = hostsById("desktop-toolbar-total")[0]!;
    expect(textOf(middle)).toContain(BOARD_STRINGS[language].totalUnit(6).trim());
    expect(middle.props.pointerEvents).toBe("none");
    expect(refreshButton().props.dataSet.bctip).toBe(BOARD_STRINGS[language].more);
    expect(refreshButton().find((node) => (node.type as unknown) === "Icon").props.name).toBe("MoreVertical");
    act(() => refreshButton().props.onPress());
    expect(StyleSheet.flatten(hostsById("desktop-more-menu")[0]!.props.style)).toMatchObject({ width: "max-content", maxWidth: NATIVE(200) });
    expect(textOf(menuOption(BOARD_STRINGS[language].refreshTasks))).toContain("⌥R");
    expect(menuOption(BOARD_STRINGS[language].emptyGroups.hide)).toBeDefined();
  });

  it.each(["done", "failed", "rejected"] as const)("shows a loading ring only while refreshing (%s), without redrawing a row", async (outcome) => {
    let finish!: () => void;
    handle().refresh.mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => (outcome === "rejected" ? reject(new Error("gone")) : resolve(outcome));
    }));
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1600);
    expect(refreshButton().props.accessibilityState).toEqual({ busy: false });
    expect(hostsById("desktop-toolbar-more-spinner")).toHaveLength(0);
    // The board's own first settle draws the rows once more; count from after it.
    await act(async () => {});
    const rows = host.rowRenders;
    const cardsBefore = cards().map((card) => card.props.card);
    act(() => refreshButton().props.onPress());
    await act(async () => { menuOption(BOARD_STRINGS.en.refreshTasks).props.onPress(); });
    expect(handle().refresh).toHaveBeenCalledTimes(1);
    expect(refreshButton().props.accessibilityState).toEqual({ busy: true });
    expect(hostsById("desktop-toolbar-more-spinner")).toHaveLength(1);
    expect(refreshButton().props.accessibilityLabel).toBe(BOARD_STRINGS.en.refreshTasks);
    expect(refreshButton().findAll((node) => (node.type as unknown) === "Icon")).toHaveLength(0);
    // A second press while it runs asks nothing more.
    act(() => refreshButton().props.onPress());
    expect(menuOption(BOARD_STRINGS.en.refreshTasks).props.disabled).toBe(true);
    act(() => refreshButton().props.onPress());
    expect(handle().refresh).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await Promise.resolve(); });
    expect(refreshButton().props.accessibilityState).toEqual({ busy: false });
    expect(hostsById("desktop-toolbar-more-spinner")).toHaveLength(0);
    expect(refreshButton().find((node) => (node.type as unknown) === "Icon").props.name).toBe("MoreVertical");
    expect(host.rowRenders).toBe(rows);
    expect(cards()).toHaveLength(cardsBefore.length);
    cards().forEach((card, index) => expect(card.props.card).toBe(cardsBefore[index]));
    // It can run again.
    act(() => refreshButton().props.onPress());
    await act(async () => { menuOption(BOARD_STRINGS.en.refreshTasks).props.onPress(); });
    expect(handle().refresh).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); await Promise.resolve(); });
  });

  it("runs Option+R through the refresh action, with the menu open or closed, and blocks duplicate refreshes", async () => {
    let finish!: () => void;
    handle().refresh.mockImplementation(() => new Promise((resolve) => { finish = () => resolve("done"); }));
    const browser = renderFocusBoard();
    browser.doc.activeElement = browser.root;
    try {
      // macOS Option+R produces a different key value: match its physical code.
      const key = () => browser.key("®", false, { code: "KeyR", altKey: true });
      await act(async () => { expect(key().preventDefault).toHaveBeenCalledOnce(); });
      expect(handle().refresh).toHaveBeenCalledTimes(1);
      expect(hostsById("desktop-toolbar-more-spinner")).toHaveLength(1);
      await act(async () => { key(); });
      expect(handle().refresh).toHaveBeenCalledTimes(1);
      await act(async () => { finish(); });
      act(() => refreshButton().props.onPress());
      await act(async () => { key(); });
      expect(handle().refresh).toHaveBeenCalledTimes(2);
      expect(hostsById("desktop-more-menu")).toHaveLength(0);
      await act(async () => { finish(); });
      act(() => renderer!.unmount());
      renderer = undefined;
      expect(key().preventDefault).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });

  it("yields Option+R to typing and other surfaces, and ignores extra modifiers, repeats and composition", async () => {
    const browser = renderFocusBoard();
    try {
      for (const active of [
        { inBoard: true, closest: () => ({}) },
        { inBoard: true, isContentEditable: true, closest: () => null },
        { inBoard: false },
      ]) {
        browser.doc.activeElement = active;
        expect(browser.key("®", false, { code: "KeyR", altKey: true }).preventDefault).not.toHaveBeenCalled();
      }
      browser.doc.activeElement = browser.root;
      for (const flags of [{ altKey: false }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { isComposing: true }, { code: "KeyT" }, { defaultPrevented: true }]) {
        expect(browser.key("®", false, { code: "KeyR", altKey: true, ...flags }).preventDefault).not.toHaveBeenCalled();
      }
      await act(async () => { browser.key("®", false, { code: "KeyR", altKey: true, repeat: true }); });
      expect(handle().refresh).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount());
      renderer = undefined;
      vi.unstubAllGlobals();
    }
  });
});

describe("Tasks board, refresh during a title reveal", () => {
  type Answer = (state: { state: "done"; title: string } | { state: "error"; error: string }) => void;
  const LANES = ["needs_input", "running", "review", "done", "archived"] as const;
  type Lane = (typeof LANES)[number];
  const permission = { id: "p", provider: "claude", name: "Bash", kind: "tool", input: { command: "npm test" } };
  /** An agent the store puts in `lane`, last updated `ageMs` ago. */
  function agentIn(lane: Lane, id: string, title: string, ageMs: number) {
    const updatedAt = new Date(Date.now() - ageMs).toISOString();
    const base = { id, title, workspaceId: "ws", updatedAt, lastUserMessageAt: updatedAt };
    if (lane === "needs_input") return makeAgent({ ...base, status: "running", pendingPermissions: [permission] as never });
    if (lane === "running") return makeAgent({ ...base, status: "running" });
    if (lane === "review") return makeAgent({ ...base, status: "idle", requiresAttention: true, attentionReason: "finished" });
    if (lane === "done") return makeAgent({ ...base, status: "idle", requiresAttention: false });
    return makeAgent({ ...base, status: "idle", requiresAttention: false, archivedAt: updatedAt });
  }

  async function mountLive(lane: Lane) {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const titleUpdates = await import("../../client/tasks/actions/title-update");
    let answer!: Answer;
    const control = titleUpdates.createTitleUpdateControl(() => new Promise((resolve) => { answer = resolve as Answer; }));
    const titleControl = vi.spyOn(titleUpdates, "useTitleUpdateControl").mockReturnValue(control);
    const fake = createFakePaseo({ agents: [agentIn(lane, "title-first", "First task", 60_000), agentIn(lane, "title-target", "Old title", 120_000)] });
    host.liveTasks = fake.paseo;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } };
    // Newest first, so the renamed card's later update would move it to the top.
    await act(async () => { renderer = TestRenderer.create(screen(false, { sort: "updated-desc" })); });
    await act(async () => { await deviceTasksStore().update({ showArchived: true }); });
    layOut(2400);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const laneCards = () => cards().filter((card) => card.props.card.lane === lane);
    const ids = () => laneCards().map((card) => card.props.card.id);
    const pressRefresh = async () => {
      act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
      await act(async () => {
        menuOption(BOARD_STRINGS.en.refreshTasks).props.onPress();
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    };
    return { control, answer: (state: Parameters<Answer>[0]) => answer(state), fake, laneCards, ids, pressRefresh, restore: () => titleControl.mockRestore() };
  }

  it.each(LANES)("holds a rename a refresh brings until its complete title is displayed (%s)", async (lane) => {
    const live = await mountLive(lane);
    const title = "A complete generated title that must finish before the card moves";
    try {
      expect(live.ids()).toEqual(["title-first", "title-target"]);
      const [firstCard, targetCard] = live.laneCards().map((card) => card.props.card);
      await act(async () => live.control.start("title-target"));
      const rowRenders = host.rowRenders;
      // The daemon saved the rename before the client hears the title is done; the refresh brings it.
      live.fake.setAgentSilently(agentIn(lane, "title-target", title, 0));
      await live.pressRefresh();
      expect(hostsById("desktop-toolbar-more")[0]!.props.accessibilityState).toEqual({ busy: false });
      expect(live.ids()).toEqual(["title-first", "title-target"]);
      expect(live.laneCards()[0]!.props.card).toBe(firstCard);
      expect(live.laneCards()[1]!.props.card).toBe(targetCard);
      expect(host.rowRenders).toBe(rowRenders);
      await act(async () => live.answer({ state: "done", title }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      expect(live.control.revealing().has("title-target")).toBe(true);
      expect(live.ids()).toEqual(["title-first", "title-target"]);
      expect(live.laneCards()[1]!.props.card).toBe(targetCard);
      expect(host.rowRenders).toBe(rowRenders);
      for (let index = 0; index < 100 && live.control.revealing().has("title-target"); index++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      }
      expect(live.control.revealing().has("title-target")).toBe(false);
      expect(live.ids()).toEqual(["title-target", "title-first"]);
      expect(live.laneCards()[0]!.props.card.title).toBe(title);
      expect(live.laneCards()[1]!.props.card).toBe(firstCard);
      expect(textOf(live.laneCards()[0]!.find((node) => typeof node.type === "string" && node.props.testID === "task-card-title"))).toBe(title);
    } finally {
      live.restore();
    }
  });

  it("releases the held card when the generation fails, taking the refreshed snapshot", async () => {
    const live = await mountLive("done");
    try {
      await act(async () => live.control.start("title-target"));
      live.fake.setAgentSilently(agentIn("done", "title-target", "Renamed elsewhere", 0));
      await live.pressRefresh();
      expect(live.ids()).toEqual(["title-first", "title-target"]);
      expect(live.laneCards()[1]!.props.card.title).toBe("Old title");
      await act(async () => live.answer({ state: "error", error: "model unavailable" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      expect(live.control.revealing().has("title-target")).toBe(false);
      expect(live.ids()).toEqual(["title-target", "title-first"]);
      expect(live.laneCards()[0]!.props.card.title).toBe("Renamed elsewhere");
    } finally {
      live.restore();
    }
  });

  it("lets a refresh remove a revealing card, or move it to another lane, at once", async () => {
    const live = await mountLive("running");
    try {
      await act(async () => live.control.start("title-target"));
      await act(async () => live.control.start("title-first"));
      // One finished meanwhile with a new title, one was deleted: neither waits for its reveal.
      live.fake.setAgentSilently(agentIn("done", "title-target", "Finished and renamed", 0));
      live.fake.forgetAgent("title-first");
      await live.pressRefresh();
      expect(live.control.revealing().has("title-target")).toBe(true);
      expect(live.ids()).toEqual([]);
      const done = cards().filter((card) => card.props.card.lane === "done");
      expect(done.map((card) => card.props.card.id)).toEqual(["title-target"]);
      expect(cards().some((card) => card.props.card.id === "title-first")).toBe(false);
    } finally {
      live.restore();
    }
  });
});

describe("Tasks board, a title the daemon starts with the first message", () => {
  type Answer = (state: TitleUpdateState) => void;
  const LANES = ["needs_input", "running", "review", "done", "archived"] as const;
  type Lane = (typeof LANES)[number];
  const permission = { id: "p", provider: "claude", name: "Bash", kind: "tool", input: { command: "npm test" } };
  function agentIn(lane: Lane, id: string, title: string, ageMs: number) {
    const updatedAt = new Date(Date.now() - ageMs).toISOString();
    const base = { id, title, workspaceId: "ws", updatedAt, lastUserMessageAt: updatedAt };
    if (lane === "needs_input") return makeAgent({ ...base, status: "running", pendingPermissions: [permission] as never });
    if (lane === "running") return makeAgent({ ...base, status: "running" });
    if (lane === "review") return makeAgent({ ...base, status: "idle", requiresAttention: true, attentionReason: "finished" });
    if (lane === "done") return makeAgent({ ...base, status: "idle", requiresAttention: false });
    return makeAgent({ ...base, status: "idle", requiresAttention: false, archivedAt: updatedAt });
  }
  const sweeping = (card: ReactTestInstance) => card.findAllByType(TitleLoading).length > 0;

  /** Both cards start in `from`; the daemon answers each status ask through `answer`. */
  async function mountLive(from: Lane, afterFirstReply = true) {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const titleUpdates = await import("../../client/tasks/actions/title-update");
    let answer!: Answer;
    const call = vi.fn((_input: { agentId: string; action: string }) => new Promise<TitleUpdateState>((resolve) => { answer = resolve; }));
    const control = titleUpdates.createTitleUpdateControl(call);
    const titleControl = vi.spyOn(titleUpdates, "useTitleUpdateControl").mockReturnValue(control);
    const fake = createFakePaseo({ agents: [agentIn(from, "title-first", "First task", 60_000), agentIn(from, "title-target", "Fix the card title", 120_000)] });
    host.liveTasks = fake.paseo;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } };
    host.titleSettings = titleGenerationSettingsSchema.parse({ afterFirstReply });
    await act(async () => { renderer = TestRenderer.create(screen(false, { sort: "updated-desc" })); });
    await act(async () => { await deviceTasksStore().update({ showArchived: true }); });
    layOut(2400);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const laneCards = (lane: Lane) => cards().filter((card) => card.props.card.lane === lane);
    const target = () => cards().find((card) => card.props.card.id === "title-target")!;
    const push = async (agent: ReturnType<typeof makeAgent>) => {
      await act(async () => { fake.pushAgentSnapshot(agent); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    };
    const reply = async (state: TitleUpdateState, wait = 0) => {
      await act(async () => answer(state));
      await act(async () => { await vi.advanceTimersByTimeAsync(wait); });
    };
    return { control, call, fake, laneCards, target, push, reply, restore: () => titleControl.mockRestore() };
  }

  it.each(LANES.filter((lane) => lane !== "running"))("follows a title when a task starts (%s → running)", async (from) => {
    const live = await mountLive(from);
    try {
      expect(live.call).not.toHaveBeenCalled();
      await live.push(agentIn("running", "title-target", "Fix the card title", 0));
      expect(live.call).toHaveBeenLastCalledWith({ agentId: "title-target", action: "status" });
      await live.reply({ state: "idle" }, 1000);
      expect(sweeping(live.target())).toBe(false);
      await live.reply({ state: "running", helperId: "helper" });
      expect(live.control.revealing().has("title-target")).toBe(true);
      expect(sweeping(live.target())).toBe(true);
      expect(cards().filter(sweeping).map((card) => card.props.card.id)).toEqual(["title-target"]);
    } finally {
      live.restore();
    }
  });

  it("does not attach initial running cards, updates within running, or turn endings", async () => {
    const live = await mountLive("running");
    try {
      expect(live.call).not.toHaveBeenCalled();
      await live.push(agentIn("running", "title-target", "Fix the card title", 0));
      await live.push(agentIn("review", "title-target", "Fix the card title", 0));
      expect(live.call).not.toHaveBeenCalled();
    } finally {
      live.restore();
    }
  });

  it("does not treat a filtered-list removal and return as a new start", async () => {
    const live = await mountLive("running");
    try {
      await act(async () => { live.fake.removeAgent("title-target"); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { live.fake.upsertAgent(agentIn("running", "title-target", "Fix the card title", 0)); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(live.call).not.toHaveBeenCalled();
    } finally {
      live.restore();
    }
  });

  it("leaves a card alone when the setting is off", async () => {
    const live = await mountLive("done", false);
    try {
      await live.push(agentIn("running", "title-target", "Fix the card title", 0));
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(live.call).not.toHaveBeenCalled();
      expect(sweeping(live.target())).toBe(false);
    } finally {
      live.restore();
    }
  });

  it("keeps normal lane changes live while a running card reveals its title", async () => {
    const live = await mountLive("done");
    try {
      await live.push(agentIn("running", "title-target", "Fix the card title", 0));
      await live.reply({ state: "running", text: "A new title" });
      await live.push(agentIn("needs_input", "title-target", "A new title", 0));
      expect(live.target().props.card.lane).toBe("needs_input");
    } finally {
      live.restore();
    }
  });

  it.each(LANES)("holds the card in place until the followed title is displayed (%s)", async (lane) => {
    const live = await mountLive(lane);
    const title = "A complete generated title that must finish before the card moves";
    try {
      expect(live.laneCards(lane).map((card) => card.props.card.id)).toEqual(["title-first", "title-target"]);
      const [firstCard, targetCard] = live.laneCards(lane).map((card) => card.props.card);
      await act(async () => live.control.attach("title-target"));
      await live.reply({ state: "running", helperId: "helper", text: "A complete" });
      expect(sweeping(live.target())).toBe(true);
      const rowRenders = host.rowRenders;
      // The daemon pushes the rename before the client hears the title is done.
      await live.push(agentIn(lane, "title-target", title, 0));
      expect(live.laneCards(lane).map((card) => card.props.card.id)).toEqual(["title-first", "title-target"]);
      expect(live.laneCards(lane)[0]!.props.card).toBe(firstCard);
      expect(live.laneCards(lane)[1]!.props.card).toBe(targetCard);
      expect(host.rowRenders).toBe(rowRenders);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await live.reply({ state: "done", title }, 30);
      expect(live.control.revealing().has("title-target")).toBe(true);
      expect(live.laneCards(lane)[1]!.props.card).toBe(targetCard);
      expect(host.rowRenders).toBe(rowRenders);
      for (let index = 0; index < 100 && live.control.revealing().has("title-target"); index++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      }
      expect(live.control.revealing().has("title-target")).toBe(false);
      expect(live.laneCards(lane).map((card) => card.props.card.id)).toEqual(["title-target", "title-first"]);
      expect(live.laneCards(lane)[0]!.props.card.title).toBe(title);
      expect(live.laneCards(lane)[1]!.props.card).toBe(firstCard);
      expect(sweeping(live.target())).toBe(false);
    } finally {
      live.restore();
    }
  });

  it("releases the card without an error when the followed job fails", async () => {
    const live = await mountLive("done");
    try {
      await act(async () => live.control.attach("title-target"));
      await live.reply({ state: "running" });
      expect(sweeping(live.target())).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await live.reply({ state: "error", error: "model unavailable" });
      expect(live.control.revealing().has("title-target")).toBe(false);
      expect(sweeping(live.target())).toBe(false);
      expect(live.target().findAll((node) => typeof node.type === "string" && node.props.testID === "task-title-update-error")).toHaveLength(0);
      expect(live.target().props.card.title).toBe("Fix the card title");
    } finally {
      live.restore();
    }
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
        "Search tasks (/)",
        "Filter by project",
        "Filter by workspace",
        "Filter by Agent",
        "Filter by label",
        "Hide subtasks (S)",
        "How far back Done and Archived reach",
        "Show the archived lane (A)",
        "Order the cards in each lane",
        "Lanes · Default",
      ]),
    );
    const toggle = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "archived-lane-toggle")[0]!;
    await act(async () => toggle.props.onPress());
    expect(tips()).toContain("Hide the archived lane (A)");
    expect(tips()).not.toContain("Show the archived lane (A)");
    const subtasks = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "subtasks-toggle")[0]!;
    act(() => subtasks.props.onPress());
    expect(tips()).toContain("Show subtasks (S)");
    expect(tips()).not.toContain("Hide subtasks (S)");
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
    expect(tips()).toContain("Filter by Agent");
    lay(hostParentOf(view("filter-bar-controls"))!, 500);
    lay(view("filter-bar-end"), 420);
    lay(view("filter-bar-controls"), 700);
    expect(tips()).toEqual(
      expect.arrayContaining([
        "Agent · 1\nFilter by Agent",
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

describe("F2: tablet overlays outside toolbar AX bounds", () => {
  const bar = () => hostsById("tablet-toolbar")[0]!;
  const end = () => hostsById("tablet-toolbar-end")[0]!;
  const anchor = () => hostParentOf(hostsById("tablet-view")[0]!)!;
  const style = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style);
  const layout = (node: ReactTestInstance, box: { x?: number; y?: number; width: number; height?: number }) =>
    act(() => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, height: 44, ...box } } }));
  const mount = (os: string, width?: number, base = 14) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    if (width !== undefined) layOut(width);
  };
  const siblingAfterBar = (overlay: ReactTestInstance) => {
    const parent = hostParentOf(bar())!;
    expect(hostParentOf(overlay)).toBe(parent);
    expect(bar().findAll((node) => node === overlay)).toHaveLength(0);
    const siblings = parent.findAll((node) => typeof node.type === "string" && hostParentOf(node) === parent);
    expect(siblings.indexOf(overlay)).toBeGreaterThan(siblings.indexOf(bar()));
    expect(style(overlay).zIndex).toBeGreaterThan(style(bar()).zIndex);
    expect(style(overlay).zIndex).toBeGreaterThan(style(hostsById("tablet-toolbar-backdrop")[0]!).zIndex);
  };

  it.each(["android", "ios"])("%s waits for every anchor layout and mounts only while open", (os) => {
    mount(os);
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    expect(hostsById("tablet-view-menu")).toHaveLength(0);
    layout(bar(), { width: 800 });
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
    layout(anchor(), { x: 200, width: 44 });
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
    layout(end(), { x: 400, y: 6, width: 388 });
    const overlay = hostsById("tablet-view-overlay")[0]!;
    siblingAfterBar(overlay);
    expect(overlay.props.pointerEvents).toBe("box-none");
    for (const prop of ["accessible", "accessibilityLabel", "aria-label", "aria-hidden", "accessibilityElementsHidden"]) expect(overlay.props).not.toHaveProperty(prop);
    expect(style(overlay)).toMatchObject({ position: "absolute", top: 0, bottom: 0, left: 0 });
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
    expect(hostsById("tablet-view-menu")).toHaveLength(0);
    expect(hostsById("tablet-toolbar-backdrop")).toHaveLength(0);
  });

  it.each([
    ["android", 480, 14], ["android", 834, 21],
    ["ios", 834, 14], ["ios", 1200, 21],
  ] as const)("%s at %i pt/UI%i keeps the old right-aligned menu coordinates, including relayout", (os, width, base) => {
    mount(os, width, base);
    const target = style(hostsById("tablet-view")[0]!).height as number;
    const compare = (toolbarWidth: number, endX: number, endY: number, viewX: number, viewY: number, viewWidth: number) => {
      layout(bar(), { width: toolbarWidth });
      layout(end(), { x: endX, y: endY, width: toolbarWidth - endX - 12 });
      layout(anchor(), { x: viewX, y: viewY, width: viewWidth });
      const overlay = hostsById("tablet-view-overlay")[0]!;
      const menu = hostsById("tablet-view-menu")[0]!;
      siblingAfterBar(overlay);
      expect(hostParentOf(menu)).toBe(overlay);
      const oldRightEdge = endX + viewX + viewWidth;
      const oldTop = endY + viewY + target + 6;
      const menuStyle = style(menu);
      expect(toolbarWidth - (style(overlay).right as number)).toBe(oldRightEdge);
      expect(menuStyle).toMatchObject({ position: "absolute", top: oldTop, right: 0, width: Math.min(Math.round(220 * base / 14), width - 24), zIndex: 30 });
    };
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    compare(width, width / 2, 6, 80, 2, target);
    compare(width + 24, width / 2 + 10, 8, 70, 1, target + 20);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
  });

  it.each([["android", 480, 14], ["ios", 600, 21]] as const)("%s at %i pt/UI%i opens search below the toolbar with autofocus, clear and dismissal", (os, width, base) => {
    mount(os, width, base);
    const height = style(bar()).height;
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    const search = () => hostsById("tablet-toolbar-search")[0]!;
    expect(hostsById("tablet-search-popover")).toHaveLength(0);
    expect(hostParentOf(search())?.props.testID).toBe("tablet-toolbar-search-group");
    expect(hostParentOf(hostsById("tablet-toolbar-search-group")[0]!)?.props.testID).toBe("tablet-search-row");
    expect(bar().findAll((node) => node === search())).toHaveLength(0);
    expect(hostsById("tablet-search-toggle")).toHaveLength(1);
    expect(style(hostsById("tablet-search-toggle")[0]!).backgroundColor).toBe("transparent");
    expect(hostsById("tablet-toolbar-start")[0]!.children.map((node) => typeof node === "string" ? node : node.props.testID)).toEqual(["tablet-search-toggle"]);
    expect(search().findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "Search")).toHaveLength(0);
    expect(style(search())).toMatchObject({ height: Math.round(40 * base / 14) - 8, width: 320, flexShrink: 1, minWidth: 0 });
    expect(style(search()).position).toBeUndefined();
    expect(hostsById("tablet-toolbar-total")).toHaveLength(1);
    expect(style(hostsById("tablet-toolbar-start")[0]!).minWidth).toBe(style(end()).minWidth);
    expect(style(end())).toMatchObject({ flex: 1, flexBasis: 0 });
    expect(hostsById("toolbar-filters")).toHaveLength(1);
    expect(hostsById("tablet-view")).toHaveLength(1);
    const input = () => search().find((node) => (node.type as unknown) === "TextInput");
    expect(input().props.autoFocus).toBe(true);
    expect(style(input()).fontSize).toBe(Math.round(12 * base / 14));
    act(() => input().props.onChangeText("needle"));
    expect(input().props.value).toBe("needle");
    expect(style(hostsById("tablet-search-toggle")[0]!).backgroundColor).toBe("transparent");
    act(() => hostsById("tablet-search-clear")[0]!.props.onPress());
    expect(input().props.value).toBe("");
    expect(hostsById("tablet-search-clear")).toHaveLength(0);
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(0);
    expect(style(hostsById("tablet-search-toggle")[0]!).backgroundColor).toBe("transparent");
    expect(hostsById("tablet-toolbar-total")).toHaveLength(1);
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(0);
    expect(hostsById("tablet-view-menu")).toHaveLength(1);
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(0);
    expect(hostsById("tablet-toolbar-total")).toHaveLength(1);
    expect(style(bar()).height).toBe(height);
  });

  it.each([["ios", 600], ["ios", 800], ["android", 600], ["android", 800]] as const)("%s at %i keeps the search compact and dismisses only an empty query", (os, width) => {
    mount(os, width);
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(style(hostsById("tablet-toolbar-search")[0]!).width).toBe(320);
    expect(hostsById("tablet-toolbar-backdrop")).toHaveLength(1);
    expect(style(hostsById("tablet-toolbar-backdrop")[0]!).zIndex).toBeLessThan(style(bar()).zIndex);
    act(() => hostsById("search-full-conversation-toggle")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    const input = () => hostsById("tablet-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput");
    act(() => input().props.onChangeText("needle"));
    expect(hostsById("tablet-toolbar-backdrop")).toHaveLength(0);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    expect(input().props.value).toBe("needle");
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    act(() => hostsById("tablet-search-clear")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-backdrop")).toHaveLength(1);
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-toolbar-search")).toHaveLength(0);
    expect(hostsById("tablet-search-toggle")).toHaveLength(1);
  });

  it.each(["ios", "android"])("shows %s fixed-width search inline on a wide toolbar", (os) => {
    mount(os, 1200);
    expect(hostsById("tablet-search-toggle")).toHaveLength(0);
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    expect(hostParentOf(hostsById("tablet-toolbar-search-group")[0]!)?.props.testID).toBe("tablet-toolbar-start");
    expect(StyleSheet.flatten(hostsById("search-full-conversation-toggle")[0]!.props.style)).toMatchObject({ borderWidth: 0, borderRadius: 7 });
    const fullSearchIcon = hostsById("search-full-conversation-toggle")[0]!.findAll((node) => node.props.icon?.svg)[0]!;
    expect(fullSearchIcon.props.size).toBe(18);
  });

  it.each(["android", "ios"])("%s preserves keepOpen, drill-down, Back and selection close", (os) => {
    mount(os, 1000);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    act(() => menuOption("Show the archived lane").props.onPress());
    expect(menuOption("Show the archived lane").props.accessibilityState.checked).toBe(true);
    expect(hostsById("tablet-view-overlay")).toHaveLength(1);
    act(() => menuOption("Lane width").props.onPress());
    expect(menuOption("Wide")).toBeDefined();
    act(() => menuOption("Back").props.onPress());
    expect(menuOption("Sort")).toBeDefined();
    act(() => menuOption("Sort").props.onPress());
    act(() => menuOption("Title").props.onPress());
    expect(menuOption("A→Z")).toBeDefined();
    expect(hostsById("tablet-view-overlay")).toHaveLength(1);
    act(() => menuOption("A→Z").props.onPress());
    expect(lastBoardParams("host-1").sort).toEqual({ key: "title", direction: "asc" });
    expect(hostsById("tablet-view-menu")).toHaveLength(0);
    expect(hostsById("tablet-view-overlay")).toHaveLength(0);
  });
});

describe("Tasks board, tablet filters", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
  });

  it.each(["web", "ios", "android"])("matches the panel direction across sizes and resize boundaries on %s", (os) => {
    finishSidebarCloseImmediately();
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    // Cross both hysteresis bands in both directions, including their exact edges.
    for (const [width, side] of [
      [320, "bottom"], [480, "bottom"], [600, "bottom"], [759, "bottom"],
      [760, "bottom"], [783, "bottom"], [784, "right"], [995, "right"],
      [996, "right"], [1019, "right"], [1020, "right"], [1440, "right"],
      [2560, "right"], [1020, "right"], [1019, "right"], [996, "right"],
      [995, "right"], [784, "right"], [783, "right"], [760, "right"],
      [759, "bottom"], [320, "bottom"],
    ] as const) {
      layOut(width);
      const sidebar = () => renderer!.root.findByType(os === "web" ? DesktopToolbar : TabletToolbar).props.sidebar;
      if (sidebar().open) act(() => sidebar().onToggle());
      for (const open of [false, true]) {
        if (open) act(() => sidebar().onToggle());
        expect(sidebar().open, `${width}: open`).toBe(open);
        expect(sidebar().sheet, `${width}: direction`).toBe(side === "bottom");
        if (hostsById("sidebar-switch").length) {
          expect(hostsById("sidebar-switch")[0]!.props.accessibilityState.selected, `${width}: selected`).toBe(open);
          expect(StyleSheet.flatten(hostsById("panel-mark")[0]!.props.style).flexDirection, `${width}: icon direction`).toBe(side === "bottom" ? "column" : "row");
          expect(StyleSheet.flatten(hostsById("panel-mark-fill")[0]!.props.style), `${width}: icon fill`).toMatchObject(side === "bottom"
            ? { width: 10, height: open ? 3 : 1.5 }
            : { width: open ? 3.5 : 1.5, height: 7 });
        } else {
          // The narrow desktop toolbar moves this action into More, without an icon.
          expect(os).toBe("web");
          expect(hostsById("panel-mark")).toHaveLength(0);
        }
        expect(hostsById("board-sheet"), `${width}: bottom panel`).toHaveLength(open && side === "bottom" ? 1 : 0);
        if (open && side === "right") expect(hostsById("sidebar-inline").length + hostsById("sidebar-floating").length, `${width}: right panel`).toBe(1);
      }
    }
  });

  it("aligns the filter menu with its button and keeps it inside the board", () => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(800);
    act(() => {
      hostsById("tablet-toolbar")[0]!.props.onLayout({ nativeEvent: { layout: { width: 800 } } });
      hostsById("tablet-toolbar-end")[0]!.props.onLayout({ nativeEvent: { layout: { x: 500, y: 0, width: 300, height: 44 } } });
      hostsById("tablet-filter-anchor")[0]!.props.onLayout({ nativeEvent: { layout: { x: 100, y: 0, width: 44, height: 44 } } });
      hostsById("toolbar-filters")[0]!.props.onPress();
    });
    expect(StyleSheet.flatten(hostsById("tablet-filter-popover")[0]!.props.style).right).toBe(156);
    act(() => hostsById("tablet-filter-anchor")[0]!.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 44, height: 44 } } }));
    expect(StyleSheet.flatten(hostsById("tablet-filter-popover")[0]!.props.style).right).toBeLessThanOrEqual(800 - 320 - 24);
  });

  it.each(["ios", "android"].flatMap((os) => ([[320, 240, 14], [320, 300, 14], [800, 600, 14], [800, 750, 14], [800, 800, 14], [800, 900, 14], [800, 1200, 14], [1200, 300, 14], [1200, 900, 21]] as const).map(([width, height, base]) => ({ os, width, height, base }))))("$os filters fit $width x $height at UI base $base", ({ os, width, height, base }) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(width);
    act(() => hostsById("tasks-board-area")[0]!.props.onLayout({ nativeEvent: { layout: { width, height } } }));
    const open = () => act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    open();
    const panel = hostsById("tablet-filter-popover")[0]!;
    const style = StyleSheet.flatten(panel.props.style);
    expect(style).toMatchObject({ position: "absolute", top: StyleSheet.flatten(hostsById("tablet-toolbar")[0]!.props.style).height as number + 6, right: 12 });
    expect(Number(style.width)).toBeLessThanOrEqual(width - 24);
    expect(style.width).toBe(Math.min(Math.round(320 * Math.max(1, base / 14)), width - 24));
    expect(style.height).toBe(Math.min(600, height * 0.8));
    const frames = measureHostTree(panel, { width });
    const panelFrame = frames.get(panel)!;
    const footerFrame = frames.get(hostsById("filter-sheet-footer")[0]!)!;
    expect(panelFrame.height).toBe(Math.min(600, height * 0.8));
    expect(footerFrame.top + footerFrame.height).toBeLessThanOrEqual(panelFrame.top + panelFrame.height);
    expect(frames.get(hostsById("filter-sheet-scroll")[0]!)!.height).toBeGreaterThan(0);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
    expect(panel.props.accessibilityViewIsModal).toBeUndefined();
    expect(hostsById("toolbar-filters")[0]!.props.accessibilityState.expanded).toBe(true);
    expect(panel.findAll((node) => (node.type as unknown) === "ScrollView")).toHaveLength(1);
    const footer = hostsById("filter-sheet-footer")[0]!;
    expect(hostParentOf(footer)).toBe(hostParentOf(hostsById("filter-sheet-scroll")[0]!));
    expect(hostsById("filter-sheet-subtasks")).toHaveLength(0);
    expect(hostsById("filter-sheet-empty-groups")).toHaveLength(0);
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
    open();
    open();
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
    open();
    act(() => hostsById("tablet-filter-close")[0]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
    open();
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
    open();
    if (!hostsById("tablet-search-toggle").length) layOut(800);
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
    open();
    act(() => hostsById("filter-sheet-footer")[0]!.findAll((node) => (node.type as unknown) === "Pressable")[1]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
  });

  it.each(["ios", "android"] as const)("%s resizes an open filter panel with the board", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(800);
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    act(() => hostsById("filter-sheet-workspaces-toggle")[0]!.props.onPress());
    for (const height of [400, 750, 1100, 300]) {
      act(() => hostsById("tasks-board-area")[0]!.props.onLayout({ nativeEvent: { layout: { width: 800, height } } }));
      expect(StyleSheet.flatten(hostsById("tablet-filter-popover")[0]!.props.style).height).toBe(Math.min(600, height * 0.8));
      expect(hostsById("filter-sheet-workspaces-toggle")[0]!.props.accessibilityState.expanded).toBe(true);
      expect(hostParentOf(hostsById("filter-sheet-footer")[0]!)).toBe(hostParentOf(hostsById("filter-sheet-scroll")[0]!));
    }
  });

  it.each([320, 800, 1200])("opens Android filters in the toolbar popover at %i pt", (width) => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(1);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
    expect(hostsById("filter-sheet-scroll")).toHaveLength(1);
    const panel = hostsById("tablet-filter-popover")[0]!;
    expect(Number(StyleSheet.flatten(panel.props.style).width)).toBeLessThanOrEqual(width - 24);
    expect(StyleSheet.flatten(panel.props.style).elevation).toBe(8);
    expect(hostsById("filter-sheet-subtasks")).toHaveLength(0);
    expect(hostsById("filter-sheet-empty-groups")).toHaveLength(0);
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-filter-popover")).toHaveLength(0);
  });

  it.each([["done", false], ["done", true], ["failed", false], ["rejected", false]] as const)("iPad pulls refresh and releases the indicator (%s, empty=%s)", async (outcome, empty) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    const handle = (data as unknown as { __handle: { refresh: ReturnType<typeof vi.fn> } }).__handle;
    let finish!: () => void;
    handle.refresh.mockImplementation(() => new Promise((resolve, reject) => {
      finish = () => outcome === "rejected" ? reject(new Error("offline")) : resolve(outcome);
    }));
    handle.refresh.mockClear();
    act(() => { renderer = TestRenderer.create(screen(false, empty ? { agent: "no-such-provider" } : {})); });
    layOut(1600);
    await act(async () => {});
    for (const id of ["needs_input", "done"]) {
      const list = () => hostsById(`lane-${id}`)[0]!.find((node) => (node.type as unknown) === "FlatList");
      expect(list().props.data.length === 0).toBe(empty);
      expect(list().props.alwaysBounceVertical).toBe(true);
      const requests = handle.refresh.mock.calls.length;
      const before = list().props.data;
      act(() => list().props.onRefresh());
      expect(list().props.refreshing).toBe(true);
      await act(async () => { await Promise.resolve(); });
      expect(handle.refresh).toHaveBeenCalledTimes(requests + 1);
      act(() => list().props.onRefresh());
      expect(handle.refresh).toHaveBeenCalledTimes(requests + 1);
      await act(async () => { finish(); });
      expect(list().props.refreshing).toBe(false);
      expect(list().props.data).toBe(before);
    }
    handle.refresh.mockReset();
  });

  it.each([
    ["ios", 480, "zh", 14], ["ios", 800, "en", 14], ["ios", 1200, "zh", 21],
    ["android", 600, "en", 21], ["android", 800, "zh", 14], ["android", 1200, "en", 14], ["android", 1200, "en", 21],
  ] as const)("%s at %i pt has one %s toolbar at UI base %i", (os, width, language, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(width);
    expect(hostsById("filter-bar")).toHaveLength(0);
    const bar = hostsById("tablet-toolbar")[0]!;
    expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ height: Math.round(40 * Math.max(1, base / 14)), flexDirection: "row", flexShrink: 0 });
    expect(StyleSheet.flatten(hostsById("tablet-toolbar-end")[0]!.props.style).gap).toBe(0);
    const buttons = bar.findAll((n) => (n.type as unknown) === "Pressable" && n.props.testID !== "search-full-conversation-toggle");
    for (const button of buttons) {
      const style = StyleSheet.flatten(button.props.style);
      expect(style.height).toBe(Math.round(32 * Math.max(1, base / 14)));
      expect(style.minWidth).toBe(Math.round(32 * Math.max(1, base / 14)));
      expect(style.borderRadius).toBe(7);
      const icon = button.find((node) => button.props.testID === "sidebar-switch" ? typeof node.type === "string" && node.props.testID === "panel-mark" : (node.type as unknown) === "Icon");
      expect(StyleSheet.flatten(hostParentOf(icon)!.props.style)).toMatchObject({ width: 18, height: 18 });
    }
    const filters = hostsById("toolbar-filters")[0]!;
    const view = hostsById("tablet-view")[0]!;
    expect(textOf(filters).includes(BOARD_STRINGS[language].filters)).toBe(false);
    expect(textOf(view).includes(BOARD_STRINGS[language].view)).toBe(false);
    act(() => view.props.onPress());
    expect(hostsById("tablet-view-menu")).toHaveLength(1);
    // Visibility switches share the View menu.
    const items = hostsById("tablet-view-menu")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem").map(textOf);
    expect(items.some((text) => text.startsWith(BOARD_STRINGS[language].emptyGroups.row))).toBe(true);
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById("tablet-view-menu")).toHaveLength(0);
  });

  it.each([
    ["ios", 320, 14], ["ios", 480, 14], ["android", 480, 14], ["android", 600, 21],
  ] as const)("%s at %i pt/UI%i keeps filtering and view at the right, and the board's switches in View", async (os, width, base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(width);
    const end = () => hostsById("tablet-toolbar-end")[0]!;
    const order = () => end().findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID);
    const expected = ["subtasks-toggle", "toolbar-filters", "tablet-view", "sidebar-switch"];
    expect(order()).toEqual(expected);
    // View owns layout and visibility switches.
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    const strings = BOARD_STRINGS.en;
    const items = hostsById("tablet-view-menu")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem").map(textOf);
    expect(items.some((text) => text.startsWith(strings.showSubtasks))).toBe(true);
    expect(items.some((text) => text.startsWith(strings.emptyGroups.row))).toBe(true);
    expect(items.some((text) => text.startsWith(strings.archivedLane.row))).toBe(true);
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(order()).toEqual(expected);
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    // Search relayout must retain every action, including the filter button.
    act(() => end().props.onLayout({ nativeEvent: { layout: { x: 160, y: 6, width: StyleSheet.flatten(end().props.style).minWidth, height: 32 } } }));
    expect(order()).toEqual(expected);
    const field = hostsById("tablet-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput" && [BOARD_STRINGS.en.search, BOARD_STRINGS.zh.search].includes(node.props.accessibilityLabel));
    act(() => field.props.onChangeText("needle"));
    expect(order()).toEqual(expected);
    expect(hostsById("tablet-search-toggle")).toHaveLength(1);
    expect(order()).toEqual(expected);
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    expect(hostsById("filter-sheet-scroll")).toHaveLength(1);
  });

  it.each(["en", "zh"] as const)("reserves a complete centred count across count changes in %s", (language) => {
    updateEnhancerPreferences({ language });
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1000);
    const props = renderer!.root.findByType(TabletToolbar).props as React.ComponentProps<typeof TabletToolbar>;
    let slotStyle: unknown;
    let searchStyle: unknown;
    for (const total of [0, 9, 10, 70, 99, 100, 999, 9]) {
      act(() => renderer!.update(React.createElement(TabletToolbar, { ...props, board: { ...props.board, total } })));
      const reserve = hostsById("tablet-total-reserve")[0]!;
      expect(textOf(reserve)).toBe(BOARD_STRINGS[language].total(888));
      expect(StyleSheet.flatten(reserve.props.style)).toMatchObject({ fontVariant: ["tabular-nums"], opacity: 0 });
      expect(hostsById("tablet-toolbar-total")[0]!.props.accessibilityLabel).toBe(BOARD_STRINGS[language].total(total));
      const slot = StyleSheet.flatten(hostsById("tablet-total-slot")[0]!.props.style);
      const search = StyleSheet.flatten((hostsById("tablet-search-toggle")[0] ?? hostsById("tablet-toolbar-search")[0])!.props.style);
      slotStyle ??= slot; searchStyle ??= search;
      expect(slot).toEqual(slotStyle); expect(search).toEqual(searchStyle);
      // Only the invisible ruler participates in the slot's intrinsic width.
      expect(StyleSheet.flatten(hostParentOf(reserve)!.props.style).flexShrink).toBe(0);
    }
    act(() => renderer!.update(React.createElement(TabletToolbar, { ...props, board: { ...props.board, total: 1000 } })));
    expect(textOf(hostsById("tablet-total-reserve")[0]!)).toBe(BOARD_STRINGS[language].total(8888));
  });

  it.each(["ios", "android"])("%s keeps the sidebar switch in the toolbar and out of View", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(1200);
    const button = () => hostsById("sidebar-switch")[0]!;
    expect(hostsById("tablet-toolbar-end")[0]!.findAll((node) => typeof node.type === "string" && StyleSheet.flatten(node.props.style)?.marginHorizontal === 2)).toHaveLength(0);
    const fill = (node: ReactTestInstance) => StyleSheet.flatten(node.find((child) => typeof child.type === "string" && child.props.testID === "panel-mark-fill").props.style).width;
    for (let i = 0; i < 3; i++) {
      const open = button().props.accessibilityState.selected;
      expect(StyleSheet.flatten(button().props.style).backgroundColor).toBe("transparent");
      expect(fill(button())).toBe(open ? 3.5 : 1.5);
      act(() => hostsById("tablet-view")[0]!.props.onPress());
      const strings = renderer!.root.findByType(TabletToolbar).props.board.strings;
      const items = hostsById("tablet-view-menu")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
      expect(items.some((item) => textOf(item).startsWith(open ? strings.sidebar.hide : strings.sidebar.show))).toBe(false);
      act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
      await act(async () => button().props.onPress());
      expect(button().props.accessibilityState.selected).toBe(!open);
      expect(StyleSheet.flatten(button().props.style).backgroundColor).toBe("transparent");
      expect(fill(button())).toBe(open ? 1.5 : 3.5);
      await act(async () => button().props.onPress());
      expect(fill(button())).toBe(open ? 3.5 : 1.5);
    }
  });

  it.each(["ios", "android"])("%s retains filtering, reset, device settings and subtask visibility", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(1200);
    expect(hostsById("tablet-toolbar-end")[0]!.findAll((n) => (n.type as unknown) === "Pressable").map((n) => n.props.testID)).toEqual(["subtasks-toggle", "toolbar-filters", "tablet-view", "sidebar-switch"]);
    expect(hostsById("subtasks-toggle")[0]!.props.accessibilityState.selected).toBe(true);
    expect(StyleSheet.flatten(hostsById("subtasks-toggle")[0]!.props.style).backgroundColor).toBe("transparent");
    expect(hostsById("subtasks-toggle")[0]!.find((n) => (n.type as unknown) === "Icon").props.color).toBe("#1b1b1f");
    await act(async () => hostsById("subtasks-toggle")[0]!.props.onPress());
    expect(deviceTasksStore().snapshot().values).toMatchObject({ hideSubtasks: true });
    expect(hostsById("subtasks-toggle")[0]!.props.accessibilityState.selected).toBe(false);
    expect(StyleSheet.flatten(hostsById("subtasks-toggle")[0]!.props.style).backgroundColor).toBe("transparent");
    expect(hostsById("subtasks-toggle")[0]!.find((n) => (n.type as unknown) === "Icon").props.color).toBe("#6b6b75");
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    const sheet = hostsById("filter-sheet-scroll")[0]!;
    act(() => hostsById("filter-sheet-workspaces-toggle")[0]!.props.onPress());
    const pick = (value: string) => sheet.find((n) => (n.type as unknown) === "Pressable" && n.props.accessibilityRole === "checkbox" && textOf(n).startsWith(value));
    act(() => pick("Codex").props.onPress());
    act(() => pick("frontend").props.onPress());
    act(() => pick("tasks-board").props.onPress());
    expect(lastBoardParams("host-1")).toMatchObject({ providers: ["codex"], labels: ["frontend"], workspaceIds: ["wks_sample"] });
    // Agent, label and workspace; the subtask switch is not a filter.
    expect(textOf(hostsById("tablet-filter-count")[0]!)).toBe("3");
    expect(hostsById("filter-sheet-subtasks")).toHaveLength(0);
    expect(hostsById("filter-sheet-archived")).toHaveLength(0);
    expect(host.save).not.toHaveBeenCalled();
    act(() => hostsById("filter-sheet-reset")[0]!.props.onPress());
    expect(lastBoardParams("host-1")).toMatchObject({ providers: [], labels: [], workspaceIds: [] });
  });

  it.each(["ios", "android"])("%s moves filter switches into View and retains their saved state", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const handle = (data as unknown as { __handle: { providers: object[] } }).__handle;
    const saved = handle.providers;
    handle.providers = [...saved, { id: "pi", label: "Pi" }];
    try {
      await act(async () => { renderer = TestRenderer.create(screen(false)); });
      layOut(800);
      act(() => hostsById("toolbar-filters")[0]!.props.onPress());
      expect(hostsById("filter-sheet-subtasks")).toHaveLength(0);
      expect(hostsById("filter-sheet-empty-groups")).toHaveLength(0);
      expect(textOf(hostsById("filter-sheet-scroll")[0]!)).toContain("Pi");
      act(() => hostsById("tablet-view")[0]!.props.onPress());
      const rows = () => hostsById("tablet-view-menu")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
      expect(rows().slice(-4).map(textOf)).toEqual(["Show subtasks", "Show all", "Collapse empty lanes", "Show the archived lane"]);
      for (const label of ["Show subtasks", "Show all"]) {
        expect(menuOption(label).props.accessibilityState.checked).toBe(true);
        await act(async () => menuOption(label).props.onPress());
        expect(menuOption(label).props.accessibilityState.checked).toBe(false);
        expect(hostsById("tablet-view-menu")).toHaveLength(1);
      }
      expect(hostsById("subtasks-toggle")[0]!.props.accessibilityState.selected).toBe(false);
      expect(deviceTasksStore().snapshot().values).toMatchObject({ hideSubtasks: true, showEmptyGroups: false });
      expect(host.save).not.toHaveBeenCalled();
      act(() => hostsById("toolbar-filters")[0]!.props.onPress());
      expect(textOf(hostsById("filter-sheet-scroll")[0]!)).not.toContain("Pi");
      act(() => hostsById("tablet-view")[0]!.props.onPress());
      expect(menuOption("Show subtasks").props.accessibilityState.checked).toBe(false);
      expect(menuOption("Show all").props.accessibilityState.checked).toBe(false);
      for (const label of ["Show subtasks", "Show all"]) {
        await act(async () => menuOption(label).props.onPress());
        expect(menuOption(label).props.accessibilityState.checked).toBe(true);
      }
      expect(deviceTasksStore().snapshot().values).toMatchObject({ hideSubtasks: false, showEmptyGroups: true });
    } finally {
      handle.providers = saved;
    }
  });

  it("opens sort and lane width from View and time range from filters", async () => {
    await act(async () => { renderer = TestRenderer.create(screen(false)); });
    layOut(1000);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    act(() => menuOption("Sort").props.onPress());
    act(() => menuOption("Title").props.onPress());
    act(() => menuOption("A→Z").props.onPress());
    expect(lastBoardParams("host-1").sort).toEqual({ key: "title", direction: "asc" });
    expect(hostsById("tablet-view-menu")).toHaveLength(0);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    act(() => menuOption("Lane width").props.onPress());
    await act(async () => menuOption("Wide").props.onPress());
    expect(deviceTasksStore().snapshot().values).toMatchObject({ laneWidth: "wide" });
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    act(() => renderer!.root.findAllByType(WindowSegments)[0]!.props.onChange("7d"));
    expect(lastBoardParams("host-1").doneWindow).toBe("7d");
  });

  it.each([
    ["ios", 14, 40], ["android", 14, 40],
    ["ios", 15, 43], ["android", 15, 43],
    ["ios", 21, 60], ["android", 21, 60],
  ] as const)("%s at UI%i uses a %i-point tablet toolbar", (os, base, height) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } })); });
    layOut(1000);
    expect(StyleSheet.flatten(hostsById("tablet-toolbar")[0]!.props.style).height).toBe(height);
    if (hostsById("tablet-search-toggle").length) act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(StyleSheet.flatten(hostsById("tablet-toolbar-search")[0]!.props.style).height).toBe(height - 8);
    const input = hostsById("tablet-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput");
    expect(StyleSheet.flatten(input.props.style).fontSize).toBe(Math.round(12 * base / 14));
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    expect(StyleSheet.flatten(hostsById("tablet-filter-popover")[0]!.props.style).top).toBe(height + 6);
  });

  it.each([
    ["ios", "tablet-view", "tablet-view-menu"],
    ["android", "tablet-view", "tablet-view-menu"],
    ["ios", "toolbar-filters", "tablet-filter-popover"],
    ["android", "toolbar-filters", "tablet-filter-popover"],
  ] as const)("%s covers the toolbar while %s is open and dismisses without activating its controls", (os, trigger, panel) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(1000);
    act(() => hostsById(trigger)[0]!.props.onPress());
    expect(hostsById(panel)).toHaveLength(1);
    const backdrop = hostsById("tablet-toolbar-backdrop")[0]!;
    const toolbar = hostsById("tablet-toolbar")[0]!;
    expect(hostParentOf(backdrop)).toBe(hostParentOf(toolbar));
    const backdropStyle = StyleSheet.flatten(backdrop.props.style);
    expect(backdropStyle).toMatchObject({ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 });
    expect(backdropStyle.zIndex).toBeGreaterThan(StyleSheet.flatten(toolbar.props.style).zIndex);
    expect(backdropStyle.zIndex).toBeLessThan(StyleSheet.flatten(hostsById(panel)[0]!.props.style).zIndex);
    const sidebar = hostsById("sidebar-switch")[0]!.props.accessibilityState.selected;
    const subtasks = hostsById("subtasks-toggle")[0]!.props.accessibilityState.selected;
    for (const id of ["tablet-toolbar", "tablet-toolbar-end"]) {
      expect(hostsById(id)[0]!.props.pointerEvents).toBe("box-none");
    }
    expect(hostsById("tablet-toolbar-total")[0]!.props.pointerEvents).toBe("none");
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    expect(hostsById(panel)).toHaveLength(0);
    expect(hostsById("tablet-toolbar-backdrop")).toHaveLength(0);
    expect(hostsById("sidebar-switch")[0]!.props.accessibilityState.selected).toBe(sidebar);
    expect(hostsById("subtasks-toggle")[0]!.props.accessibilityState.selected).toBe(subtasks);
    act(() => hostsById(trigger)[0]!.props.onPress());
    expect(hostsById(panel)).toHaveLength(1);
  });

  it.each([320, 480, 600])("at %i pt opens search below the toolbar", (width) => {
    act(() => { renderer = TestRenderer.create(screen(false)); });
    layOut(width);
    const height = StyleSheet.flatten(hostsById("tablet-toolbar")[0]!.props.style).height;
    if (!hostsById("tablet-search-toggle").length) return;
    act(() => hostsById("tablet-search-toggle")[0]!.props.onPress());
    expect(hostsById("tablet-search-popover")).toHaveLength(0);
    expect(hostParentOf(hostsById("tablet-toolbar-search")[0]!)?.props.testID).toBe("tablet-toolbar-search-group");
    expect(StyleSheet.flatten(hostsById("tablet-toolbar")[0]!.props.style).height).toBe(height);
    const field = renderer!.root.find((n) => (n.type as unknown) === "TextInput");
    act(() => field.props.onChangeText("ping"));
    expect(lastBoardParams("host-1").query).toBe("ping");
    expect(hostsById("tablet-toolbar-backdrop")).toHaveLength(0);
    expect(hostsById("tablet-toolbar-search")).toHaveLength(1);
    expect(hostsById("tablet-search-popover")).toHaveLength(0);
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
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(0);
    expect(hostsById("filter-sheet-sort")).toHaveLength(0);
    expect(hostsById("filter-sheet-range-toggle")).toHaveLength(1);
    // Native tablets retain the single row when widened.
    layOut(1600);
    expect(hostsById("filter-bar-end")).toHaveLength(0);
    expect(hostsById("toolbar-filters")).toHaveLength(1);
  });

  it.each([14, 21])("balances 24h and 7d with infinity at UI base %i while retaining their targets and labels", async (base) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    await act(async () => {
      renderer = TestRenderer.create(screen(false, {}, { ...(theme as object), typography: { fontSize: { ui: base } } }));
    });
    layOut(2400);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    const radios = () => end.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "radio");
    expect(radios().map((node) => node.props.accessibilityLabel)).toEqual(["24h", "7 days", "All"]);
    // Each its count and a smaller unit, infinity for all; the words are left to the label.
    expect(radios().map((node) => node.findAll((child) => child.props.testID === "window-mark").length > 0)).toEqual([true, true, true]);
    expect(radios().map(textOf)).toEqual(["24h", "7d", "\u221e"]);
    const marks = radios().map((radio) => radio.find((node) => (node.type as unknown) === "Text" && node.props.testID === "window-mark"));
    expect(marks.map((mark) => StyleSheet.flatten(mark.props.style).fontSize)).toEqual([11, 11, 17].map((size) => Math.round(size * base / 14)));
    for (const mark of marks.slice(0, 2)) {
      const unit = mark.find((node) => (node.type as unknown) === "Text" && node !== mark);
      expect(StyleSheet.flatten(unit.props.style).fontSize).toBe(Math.round(9 * base / 14));
      expect(StyleSheet.flatten(mark.props.style).fontWeight).toBe("500");
    }
    expect(radios().map((radio) => StyleSheet.flatten(radio.props.style).height)).toEqual(Array(3).fill(Math.round(28 * Math.max(1, base / 14)) - 6));
    // Each its own name as its hover tip, inside the control's.
    expect(radios().map((node) => node.props.dataSet?.bctip)).toEqual(["24h", "7 days", "All"]);
    await act(async () => radios()[2]!.props.onPress());
    expect(radios().map((node) => node.props.accessibilityState.selected)).toEqual([false, false, true]);
    expect(lastBoardParams("host-1").doneWindow).toBe("all");
  });

  it.each(["Agent", "project", "workspace"])("lists the sidebar's groups with no active task until the %s menu's switch hides them, and saves it", async (menu) => {
    const handle = (data as unknown as { __handle: { providers: object[] } }).__handle;
    const saved = handle.providers;
    handle.providers = [...saved, { id: "pi", label: "Pi" }];
    try {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
      act(() => {
        renderer = TestRenderer.create(screen(false));
      });
      layOut(2400);
      // Not among the filter bar's switches: at the foot of the menus whose groups it trims, and in the top row.
      expect(hostsById("filter-bar-end")[0]!.findAll((node) => node.props.testID === "empty-groups-toggle")).toHaveLength(0);
      act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.dataSet?.bctip === `Filter by ${menu}`).props.onPress());
      const rowsOf = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem");
      const toggle = () => rowsOf().find((node) => textOf(node).startsWith("Show all"))!;
      const icon = () => toggle().findAll((node) => (node.type as unknown) === "Icon")[0]!.props.name;
      const groups = () => renderer!.root.findByProps({ testID: "sidebar-groups" });
      const rows = () => groups().findAll((node) => node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function").map((node) => node.props.accessibilityLabel);
      expect(rowsOf().at(-1)).toBe(toggle());
      expect(toggle().props.accessibilityState).toMatchObject({ checked: true });
      expect(icon()).toBe("Layers");
      // Busy first, the empty ones after them.
      expect(rows().at(-1)).toBe("Pi 0");
      await act(async () => toggle().props.onPress());
      expect(host.save).not.toHaveBeenCalled();
      expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: false });
      // The menu stays open on its new state.
      expect(toggle().props.accessibilityState).toMatchObject({ checked: false });
      expect(icon()).toBe("ListFilter");
      expect(rows()).not.toContain("Pi 0");
      expect(rows().length).toBeGreaterThan(0);
    } finally {
      handle.providers = saved;
    }
  });

  it.each(["en", "zh"] as const)("uses %s actions and icons without checks for empty groups in More", async (language) => {
    updateEnhancerPreferences({ language });
    const strings = BOARD_STRINGS[language];
    const handle = (data as unknown as { __handle: { providers: object[] } }).__handle;
    const saved = handle.providers;
    handle.providers = [...saved, { id: "pi", label: "Pi" }];
    try {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
      act(() => {
        renderer = TestRenderer.create(screen(false));
      });
      layOut(2400);
      const rows = () => renderer!.root.findByProps({ testID: "sidebar-groups" }).findAll((node) => node.props.accessibilityRole === "checkbox" && typeof node.props.onPress === "function").map((node) => node.props.accessibilityLabel);
      act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
      expect(menuOption(strings.emptyGroups.hide).props.accessibilityState.checked).toBeUndefined();
      expect(menuOption(strings.emptyGroups.hide).findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.name)).toEqual(["EyeOff"]);
      expect(textOf(menuOption(strings.emptyGroups.hide))).toContain("G");
      expect(rows().at(-1)).toBe("Pi 0");
      await act(async () => menuOption(strings.emptyGroups.hide).props.onPress());
      expect(host.save).not.toHaveBeenCalled();
      expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: false });
      act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
      expect(menuOption(strings.emptyGroups.show).props.accessibilityState.checked).toBeUndefined();
      expect(menuOption(strings.emptyGroups.show).findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.name)).toEqual(["Eye"]);
      expect(textOf(menuOption(strings.emptyGroups.show))).toContain("G");
      expect(rows()).not.toContain("Pi 0");
      await act(async () => menuOption(strings.emptyGroups.show).props.onPress());
      expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: true });
      expect(rows().at(-1)).toBe("Pi 0");
    } finally {
      handle.providers = saved;
    }
  });

  it.each([["web", 600]] as const)("%s at %i pt keeps empty groups in the filter sheet and saves the switch", async (os, width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(width);
    const buttons = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && /^toolbar-/.test(node.props.testID ?? ""));
    expect(buttons.map((node) => node.props.testID)).toEqual(os === "web" ? ["toolbar-archived", "toolbar-filters"] : ["toolbar-filters"]);
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
    // Native keeps the open panel and its value while resizing; a wide web board has it in its top row and filter menus.
    layOut(1600);
    if (os === "web") {
      act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
      expect(menuOption("Show empty groups").props.accessibilityState.checked).toBeUndefined();
      act(() => hostsById("desktop-toolbar-more")[0]!.props.onPress());
      act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.dataSet?.bctip === "Filter by project").props.onPress());
      const row = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && textOf(node).startsWith("Show all"));
      expect(row[0]!.props.accessibilityState).toMatchObject({ checked: false });
    }
  });

  it("web at 600 pt keeps the archived lane's icon button in the folded header", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(600);
    const archived = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "toolbar-archived");
    // The folded web header keeps the filter bar's order: empty lanes, then the archived lane, then the filters.
    const header = renderer!.root.findByType(DesktopToolbar).findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID !== "sidebar-switch");
    expect(header.map((node) => node.props.testID)).toEqual(["desktop-search-toggle", "empty-lanes-toggle", "toolbar-archived", "toolbar-filters", "desktop-toolbar-more"]);
    expect(textOf(archived())).toBe("");
    expect(archived().find((node) => (node.type as unknown) === "Icon").props.name).toBe("Archive");
    expect(hostsById("archived-lane-toggle")).toHaveLength(0);
    // Folded archive and filter controls keep their compact size.
    const size = (testID: string) => StyleSheet.flatten(renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === testID).props.style).width;
    expect(size("toolbar-archived")).toBe(size("toolbar-filters"));
    if (hostsById("sidebar-switch").length) expect(size("sidebar-switch")).toBeGreaterThan(size("toolbar-filters"));
    expect(archived().props).toMatchObject({ accessibilityLabel: "Show the archived lane", accessibilityState: { selected: false } });
    // Struck through while off.
    const slashed = () => archived().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    expect(slashed()).toBe(true);
    expect(hostsById("lane-archived")).toHaveLength(0);
    await act(async () => archived().props.onPress());
    layOut(600);
    expect(archived().props.accessibilityState).toEqual({ selected: true });
    expect(slashed()).toBe(false);
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true });
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(1);
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-sheet-archived")).toHaveLength(0);
    // The state survives a resize: a wide web board moves the switch to the filter bar.
    layOut(1600);
    expect(hostsById("toolbar-archived")).toHaveLength(0);
    expect(hostsById("archived-lane-toggle")[0]!.props.accessibilityState).toEqual({ checked: true });
  });

  it.each([["ios", 600], ["ios", 800], ["ios", 1200], ["android", 1200]] as const)("%s at %i pt keeps the archived lane in View and the filter panel, not the toolbar", async (os, width) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(width);
    const end = hostsById("tablet-toolbar-end")[0]!.findAll((node) => (node.type as unknown) === "Pressable").map((node) => node.props.testID);
    expect(end).toEqual(["subtasks-toggle", "toolbar-filters", "tablet-view", "sidebar-switch"]);
    expect(hostsById("toolbar-archived")).toHaveLength(0);
    act(() => hostsById("tablet-view")[0]!.props.onPress());
    const item = () => hostsById("tablet-view-menu")[0]!.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem" && textOf(node).startsWith("Show the archived lane"));
    expect(hostsById("lane-archived")).toHaveLength(0);
    await act(async () => item().props.onPress());
    layOut(width);
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true });
    act(() => hostsById("tablet-toolbar-backdrop")[0]!.props.onPress());
    act(() => hostsById("toolbar-filters")[0]!.props.onPress());
    expect(hostsById("filter-sheet-archived")).toHaveLength(0);
  });

  it("web switches between hierarchy and tree list icons for subtask visibility", () => {
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
    // Search has its own switch; board visibility switches stay left of the lane width.
    const barSwitches = new Set(["search-full-conversation-toggle", "archived-lane-toggle", "subtasks-toggle", "empty-groups-toggle"]);
    const switches = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "switch");
    expect(switches.filter((node) => !barSwitches.has(node.props.testID))).toHaveLength(0);
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    expect(end.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "subtasks-toggle")).toHaveLength(1);
    expect(toggle().props).toMatchObject({ accessibilityLabel: "Show subtasks", accessibilityState: { checked: true } });
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.name).toBe("Network");
    expect(slashed()).toBe(false);
    expect(look().backgroundColor).toBe("#ffffff");
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.color).toBe("#1b1b1f");
    act(() => toggle().props.onPress());
    expect(lastBoardParams("host-1")).toMatchObject({ hideSubtasks: null });
    expect(deviceTasksStore().snapshot().values?.hideSubtasks).toBe(true);
    expect(toggle().props.accessibilityState).toEqual({ checked: false });
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.name).toBe("ListTree");
    expect(slashed()).toBe(false);
    expect(look().backgroundColor).toBe("#ffffff");
    expect(toggle().find((node) => (node.type as unknown) === "Icon").props.color).toBe("#6b6b75");
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

  it.each(["ios", "android"])("asks for rendered cards' icons on %s when the field is on", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(requestProjectIcon()).toHaveBeenCalledWith("prj_sample");
    expect(hostsById("project-icon-generated").length).toBeGreaterThan(0);
  });

  it.each([false, true])("never asks with the icon field off (compact=%s)", (compact) => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, projectIcon: false } };
    (globalThis as { __rnMockOS?: string }).__rnMockOS = compact ? "ios" : "web";
    act(() => {
      renderer = TestRenderer.create(screen(compact));
    });
    if (!compact) layOut(1600);
    expect(requestProjectIcon()).not.toHaveBeenCalled();
  });

  it("keeps project icons off with minimal mobile cards", () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(requestProjectIcon()).not.toHaveBeenCalled();
    expect(hostsById("project-icon-generated")).toHaveLength(0);
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
  it("puts settings to the right of reset and opens it", () => {
    const openSettings = vi.fn();
    setTasksSettingsOpener(openSettings);
    act(() => { renderer = TestRenderer.create(screen(true)); });
    act(() => pressable("More").props.onPress());
    const button = hostsById("filter-sheet-settings")[0]!;
    const footer = hostsById("filter-sheet-footer")[0]!;
    const controls = footer.findAll((node) => (node.type as unknown) === "Pressable");
    expect(controls.map((node) => node.props.testID)).toEqual(["filter-sheet-reset", undefined, "filter-sheet-settings"]);
    act(() => button.props.onPress());
    expect(openSettings).toHaveBeenCalledOnce();
    expect(hostsById("filter-sheet-scroll")).toHaveLength(0);
  });
  it.each(["ios", "android", "web"])("%s keeps lane rows still while opening and closing sheets", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    const before = host.rowRenders;
    const card = cards()[0]!.props.card;
    const close = async () => {
      const modal = renderer!.root.findAllByType(Modal).find((node) => node.props.open)!;
      await act(async () => modal.props.onOpenChange(false));
      expect(renderer!.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
      expect(host.rowRenders).toBe(before);
    };
    for (let round = 0; round < 2; round++) {
      await act(async () => cards()[0]!.props.onSelect(card));
      expect(renderer!.root.findByType(TaskDetailCards).props.card.id).toBe(card.id);
      expect(host.rowRenders).toBe(before);
      await close();
      await act(async () => pressable("More").props.onPress());
      expect(hostsById("filter-sheet-scroll")).toHaveLength(1);
      expect(host.rowRenders).toBe(before);
      await close();
    }
  });

  it.each(["ios", "android", "web"])("%s still updates lane rows and open details when task data changes", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: Array<{ id: string; title: string }> }>; byId: Map<string, unknown> } }).__handle;
    const saved = { lanes: handle.lanes, byId: handle.byId };
    try {
      await act(async () => { renderer = TestRenderer.create(screen(true)); });
      const card = cards()[0]!.props.card;
      await act(async () => cards()[0]!.props.onSelect(card));
      const before = host.rowRenders;
      const updated = { ...card, title: "Updated while details are open" };
      handle.lanes = { ...saved.lanes, needs_input: { ...saved.lanes.needs_input!, cards: [updated] } };
      handle.byId = new Map(saved.byId).set(card.id, updated);
      await act(async () => renderer!.update(screen(true)));
      expect(host.rowRenders).toBeGreaterThan(before);
      expect(cards().find((node) => node.props.card.id === card.id)!.props.card.title).toBe(updated.title);
      expect(renderer!.root.findByType(TaskDetailCards).props.card.title).toBe(updated.title);
      await act(async () => pressable("Running 2").props.onPress());
      expect(pressable("Running 2").props.accessibilityState).toEqual({ selected: true });
      expect(cards().some((node) => node.props.card.lane === "running")).toBe(true);
    } finally {
      handle.lanes = saved.lanes;
      handle.byId = saved.byId;
    }
  });

  it.each(["ios", "android", "web"])("%s shows subtasks on the toolbar and remembers the preference", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    const button = () => hostsById("phone-subtasks")[0]!;
    const controls = hostParentOf(button())!.findAll((node) => (node.type as unknown) === "Pressable");
    expect(controls.slice(-3).map((node) => node.props.testID)).toEqual(["phone-subtasks", "phone-archived", "phone-more"]);
    expect(button().props.accessibilityState).toEqual({ selected: true });
    expect(button().findAll((node) => (node.type as unknown) === "View" && StyleSheet.flatten(node.props.style)?.backgroundColor === "#e4e4e7")).toHaveLength(0);
    expect(button().find((node) => (node.type as unknown) === "Icon").props.color).toBe("#1b1b1f");
    await act(async () => button().props.onPress());
    expect(button().props.accessibilityState).toEqual({ selected: false });
    expect(button().find((node) => (node.type as unknown) === "Icon").props.color).toBe("#6b6b75");
    expect(button().findAll((node) => (node.type as unknown) === "View" && StyleSheet.flatten(node.props.style)?.backgroundColor === "#e4e4e7")).toHaveLength(0);
    expect(deviceTasksStore().snapshot().values?.hideSubtasks).toBe(true);
    expect(lastBoardParams("host-1").hideSubtasks).toBeNull();
    act(() => pressable("More").props.onPress());
    expect(hostsById("filter-sheet-subtasks")).toHaveLength(0);
    act(() => renderer!.unmount());
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    expect(button().props.accessibilityState).toEqual({ selected: false });
    await act(async () => button().props.onPress());
    expect(deviceTasksStore().snapshot().values?.hideSubtasks).toBe(false);
    expect(host.save).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"])("%s updates the adjacent lane after the subtasks switch", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    expect(laneCards("running")).toContain("sample-child-1");
    await act(async () => hostsById("phone-subtasks")[0]!.props.onPress());
    expect(laneCards("running")).not.toContain("sample-child-1");
    expect(laneCards("running")).toContain("sample-running");
    await act(async () => hostsById("phone-subtasks")[0]!.props.onPress());
    expect(laneCards("running")).toContain("sample-child-1");
  });

  it.each([false, true])("pulses a landed card in neutral grey with the lane flash rhythm (dark=%s)", (dark) => {
    act(() => { renderer = TestRenderer.create(screen(true)); });
    const cell = renderer!.root.findAllByType(CardCell)[0]!;
    const props = cell.props as React.ComponentProps<typeof CardCell>;
    const theme = { ...props.theme, colors: { ...props.theme.colors, surface0: dark ? "#121212" : "#ffffff", accent: "#e11d48" } };
    const store = createLaneMotionStore(true);
    const attach = vi.spyOn(store, "attach");
    const timing = vi.spyOn(Animated, "timing");
    let landed: TestRenderer.ReactTestRenderer | undefined;
    let copy: TestRenderer.ReactTestRenderer | undefined;
    try {
      act(() => {
        landed = TestRenderer.create(React.createElement(LaneMotionProvider, { value: store }, React.createElement(CardCell, { ...props, theme, fresh: false })));
      });
      const onArrive = attach.mock.calls[0]![3]!;
      timing.mockClear();
      act(() => onArrive());
      const overlay = landed!.root.find((node) => typeof node.type === "string" && node.props.testID === `card-flash-${props.card.id}`);
      expect(overlay.props.pointerEvents).toBe("none");
      expect(overlay.props.style).toMatchObject({ backgroundColor: dark ? "#ffffff" : "#000000", borderRadius: 8 });
      const flash = timing.mock.calls.filter(([value]) => value === overlay.props.style.opacity);
      expect(flash.map(([, config]) => [config.toValue, config.duration])).toEqual([[0.07, 600], [0, 800], [0.07, 600], [0, 800]]);
      timing.mockClear();
      act(() => onArrive());
      expect(timing.mock.calls.filter(([value]) => value === overlay.props.style.opacity)).toHaveLength(4);
      attach.mockClear();
      act(() => {
        copy = TestRenderer.create(React.createElement(LaneMotionProvider, { value: store }, React.createElement(CardCell, { ...props, theme, copy: true, fresh: false })));
      });
      expect(attach).not.toHaveBeenCalled();
    } finally {
      act(() => { landed?.unmount(); copy?.unmount(); });
      attach.mockRestore();
      timing.mockRestore();
    }
  });

  it.each([true, false])("keeps expanded subtasks through refresh, animation copies and lane remounts (compact=%s)", (compact) => {
    if (!compact) (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: import("../../client/tasks/model").TaskCard[] }> } }).__handle;
    const original = handle.lanes;
    let copy: ReturnType<typeof TestRenderer.create> | undefined;
    const timing = vi.spyOn(Animated, "timing");
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
      // The shared native mock never completes animations; drive this exit with the fake clock.
      if (compact) timing.mockImplementationOnce((_value, config) => {
        let timer: ReturnType<typeof setTimeout>;
        return {
          start: (done) => { timer = setTimeout(() => done?.({ finished: true }), config.duration); },
          stop: () => clearTimeout(timer),
          reset: () => clearTimeout(timer),
        };
      });
      act(() => toggle().props.onPress());
      refresh();
      const panel = card().find((node) => typeof node.type === "string" && node.props.testID === "task-card-subtasks-panel");
      expect(panel.props.pointerEvents).toBe("none");
      expect(card().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-subtasks")).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(140); });
      expect(card().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-subtasks")).toHaveLength(0);
    } finally {
      timing.mockRestore();
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

  it.each(["ios", "android", "web"])("%s scrolls only when the selected tab is pressed again", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const scrollToOffset = vi.fn();
    act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset } : null }); });
    act(() => pressable("Running 2").props.onPress());
    expect(scrollToOffset).not.toHaveBeenCalled();
    act(() => pressable("Running 2").props.onPress());
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 0, animated: true });
    scrollToOffset.mockClear();
    act(() => hostsById("phone-stat-needs_input")[0]!.props.onPress());
    expect(scrollToOffset).not.toHaveBeenCalled();
    act(() => hostsById("phone-stat-needs_input")[0]!.props.onPress());
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 0, animated: true });
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

  it.each(["ios", "android", "web"])("%s shows the bottom shortcut only when the active lane exceeds two viewports, and ends the list clear of it", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const scrollToOffset = vi.fn();
    const scrollToIndex = vi.fn();
    act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset, scrollToIndex } : null }); });
    const list = () => renderer!.root.findAll((node) => (node.type as unknown) === "FlatList")[0]!;
    const container = () => hostParentOf(list())!;
    const endSpace = () => (list().props.contentContainerStyle as { paddingBottom: number }).paddingBottom;
    act(() => container().props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
    // Measured heights include the list's end space (46 without the shortcuts).
    act(() => list().props.onContentSizeChange(390, 1046));
    expect(hostsById("phone-scroll-actions")).toHaveLength(0);
    expect(endSpace()).toBe(46);
    act(() => list().props.onContentSizeChange(390, 1047));
    expect(hostsById("phone-scroll-actions")).toHaveLength(1);
    const scroll = (y: number, height = 1125) => act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y }, contentSize: { height }, layoutMeasurement: { height: 500 } } }));
    expect(hostsById("phone-scroll-top")).toHaveLength(0);
    expect(hostsById("phone-scroll-bottom")).toHaveLength(1);
    scroll(200);
    expect(hostsById("phone-scroll-top")).toHaveLength(0);
    expect(hostsById("phone-scroll-bottom")).toHaveLength(1);
    scroll(625);
    expect(hostsById("phone-scroll-top")).toHaveLength(0);
    expect(hostsById("phone-scroll-bottom")).toHaveLength(0);
    scroll(200);
    // The list ends below the shortcuts, so its last card and Load more scroll clear of them.
    const actions = StyleSheet.flatten(hostsById("phone-scroll-actions")[0]!.props.style) as { bottom: number };
    const button = StyleSheet.flatten(hostsById("phone-scroll-bottom")[0]!.props.style) as { height: number };
    expect(endSpace()).toBeGreaterThan(actions.bottom + button.height);
    // The space they add does not keep them shown: the same cards remeasured with it stay over the line.
    const added = endSpace() - 46;
    act(() => list().props.onContentSizeChange(390, 1047 + added));
    expect(hostsById("phone-scroll-actions")).toHaveLength(1);
    act(() => list().props.onContentSizeChange(390, 1046 + added));
    expect(hostsById("phone-scroll-actions")).toHaveLength(0);
    expect(endSpace()).toBe(46);
    act(() => list().props.onContentSizeChange(390, 1200));
    act(() => hostsById("phone-stat-needs_input")[0]!.props.onPress());
    act(() => hostsById("phone-scroll-bottom")[0]!.props.onPress());
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 738, animated: true });
    expect(scrollToIndex).not.toHaveBeenCalled();
    act(() => container().props.onLayout({ nativeEvent: { layout: { height: 600 } } }));
    expect(hostsById("phone-scroll-actions")).toHaveLength(0);
  });

  it("names the bottom shortcut for the loaded end of a lane with more pages, and loads no page itself", () => {
    const scrollToOffset = vi.fn();
    const scrollToIndex = vi.fn();
    act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset, scrollToIndex } : null }); });
    const pager = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "phone-lane-pager");
    act(() => pager().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } }));
    const laneList = (lane: string) => hostsById(`phone-lane-${lane}`)[0]!.find((node) => (node.type as unknown) === "FlatList");
    const overflow = (lane: string) => {
      act(() => hostParentOf(laneList(lane))!.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
      act(() => laneList(lane).props.onContentSizeChange(390, 1400));
    };
    const bottom = (lane: string) => hostsById(`phone-lane-${lane}`)[0]!.find((node) => typeof node.type === "string" && node.props.testID === "phone-scroll-bottom");
    act(() => pressable("Running 2").props.onPress());
    overflow("running");
    expect(bottom("running").props.accessibilityLabel).toBe("Scroll to bottom");
    // Done has more pages (the sample handle's `hasMore`): its end is the loaded cards' end.
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 390 * 3, y: 0 } } }));
    overflow("done");
    expect(bottom("done").props.accessibilityLabel).toBe("Scroll to the end of loaded tasks");
    const loadMore = (data as unknown as { __handle: { loadMoreDone: ReturnType<typeof vi.fn> } }).__handle.loadMoreDone;
    loadMore.mockClear();
    act(() => bottom("done").props.onPress());
    expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 938, animated: true });
    expect(scrollToIndex).not.toHaveBeenCalled();
    expect(loadMore).not.toHaveBeenCalled();
    act(() => laneList("done").props.onEndReached());
    expect(loadMore).toHaveBeenCalledTimes(1);
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }> } }).__handle;
    const saved = handle.lanes;
    try {
      handle.lanes = { ...saved, done: { ...saved.done!, cards: [...saved.done!.cards, { ...saved.done!.cards[0]!, id: "next-page" }] } };
      act(() => renderer!.update(screen(true)));
      act(() => laneList("done").props.onContentSizeChange(390, 1800));
      act(() => { vi.advanceTimersByTime(1000); });
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).not.toHaveBeenCalled();
    } finally {
      handle.lanes = saved;
    }
  });

  it("jumps without animation when reduced motion is on", () => {
    let onReduce: (enabled: boolean) => void = () => {};
    const addListener = AccessibilityInfo.addEventListener;
    const subscription = vi.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((name: string, listener: (enabled: boolean) => void) => {
      if (name === "reduceMotionChanged") onReduce = listener;
      return addListener("reduceMotionChanged", listener);
    }) as typeof AccessibilityInfo.addEventListener);
    const spring = vi.spyOn(Animated, "spring");
    try {
      const scrollToOffset = vi.fn();
      const scrollToIndex = vi.fn();
      act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset, scrollToIndex } : null }); });
      act(() => onReduce(true));
      const list = renderer!.root.findAll((node) => (node.type as unknown) === "FlatList")[0]!;
      act(() => hostParentOf(list)!.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
      act(() => list.props.onContentSizeChange(390, 1400));
      act(() => list.props.onScroll({ nativeEvent: { contentOffset: { y: 100 }, contentSize: { height: 1400 }, layoutMeasurement: { height: 500 } } }));
      act(() => hostsById("phone-stat-needs_input")[0]!.props.onPress());
      act(() => hostsById("phone-scroll-bottom")[0]!.props.onPress());
      expect(spring).not.toHaveBeenCalled();
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
      expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 938, animated: false });
      expect(scrollToIndex).not.toHaveBeenCalled();
    } finally {
      act(() => onReduce(false));
      subscription.mockRestore();
      spring.mockRestore();
    }
  });

  it.each([["ios", 1.1], ["android", 1.1], ["web", 1.03]] as const)("%s holds the bottom shortcut and still scrolls on press", (os, pressedScale) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const timing = vi.spyOn(Animated, "timing");
    const spring = vi.spyOn(Animated, "spring");
    const sequence = vi.spyOn(Animated, "sequence");
    const scrollToOffset = vi.fn();
    try {
      act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset } : null }); });
      const list = renderer!.root.findAll((node) => (node.type as unknown) === "FlatList")[0]!;
      act(() => hostParentOf(list)!.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
      act(() => list.props.onContentSizeChange(390, 1400));
      timing.mockClear();
      spring.mockClear();
      sequence.mockClear();
      act(() => { hostsById("phone-scroll-bottom")[0]!.props.onTouchStart({}); hostsById("phone-scroll-bottom")[0]!.props.onPressIn({}); });
      act(() => hostsById("phone-scroll-bottom")[0]!.props.onPressOut({}));
      expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: pressedScale, duration: 100 }));
      expect(spring).not.toHaveBeenCalled();
      act(() => hostsById("phone-scroll-bottom")[0]!.props.onTouchEnd({}));
      expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1 }));
      act(() => hostsById("phone-scroll-bottom")[0]!.props.onPress());
      expect(scrollToOffset).toHaveBeenCalledWith({ offset: 938, animated: true });
    } finally {
      timing.mockRestore();
      spring.mockRestore();
      sequence.mockRestore();
    }
  });

  it.each(["ios", "android", "web"])("%s scrolls once to the loaded end without chasing newly loaded pages", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }> } }).__handle;
    const saved = handle.lanes;
    const cards = Array.from({ length: 90 }, (_, index) => ({ ...saved.needs_input!.cards[0]!, id: `windowed-${index}` }));
    handle.lanes = { ...saved, needs_input: { ...saved.needs_input!, cards } };
    try {
      const list = () => renderer!.root.findAll((node) => (node.type as unknown) === "FlatList")[0]!;
      const scrollToOffset = vi.fn();
      const scrollToIndex = vi.fn((params: { index: number }) => list().props.onScrollToIndexFailed({ index: params.index, averageItemLength: 120, highestMeasuredFrameIndex: 5 }));
      act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset, scrollToIndex } : null }); });
      act(() => hostParentOf(list())!.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
      act(() => list().props.onContentSizeChange(390, 1400));
      act(() => hostsById("phone-scroll-bottom")[0]!.props.onPress());
      expect(scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 938, animated: true });
      expect(scrollToIndex).not.toHaveBeenCalled();
      handle.lanes = { ...handle.lanes, needs_input: { ...saved.needs_input!, cards: [...cards, { ...cards[0]!, id: "new-page" }] } };
      act(() => renderer!.update(screen(true)));
      act(() => list().props.onContentSizeChange(390, 1700));
      act(() => { vi.advanceTimersByTime(10000); });
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).not.toHaveBeenCalled();
    } finally {
      act(() => renderer?.unmount()); renderer = undefined;
      handle.lanes = saved;
    }
  });

  it("bounds retries when measurement stalls, and the current tab cancels a pending reveal", () => {
    const list = () => hostsById("phone-lane-running")[0]!.find((node) => (node.type as unknown) === "FlatList");
    const scrollToOffset = vi.fn();
    const scrollToIndex = vi.fn((params: { index: number }) => list().props.onScrollToIndexFailed({ index: params.index, averageItemLength: 100, highestMeasuredFrameIndex: 0 }));
    act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToOffset, scrollToIndex } : null }); });
    act(() => pressable("Running 2").props.onPress());
    act(() => hostParentOf(list())!.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
    act(() => list().props.onContentSizeChange(390, 1400));
    act(() => list().props.onScrollToIndexFailed({ index: 1, averageItemLength: 100, highestMeasuredFrameIndex: 0 }));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(scrollToIndex).toHaveBeenCalledTimes(50);
    expect(scrollToOffset).toHaveBeenCalledTimes(50);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(scrollToIndex).toHaveBeenCalledTimes(50);
    act(() => list().props.onScrollToIndexFailed({ index: 1, averageItemLength: 100, highestMeasuredFrameIndex: 0 }));
    act(() => list().props.onScroll({ nativeEvent: { contentOffset: { y: 100 }, contentSize: { height: 1400 }, layoutMeasurement: { height: 500 } } }));
    act(() => pressable("Running 2").props.onPress());
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(scrollToIndex).toHaveBeenCalledTimes(50);
  });

  it("retries a reveal's failed index through the inactive lane's own ref and cancels on unmount", () => {
    const lists = new Map<string, { scrollToOffset: ReturnType<typeof vi.fn>; scrollToIndex: ReturnType<typeof vi.fn> }>();
    act(() => { renderer = TestRenderer.create(screen(true), { createNodeMock: (element) => {
      if (element.type !== "FlatList") return null;
      const id = ((element.props as { data: TaskCard[] }).data)[0]!.id;
      const ref = { scrollToOffset: vi.fn(), scrollToIndex: vi.fn() };
      lists.set(id, ref);
      return ref;
    } }); });
    const list = hostsById("phone-lane-running")[0]!.find((node) => (node.type as unknown) === "FlatList");
    const ref = lists.get((list.props.data as TaskCard[])[0]!.id)!;
    act(() => list.props.onScrollToIndexFailed({ index: 0, averageItemLength: 120, highestMeasuredFrameIndex: -1 }));
    expect(ref.scrollToOffset).toHaveBeenCalledExactlyOnceWith({ offset: 0, animated: false });
    act(() => { vi.advanceTimersByTime(100); });
    expect(ref.scrollToIndex).toHaveBeenCalledExactlyOnceWith({ index: 0, viewPosition: 0, viewOffset: 12, animated: true });
    act(() => list.props.onScrollToIndexFailed({ index: 0, averageItemLength: 120, highestMeasuredFrameIndex: -1 }));
    act(() => renderer!.unmount()); renderer = undefined;
    act(() => { vi.advanceTimersByTime(1000); });
    expect(ref.scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it("shows shortcuts only for the selected native lane", () => {
    act(() => { renderer = TestRenderer.create(screen(true)); });
    const laneList = (lane: string) => hostsById(`phone-lane-${lane}`)[0]!.find((node) => (node.type as unknown) === "FlatList");
    for (const lane of ["needs_input", "running"]) {
      act(() => hostParentOf(laneList(lane))!.props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
      act(() => laneList(lane).props.onContentSizeChange(390, 1200));
    }
    expect(hostsById("phone-scroll-actions")).toHaveLength(1);
    expect(hostsById("phone-lane-needs_input")[0]!.findAll((node) => typeof node.type === "string" && node.props.testID === "phone-scroll-actions")).toHaveLength(1);
    act(() => pressable("Running 2").props.onPress());
    expect(hostsById("phone-scroll-actions")).toHaveLength(1);
    expect(hostsById("phone-lane-running")[0]!.findAll((node) => typeof node.type === "string" && node.props.testID === "phone-scroll-actions")).toHaveLength(1);
  });

  it.each(["ios", "android"])("%s does not redraw lane rows for height-only layouts, but still resizes pages with the viewport width", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(screen(true)); });
    const pager = () => hostsById("phone-lane-pager")[0]!;
    const layout = (width: number, height: number) => act(() => pager().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
    layout(390, 600);
    const before = host.rowRenders;
    for (const height of [599, 590, 575, 554, 600]) layout(390, height);
    expect(host.rowRenders).toBe(before);
    layout(844, 390);
    expect(StyleSheet.flatten(hostsById("phone-lane-needs_input")[0]!.props.style).width).toBe(844);
    act(() => pager().props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 844, y: 0 } } }));
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
    const filters = pressable("More");
    // Two agents; showing subtasks does not count.
    expect(textOf(filters)).toBe("2");
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
    act(() => filters.props.onPress());
    const sheet = renderer!.root.find((node) => (node.type as unknown) === "Modal");
    expect(sheet.props.title).toBe("More");
    expect(hostsById("filter-sheet-subtasks")).toHaveLength(0);
    expect(textOf(sheet)).not.toContain("Open tabs only");
  });

  it("shows an empty lane with a way out of the filters", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true, { q: "nothing matches" }));
    });
    const text = textOf(renderer!.root);
    expect(text).toContain("No tasks running");
    expect(text).toContain("Clear filters");
  });

  it("switches lanes from the status strip, the shown lane raised as a card", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    const cell = (label: string) => pressable(label);
    expect(textOf(cell("Waiting 1"))).toMatch(/Waiting\s*1/);
    expect(cell("Waiting 1").props.accessibilityState).toEqual({ selected: true });
    act(() => cell("Running 2").props.onPress());
    expect(cell("Running 2").props.accessibilityState).toEqual({ selected: true });
    expect(cell("Waiting 1").props.accessibilityState).toEqual({ selected: false });
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
    expect(renderer!.root.find((node) => (node.type as unknown) === "Modal").props.title).toBe("More");
  });

  it("pins the filter sheet's button under its scrolling options, and keeps the sort's height when drilling in", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => pressable("More").props.onPress());
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

  it("shows the archived lane beside More and saves it", async () => {
    act(() => { renderer = TestRenderer.create(screen(true)); });
    expect(hostsById("phone-stat-archived")).toHaveLength(0);
    const button = () => hostsById("phone-archived")[0]!;
    const controls = hostParentOf(button())!.findAll((node) => (node.type as unknown) === "Pressable");
    expect(controls.slice(-2).map((node) => node.props.testID)).toEqual(["phone-archived", "phone-more"]);
    expect(button().props.accessibilityState).toEqual({ selected: false });
    expect(button().findByType(SlashMark).props).toMatchObject({ color: "#6b6b75", gap: "#ffffff" });
    await act(async () => button().props.onPress());
    expect(button().props.accessibilityState).toEqual({ selected: true });
    expect(button().findAllByType(SlashMark)).toHaveLength(0);
    expect(hostsById("phone-stat-archived")).toHaveLength(1);
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true });
    act(() => pressable("More").props.onPress());
    expect(hostsById("filter-sheet-archived")).toHaveLength(0);
  });

  it("refreshes the phone list on pull and removes the More panel entry", async () => {
    act(() => { renderer = TestRenderer.create(screen(true)); });
    const handle = (data as unknown as { __handle: { refresh: ReturnType<typeof vi.fn> } }).__handle;
    let finish!: (result: string) => void;
    handle.refresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    handle.refresh.mockClear();
    const list = () => hostsById("phone-lane-needs_input")[0]!.find((node) => (node.type as unknown) === "FlatList");
    expect(list().props.alwaysBounceVertical).toBe(true);
    act(() => list().props.onRefresh());
    expect(list().props.refreshing).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(handle.refresh).toHaveBeenCalledOnce();
    await act(async () => { finish("done"); });
    expect(list().props.refreshing).toBe(false);
    const more = hostsById("phone-more")[0]!;
    expect(more.find((node) => (node.type as unknown) === "Icon").props.name).toBe("MoreVertical");
    act(() => more.props.onPress());
    expect(hostsById("filter-sheet-refresh")).toHaveLength(0);
    expect(hostsById("filter-sheet-scroll")).toHaveLength(1);
  });

  it("opens the filter sheet with the sort first from the header's sort pill, and with the switches first from the filters button", () => {
    const order = () => {
      const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      const text = textOf(scroll);
      return { sort: text.indexOf("Sort"), switches: text.indexOf(BOARD_STRINGS.en.emptyGroups.row), workspace: text.indexOf("Workspace") };
    };
    act(() => {
      renderer = TestRenderer.create(screen(true, { sort: "branch-desc" }));
    });
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "phone-sort-hint").props.onPress());
    expect(order().sort).toBeGreaterThanOrEqual(0);
    expect(order().sort).toBeLessThan(order().switches);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-sort")).toHaveLength(1);
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Modal").props.onOpenChange?.(false));
    act(() => pressable("More").props.onPress());
    expect(order().switches).toBeLessThan(order().sort);
    expect(order().workspace).toBeLessThan(order().sort);
  });

  it("draws the filter sheet's on/off filters as switches, not ticks", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => pressable("More").props.onPress());
    const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
    const switches = () => scroll.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "switch");
    expect(switches()).toHaveLength(1);
    expect(switches().map((node) => node.props.accessibilityState)).toEqual([{ checked: true }]);
    act(() => switches()[0]!.props.onPress());
    expect(switches()[0]!.props.accessibilityState).toEqual({ checked: false });
    expect(switches().flatMap((node) => node.findAll((child) => (child.type as unknown) === "Icon" && child.props.name === "Check"))).toHaveLength(0);
  });

  it("places the expanded time range after the switch and keeps Reset in the footer", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => pressable("More").props.onPress());
    const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
    const text = textOf(scroll);
    const at = (label: string) => text.indexOf(label);
    expect(at(BOARD_STRINGS.en.refreshTasks)).toBe(-1);
    expect(at(BOARD_STRINGS.en.emptyGroups.row)).toBeGreaterThanOrEqual(0);
    expect(at(BOARD_STRINGS.en.emptyGroups.row)).toBeLessThan(at("Time range"));
    expect(at("Time range")).toBeLessThan(at("Agent"));
    expect(at("Agent")).toBeLessThan(at("Workspace"));
    expect(at("Workspace")).toBeLessThan(at("Labels"));
    expect(at("Labels")).toBeLessThan(at("Sort"));
    const range = () => hostsById("filter-sheet-range-toggle")[0]!;
    expect(range().props.accessibilityState.expanded).toBe(true);
    expect(hostsById("filter-sheet-range-content")[0]!.props.accessibilityElementsHidden).toBe(false);
    act(() => range().props.onPress());
    expect(range().props.accessibilityState.expanded).toBe(false);
    act(() => range().props.onPress());
    expect(range().props.accessibilityState.expanded).toBe(true);
    for (const id of ["agents", "workspaces", "labels", "sort-group"]) expect(hostsById(`filter-sheet-${id}-toggle`)[0]!.props.accessibilityState.expanded).toBe(false);
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
      act(() => pressable("More").props.onPress());
      const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      const workspaces = () => sheet().find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-workspaces");
      const chips = () => workspaces().findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "checkbox").map(textOf);
      const header = () => sheet().find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-workspace-header");
      const field = () => header().find((node) => (node.type as unknown) === "TextInput");
      expect(sheet().props.stickyHeaderIndices).toEqual([1, 3, 5]);
      act(() => hostsById("filter-sheet-workspaces-toggle")[0]!.props.onPress());
      expect(field().props.placeholder).toBe("Search projects and workspaces");
      expect(chips().map((chip) => chip.replace(/\d+$/, ""))).toEqual(["tasks-board", "idle-branch"]);
      // A project's name keeps its whole group; every word must match.
      act(() => field().props.onChangeText("IDLE proj"));
      expect(chips().map((chip) => chip.replace(/\d+$/, ""))).toEqual(["idle-branch"]);
      expect(textOf(workspaces())).not.toContain("better-paseo");
      act(() => field().props.onChangeText("nothing-here"));
      expect(chips()).toEqual([]);
      expect(textOf(workspaces())).toContain("No matches");
      act(() => header().find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-search-clear").props.onPress());
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
      act(() => pressable("More").props.onPress());
      const button = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-empty-groups");
      const icon = () => button().find((node) => (node.type as unknown) === "Icon").props.name;
      // On by default: the whole list.
      expect(button().props).toMatchObject({ accessibilityRole: "switch", accessibilityState: { checked: true } });
      expect(textOf(button())).toContain("Show all");
      expect(textOf(button())).toContain("Includes groups with no tasks on the board");
      expect(icon()).toBe("Layers");
      const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      expect(sheet().findAll((node) => node === button())).toHaveLength(1);
      const chips = () => sheet().findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "checkbox").map(textOf);
      act(() => hostsById("filter-sheet-workspaces-toggle")[0]!.props.onPress());
      expect(chips()).toEqual(expect.arrayContaining(["idle-branch0", "Pi", "unused0"]));
      await act(async () => button().props.onPress());
      expect(host.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showEmptyGroups: false });
      expect(button().props.accessibilityState).toEqual({ checked: false });
      expect(textOf(button())).toContain("Show groups with tasks");
      expect(textOf(button())).toContain("Hides groups with no tasks on the board");
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
      act(() => pressable("More").props.onPress());
      expect(chips()).toContain("Pi");
      expect(chips()).not.toContain("idle-branch0");
    } finally {
      handle.workspaces = saved.workspaces;
      handle.providers = saved.providers;
      handle.labels = saved.labels;
    }
  });

  it("opens the details sheet on a card's tap instead of its tab", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => cards()[0]!.props.onSelect(cards()[0]!.props.card));
    const sheet = () => renderer!.root.find((node) => (node.type as unknown) === "Modal");
    // The details draw the title themselves; the sheet's header says what it is.
    expect(sheet().props.title).toBe("Details");
    expect(sheet().findByType(TaskDetailCards).props).toMatchObject({ touch: true, language: "en", card: { id: "sample-input" } });
    act(() => cards()[0]!.props.onSelect(cards()[0]!.props.card));
    expect(sheet().findByType(TaskDetailCards).props.card.id).toBe("sample-input");
    expect(openAgent).not.toHaveBeenCalled();
  });

  it.each(["ios", "android", "web"])("shows message and info tabs with a pinned action bar in the %s phone sheet", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    await act(async () => cards()[0]!.props.onSelect(cards()[0]!.props.card));
    const detail = renderer!.root.findByType(TaskDetailCards);
    expect(detail.props).toMatchObject({ touch: true, tabs: true, scrollHeader: true, actions: false });
    const scroll = hostsById("detail-tab-short-scroll")[0]!;
    const bar = hostsById("detail-action-bar")[0]!;
    expect(scroll.findAll((node) => node === bar)).toHaveLength(0);
    expect(hostsById("detail-tab-messages")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("detail-prompt")).toHaveLength(1);
    await act(async () => hostsById("detail-tab-info")[0]!.props.onPress());
    expect(hostsById("detail-tab-info")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("detail-location")).toHaveLength(1);
    expect(hostsById("detail-action-bar")[0]).toBe(bar);
    await act(async () => {
      scroll.props.onLayout({ nativeEvent: { layout: { height: 300 } } });
      scroll.props.onContentSizeChange(200, 900);
    });
    const barShadow = () => {
      const style = hostsById("detail-action-bar")[0]!.props.style;
      return (Array.isArray(style) ? style : [style]).map((item: { boxShadow?: string } | null) => item?.boxShadow).find((value: string | undefined) => typeof value === "string");
    };
    expect(barShadow()).toContain("0px -5px 8px -4px");
    await act(async () => scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 600 }, layoutMeasurement: { height: 300 }, contentSize: { height: 900 } } }));
    expect(barShadow()).toBeUndefined();
    expect(openAgent).not.toHaveBeenCalled();
  });

  it("returns to messages when stepping to another phone task", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    await act(async () => { renderer = TestRenderer.create(screen(true)); });
    await act(async () => pressable("Running 2").props.onPress());
    const card = cards().find((node) => node.props.card.id === "sample-running")!;
    await act(async () => card.props.onSelect(card.props.card));
    await act(async () => hostsById("detail-tab-info")[0]!.props.onPress());
    expect(hostsById("detail-tab-info")[0]!.props.accessibilityState.selected).toBe(true);
    await act(async () => pressable("Next task").props.onPress());
    expect(renderer!.root.findByType(TaskDetailCards).props.card.id).not.toBe(card.props.card.id);
    expect(hostsById("detail-tab-messages")[0]!.props.accessibilityState.selected).toBe(true);
    expect(hostsById("detail-action-bar")).toHaveLength(1);
  });

  it.each([
    { compact: false, canStop: true, provider: false },
    { compact: true, canStop: true, provider: false },
    { compact: false, canStop: false, provider: false },
    { compact: true, canStop: false, provider: false },
    { compact: false, canStop: true, provider: true },
    { compact: true, canStop: true, provider: true },
  ])("aligns idle-parent stop availability in cards and details: %j", async ({ compact, canStop, provider }) => {
    host.canStop = canStop;
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }>; byId: Map<string, TaskCard> } }).__handle;
    const saved = { lanes: handle.lanes, byId: handle.byId };
    const base = saved.byId.get("sample-running")!;
    const parent: TaskCard = { ...base, stoppable: false, waitingOnSubtasks: true, children: [{ id: "child", title: "Child", status: "running", ...(provider ? { kind: "provider" as const } : {}) }] };
    try {
      handle.lanes = { ...saved.lanes, running: { ...saved.lanes.running!, cards: [parent] } };
      handle.byId = new Map(saved.byId).set(parent.id, parent);
      await act(async () => { renderer = TestRenderer.create(screen(compact)); });
      if (!compact) layOut(1400);
      const card = cards().find((node) => node.props.card.id === parent.id)!;
      await act(async () => card.props.onSelect(parent));
      const detail = renderer!.root.findByType(TaskDetailCards);
      expect(!!detail.props.stop).toBe(canStop && !provider);
      if (compact) expect(!!renderer!.root.findByType(DetailActionBar).props.stop).toBe(canStop && !provider);
    } finally {
      handle.lanes = saved.lanes;
      handle.byId = saved.byId;
    }
  });

  it.each([false, true])("offers Stop on a phone card exactly when its details sheet does (host CLI: %s)", async (canStop) => {
    host.canStop = canStop;
    await act(async () => {
      renderer = TestRenderer.create(screen(true));
      await Promise.resolve();
    });
    const running = cards().find((card) => card.props.card.lane === "running" && card.props.card.stoppable)!;
    // Without the CLI a card's Stop would do nothing: the press ends in `stop.press`'s early return.
    expect(typeof running.props.onStop).toBe(canStop ? "function" : "undefined");
    await act(async () => running.props.onSelect(running.props.card));
    const bar = renderer!.root.findByType(DetailActionBar);
    expect(bar.props.card.id).toBe(running.props.card.id);
    expect(bar.props.stop ? "stop" : null).toBe(canStop ? "stop" : null);
  });

  // The phone wraps the board's callbacks to swallow taps after a swipe; it once dropped the title control.
  it.each(["needs_input", "running", "review", "done", "archived"] as const)("keeps a card in place until its complete generated title is displayed (%s)", async (lane) => {
    const titleUpdates = await import("../../client/tasks/actions/title-update");
    let answer!: (state: { state: "done"; title: string }) => void;
    const control = titleUpdates.createTitleUpdateControl(() => new Promise((resolve) => { answer = resolve; }));
    const titleControl = vi.spyOn(titleUpdates, "useTitleUpdateControl").mockReturnValue(control);
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }>; byId: Map<string, TaskCard> } }).__handle;
    const saved = handle.lanes;
    const first = { ...handle.byId.get("sample-done")!, id: "title-first", lane, location: { ...handle.byId.get("sample-done")!.location, branch: "search-match" } };
    const target = { ...first, id: "title-target", title: "Old title" };
    const title = "A complete generated title that must finish before the card moves";
    const laneCards = () => cards().filter((card) => card.props.card.lane === lane);
    try {
      host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } };
      handle.lanes = { ...saved, [lane]: { ...saved[lane]!, cards: [first, target] } };
      await act(async () => { renderer = TestRenderer.create(screen(false, { q: "search-match" })); });
      await act(async () => { await deviceTasksStore().update({ showArchived: true }); });
      layOut(2400);
      await act(async () => { await vi.advanceTimersByTimeAsync(800); });
      expect(laneCards().map((card) => card.props.card.id)).toEqual([first.id, target.id]);
      await act(async () => control.start(target.id));
      const rowRenders = host.rowRenders;
      const updated = { ...target, title, timing: { ...target.timing, updatedAt: "2026-10-28T00:00:00Z" } };
      // The daemon publishes the rename before the final status reaches the client.
      handle.lanes = { ...handle.lanes, [lane]: { ...handle.lanes[lane]!, cards: [updated, first] } };
      await act(async () => renderer!.update(screen(false, { q: "search-match" })));
      expect(laneCards().map((card) => card.props.card.id)).toEqual([first.id, target.id]);
      expect(laneCards()[1]!.props.card).toBe(target);
      await act(async () => answer({ state: "done", title }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      expect(control.revealing().has(target.id)).toBe(true);
      expect(laneCards().map((card) => card.props.card.id)).toEqual([first.id, target.id]);
      expect(laneCards()[1]!.props.card).toBe(target);
      expect(host.rowRenders).toBe(rowRenders);
      for (let index = 0; index < 100 && control.revealing().has(target.id); index++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(30); });
      }
      expect(control.revealing().has(target.id)).toBe(false);
      expect(laneCards().map((card) => card.props.card.id)).toEqual([target.id, first.id]);
      expect(laneCards()[0]!.props.card).toBe(updated);
      expect(laneCards()[1]!.props.card).toBe(first);
      expect(textOf(laneCards()[0]!.find((node) => typeof node.type === "string" && node.props.testID === "task-card-title"))).toBe(title);
    } finally {
      handle.lanes = saved;
      titleControl.mockRestore();
    }
  });

  it.each([true, false])("offers automatic titles from a card's long-press menu (compact: %s)", async (compact) => {
    await act(async () => {
      renderer = TestRenderer.create(screen(compact));
      await Promise.resolve();
    });
    if (!compact) layOut(1400);
    const card = cards().find((node) => node.props.card.lane === "running" && !node.props.card.subagent)!;
    expect(card.props.titleUpdates).toBeDefined();
    act(() => card.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.props.card.id}`).props.onLongPress({ nativeEvent: { pageX: 140, pageY: 280 } }));
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Automatically update title")).toHaveLength(1);
  });

  it.each([true, false])("offers automatic titles on an archived card's long-press menu (compact: %s)", async (compact) => {
    const handle = (data as unknown as { __handle: { lanes: Record<string, { cards: TaskCard[] }>; byId: Map<string, TaskCard> } }).__handle;
    const saved = handle.lanes;
    const archived = data.withArchived(handle.byId.get("sample-done")!, "agent");
    try {
      // The archived lane mounts late; the first page carries the card, which keeps its own lane.
      handle.lanes = { ...saved, needs_input: { ...saved.needs_input!, cards: [archived] } };
      await act(async () => {
        renderer = TestRenderer.create(screen(compact));
        await Promise.resolve();
      });
      if (!compact) layOut(1400);
      const card = cards().find((node) => node.props.card.id === archived.id)!;
      expect(card.props.titleUpdates).toBeDefined();
      act(() => card.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${archived.id}`).props.onLongPress({ nativeEvent: { pageX: 140, pageY: 280 } }));
      // Archived cards keep the same title actions as other sessions.
      expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Copy title")).toHaveLength(1);
      expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Automatically update title")).toHaveLength(1);
    } finally {
      handle.lanes = saved;
    }
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
    act(() => card.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.props.card.id}`).props.onLongPress({ nativeEvent: { pageX: 140, pageY: 280 } }));
    expect(handleSetJSResponder).toHaveBeenCalledTimes(1);
    expect(flushOperations).toHaveBeenCalledTimes(1);
    expect(pager().props.scrollEnabled).toBe(false);
    act(() => grid().props.onTouchEnd(touch(220, 302)));
    expect(pager().props.scrollEnabled).toBe(true);
    expect(renderer!.root.find((node) => (node.type as unknown) === "Modal").props.title).toBe(card.props.card.title);
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
    act(() => card.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.props.card.id}`).props.onLongPress({ nativeEvent: { pageX: 140, pageY: 280 } }));
    expect(setIsJSResponder).toHaveBeenCalledWith(shadow, true, true);
    expect(pager().props.scrollEnabled).toBe(false);
    act(() => grid().props.onTouchCancel());
    expect(setIsJSResponder).toHaveBeenLastCalledWith(shadow, false, false);
    expect(pager().props.scrollEnabled).toBe(true);
    expect(handleSetJSResponder).not.toHaveBeenCalled();
    expect(pressable("Running 2").props.accessibilityState).toEqual({ selected: true });
    expect(renderer!.root.find((node) => (node.type as unknown) === "Modal").props.title).toBe(card.props.card.title);
  });

  it("Android: past the first lane tells the host the board is scrolled sideways, so its agent-list pan fails", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const record = { registerScrollOffset: vi.fn(), unregisterScrollOffset: vi.fn(), isAnyScrolledRight: { value: false } };
    const fiber = { memoizedProps: {}, return: { memoizedProps: { value: record }, return: null } };
    act(() => {
      renderer = TestRenderer.create(screen(true), { createNodeMock: () => ({ __internalInstanceHandle: fiber }) });
    });
    // Waiting: the first lane registers nothing.
    expect(record.registerScrollOffset).not.toHaveBeenCalled();
    act(() => pressable("Running 2").props.onPress());
    expect(record.registerScrollOffset).toHaveBeenCalledTimes(1);
    const [id, offset] = record.registerScrollOffset.mock.calls[0]!;
    expect(offset).toBeGreaterThan(1);
    act(() => pressable("Review 2").props.onPress());
    expect(record.registerScrollOffset).toHaveBeenCalledTimes(1);
    act(() => pressable("Waiting 1").props.onPress());
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
    expect(pressable("Waiting 1").props.accessibilityState).toEqual({ selected: true });
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

  it("updates the hover hint for each visible sidebar count", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } };
    const card = (data as unknown as { __handle: { lanes: { running: { cards: TaskCard[] } } } }).__handle.lanes.running.cards[0]!;
    host.counts = { running: 3, needsInput: 1, review: 2, done: 0, hidden: [card] };
    const titles = new Map<string, string>();
    const props = { theme, host: { id: "host-1", label: "Local" }, layout: { compact: false, platform: "web" as const }, currentScreen: null, openScreen: vi.fn(), openPopover: vi.fn() };
    act(() => {
      renderer = TestRenderer.create(React.createElement(TasksSidebarEntry, props), {
        createNodeMock: (element) => {
          const id = (element.props as { testID?: string }).testID;
          return id === "sidebar-counts-area" || id?.startsWith("sidebar-count-") ? { setAttribute: (_name: string, value: string) => titles.set(id, value) } : null;
        },
      });
    });
    expect(titles.get("sidebar-count-needs_input")).toBe("1 need input");
    expect(titles.get("sidebar-count-running")).toBe("3 running");
    expect(titles.get("sidebar-count-review")).toBe("2 to review");
    expect(titles.get("sidebar-counts-area")).toBe("1 hidden task, 1 need input, 3 running, 2 to review");
    host.counts = { running: 4, needsInput: 1, review: 2, done: 0 };
    act(() => renderer!.update(React.createElement(TasksSidebarEntry, props)));
    expect(titles.get("sidebar-count-running")).toBe("4 running");
    expect(titles.get("sidebar-counts-area")).toBe("1 need input, 4 running, 2 to review");
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

  it("draws a hidden task as the board's card, with its agent mark and thinking level", () => {
    const card = (data as unknown as { __handle: { lanes: { running: { cards: TaskCard[] } } } }).__handle.lanes.running.cards[0]!;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } };
    host.counts = { needsInput: 0, running: 0, review: 0, done: 0, hidden: [card] };
    const row = entry(null);
    act(() => row.findAll((node) => node.props.testID === "hidden-tasks-count")[0]!.props.onPress());
    const modal = renderer!.root.findByType(Modal);
    expect(modal.props.title).toBe("Hidden tasks");
    expect(textOf(modal)).toContain("Running · 1");
    expect(textOf(modal)).toContain(card.modelLabel);
    expect(textOf(modal)).toContain(card.thinkingLabel);
    expect(textOf(modal)).toContain(card.title);
    expect(modal.findAll((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`)).toHaveLength(1);
    expect(modal.findAll((node) => node.props.testID === "agent-pill-thinking").map((node) => textOf(node))).toContain(card.thinkingLabel);
    expect(modal.findAllByType(ProviderLogo).length).toBeGreaterThan(0);
  });

  it("clears the board's search and filters from the hidden-task dialog and closes it", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const card = (data as unknown as { __handle: { lanes: { running: { cards: TaskCard[] } } } }).__handle.lanes.running.cards[0]!;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } };
    host.counts = { needsInput: 0, running: 0, review: 0, done: 0, hidden: [card] };
    rememberBoardParams("host-1", { ...EMPTY_PARAMS, query: "deploy", providers: ["codex"], labels: ["frontend"] });
    const openScreen = vi.fn();
    const row = entry(null, openScreen);
    act(() => row.findAll((node) => node.props.testID === "hidden-tasks-count")[0]!.props.onPress());
    const button = renderer!.root.findAll((node) => node.props.testID === "hidden-tasks-clear-filters" && (node.type as unknown) === "Pressable")[0]!;
    expect(button.props.accessibilityLabel).toBe("Clear filters");
    act(() => button.props.onPress());
    expect(renderer!.root.findAllByType(Modal)).toHaveLength(0);
    expect(openScreen).toHaveBeenCalledOnce();
    const params = openScreen.mock.calls[0]![0] as { screenId: string; params: Record<string, string> };
    expect(params.screenId).toBe("tasks");
    // The subtask switch is the device's own preference and stays out of the cleared route.
    expect(params.params).toEqual({});
    expect(boardClearCount("host-1")).toBe(1);
  });

  it("asks an open board to clear instead of opening the route again", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const card = (data as unknown as { __handle: { lanes: { running: { cards: TaskCard[] } } } }).__handle.lanes.running.cards[0]!;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } };
    host.counts = { needsInput: 0, running: 0, review: 0, done: 0, hidden: [card] };
    const openScreen = vi.fn();
    const row = entry("tasks", openScreen);
    act(() => row.findAll((node) => node.props.testID === "hidden-tasks-count")[0]!.props.onPress());
    act(() => renderer!.root.findAll((node) => node.props.testID === "hidden-tasks-clear-filters" && (node.type as unknown) === "Pressable")[0]!.props.onPress());
    expect(openScreen).not.toHaveBeenCalled();
    expect(boardClearCount("host-1")).toBe(1);
  });

  it("folds hidden groups independently and stops dialog clicks reaching the sidebar", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const card = (data as unknown as { __handle: { lanes: { running: { cards: TaskCard[] } } } }).__handle.lanes.running.cards[0]!;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } };
    host.counts = { needsInput: 0, running: 0, review: 0, done: 0, hidden: [card, { ...card, id: "review-hidden", lane: "review" }] };
    const row = entry(null);
    act(() => row.findAll((node) => node.props.testID === "hidden-tasks-count")[0]!.props.onPress());
    const modal = () => renderer!.root.findByType(Modal);
    const toggle = () => modal().findAll((node) => node.props.testID === "hidden-tasks-toggle-running" && (node.type as unknown) === "Pressable")[0]!;
    expect(toggle().props.accessibilityState.expanded).toBe(true);
    act(() => toggle().props.onPress());
    expect(toggle().props.accessibilityState.expanded).toBe(false);
    expect(modal().findAll((node) => node.props.testID === `task-card-${card.id}`)).toHaveLength(0);
    expect(modal().findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-review-hidden")).toHaveLength(1);
    act(() => toggle().props.onPress());
    expect(modal().findAll((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`)).toHaveLength(1);
    const boundary = row.findAll((node) => typeof node.props.onClick === "function").find((node) => node.findAllByType(Modal).length > 0)!;
    const event = { stopPropagation: vi.fn() };
    boundary.props.onClick(event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it.each([["all", true], ["input-only", false], ["none", false]] as const)("shows hidden running tasks only for the all indicator (%s)", (count, visible) => {
    const card = (data as unknown as { __handle: { lanes: { running: { cards: TaskCard[] } } } }).__handle.lanes.running.cards[0]!;
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count } };
    host.counts = { needsInput: 0, running: 0, review: 0, done: 0, hidden: [card] };
    const row = entry(null);
    expect(row.findAll((node) => node.props.testID === "hidden-tasks-count" && (node.type as unknown) === "Pressable")).toHaveLength(visible ? 1 : 0);
  });

  it("counts with the board's filters and follows them as the board changes them", () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, hideSubtasks: true } };
    rememberBoardParams("host-1", { ...EMPTY_PARAMS, providers: ["codex"] });
    entry(null);
    expect(host.countScope).toMatchObject({ filters: { providers: ["codex"], labels: [], hideSubtasks: true, query: "" } });
    act(() => rememberBoardParams("host-1", { ...EMPTY_PARAMS, labels: ["frontend"] }));
    expect(host.countScope).toMatchObject({ filters: { providers: [], labels: ["frontend"], hideSubtasks: true } });
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

describe("Tasks board, new tasks", () => {
  const old = new Date(Date.parse("2026-10-20T12:00:00Z")).toISOString();
  const running = (id: string, createdAt: string) => makeAgent({ id, title: `Task ${id}`, workspaceId: "ws", status: "running", createdAt, updatedAt: createdAt, lastUserMessageAt: createdAt });
  const review = (id: string) => makeAgent({ id, title: `Task ${id}`, workspaceId: "ws", status: "idle", requiresAttention: true, attentionReason: "finished", createdAt: old, updatedAt: old, lastUserMessageAt: old });

  /** The list drawing `lane`'s cards: the phone's page, or the desktop lane. */
  function list(lane: string): ReactTestInstance {
    return renderer!.root.find((node) => (node.type as unknown) === "FlatList" && Array.isArray(node.props.data) && (node.props.data as TaskCard[]).some((card) => card.lane === lane) && (hostsById(`phone-lane-${lane}`).length === 0 || hostsById(`phone-lane-${lane}`)[0]!.findAll((inner) => inner === node).length > 0));
  }
  /** The list reports which of its cards are on screen, as `VirtualizedList` does. */
  function onScreen(lane: string, ids: string[]) {
    const target = list(lane);
    const data = target.props.data as TaskCard[];
    const pairs = target.props.viewabilityConfigCallbackPairs as { onViewableItemsChanged(info: unknown): void }[];
    act(() => pairs[0]!.onViewableItemsChanged({ viewableItems: ids.map((id) => ({ key: id, item: null, index: data.findIndex((card) => card.id === id), isViewable: true })), changed: [] }));
  }
  // Its outline layer is drawn from the start; breathing is the store's flash for it.
  const outlined = (id: string) => hostsById(`card-new-${id}`).length > 0 && newCardStore("host-1").flash(id).key !== 0;

  async function mount(compact: boolean, os: string, extra: ReturnType<typeof makeAgent>[] = []) {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const scrollToIndex = vi.fn();
    const fake = createFakePaseo({ agents: [running("a", old), running("b", old), review("c"), ...extra] });
    host.liveTasks = fake.paseo;
    await act(async () => { renderer = TestRenderer.create(screen(compact), { createNodeMock: (element) => element.type === "FlatList" ? { scrollToIndex, scrollToOffset: vi.fn() } : null }); });
    layOut(compact ? 390 : 2400);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const push = async (agent: ReturnType<typeof makeAgent>, wait = 0) => {
      await act(async () => { fake.pushAgentSnapshot(agent); });
      await act(async () => { await vi.advanceTimersByTimeAsync(wait); });
    };
    /** Past the moment a new card's lane starts saying so. */
    const announce = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(ANNOUNCE_AFTER_MS); }); };
    return { fake, push, announce, scrollToIndex };
  }

  it.each(["ios", "web"])("%s marks the tab of a lane not shown, and outlines the new card once its lane is", async (os) => {
    const { push, announce } = await mount(true, os);
    act(() => hostsById("phone-stat-review")[0]!.props.onPress());
    await push(running("fresh", new Date().toISOString()));
    // Not at once: a card the user looks at is reported on screen a few frames after it came.
    expect(hostsById("phone-new-dot-running")).toHaveLength(0);
    await announce();
    expect(hostsById("phone-new-dot-running")).toHaveLength(1);
    expect(hostsById("phone-new-dot-review")).toHaveLength(0);
    expect(hostsById("phone-new-pill-review").length).toBe(0);
    if (os !== "web") {
      // The page beside the one shown sees its cards, but nobody looks at it.
      onScreen("running", ["a", "b", "fresh"]);
      expect(hostsById("phone-new-dot-running")).toHaveLength(1);
      expect(outlined("fresh")).toBe(false);
    }
    act(() => hostsById("phone-stat-running")[0]!.props.onPress());
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    if (os === "web") onScreen("running", ["a", "b", "fresh"]);
    expect(hostsById("phone-new-dot-running")).toHaveLength(0);
    expect(outlined("fresh")).toBe(true);
    expect(outlined("a")).toBe(false);
    // It breathes twice and goes; scrolled away and back, it does not breathe again.
    await act(async () => { await vi.advanceTimersByTimeAsync(FLASH_AFTER_SCROLL_MS + 2800 + 50); });
    expect(outlined("fresh")).toBe(false);
    onScreen("running", ["a"]);
    onScreen("running", ["a", "b", "fresh"]);
    expect(outlined("fresh")).toBe(false);
  });

  it.each(["ios", "web"])("%s offers a pill for a new card below the screen, and scrolls to it", async (os) => {
    const { push, announce, scrollToIndex } = await mount(true, os);
    act(() => hostsById("phone-stat-running")[0]!.props.onPress());
    onScreen("running", ["a", "b"]);
    await push(running("fresh", new Date().toISOString()));
    await announce();
    // The running lane keeps its oldest task first: the new one is last, out of view.
    expect((list("running").props.data as TaskCard[]).map((card) => card.id)).toEqual(["a", "b", "fresh"]);
    const pill = () => hostsById("phone-new-pill-running");
    expect(pill()).toHaveLength(1);
    expect(pill()[0]!.props.accessibilityLabel).toBe("1 new task");
    expect(outlined("fresh")).toBe(false);
    act(() => pill()[0]!.props.onPress());
    expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 2, viewPosition: 0.5, animated: true });
    // It sinks away, then goes.
    vi.spyOn(Animated, "timing").mockImplementation(() => ({ start: (done?: (result: { finished: boolean }) => void) => done?.({ finished: true }), stop() {}, reset() {} }) as never);
    onScreen("running", ["b", "fresh"]);
    expect(outlined("fresh")).toBe(true);
    expect(pill()).toHaveLength(0);
  });

  it("outlines a new card seen as it comes in once its entrance settles, and offers no pill for it", async () => {
    const { push } = await mount(true, "ios");
    act(() => hostsById("phone-stat-running")[0]!.props.onPress());
    onScreen("running", ["a", "b"]);
    await push(running("fresh", new Date().toISOString()));
    // The list reports the new row a little after it came.
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    onScreen("running", ["a", "b", "fresh"]);
    expect(outlined("fresh")).toBe(true);
    const outline = hostsById("card-new-fresh")[0]!;
    expect(StyleSheet.flatten(outline.props.style)).toMatchObject({ borderWidth: 1.5, borderRadius: 8 });
    expect(FLASH_AFTER_ENTER_MS).toBeGreaterThan(FLASH_AFTER_SCROLL_MS);
    await act(async () => { await vi.advanceTimersByTimeAsync(ANNOUNCE_AFTER_MS); });
    expect(hostsById("phone-new-pill-running")).toHaveLength(0);
  });

  it("does not count a task that was created a while ago (unarchived, paged in), or the tasks it starts with", async () => {
    const { push } = await mount(true, "ios", [running("startup", new Date().toISOString())]);
    act(() => hostsById("phone-stat-review")[0]!.props.onPress());
    expect(hostsById("phone-new-dot-running")).toHaveLength(0);
    await push(running("returning", new Date(Date.now() - 5 * 60_000).toISOString()), ANNOUNCE_AFTER_MS);
    expect(hostsById("phone-new-dot-running")).toHaveLength(0);
    await push(running("fresh", new Date().toISOString()), ANNOUNCE_AFTER_MS);
    expect(hostsById("phone-new-dot-running")).toHaveLength(1);
  });

  it("forgets a new task that leaves its lane before it was seen", async () => {
    const { push } = await mount(true, "ios");
    act(() => hostsById("phone-stat-review")[0]!.props.onPress());
    const now = new Date().toISOString();
    await push(running("fresh", now), ANNOUNCE_AFTER_MS);
    expect(hostsById("phone-new-dot-running")).toHaveLength(1);
    await push(makeAgent({ id: "fresh", title: "Task fresh", workspaceId: "ws", status: "idle", requiresAttention: true, attentionReason: "finished", createdAt: now, updatedAt: new Date(Date.now() + 1000).toISOString(), lastUserMessageAt: now }));
    expect(hostsById("phone-new-dot-running")).toHaveLength(0);
    expect(hostsById("phone-new-dot-review")).toHaveLength(0);
  });

  it("on the desktop floats a pill over the lane, and marks a collapsed lane", async () => {
    const { push, scrollToIndex } = await mount(false, "web");
    onScreen("running", ["a", "b"]);
    await push(running("fresh", new Date().toISOString()), ANNOUNCE_AFTER_MS);
    const pill = () => hostsById("lane-new-pill-running");
    expect(pill()).toHaveLength(1);
    act(() => pill()[0]!.props.onPress());
    expect(scrollToIndex).toHaveBeenLastCalledWith({ index: 2, viewPosition: 0.5, animated: true });
    onScreen("running", ["a", "b", "fresh"]);
    expect(outlined("fresh")).toBe(true);
    await push(running("later", new Date().toISOString()), ANNOUNCE_AFTER_MS);
    act(() => hostsById("lane-header-running")[0]!.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === BOARD_STRINGS.en.collapse)[0]!.props.onPress());
    layOut(2400);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(hostsById("lane-new-dot-running")).toHaveLength(1);
  });
});
