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
import { WindowSegments } from "../../client/tasks/board/board-parts";
import { TasksSidebarEntry } from "../../client/tasks/board/sidebar-entry";
import { contributeTasks } from "../../client/tasks/contribute";
import { lastBoardParams, rememberBoardParams, resetBoardSessions, EMPTY_PARAMS } from "../../client/tasks/board/params";
import { NOTICE_MS } from "../../client/tasks/board/use-board";
import { readSidebarPreference, resetSidebarPreference, writeSidebarPreference } from "../../client/tasks/board/sidebar-model";
import { ACTIVE_LANE_ORDER as LANE_ORDER } from "../../client/tasks/model";
import { BrandMark, PiMark, TaskCardView, TaskDetailCards, taskTokens } from "../../client/tasks/cards";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS } from "../../shared/tasks-settings";
import { resetTasksEnabled } from "../../client/tasks/board/enabled";
import { APP_SETTINGS_KEY, resetHostAppearanceForTests, setNativeSettingsReaderForTests, triggerHostAppearanceCheck } from "../../client/ui/tokens/host-appearance-shim";

// The board is opt-in; these tests draw it turned on (tasks-board-enabled.test.ts covers off).
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: true };
import { resetEnhancerPreferences } from "../../client/preferences";

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
      const pill = renderer!.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "pill-model")[0]!;
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
    // "ring" matches the parent and its running child; hiding subtasks keeps active children.
    expect(cards().map((card) => card.props.card.id)).toEqual(["sample-running", "sample-child-1"]);
    expect(lastBoardParams("host-1")).toMatchObject({ query: "ring", hideSubtasks: true });
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

  it("draws the archived lane after done only when the setting turns it on", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    expect(hostsById("lane-done")).toHaveLength(1);
    expect(hostsById("lane-archived")).toHaveLength(0);
    expect(hostsById("sidebar-stat-archived")).toHaveLength(0);
    host.settings = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } };
    act(() => renderer!.update(screen(false)));
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
    // The switch's mark: a solid block in the frame while the sidebar shows, a thin bar once it hides.
    const bar = () => StyleSheet.flatten(renderer!.root.findByProps({ testID: "panel-mark" }).findAll((node) => (node.type as unknown) === "View")[1]!.props.style);
    expect(bar()).toMatchObject({ width: 4, height: 6.5 });
    // The switch hides it, and the lanes take the whole board.
    act(() => renderer!.root.findByProps({ testID: "sidebar-switch" }).props.onPress());
    expect(hostsById("sidebar-inline")).toHaveLength(0);
    expect(lanesScroll().props.contentContainerStyle).toMatchObject({ width: 2000 });
    expect(readSidebarPreference().open).toBe(false);
    expect(bar()).toMatchObject({ width: 1.5, height: 5.5 });
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

  it("hides the jump without navigation", () => {
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(TasksBoardScreen, { theme, host: { id: "host-1", label: "Local" }, layout: { compact: false, platform: "web" }, params: {} }),
      );
    });
    layOut(1600);
    expect(cards()[0]!.props.onOpen).toBeUndefined();
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
    // A single pick's chip draws its filter's icon, not the word, and reads the word out.
    expect(text).toContain("Labels · 1Open tabs onlyHide subtasksapi");
    const kind = filters.find((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel === "Labels");
    expect(kind.findAll((node) => node.props.name === "Tag")).not.toHaveLength(0);
    // The switch and the done window show themselves: no chip, no hint line.
    expect(text).not.toContain("still show");
    expect(text.match(/Hide subtasks/g)).toHaveLength(1);
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
      renderer = TestRenderer.create(screen(false, { sub: "1", tabs: "1", win: "7d" }));
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

  it("keeps the lanes at their width on a tablet's narrow board and scrolls them, never the phone tabs", () => {
    const tabs = () => hostsById("phone-stat-running");
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    // A tablet with the sidebar open: lanes stay 300, the rest scrolled to.
    layOut(480);
    expect(tabs()).toHaveLength(0);
    // No room for the key hints beside the count and the search.
    expect(textOf(renderer!.root)).not.toContain("HLLane");
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 300 * 4 } });
    // Narrower still (a foldable with the host's sidebar wide): still the desk lanes, still 300.
    layOut(400);
    expect(tabs()).toHaveLength(0);
    expect(cards()[0]!.props.compact).toBe(false);
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: true, contentContainerStyle: { width: 12 * 2 + 8 * 3 + 300 * 4 } });
    layOut(1600);
    expect(tabs()).toHaveLength(0);
    expect(textOf(renderer!.root)).toContain("HLLane");
    expect(lanesScroll().props).toMatchObject({ scrollEnabled: false, contentContainerStyle: { width: 1600 } });
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
    expect(host.save).toHaveBeenCalledWith({ ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, laneWidth: "wide" } }, "1");
  });

  it("goes back to the saved lane width and says so when the save is refused", async () => {
    host.save.mockResolvedValueOnce(false);
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(1600);
    const button = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && String(node.props.accessibilityLabel).startsWith("Lanes · "))[0]!;
    act(() => button().props.onPress());
    const narrow = renderer!.root
      .find((node) => node.props.testID === "lane-width-menu")
      .findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "menuitem")[0]!;
    await act(async () => narrow.props.onPress());
    expect(textOf(button())).toBe("Default");
    expect(host.reload).toHaveBeenCalled();
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
    expect(textOf(toggle())).toBe("Archived");
    expect(toggle().props.accessibilityState).toEqual({ checked: false });
    expect(hostsById("lane-archived")).toHaveLength(0);
    // In the bar's end, after the done window and before the sort.
    const end = renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-bar-end");
    expect(textOf(end).indexOf("Archived")).toBeGreaterThan(textOf(end).indexOf("7 days"));
    expect(textOf(end).indexOf("Archived")).toBeLessThan(textOf(end).indexOf("Sort"));
    await act(async () => toggle().props.onPress());
    layOut(2400);
    // Drawn at once, before the record catches up.
    expect(toggle().props.accessibilityState).toEqual({ checked: true });
    expect(hostsById("lane-archived")).toHaveLength(1);
    expect(host.save).toHaveBeenCalledWith({ ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } }, "1");
  });

  it("goes back and says so when the save is refused", async () => {
    host.save.mockResolvedValueOnce(false);
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(2400);
    await act(async () => toggle().props.onPress());
    expect(toggle().props.accessibilityState).toEqual({ checked: false });
    expect(hostsById("lane-archived")).toHaveLength(0);
    expect(host.reload).toHaveBeenCalled();
    expect(host.toast).toHaveBeenCalledWith("Couldn't save the archived lane setting");
  });
});

describe("Tasks board, tablet filters", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
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

  it("keeps the archived lane's switch out of a narrow board's sheet, as a round button left of the filters", async () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(600);
    const archived = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "toolbar-archived");
    const buttons = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && (node.props.testID === "toolbar-archived" || node.props.testID === "toolbar-filters"));
    expect(buttons.map((node) => node.props.testID)).toEqual(["toolbar-archived", "toolbar-filters"]);
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
    expect(host.save).toHaveBeenCalledWith({ ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } }, "1");
    act(() => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "toolbar-filters").props.onPress());
    expect(hostsById("filter-sheet-lane-width")).toHaveLength(1);
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-sheet-archived")).toHaveLength(0);
    // A wide board keeps its switch in the filter bar.
    layOut(1600);
    expect(renderer!.root.findAll((node) => node.props.testID === "toolbar-archived")).toHaveLength(0);
  });

  it("folds the two toggles behind a plus, and marks the plus while one is on", () => {
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(800);
    const more = () => renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-bar-more");
    // The archived lane's switch is no filter: it stays in the bar, by the done window.
    const switches = () => renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "switch" && node.props.testID !== "archived-lane-toggle");
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "archived-lane-toggle")).toHaveLength(1);
    expect(textOf(renderer!.root)).toContain("Workspace");
    expect(switches()).toHaveLength(0);
    expect(more().props).toMatchObject({ accessibilityLabel: "More filters", accessibilityState: { expanded: false } });
    act(() => more().props.onPress());
    expect(switches().map((node) => textOf(node))).toEqual(["Open tabs only", "Hide subtasks"]);
    expect(more().props).toMatchObject({ accessibilityLabel: "Fewer filters", accessibilityState: { expanded: true } });
    act(() => switches()[1]!.props.onPress());
    act(() => more().props.onPress());
    expect(switches()).toHaveLength(0);
    expect(textOf(more())).toBe("1");
  });

  it("keeps the toggles in the bar on web", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    act(() => {
      renderer = TestRenderer.create(screen(false));
    });
    layOut(800);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-bar-more")).toHaveLength(0);
    expect(textOf(renderer!.root)).toContain("Hide subtasks");
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
      renderer = TestRenderer.create(screen(true, { agent: "claude,codex", tabs: "1" }));
    });
    const filters = pressable("Filters");
    expect(textOf(filters)).toBe("3");
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Modal")).toHaveLength(0);
    act(() => filters.props.onPress());
    const sheet = renderer!.root.find((node) => (node.type as unknown) === "Modal");
    expect(sheet.props.title).toBe("Filters");
    expect(textOf(sheet)).toContain("Paseo marks open tabs for subagents only");
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
    const labels = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && ["Search", "Show the archived lane", "Filters"].includes(node.props.accessibilityLabel)).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Search", "Show the archived lane", "Filters"]);
    const slashed = () => button().findAll((node) => (node.type as unknown) === "View" && node.props.testID === "slash-mark").length > 0;
    expect(button().props.accessibilityState).toEqual({ selected: false });
    expect(slashed()).toBe(true);
    await act(async () => button().props.onPress());
    expect(button().props.accessibilityState).toEqual({ selected: true });
    expect(slashed()).toBe(false);
    // The filter sheet no longer carries the switch.
    act(() => pressable("Filters").props.onPress());
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-sheet-archived")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "phone-stat-archived")).toHaveLength(1);
    expect(host.save).toHaveBeenCalledWith({ ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true } }, "1");
  });

  it("opens the filter sheet with the sort first from the header's sort pill, and with the switches first from the filters button", () => {
    const order = () => {
      const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      const text = textOf(scroll);
      return { sort: text.indexOf("Sort"), switches: text.indexOf("Open tabs only"), workspace: text.indexOf("Workspace") };
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
    expect(switches().map((node) => textOf(node).startsWith("Open tabs only") || textOf(node).startsWith("Hide subtasks"))).toEqual([true, true]);
    expect(switches().map((node) => node.props.accessibilityState)).toEqual([{ checked: false }, { checked: false }]);
    act(() => switches()[1]!.props.onPress());
    expect(switches()[1]!.props.accessibilityState).toEqual({ checked: true });
    expect(switches().flatMap((node) => node.findAll((child) => (child.type as unknown) === "Icon" && child.props.name === "Check"))).toHaveLength(0);
  });

  it("leads the filter sheet with the short filters, the workspaces last with the idle ones folded, Reset by its button", () => {
    const handle = (data as unknown as { __handle: { workspaces: object[] } }).__handle;
    const saved = handle.workspaces;
    handle.workspaces = [...saved, { id: "wks_idle", name: "idle-branch", projectId: "prj_idle", projectName: "idle-project" }];
    try {
      act(() => {
        renderer = TestRenderer.create(screen(true));
      });
      act(() => pressable("Filters").props.onPress());
      const scroll = renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "filter-sheet-scroll");
      const text = textOf(scroll);
      const at = (label: string) => text.indexOf(label);
      expect(at("Open tabs only")).toBe(0);
      expect(at("Hide subtasks")).toBeLessThan(at("Agent"));
      expect(at("Agent")).toBeLessThan(at("Labels"));
      expect(at("Labels")).toBeLessThan(at("Sort"));
      expect(at("Sort")).toBeLessThan(at("Workspace"));
      // Reset sits by the sheet's button, not on a row of its own over the options.
      expect(scroll.findAll((node) => (node.type as unknown) === "Pressable" && textOf(node) === "Reset")).toHaveLength(0);
      const reset = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-reset");
      const workspaces = () => renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "filter-sheet-workspaces");
      const chips = () => workspaces().findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "checkbox");
      const more = () => workspaces().findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "filter-sheet-more-workspaces");
      const shown = chips().map(textOf);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((chip) => !/0$/.test(chip))).toBe(true);
      expect(more()).toHaveLength(1);
      expect(textOf(more()[0]!)).toMatch(/^\d+ more workspaces? with nothing active$/);
      act(() => more()[0]!.props.onPress());
      expect(chips().length).toBeGreaterThan(shown.length);
      expect(textOf(more()[0]!)).toBe("Show fewer");
      // A picked idle workspace counts as busy: nothing is left to fold. Reset folds it again.
      const idle = chips().find((chip) => /0$/.test(textOf(chip)))!;
      act(() => idle.props.onPress());
      expect(more()).toHaveLength(0);
      expect(chips().map(textOf)).toContain("idle-branch0");
      act(() => reset.props.onPress());
      act(() => more()[0]!.props.onPress());
      expect(chips().map(textOf)).toEqual(shown);
    } finally {
      handle.workspaces = saved;
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
