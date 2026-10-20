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
      data.length ? data.map((item, index) => React.createElement(React.Fragment, { key: key(item, index) }, render({ item, index }))) : empty,
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
  };
});
const host = vi.hoisted(() => ({
  toast: vi.fn(),
  settings: null as Record<string, unknown> | null,
  counts: null as { running: number; needsInput: number; review: number; done: number } | null,
}));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({}),
  useRpc: () => () => Promise.resolve({ stop: false }),
  useSettings: () => (host.settings ? { status: "ready", values: host.settings, revision: "1", saving: false, saveError: null } : { status: "loading" }),
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
    requestProjectIcon: vi.fn(),
  };
  return {
    ...actual,
    __handle: handle,
    useTasks: () => handle,
    useTaskCounts: () => ({ ...(host.counts ?? handle.counts), ready: true }),
  };
});

import { StyleSheet } from "react-native";
import * as data from "../../client/tasks/data";
import { TasksBoardScreen } from "../../client/tasks/board/board-screen";
import { TasksSidebarEntry } from "../../client/tasks/board/sidebar-entry";
import { contributeTasks } from "../../client/tasks/contribute";
import { lastBoardParams, rememberBoardParams, resetBoardSessions, EMPTY_PARAMS } from "../../client/tasks/board/params";
import { TaskCardView, TaskDetails } from "../../client/tasks/cards";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
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

/** The desktop lanes wait for the board's width; this lays every View out at `width`. */
function layOut(width: number) {
  const views = renderer!.root.findAll((node) => (node.type as unknown) === "View" && typeof node.props.onLayout === "function");
  act(() => {
    for (const view of views) view.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } } });
  });
}

function lanesScroll(): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === "ScrollView" && node.props.horizontal === true);
}

function cards(): ReactTestInstance[] {
  return renderer!.root.findAllByType(TaskCardView);
}

function pressable(label: string): ReactTestInstance {
  return renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}

beforeEach(() => {
  host.settings = { ...DEFAULT_TASKS_SETTINGS };
  host.counts = null;
  resetBoardSessions();
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
  resetEnhancerPreferences();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("Tasks board, desktop", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
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
    act(() => pressable("Expand lane: Running").props.onPress());
    expect(cards().map((card) => card.props.card.id)).toContain("sample-running");
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

describe("Tasks board, lane widths", () => {
  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
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
      expect(style(lane)).toMatchObject({ borderRadius: 4 });
      expect(style(lane).borderWidth).toBeUndefined();
      expect(style(lane).boxShadow).toBeUndefined();
    }
    const pill = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState?.expanded === false)[0]!;
    expect(style(pill)).toMatchObject({ height: 28, borderRadius: 6, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth });
  });

  it("draws the phone board on the theme's panel with a hairline under the tabs", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true, {}, { colors: BLUE_DARK }));
    });
    const style = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) as Record<string, unknown>;
    const views = renderer!.root.findAll((node) => (node.type as unknown) === "View");
    expect(views.some((node) => style(node).backgroundColor === "#16203a")).toBe(true);
    // The tab bar is the one row drawn above the lane content (zIndex 5).
    const tabs = views.find((node) => style(node).zIndex === 5)!;
    expect(style(tabs)).toMatchObject({ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BLUE_DARK.border, backgroundColor: BLUE_DARK.surface0 });
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

describe("Tasks board, phone", () => {
  it("opens on needs-input, switches lanes by tab and remembers the pick", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(cards().map((card) => card.props.card.id)).toEqual(["sample-input"]);
    expect(cards()[0]!.props.compact).toBe(true);
    expect(cards()[0]!.props.hostId).toBe("host-1");
    act(() => pressable("Running 2").props.onPress());
    const list = renderer!.root.find((node) => (node.type as unknown) === "FlatList");
    expect(list.findAllByType(TaskCardView).map((card) => card.props.card.id)).toEqual(["sample-running", "sample-child-1"]);
    // The old lane stays on top while it fades out (the mock's animations never finish).
    expect(cards().map((card) => card.props.card.id)).toContain("sample-input");
    act(() => renderer!.unmount());
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    expect(cards().map((card) => card.props.card.id)).toEqual(["sample-running", "sample-child-1"]);
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

  it("opens the details sheet on a card's long press", () => {
    act(() => {
      renderer = TestRenderer.create(screen(true));
    });
    act(() => cards()[0]!.props.onDetails(cards()[0]!.props.card));
    const sheet = renderer!.root.find((node) => (node.type as unknown) === "Modal");
    // The compact details draw the title themselves; the sheet's header says what it is.
    expect(sheet.props.title).toBe("Details");
    expect(sheet.findByType(TaskDetails).props).toMatchObject({ compact: true, language: "en", card: { id: "sample-input" } });
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
    ["running-and-input", "2 running, 1 need input", "21"],
    ["input-only", "1 need input", "1"],
    ["none", null, ""],
  ] as const)("draws the counts for %s", (count, label, text) => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, sidebar: { count } };
    const row = entry(null);
    const counts = row.findAll((node) => node.props.accessibilityLabel !== undefined && (node.type as unknown) === "View");
    expect(counts.map((node) => node.props.accessibilityLabel)).toEqual(label ? [label] : []);
    expect(textOf(row)).toBe(text);
  });

  it("hides a zero count and draws nothing when both are zero", () => {
    host.counts = { running: 0, needsInput: 2, review: 0, done: 0 };
    const row = entry(null);
    expect(textOf(row)).toBe("2");
    expect(row.findAll((node) => (node.type as unknown) === "View" && node.props.accessibilityLabel !== undefined).map((node) => node.props.accessibilityLabel)).toEqual(["2 need input"]);
    expect(row.findAll((node) => node.props.kind === "running")).toHaveLength(0);
    const input = row.findAll((node) => (node.type as unknown) === "Text" && node.props.children === 2)[0]!;
    expect(input.props.style).toMatchObject({ fontWeight: "600" });
    host.counts = { running: 0, needsInput: 0, review: 3, done: 1 };
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
  it("opens the board with the last filters", () => {
    const items: { onSelect(context: unknown): void }[] = [];
    const noop = () => () => {};
    const client = {
      addScreen: noop,
      addSidebarHeaderItem: noop,
      addSettingsScreen: noop,
      addCommandCenterItem: (item: { onSelect(context: unknown): void }) => {
        items.push(item);
        return () => {};
      },
    };
    contributeTasks(client as never);
    rememberBoardParams("host-1", { ...EMPTY_PARAMS, query: "ring" });
    const openScreen = vi.fn();
    items[0]!.onSelect({ context: "global", openScreen });
    expect(openScreen).toHaveBeenCalledWith({ screenId: "tasks", params: { q: "ring" } });
  });
});
