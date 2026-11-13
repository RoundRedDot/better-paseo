/**
 * The whole board with two Paseo hosts: Open on another host's card opens
 * that agent on its own host, as Paseo's sidebar does; this host's card
 * opens as it always has.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LANE_ORDER } from "../../client/tasks/model";
import { REMOTE_RETRY_MS } from "../../client/tasks/data/hosts";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };
  return { ...rn, AppState, findNodeHandle: () => null, default: { ...rn.default, AppState } };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  const React = await import("react");
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  function FlatList(props: Props) {
    const data = (props.data as unknown[]) ?? [];
    const render = props.renderItem as (info: { item: unknown; index: number }) => React.ReactNode;
    const key = props.keyExtractor as (item: unknown, index: number) => string;
    return React.createElement("FlatList", { testID: props.testID }, data.map((item, index) => React.createElement(React.Fragment, { key: key(item, index) }, render({ item, index }))));
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
    copyText: async () => {},
  };
});
const fixture = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null }));
const remoteStore = vi.hoisted(() => {
  const store = {
    healthy: null as unknown,
    snapshot: null as unknown,
    listeners: new Set<() => void>(),
    set(next: unknown) {
      store.snapshot = next;
      for (const listener of [...store.listeners]) listener();
    },
  };
  return store;
});
const apis = vi.hoisted(() => {
  const timeline = {
    refetch: () => Promise.resolve({ error: null, entries: [], epoch: "test", endCursor: null, window: { nextSeq: 0 } }),
    subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
  };
  return {
    own: { agents: { ref: () => ({ timeline }) } },
    remote: { agents: { ref: () => ({ timeline }) } },
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => apis.own,
  useRpc: (contract: { name: string }) => (input: { agentIds?: string[] }) =>
    Promise.resolve(contract.name === "tasks.availability" ? { entries: (input.agentIds ?? []).map((agentId) => ({ agentId, availability: { issue: null, blocked: {} } })) } : { stop: false }),
  useSettings: (definition: { id: string }) =>
    definition.id === "title-generation" || !fixture.settings ? { status: "loading" } : { status: "ready", values: fixture.settings, revision: "1", saving: false, saveError: null, save: async () => true, reload: async () => {} },
  useHosts: () => HOSTS,
  getPaseoClient: (serverId: string) => {
    if (serverId !== "srv-remote") throw new Error("not online");
    return apis.remote;
  },
}));
const HOSTS = [
  { serverId: "srv-own", label: "This Mac", status: "online" },
  { serverId: "srv-remote", label: "remote-box", status: "online" },
];
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const React = await import("react");
  return { SidebarRow: (props: Record<string, unknown>) => React.createElement("SidebarRow", { label: props.label }) };
});
// Each host's store is stood in for by a fixed handle: the board's own through `useTasks`, the other's through the remote store calls.
vi.mock("../../client/tasks/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/tasks/data")>();
  const { sampleCards } = await import("../../client/tasks/sample-cards");
  const { LANE_ORDER } = await import("../../client/tasks/model");
  const sample = sampleCards(Date.parse("2026-10-20T12:00:00Z")).find((card) => card.id === "sample-done")!;
  const handleOf = (id: string) => {
    const card = { ...sample, id, title: id, children: [], parent: null };
    const lanes = Object.fromEntries(LANE_ORDER.map((lane) => [lane, { id: lane, cards: card.lane === lane ? [card] : [], hasMore: false, loading: false }]));
    return {
      lanes,
      counts: { needsInput: 0, running: 0, review: 0, done: 1, archived: 0 },
      byId: new Map([[id, card]]),
      workspaces: [],
      providers: [],
      labels: [],
      ready: true,
      error: null,
      refresh: async () => "done" as const,
      loadMoreDone() {},
      resolveParent() {},
      refreshParent: async () => false,
      requestProjectIcon() {},
    };
  };
  const own = handleOf("local-task");
  const remote = handleOf("remote-task");
  // The other host's store as the test sets it: `remoteStore.set` swaps its snapshot and tells the board.
  remoteStore.healthy = remote;
  remoteStore.snapshot = remote;
  return {
    ...actual,
    useTasks: () => own,
    useTaskCounts: () => ({ ...own.counts, ready: true }),
    subscribeRemoteTasks: (_api: unknown, listener: () => void) => {
      remoteStore.listeners.add(listener);
      return () => remoteStore.listeners.delete(listener);
    },
    remoteTasksSnapshot: () => remoteStore.snapshot,
    setRemoteArchivedLane() {},
  };
});

import { TasksBoardScreen } from "../../client/tasks/board/board-screen";
import { resetTasksEnabled } from "../../client/tasks/board/enabled";
import { resetBoardSessions } from "../../client/tasks/board/params";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
fixture.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: false } };

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
};

let renderer: TestRenderer.ReactTestRenderer | undefined;
const openAgent = vi.fn();
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetBoardSessions();
  resetTasksEnabled();
  openAgent.mockClear();
  remoteStore.snapshot = remoteStore.healthy;
  vi.useRealTimers();
});

/** Lays every View out at a desktop width, again while that mounts Views that wait for one. */
function layOut(width: number) {
  const seen = new Set<unknown>();
  for (let pass = 0; pass < 4; pass++) {
    const views = renderer!.root.findAll((node) => (node.type as unknown) === "View" && typeof node.props.onLayout === "function" && !seen.has(node.props.onLayout));
    if (views.length === 0) return;
    act(() => {
      for (const view of views) {
        seen.add(view.props.onLayout);
        view.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 900 } } });
      }
    });
  }
}

const cardFor = (id: string): ReactTestInstance => renderer!.root.find((node) => typeof node.type !== "string" && node.props.card?.id === id && typeof node.props.onOpen === "function");

describe("a board with two hosts", () => {
  it("opens another host's agent on that host, and this host's as before", async () => {
    await act(async () => {
      renderer = TestRenderer.create(
        <TasksBoardScreen
          theme={theme as never}
          host={{ id: "srv-own", label: "This Mac" }}
          layout={{ compact: false, platform: "web" } as never}
          navigation={{ openAgent, openWorkspace: vi.fn() } as never}
          params={{}}
        />,
      );
    });
    layOut(1600);
    await act(async () => {});
    const remote = cardFor("remote-task");
    expect(remote.props.card.host).toEqual({ id: "srv-remote", label: "remote-box", remote: true });
    act(() => remote.props.onOpen("remote-task"));
    expect(openAgent).toHaveBeenCalledWith({ agentId: "remote-task", serverId: "srv-remote" });
    openAgent.mockClear();
    act(() => cardFor("local-task").props.onOpen("local-task"));
    expect(openAgent).toHaveBeenCalledWith({ agentId: "local-task" });
  });

  it("says when an online host's tasks could not be read, and clears it once a retry reads them", async () => {
    vi.useFakeTimers();
    type Handle = { lanes: Record<string, { cards: unknown[] }>; error: string | null; refresh: () => Promise<string> };
    const healthy = remoteStore.healthy as Handle;
    // The host stays online throughout (`HOSTS`): only its task read fails, then works again.
    const refresh = vi.fn(async () => {
      remoteStore.set(healthy);
      return "done";
    });
    const empty = Object.fromEntries(LANE_ORDER.map((lane) => [lane, { ...healthy.lanes[lane], cards: [] }]));
    remoteStore.snapshot = { ...healthy, lanes: empty, byId: new Map(), error: "remote list failed", refresh };
    await act(async () => {
      renderer = TestRenderer.create(
        <TasksBoardScreen
          theme={theme as never}
          host={{ id: "srv-own", label: "This Mac" }}
          layout={{ compact: false, platform: "web" } as never}
          navigation={{ openAgent, openWorkspace: vi.fn() } as never}
          params={{}}
        />,
      );
    });
    layOut(1600);
    await act(async () => {});
    const notice = () => renderer!.root.findAll((node) => node.props.testID === "host-notice" && typeof node.type === "string");
    const noticeText = () => notice().flatMap((node) => node.findAll((child) => (child.type as unknown) === "Text")).map((child) => child.props.children).join("");
    expect(noticeText()).toBe("Couldn't load tasks from remote-box; some may be missing. Retrying.");
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === "CircleAlert").length).toBeGreaterThan(0);
    expect(renderer!.root.findAll((node) => typeof node.type !== "string" && node.props.card?.id === "remote-task")).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REMOTE_RETRY_MS);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(notice()).toHaveLength(0);
    expect(cardFor("remote-task").props.card.host).toEqual({ id: "srv-remote", label: "remote-box", remote: true });
  });
});
