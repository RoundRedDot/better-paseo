import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

// When an install fetches the Tasks chunk (`chunk/load.tsx`, `contribute.tsx`):
// the sidebar row and the board being on ask later, after startup; opening the
// board, its settings or the Command Center item asks now. The chunk source is
// faked here, as in an install before the chunk arrives.

vi.mock("react-native", () => import("./helpers/rn-mock"));
const host = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null }));
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => (host.settings ? { status: "ready", values: host.settings, revision: "1", saving: false, saveError: null } : { status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const React = await import("react");
  return {
    SidebarRow: (props: Record<string, unknown>) => React.createElement("SidebarRow", props),
  };
});
const source = vi.hoisted(() => ({
  chunk: null as unknown,
  requestChunk: vi.fn(),
  requestChunkLater: vi.fn(),
  cancelChunkLater: vi.fn(),
  setChunkClient: vi.fn(),
}));
vi.mock("../../client/tasks/chunk/source", () => ({
  chunkNow: () => source.chunk,
  requestChunk: source.requestChunk,
  requestChunkLater: source.requestChunkLater,
  cancelChunkLater: source.cancelChunkLater,
  setChunkClient: source.setChunkClient,
  subscribeChunk: () => () => {},
}));

import { TasksBoardScreen, TasksSettingsPanel, TasksSidebarEntry } from "../../client/tasks/chunk/load";
import { contributeTasks } from "../../client/tasks/contribute";
import { resetTasksEnabled, setTasksEnabled } from "../../client/tasks/board/enabled";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";

const flush = async () => {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
};

const theme = { colors: { surface0: "#fff" } };

function sidebarProps(openScreen = vi.fn()) {
  return {
    host: { id: "host-1" },
    theme,
    currentScreen: null,
    openScreen,
  } as never;
}

function plugin(enabled: boolean) {
  const commands: Array<{ onSelect(context: { openScreen(route: unknown): void }): void }> = [];
  const value = {
    addScreen: () => () => {},
    addSidebarHeaderItem: () => () => {},
    addCommandCenterItem: (item: (typeof commands)[number]) => {
      commands.push(item);
      return () => {};
    },
    openSettings: vi.fn(),
    openScreen: vi.fn(),
    rpc: vi.fn(() => Promise.resolve({ status: "ready", revision: "1", values: { enabled } })),
  };
  return { value, commands };
}

beforeEach(() => {
  source.chunk = null;
  source.requestChunk.mockClear();
  source.requestChunkLater.mockClear();
  source.cancelChunkLater.mockClear();
  host.settings = null;
  resetTasksEnabled();
});

afterEach(() => {
  resetTasksEnabled();
});

describe("Tasks chunk timing, registrations", () => {
  it("asks for the chunk later, not now, when the board turns on at startup", async () => {
    const cleanup = contributeTasks(plugin(true).value as never);
    await flush();
    expect(source.requestChunkLater).toHaveBeenCalledTimes(1);
    expect(source.requestChunk).not.toHaveBeenCalled();
    cleanup();
  });

  it("drops the pending later fetch when the board is turned off", async () => {
    const cleanup = contributeTasks(plugin(true).value as never);
    await flush();
    setTasksEnabled(false);
    expect(source.cancelChunkLater).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("asks now from the Command Center item while the chunk is cold, then opens the board", async () => {
    const registered = plugin(true);
    const cleanup = contributeTasks(registered.value as never);
    await flush();
    const openScreen = vi.fn();
    registered.commands[0]!.onSelect({ openScreen });
    expect(source.requestChunk).toHaveBeenCalledTimes(1);
    expect(openScreen).toHaveBeenCalledWith({ screenId: "tasks", params: expect.any(Object) });
    cleanup();
  });

  it("warms the board from the Command Center item once the chunk is here, without asking again", async () => {
    const prefetchBoardFromCommand = vi.fn();
    source.chunk = { prefetchBoardFromCommand, startTasksData: () => () => {}, releaseBoardPrefetch: () => {} };
    const registered = plugin(true);
    const cleanup = contributeTasks(registered.value as never);
    await flush();
    registered.commands[0]!.onSelect({ openScreen: vi.fn() });
    expect(prefetchBoardFromCommand).toHaveBeenCalledTimes(1);
    expect(source.requestChunk).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("Tasks chunk timing, components", () => {
  it("the board screen and its settings ask now", () => {
    act(() => {
      TestRenderer.create(React.createElement(TasksBoardScreen, { theme } as never));
    });
    expect(source.requestChunk).toHaveBeenCalledTimes(1);
    act(() => {
      TestRenderer.create(React.createElement(TasksSettingsPanel, {} as never));
    });
    expect(source.requestChunk).toHaveBeenCalledTimes(2);
    expect(source.requestChunkLater).not.toHaveBeenCalled();
  });

  it("the sidebar row asks later and draws a plain row meanwhile, while the settings load", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(TasksSidebarEntry, sidebarProps()));
    });
    expect(source.requestChunkLater).toHaveBeenCalledTimes(1);
    expect(source.requestChunk).not.toHaveBeenCalled();
    const row = tree.root.findByType("SidebarRow" as never);
    expect(row.props.label).toBe("Tasks");
    expect(row.props.icon).toBe("SquareKanban");
  });

  it("hides the plain row once the settings say the board is off", () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: false };
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(TasksSidebarEntry, sidebarProps()));
    });
    expect(tree.root.findAllByType("SidebarRow" as never)).toHaveLength(0);
  });

  it("asks now when the plain row is touched, and opens the board with this host's last filters when pressed", () => {
    host.settings = { ...DEFAULT_TASKS_SETTINGS, enabled: true };
    const openScreen = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(TasksSidebarEntry, sidebarProps(openScreen)));
    });
    const row = tree.root.findByType("SidebarRow" as never);
    const wrapper = tree.root.find((node) => typeof node.props.onTouchStart === "function");
    act(() => {
      (wrapper.props.onTouchStart as () => void)();
    });
    expect(source.requestChunk).toHaveBeenCalledTimes(1);
    act(() => {
      (row.props.onPress as () => void)();
    });
    expect(source.requestChunk).toHaveBeenCalledTimes(2);
    expect(openScreen).toHaveBeenCalledWith({ screenId: "tasks", params: expect.any(Object) });
  });

  it("hands the plain row to the chunk's row, which keeps it while the settings load", () => {
    const ChunkRow = vi.fn((props: { placeholder?: React.ReactNode }) => props.placeholder ?? null);
    source.chunk = { TasksSidebarEntry: ChunkRow };
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(React.createElement(TasksSidebarEntry, sidebarProps()));
    });
    expect(ChunkRow).toHaveBeenCalled();
    expect(tree.root.findByType("SidebarRow" as never).props.label).toBe("Tasks");
    expect(source.requestChunkLater).not.toHaveBeenCalled();
  });
});
