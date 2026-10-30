import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Icon: (props: object) => React.createElement("Icon", props),
    Modal: Object.assign(() => null, { Content: () => null }),
    FlatList: (props: Record<string, unknown>) => React.createElement("FlatList", props, props.ListEmptyComponent as React.ReactNode, props.ListFooterComponent as React.ReactNode),
  };
});
// Keep the real lanes, loading UI and data store; unrelated board chrome is outside this regression.
vi.mock("../../client/tasks/board/filter-bar", async (importOriginal) => ({ ...await importOriginal<object>(), DesktopToolbar: () => null, DesktopFilterBar: () => null }));
vi.mock("../../client/tasks/board/details-sidebar", () => ({ DetailsSidebar: () => null }));
vi.mock("../../client/tasks/cards/card-hints", () => ({ BoardTips: () => null, tipProps: () => ({}) }));

import { Animated } from "react-native";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { DesktopBoard } from "../../client/tasks/board/desktop-board";
import { LanePager } from "../../client/tasks/board/phone-board";
import { LoadMoreRow } from "../../client/tasks/board/board-parts";
import { EMPTY_PARAMS, resetBoardSessions } from "../../client/tasks/board/params";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { keepSameLanes, type BoardController } from "../../client/tasks/board/use-board";
import { filterLanes, useTasks, type TasksHandle, type TasksOptions } from "../../client/tasks/data";
import { EMPTY_FILTERS, LANE_ORDER, type LaneId, type LaneModel } from "../../client/tasks/model";
import { createFakePaseo, makeAgent } from "./helpers/fake-paseo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = { colors: { surface0: "#fff", surface1: "#fafafa", surface2: "#eee", border: "#ddd", foreground: "#111", foregroundMuted: "#777", accent: "#36f" } } as never;
const noop = () => {};
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  resetBoardSessions();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

function boardFor(tasks: TasksHandle, query: string): BoardController {
  const lanes = filterLanes(tasks.lanes, { ...EMPTY_FILTERS, query });
  const board: Partial<BoardController> = {
    hostId: "loading-test", language: "en", strings: BOARD_STRINGS.en,
    settings: DEFAULT_TASKS_SETTINGS, laneWidth: DEFAULT_TASKS_SETTINGS.board.laneWidth,
    laneOrder: LANE_ORDER, params: { ...EMPTY_PARAMS, query },
    defaults: { hideSubtasks: false, doneWindow: "all" },
    tasks, lanes, hidden: Object.fromEntries(LANE_ORDER.map((id) => [id, tasks.lanes[id].cards.length - lanes[id].cards.length])) as Record<LaneId, number>,
    callbacks: { onReveal: noop }, visible: false, highlighted: null,
    cardById: (id: string) => tasks.byId.get(id),
  };
  return board as BoardController;
}

function layoutDesktop() {
  act(() => {
    renderer!.root.findAll((node) => (node.type as unknown) === "View" && typeof node.props.onLayout === "function")
      .forEach((node) => node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 3000, height: 800 } } }));
  });
}

function laneList(id: LaneId, compact: boolean): ReactTestInstance[] {
  const lane = renderer!.root.findByProps({ testID: compact ? `phone-lane-${id}` : `lane-${id}` });
  return lane.findAll((node) => (node.type as unknown) === "FlatList");
}

async function mount(fake: ReturnType<typeof createFakePaseo>, compact: boolean, lane: LaneId, options: TasksOptions, query = "no-matching-task") {
  let current!: TasksHandle;
  let updateOptions!: React.Dispatch<React.SetStateAction<TasksOptions>>;
  function Harness() {
    const [currentOptions, setOptions] = React.useState(options);
    updateOptions = setOptions;
    current = useTasks(fake.paseo, currentOptions);
    const board = boardFor(current, query);
    const rootRef = React.useRef(null);
    const handlers = React.useRef(null);
    const scrollToTop = React.useRef<(() => void) | null>(null);
    return compact
      ? <LanePager lane={lane} board={board} theme={theme} callbacks={{ onReveal: noop }} listRef={rootRef} scrollToTop={scrollToTop} breathing={new Animated.Value(1)} reduced locked={false} onDrag={noop} onSettle={noop} />
      : <DesktopBoard screen={{ theme, host: { id: "loading-test", label: "Local" }, layout: { compact: false, platform: "web" }, params: {} }} board={board} rootRef={rootRef} handlers={handlers} />;
  }
  await act(async () => { renderer = TestRenderer.create(<Harness />); });
  if (!compact) layoutDesktop();
  return { get current() { return current; }, updateOptions: (next: TasksOptions) => updateOptions(next) };
}

describe("history lane loading", () => {
  it.each([false, true])("keeps an empty search result mounted through repeated shared-history pages (compact=%s)", async (compact) => {
    const fake = createFakePaseo({ agents: Array.from({ length: 101 }, (_, index) => makeAgent({ id: `task-${index}`, updatedAt: new Date(Date.now() - index * 1000).toISOString() })) });
    const mounted = await mount(fake, compact, "done", { doneWindow: "all", includeDone: true, includeArchived: true });
    const original = fake.paseo.agents.list.bind(fake.paseo.agents);
    let land!: () => void;
    vi.spyOn(fake.paseo.agents, "list").mockImplementation((options) => new Promise((resolve) => { land = () => { void original(options).then(resolve); }; }));
    const list = laneList("done", compact)[0]!;
    expect(list).toBeDefined();
    expect(list.props.data).toEqual([]);
    expect(list.findByType(LoadMoreRow).props.loading).toBe(false);
    for (let page = 0; page < 2; page++) {
      act(() => list.props.onEndReached());
      expect(mounted.current.lanes.done.loading).toBe(true);
      expect(laneList("done", compact)[0]).toBe(list);
      expect(list.findByType(LoadMoreRow).props.loading).toBe(true);
      // Both lanes share the cursor, including a lane with no archived cards at all.
      expect(laneList("archived", compact)[0]).toBeDefined();
      await act(async () => land());
      expect(laneList("done", compact)[0]).toBe(list);
      expect(mounted.current.lanes.done.loading).toBe(false);
    }
    expect(mounted.current.lanes.done.hasMore).toBe(false);
  });

  it.each(["request", "subscription"])("leaves the first-load skeleton after a failed %s", async (failure) => {
    const fake = createFakePaseo();
    const original = fake.paseo.agents.list.bind(fake.paseo.agents);
    vi.spyOn(fake.paseo.agents, "list").mockImplementation(async (options) => {
      if (!options?.filter?.statuses?.includes("idle")) return original(options);
      if (failure === "request") throw new Error("History unavailable");
      const result = await original(options);
      return { ...result, subscription: { ...result.subscription!, ready: Promise.reject(new Error("History unavailable")) } };
    });
    const mounted = await mount(fake, true, "done", { doneWindow: "all", includeDone: true });
    expect(mounted.current.error).toBe("History unavailable");
    expect(mounted.current.lanes.done).toMatchObject({ initialLoading: false, loading: false });
    expect(laneList("done", true)).toHaveLength(1);
  });

  it("keeps the empty list and Load more action after a page fails", async () => {
    const fake = createFakePaseo({ agents: Array.from({ length: 51 }, (_, index) => makeAgent({ id: `task-${index}` })) });
    const mounted = await mount(fake, true, "done", { doneWindow: "all", includeDone: true });
    vi.spyOn(fake.paseo.agents, "list").mockRejectedValueOnce(new Error("Page unavailable"));
    const list = laneList("done", true)[0]!;
    await act(async () => list.props.onEndReached());
    expect(mounted.current.error).toBe("Page unavailable");
    expect(mounted.current.lanes.done).toMatchObject({ hasMore: true, initialLoading: false, loading: false });
    expect(laneList("done", true)[0]).toBe(list);
    expect(list.findByType(LoadMoreRow).props.loading).toBe(false);
  });

  it.each([false, true])("waits for the first history list even after the active board is ready (compact=%s)", async (compact) => {
    const fake = createFakePaseo();
    const original = fake.paseo.agents.list.bind(fake.paseo.agents);
    let land!: () => void;
    vi.spyOn(fake.paseo.agents, "list").mockImplementation((options) => options?.filter?.statuses?.includes("idle")
      ? new Promise((resolve) => { land = () => { void original(options).then(resolve); }; })
      : original(options));
    const mounted = await mount(fake, compact, "done", { doneWindow: "all", includeDone: true });
    expect(mounted.current.ready).toBe(true);
    expect(laneList("done", compact)).toHaveLength(0);
    await act(async () => land());
    expect(laneList("done", compact)).toHaveLength(1);
  });

  it("waits only in the archived lane when it is enabled, preserving the done list", async () => {
    const fake = createFakePaseo({ agents: [makeAgent({ id: "archived", archivedAt: new Date().toISOString() })] });
    const mounted = await mount(fake, true, "done", { doneWindow: "all", includeDone: true });
    const done = laneList("done", true)[0]!;
    const original = fake.paseo.agents.list.bind(fake.paseo.agents);
    let land!: () => void;
    vi.spyOn(fake.paseo.agents, "list").mockImplementation((options) => new Promise((resolve) => { land = () => { void original(options).then(resolve); }; }));
    act(() => mounted.updateOptions({ doneWindow: "all", includeDone: true, includeArchived: true }));
    expect(mounted.current.lanes.done.initialLoading).toBe(false);
    expect(mounted.current.lanes.archived.initialLoading).toBe(true);
    expect(laneList("done", true)[0]).toBe(done);
    expect(laneList("archived", true)).toHaveLength(0);
    await act(async () => land());
    expect(mounted.current.lanes.archived.initialLoading).toBe(false);
    expect(laneList("archived", true)).toHaveLength(1);
    expect(laneList("done", true)[0]).toBe(done);
  });

  it("invalidates a memoized lane when only its first-load state changes", () => {
    const lanes = {} as Record<LaneId, LaneModel>;
    for (const id of LANE_ORDER) lanes[id] = { id, cards: [], hasMore: false, loading: true, initialLoading: true };
    const next = { ...lanes, done: { ...lanes.done, initialLoading: false } };
    expect(keepSameLanes(lanes, next).done).toBe(next.done);
    expect(keepSameLanes(lanes, next).running).toBe(lanes.running);
  });
});
