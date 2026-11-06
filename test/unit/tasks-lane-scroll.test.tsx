import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const draws = vi.hoisted(() => new Map<unknown, number>());
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Icon: (props: object) => React.createElement("Icon", props),
    Modal: Object.assign(() => null, { Content: () => null }),
    // Inspect the real lane's list contract; this mock does not simulate native scrolling.
    FlatList: (props: Record<string, unknown>) => {
      draws.set(props.data, (draws.get(props.data) ?? 0) + 1);
      return React.createElement("FlatList", props);
    },
  };
});
vi.mock("../../client/tasks/board/filter-bar", async (importOriginal) => ({ ...await importOriginal<object>(), DesktopToolbar: () => null, DesktopFilterBar: () => null }));
vi.mock("../../client/tasks/board/tablet-toolbar", () => ({ TabletToolbar: () => null }));
vi.mock("../../client/tasks/board/details-sidebar", () => ({ DetailsSidebar: () => null }));
vi.mock("../../client/tasks/cards/card-hints", () => ({ BoardTips: () => null, tipProps: () => ({}) }));

import { DesktopBoard } from "../../client/tasks/board/desktop-board";
import { MOTION } from "../../client/tasks/board/board-style";
import { EMPTY_PARAMS, resetBoardSessions } from "../../client/tasks/board/params";
import { resetSidebarPreference } from "../../client/tasks/board/sidebar-model";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import type { BoardController } from "../../client/tasks/board/use-board";
import { resetNewCards } from "../../client/tasks/board/new-cards";
import { filterLanes, useTasks } from "../../client/tasks/data";
import { EMPTY_FILTERS, LANE_ORDER, type LaneId } from "../../client/tasks/model";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { createFakePaseo, makeAgent } from "./helpers/fake-paseo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const theme = { colors: { surface0: "#fff", surface1: "#fafafa", surface2: "#eee", border: "#ddd", foreground: "#111", foregroundMuted: "#777", accent: "#36f" } } as never;
const noop = () => {};
const fillMs = MOTION.slideMs + MOTION.enterDelayMs;
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetBoardSessions();
  resetSidebarPreference();
  draws.clear();
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  resetNewCards();
  vi.useRealTimers();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

async function mount(os: "android" | "ios" | "web" = "android") {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const fake = createFakePaseo({ agents: Array.from({ length: 40 }, (_, index) => makeAgent({ id: `scroll-${index}` })) });
  let toggle!: () => void;
  function Harness() {
    const [hideSubtasks, setHideSubtasks] = React.useState(false);
    toggle = () => setHideSubtasks((current) => !current);
    const tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true, includeArchived: true });
    const lanes = React.useMemo(() => filterLanes(tasks.lanes, { ...EMPTY_FILTERS, hideSubtasks }), [tasks.lanes, hideSubtasks]);
    const board: Partial<BoardController> = {
      hostId: "lane-scroll-test", language: "en", strings: BOARD_STRINGS.en,
      settings: DEFAULT_TASKS_SETTINGS, laneWidth: DEFAULT_TASKS_SETTINGS.board.laneWidth,
      laneOrder: LANE_ORDER, params: { ...EMPTY_PARAMS, hideSubtasks },
      defaults: { hideSubtasks: false, doneWindow: "all" },
      tasks, lanes, hidden: Object.fromEntries(LANE_ORDER.map((id) => [id, 0])) as Record<LaneId, number>,
      callbacks: { onReveal: noop }, visible: false, highlighted: null,
      cardById: (id: string) => tasks.byId.get(id),
    };
    const rootRef = React.useRef(null);
    const handlers = React.useRef(null);
    return <DesktopBoard screen={{ theme, host: { id: "lane-scroll-test", label: "Local" }, layout: { compact: false, platform: os }, params: {} }} board={board as BoardController} rootRef={rootRef} handlers={handlers} />;
  }
  await act(async () => { renderer = TestRenderer.create(<Harness />); });
  act(() => {
    renderer!.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "tasks-board-area")
      .props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 3000, height: 800 } } });
  });
  return { toggle: () => act(toggle), fake };
}

function list(lane: LaneId): ReactTestInstance {
  return renderer!.root.findByProps({ testID: `lane-${lane}` }).find((node) => (node.type as unknown) === "FlatList");
}

describe("tablet lane fill scheduling", () => {
  it.each(["android", "ios"] as const)("restores normal %s list scheduling after the entrance, and bounds each subtask switch", async (os) => {
    const board = await mount(os);
    expect(list("done").props.data).toHaveLength(40);
    expect(list("done").props.updateCellsBatchingPeriod).toBe(fillMs);
    act(() => { vi.advanceTimersByTime(fillMs - 1); });
    expect(list("done").props.updateCellsBatchingPeriod).toBe(fillMs);
    act(() => { vi.advanceTimersByTime(1); });
    expect(list("done").props.updateCellsBatchingPeriod).toBeUndefined();
    board.toggle();
    expect(list("done").props.updateCellsBatchingPeriod).toBe(fillMs);
    act(() => { vi.advanceTimersByTime(fillMs); });
    expect(list("done").props.updateCellsBatchingPeriod).toBeUndefined();
    expect(list("done").props.maxToRenderPerBatch).toBe(4);
    expect(list("done").props.windowSize).toBe(7);
  });

  it("cancels the hold on drag without redrawing other lanes, and leaves continued scrolling alone", async () => {
    const board = await mount();
    const done = list("done");
    const cards = done.props.data;
    const runningData = list("running").props.data;
    const runningDraws = draws.get(runningData);
    act(() => done.props.onScrollBeginDrag());
    expect(list("done")).toBe(done);
    expect(done.props.data).toBe(cards);
    expect(done.props.updateCellsBatchingPeriod).toBeUndefined();
    expect(draws.get(runningData)).toBe(runningDraws);
    expect(done.props.onScroll).toBeUndefined();
    expect(done.props.onScrollBeginDrag).toBeUndefined();
    const doneDraws = draws.get(cards);
    act(() => { vi.advanceTimersByTime(fillMs * 2); });
    expect(draws.get(cards)).toBe(doneDraws);
    // A later explicit switch gets its own brief hold, which a new drag can cancel.
    board.toggle();
    expect(done.props.updateCellsBatchingPeriod).toBe(fillMs);
    act(() => done.props.onScrollBeginDrag());
    expect(done.props.updateCellsBatchingPeriod).toBeUndefined();
  });

  it("never delays web list filling", async () => {
    const board = await mount("web");
    expect(list("done").props.updateCellsBatchingPeriod).toBeUndefined();
    expect(list("done").props.onScrollBeginDrag).toBeUndefined();
    board.toggle();
    expect(list("done").props.updateCellsBatchingPeriod).toBeUndefined();
  });

  it("keeps daemon updates from rearming the delay during normal scrolling", async () => {
    const board = await mount();
    act(() => list("done").props.onScrollBeginDrag());
    await act(async () => board.fake.upsertAgent(makeAgent({ id: "scroll-0", title: "Updated while scrolling", updatedAt: new Date(Date.now() + 1000).toISOString() })));
    expect(list("done").props.data.find((card: { id: string }) => card.id === "scroll-0").title).toBe("Updated while scrolling");
    expect(list("done").props.updateCellsBatchingPeriod).toBeUndefined();
  });

  it("restarts the short window for a second switch and cancels the first timer", async () => {
    const board = await mount();
    act(() => { vi.advanceTimersByTime(fillMs); });
    board.toggle();
    act(() => { vi.advanceTimersByTime(fillMs - 1); });
    board.toggle();
    act(() => { vi.advanceTimersByTime(1); });
    expect(list("done").props.updateCellsBatchingPeriod).toBe(fillMs);
    act(() => { vi.advanceTimersByTime(fillMs - 1); });
    expect(list("done").props.updateCellsBatchingPeriod).toBeUndefined();
  });
});
