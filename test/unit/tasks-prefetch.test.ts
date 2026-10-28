import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { createFakePaseo, makeAgent, makePlacement, makeWorkspace } from "./helpers/fake-paseo";

// The board warms on intent (pointer, focus, touch on the sidebar entry) and
// stays warm a while after it closes. Real data layer against the fake
// PaseoApi, so every request and open subscription is counted.

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
  useRpc: (contract: { name: string }) => (input: { agentIds?: string[] }) => Promise.resolve(contract.name === "tasks.availability" ? { entries: input.agentIds!.map((agentId) => ({ agentId, availability: { issue: null, blocked: {} } })) } : { stop: false }),
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
import { resetTasksEnabled, setTasksEnabled } from "../../client/tasks/board/enabled";
import { BOARD_LINGER_MS, HOVER_INTENT_MS, INTENT_GRACE_MS, resetBoardPrefetch, warmBoard } from "../../client/tasks/board/prefetch";
import { resetBoardSessions } from "../../client/tasks/board/params";
import { contributeTasks } from "../../client/tasks/contribute";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS } from "../../shared/tasks-settings";
// These tests start from the board and the archived lane both off; the stock settings turn both on.
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: false, board: { ...STOCK_SETTINGS.board, showArchived: false } };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7",
    foreground: "#09090b", foregroundMuted: "#71717a", accent: "#2563eb", accentForeground: "#ffffff",
    statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
  },
} as never;
const hostProps = { theme, host: { id: "host-1", label: "Local" }, layout: { compact: false, platform: "web" as const } };
/** The status and attention lists and the workspaces the sidebar's default counts keep: the only ones with the board closed. */
const COUNTS_ONLY = 3;
/** Status, attention and done agent lists, workspaces, projects. */
const BOARD_OPEN = 5;

let fake: ReturnType<typeof createFakePaseo>;
let sidebarRenderer: ReturnType<typeof TestRenderer.create> | undefined;
let boardRenderer: ReturnType<typeof TestRenderer.create> | undefined;

function setOS(os: string) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
}

/** The board's text, run together: the total's number and its unit are two texts on web. */
function boardText(): string {
  const strings: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") strings.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") walk((node as { children?: unknown }).children ?? null);
  };
  walk(boardRenderer!.toJSON());
  return strings.join("");
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await settle();
}

async function mountSidebar() {
  await act(async () => {
    sidebarRenderer = TestRenderer.create(
      React.createElement(TasksSidebarEntry, { ...hostProps, currentScreen: null, openScreen: vi.fn(), openPopover: vi.fn() }),
    );
  });
  await settle();
}

/** The entry's wrapper: the one view that carries the intent handlers. */
function entry(): ReactTestInstance {
  return sidebarRenderer!.root.find((node) => (node.type as unknown) === "View" && (typeof node.props.onPointerEnter === "function" || typeof node.props.onTouchStart === "function"));
}

async function fire(handler: string) {
  await act(async () => entry().props[handler]());
  await settle();
}

/** The pointer enters the entry and stays long enough to count as intent. */
async function hover() {
  await fire("onPointerEnter");
  await advance(HOVER_INTENT_MS);
}

async function openBoard() {
  await act(async () => {
    boardRenderer = TestRenderer.create(React.createElement(TasksBoardScreen, { ...hostProps, params: {} }));
  });
  await settle();
}

async function closeBoard() {
  await act(async () => boardRenderer?.unmount());
  boardRenderer = undefined;
  await settle();
}

/** The methods called since `from`. */
function boardCalls(from = 0) {
  return fake.calls.slice(from).map((call) => call.method);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  setOS("web");
  const agent = makeAgent({ id: "a1", status: "running", workspaceId: "wks_1" });
  const unread = makeAgent({ id: "a2", status: "idle", requiresAttention: true, attentionReason: "finished", workspaceId: "wks_1" });
  fake = createFakePaseo({
    workspaces: [makeWorkspace({ id: "wks_1" })],
    agents: [agent, unread],
    placements: { a1: makePlacement(agent), a2: makePlacement(unread) },
  });
  host.paseo = fake.paseo;
  host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true };
});

afterEach(async () => {
  await act(async () => {
    boardRenderer?.unmount();
    sidebarRenderer?.unmount();
  });
  boardRenderer = undefined;
  sidebarRenderer = undefined;
  resetBoardPrefetch();
  resetBoardSessions();
  resetTasksEnabled();
  vi.useRealTimers();
  setOS("ios");
});

describe("Tasks board prefetch", () => {
  it("opens nothing beyond the counts until the user shows intent", async () => {
    await mountSidebar();
    expect(boardCalls()).toEqual(["agents.list", "agents.list", "workspaces.list"]);
    await advance(60_000);
    expect(boardCalls()).toEqual(["agents.list", "agents.list", "workspaces.list"]);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
  });

  it("hover opens the board's subscriptions once, however often it repeats", async () => {
    await mountSidebar();
    const before = fake.calls.length;
    await hover();
    // The done list, projects, the model names; the counts already hold the workspaces.
    expect(boardCalls(before).sort()).toEqual(["agents.list", "projects.list", "providers.listModels"]);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    const warmed = fake.calls.length;
    await fire("onPointerLeave");
    await hover();
    await fire("onFocus");
    await hover();
    expect(fake.calls.length).toBe(warmed);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
  });

  it("leaving without opening releases them after the grace period", async () => {
    await mountSidebar();
    await hover();
    await fire("onPointerLeave");
    await advance(INTENT_GRACE_MS - 1);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await advance(1);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
  });

  it("keeps them while the pointer stays, and a second hover restarts the grace period", async () => {
    await mountSidebar();
    await hover();
    await advance(INTENT_GRACE_MS * 3);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await fire("onPointerLeave");
    await advance(INTENT_GRACE_MS - 1000);
    await hover();
    await fire("onPointerLeave");
    await advance(INTENT_GRACE_MS - 1);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await advance(1);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
  });

  it("a board opened after the hover sends nothing and draws at once", async () => {
    await mountSidebar();
    await hover();
    const warmed = fake.calls.length;
    await act(async () => {
      boardRenderer = TestRenderer.create(React.createElement(TasksBoardScreen, { ...hostProps, params: {} }));
    });
    // Before any answer could arrive: the board is ready on the warm data.
    expect(boardText()).toContain("2 tasks");
    await settle();
    expect(fake.calls.length).toBe(warmed);
    await fire("onPointerLeave");
    // The intent's grace runs out under the open board, which keeps its data.
    await advance(INTENT_GRACE_MS);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    expect(fake.calls.length).toBe(warmed);
  });

  it("keeps the board's data 30 s after it closes, then releases it", async () => {
    await mountSidebar();
    await openBoard();
    await closeBoard();
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await advance(BOARD_LINGER_MS - 1);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await advance(1);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
  });

  it("a board reopened within the grace period sends nothing", async () => {
    await mountSidebar();
    await openBoard();
    await closeBoard();
    await advance(BOARD_LINGER_MS - 1000);
    const closed = fake.calls.length;
    await openBoard();
    expect(fake.calls.length).toBe(closed);
    expect(boardText()).toContain("2 tasks");
    // Its own close starts a fresh grace period.
    await closeBoard();
    await advance(BOARD_LINGER_MS - 1);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await advance(1);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
  });

  it("warms without counts too, and closes everything once the grace runs out", async () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true, sidebar: { count: "none" } };
    await mountSidebar();
    expect(fake.calls).toEqual([]);
    await hover();
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await fire("onPointerLeave");
    await advance(INTENT_GRACE_MS);
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("an entry that goes while hovered lets the hold run out", async () => {
    await mountSidebar();
    await hover();
    await act(async () => sidebarRenderer!.unmount());
    sidebarRenderer = undefined;
    // The hold keeps the board's lists, status included, until its grace ends.
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await advance(INTENT_GRACE_MS);
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("a pointer that passes over the entry sends nothing and leaves nothing to release", async () => {
    await mountSidebar();
    const before = fake.calls.length;
    await fire("onPointerEnter");
    await advance(HOVER_INTENT_MS - 30);
    await fire("onPointerLeave");
    await advance(INTENT_GRACE_MS * 2);
    expect(fake.calls.length).toBe(before);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
    // The cancelled wait does not fire later, nor shorten the next one.
    await fire("onPointerEnter");
    await advance(HOVER_INTENT_MS - 1);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
    await advance(1);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
  });

  it("warms once the pointer has stayed 80 ms", async () => {
    expect(HOVER_INTENT_MS).toBe(80);
    await mountSidebar();
    const before = fake.calls.length;
    await fire("onPointerEnter");
    await advance(100);
    expect(boardCalls(before).sort()).toEqual(["agents.list", "projects.list", "providers.listModels"]);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
  });

  it("focus warms at once, without the wait", async () => {
    await mountSidebar();
    await fire("onFocus");
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
    await fire("onBlur");
    await advance(INTENT_GRACE_MS);
    expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
    // Focus while a hover waits takes over; the wait adds nothing.
    await fire("onPointerEnter");
    await fire("onFocus");
    const warmed = fake.calls.length;
    await advance(HOVER_INTENT_MS * 2);
    expect(fake.calls.length).toBe(warmed);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
  });

  it("a click before the wait ends just opens the board, which requests once", async () => {
    await mountSidebar();
    const before = fake.calls.length;
    await fire("onPointerEnter");
    await advance(50);
    expect(fake.calls.length).toBe(before);
    await openBoard();
    await advance(HOVER_INTENT_MS * 2);
    const requests = boardCalls(before).sort();
    expect(requests).toEqual(["agents.list", "projects.list", "providers.listModels"]);
    expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
  });

  it("an entry that goes during the wait never warms", async () => {
    await mountSidebar();
    const before = fake.calls.length;
    await fire("onPointerEnter");
    await act(async () => sidebarRenderer!.unmount());
    sidebarRenderer = undefined;
    await advance(HOVER_INTENT_MS * 2);
    expect(fake.calls.length).toBe(before);
  });

  it("warms on a touch on iOS and Android", async () => {
    for (const os of ["ios", "android"]) {
      setOS(os);
      await mountSidebar();
      expect(entry().props.onPointerEnter).toBeUndefined();
      await fire("onTouchStart");
      expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
      await fire("onTouchEnd");
      await advance(INTENT_GRACE_MS);
      expect(fake.openSubscriptions()).toBe(COUNTS_ONLY);
      await act(async () => sidebarRenderer!.unmount());
      sidebarRenderer = undefined;
    }
  });

  it("does nothing while the board is off", async () => {
    await mountSidebar();
    await act(async () => setTasksEnabled(false));
    const before = fake.calls.length;
    await act(async () => warmBoard(fake.paseo));
    await settle();
    expect(fake.calls.length).toBe(before);
    resetTasksEnabled();
    await act(async () => warmBoard(fake.paseo));
    await settle();
    expect(fake.calls.length).toBe(before);
  });

  it("turning the board off drops the warm data at once", async () => {
    const commands: { onSelect(context: unknown): void }[] = [];
    const cleanup = contributeTasks({
      addScreen: () => () => {},
      addSidebarHeaderItem: () => () => {},
      addSettingsScreen: () => () => {},
      addCommandCenterItem: (item: { onSelect(context: unknown): void }) => (commands.push(item), () => {}),
      openSettings: vi.fn(),
      rpc: () => Promise.resolve({ status: "ready", revision: "1", values: { enabled: true } }),
    } as never);
    try {
      await settle();
      host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true, sidebar: { count: "none" } };
      await mountSidebar();
      await openBoard();
      await closeBoard();
      expect(fake.openSubscriptions()).toBe(BOARD_OPEN);
      await act(async () => setTasksEnabled(false));
      expect(fake.openSubscriptions()).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("the Command Center item sends the board's requests before the screen mounts", async () => {
    const commands: { onSelect(context: { openScreen: () => void }): void }[] = [];
    const cleanup = contributeTasks({
      addScreen: () => () => {},
      addSidebarHeaderItem: () => () => {},
      addSettingsScreen: () => () => {},
      addCommandCenterItem: (item: { onSelect(context: { openScreen: () => void }): void }) => (commands.push(item), () => {}),
      openSettings: vi.fn(),
      rpc: () => Promise.resolve({ status: "ready", revision: "1", values: { enabled: true } }),
    } as never);
    try {
      await settle();
      await mountSidebar();
      const before = fake.calls.length;
      const openScreen = vi.fn(() => {
        expect(boardCalls(before)).toContain("projects.list");
      });
      await act(async () => commands[0]!.onSelect({ openScreen }));
      expect(openScreen).toHaveBeenCalledTimes(1);
      await settle();
      const warmed = fake.calls.length;
      await openBoard();
      expect(fake.calls.length).toBe(warmed);
    } finally {
      cleanup();
    }
  });
});
