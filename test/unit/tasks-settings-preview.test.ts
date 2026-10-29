/**
 * The settings page's preview of the Tasks board: the real cards over the
 * sample agents, sideways-scrolling lanes and phone-only tabs, the
 * density and field switches applied as they change, and nothing of the
 * board's data work: no data layer, no settings read, no RPC, no timer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const spy = vi.hoisted(() => ({ dataLoaded: false, dataCalls: [] as string[], hostCalls: [] as string[], copyText: vi.fn(async (_text: string) => {}), show: vi.fn() }));

vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    ...rn,
    Animated: { ...rn.Animated, loop: () => ({ start() {}, stop() {}, reset() {} }) },
    AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: () => ({ remove() {} }) },
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    copyText: spy.copyText,
    useToast: () => ({ show: spy.show, error: vi.fn() }),
  };
});
// Every host hook a board reader would reach for; the preview calls none.
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => (spy.hostCalls.push("useSettings"), { status: "loading" }),
  useRpc: () => (spy.hostCalls.push("useRpc"), vi.fn()),
  usePaseo: () => (spy.hostCalls.push("usePaseo"), null),
}));
// The board's data layer: loading it at all would be a failure.
vi.mock("../../client/tasks/data", () => {
  spy.dataLoaded = true;
  const record = (name: string) => () => {
    spy.dataCalls.push(name);
    throw new Error(`data layer called: ${name}`);
  };
  return {
    useTasks: record("useTasks"),
    useTaskCounts: record("useTaskCounts"),
    holdTasks: record("holdTasks"),
    hasTasksHold: record("hasTasksHold"),
    releaseTasksHolds: record("releaseTasksHolds"),
    filterLanes: record("filterLanes"),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS, applyDensity, setCardSetting } from "../../shared/tasks-settings";
// These tests start from the board and the archived lane both off; the stock settings turn both on.
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: false, board: { ...STOCK_SETTINGS.board, showArchived: false } };
import { TasksBoardPreview, previewLanes } from "../../client/tasks/settings/board-preview";
import { StyleSheet } from "react-native";
import { TasksTypography } from "../../client/tasks/typography";
import { ACTIVE_LANE_ORDER as LANE_ORDER } from "../../client/tasks/model";

const theme = {
  colors: {
    surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", surface3: "#e4e4e7", border: "#e4e4e7",
    foreground: "#09090b", foregroundMuted: "#71717a", accent: "#2563eb", accentForeground: "#ffffff",
    statusSuccess: "#16a34a", statusWarning: "#d97706", statusDanger: "#dc2626",
  },
} as never;

let renderer: ReactTestRenderer | null = null;

function draw(props: Partial<React.ComponentProps<typeof TasksBoardPreview>> = {}, width = 0) {
  const element = React.createElement(TasksBoardPreview, { theme, values: DEFAULT_TASKS_SETTINGS, language: "en", phone: false, ...props });
  act(() => {
    if (renderer) renderer.update(element);
    else renderer = TestRenderer.create(element);
  });
  if (width) {
    const root = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "tasks-board-preview");
    act(() => root.props.onLayout({ nativeEvent: { layout: { width, height: 600 } } }));
  }
  return renderer!;
}

const hosts = (root: ReactTestInstance, test: (node: ReactTestInstance) => boolean) =>
  root.findAll((node) => typeof node.type === "string" && test(node));
const byTestID = (root: ReactTestInstance, id: string) => hosts(root, (node) => node.props.testID === id);
const cardIds = (root: ReactTestInstance) =>
  hosts(root, (node) => typeof node.props.testID === "string" && node.props.testID.startsWith("task-card-sample-")).map((node) =>
    (node.props.testID as string).slice("task-card-".length),
  );
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map((child) => textOf(child as ReactTestInstance | string)).join("");

beforeEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = null;
  spy.dataCalls = [];
  spy.hostCalls = [];
});

describe("Tasks board preview", () => {
  it("copies sample labels and other copyable pills", async () => {
    spy.copyText.mockClear();
    spy.show.mockClear();
    const r = draw({ values: applyDensity(DEFAULT_TASKS_SETTINGS, "full") }, 1400);
    const label = byTestID(r.root, "pill-label-frontend")[0]!;
    expect(label.props.accessibilityRole).toBe("button");
    await act(async () => label.props.onHoverIn());
    expect(StyleSheet.flatten(label.props.style).backgroundColor).toBe("transparent");
    await act(async () => label.props.onPress());
    expect(spy.copyText).toHaveBeenCalledWith("frontend");
    expect(spy.show).toHaveBeenCalledWith("Copied label name");
    await act(async () => byTestID(r.root, "pill-branch")[0]!.props.onPress());
    expect(spy.copyText).toHaveBeenLastCalledWith("feat/tasks-board");
  });
  it.each(["narrow", "default", "wide"] as const)("keeps %s preview lane widths across archived switches", (laneWidth) => {
    for (const width of [540, 1120, 1300, 1600, 2000]) {
      const off = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, laneWidth } };
      const on = { ...off, board: { ...off.board, showArchived: true } };
      const r = draw({ values: off }, width);
      const widths = () => LANE_ORDER.map((id) => StyleSheet.flatten(byTestID(r.root, `tasks-preview-lane-${id}`)[0]!.props.style).width);
      const before = widths();
      draw({ values: on });
      expect(widths()).toEqual(before);
      expect(StyleSheet.flatten(byTestID(r.root, "tasks-preview-lane-archived")[0]!.props.style).width).toBe(before[0]);
      draw({ values: off });
      expect(widths()).toEqual(before);
      expect(byTestID(r.root, "tasks-preview-lane-archived")).toHaveLength(0);
    }
  });

  it("holds two realistic cards per lane: four brands, a permission, a question, a subtask, a failure, a stop", () => {
    const lanes = previewLanes(Date.now(), "en");
    for (const id of LANE_ORDER) expect(lanes[id]).toHaveLength(2);
    const all = LANE_ORDER.flatMap((id) => lanes[id]);
    expect(new Set(all.map((card) => card.provider))).toEqual(new Set(["claude", "codex", "gemini", "pi"]));
    expect(lanes.needs_input.map((card) => card.permission?.kind)).toEqual(["tool", "question"]);
    expect(lanes.running.some((card) => card.parent !== null)).toBe(true);
    expect(lanes.review.some((card) => card.status === "failed")).toBe(true);
    const stopped = lanes.done.find((card) => card.stoppedManually)!;
    expect(stopped.error).toBe("Stopped manually");
    expect(previewLanes(Date.now(), "zh").done.find((card) => card.stoppedManually)!.error).not.toBe("Stopped manually");
  });

  it("wide, draws the four lanes side by side in the board's order", () => {
    const r = draw({}, 1400);
    expect(byTestID(r.root, "tasks-preview-lanes")).toHaveLength(1);
    const lanes = LANE_ORDER.map((id) => byTestID(r.root, `tasks-preview-lane-${id}`)[0]!);
    expect(lanes.map((lane) => cardIds(lane))).toEqual(LANE_ORDER.map((id) => previewLanes(0, "en")[id].map((card) => card.id)));
    // Brand marks, the permission's buttons and the running card's context ring are all drawn.
    expect(textOf(r.root)).toContain("Allow");
    expect(textOf(r.root)).toContain("Answer");
    expect(hosts(r.root, (node) => node.props.testID === "status-stopped").length).toBeGreaterThan(0);
  });

  it.each([
    [600, "narrow", 244, 1024],
    [600, "default", 284, 1184],
    [600, "wide", 300, 1248],
    [800, "narrow", 260, 1088],
    [800, "default", 300, 1248],
    [800, "wide", 340, 1408],
  ] as const)("tablet preview at %i uses %s lanes (%i pt) and scrolls the whole row", (width, laneWidth, expectedWidth, contentWidth) => {
    const r = draw({ values: { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, laneWidth } } }, width);
    expect(byTestID(r.root, "tasks-preview-tabs")).toHaveLength(0);
    const row = byTestID(r.root, "tasks-preview-lanes")[0]!;
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ width: contentWidth, paddingHorizontal: 12, gap: 8 });
    const scroll = byTestID(r.root, "tasks-preview-lanes-scroll")[0]!;
    expect(scroll.props).toMatchObject({ horizontal: true, nestedScrollEnabled: true });
    for (const id of LANE_ORDER) {
      expect(StyleSheet.flatten(byTestID(r.root, `tasks-preview-lane-${id}`)[0]!.props.style).width).toBe(expectedWidth);
    }
    // Resizing and editing a lane preset never change the chosen device mode.
    draw({ values: DEFAULT_TASKS_SETTINGS }, 1600);
    expect(byTestID(r.root, "tasks-preview-tabs")).toHaveLength(0);
    expect(StyleSheet.flatten(byTestID(r.root, "tasks-preview-lane-running")[0]!.props.style).width).toBe(340);
  });

  it.each([14, 21])("scales the tablet lane headers and real cards at UI base %i", (base) => {
    const sizedTheme = { ...(theme as object), typography: { fontSize: { ui: base } } } as never;
    act(() => {
      renderer = TestRenderer.create(React.createElement(TasksTypography, {
        theme: sizedTheme,
        children: React.createElement(TasksBoardPreview, { theme: sizedTheme, values: DEFAULT_TASKS_SETTINGS, language: "en", phone: false }),
      }));
    });
    const lane = byTestID(renderer!.root, "tasks-preview-lane-needs_input")[0]!;
    const heading = hosts(lane, (node) => (node.type as unknown) === "Text" && textOf(node) === "Waiting")[0]!;
    expect(StyleSheet.flatten(heading.props.style).fontSize).toBe(Math.round(12 * base / 14));
    const title = byTestID(lane, "task-card-title")[0]!;
    expect(StyleSheet.flatten(title.props.style).fontSize).toBe(Math.round(12 * base / 14));
  });

  it("only the phone preview draws one lane under tabs, and a tab switches it", () => {
    const r = draw({ phone: true }, 390);
    expect(byTestID(r.root, "tasks-preview-tabs")).toHaveLength(1);
    expect(cardIds(r.root)).toEqual(["sample-input", "sample-question"]);
    const tabs = hosts(r.root, (node) => node.props.accessibilityRole === "tab");
    expect(tabs).toHaveLength(4);
    act(() => tabs[3]!.props.onPress());
    expect(cardIds(r.root)).toEqual(["sample-done", "sample-stopped"]);
    expect(textOf(r.root)).toContain("Stopped manually");
  });

  it("follows the density preset and each field switch as soon as they change", () => {
    const branchShown = () => textOf(renderer!.root).includes("feat/tasks-board");
    draw({ values: applyDensity(DEFAULT_TASKS_SETTINGS, "full") }, 1400);
    expect(branchShown()).toBe(true);
    draw({ values: setCardSetting(applyDensity(DEFAULT_TASKS_SETTINGS, "full"), "branch", false) });
    expect(branchShown()).toBe(false);
    const minimal = textOf(renderer!.root).length;
    draw({ values: applyDensity(DEFAULT_TASKS_SETTINGS, "full") });
    const full = textOf(renderer!.root).length;
    draw({ values: applyDensity(DEFAULT_TASKS_SETTINGS, "minimal") });
    expect(textOf(renderer!.root).length).toBeLessThan(minimal);
    expect(minimal).toBeLessThan(full);
  });

  it("draws the archived lane after done as soon as its switch turns on, and drops it when it turns off", () => {
    const on = { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, showArchived: true, doneWindow: "7d" as const } };
    const lanes = previewLanes(0, "en");
    expect(lanes.archived.map((card) => card.archived)).toEqual(["agent", "workspace"]);
    const r = draw({}, 1700);
    expect(byTestID(r.root, "tasks-preview-lane-archived")).toHaveLength(0);
    draw({ values: on });
    const ids = hosts(r.root, (node) => typeof node.props.testID === "string" && /^tasks-preview-lane-/.test(node.props.testID)).map((node) => node.props.testID.slice(19));
    expect(ids).toEqual(["needs_input", "running", "review", "done", "archived"]);
    const archived = byTestID(r.root, "tasks-preview-lane-archived")[0]!;
    expect(cardIds(archived)).toEqual(["sample-archived", "sample-archived-workspace"]);
    expect(textOf(archived)).toContain("Archived");
    expect(textOf(archived)).toContain("7 days");
    expect(hosts(archived, (node) => node.props.testID === "status-archived").length).toBeGreaterThan(0);
    // Narrow tablet previews keep all five lanes and scroll instead of switching to phone tabs.
    draw({ values: on }, 800);
    expect(byTestID(r.root, "tasks-preview-tabs")).toHaveLength(0);
    expect(byTestID(r.root, "tasks-preview-lane-archived")).toHaveLength(1);
    const tabs = () => hosts(r.root, (node) => node.props.accessibilityRole === "tab");
    draw({ values: DEFAULT_TASKS_SETTINGS });
    expect(byTestID(r.root, "tasks-preview-lanes")).toHaveLength(1);
    expect(byTestID(r.root, "tasks-preview-lane-archived")).toHaveLength(0);
    // On a phone, turned off while its tab shows: back to the first lane.
    draw({ values: on, phone: true }, 390);
    act(() => tabs()[4]!.props.onPress());
    expect(cardIds(r.root)).toEqual(["sample-archived", "sample-archived-workspace"]);
    draw({ values: DEFAULT_TASKS_SETTINGS, phone: true });
    expect(tabs()).toHaveLength(4);
    expect(cardIds(r.root)).toEqual(["sample-input", "sample-question"]);
  });

  it("shows the done lane's window from the board options", () => {
    const r = draw({ values: { ...DEFAULT_TASKS_SETTINGS, board: { ...DEFAULT_TASKS_SETTINGS.board, doneWindow: "7d" } } }, 1400);
    expect(textOf(byTestID(r.root, "tasks-preview-lane-done")[0]!)).toContain("7 days");
  });

  it("never touches the board's data, the settings or the daemon, and starts no timer", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
    try {
      const r = draw({ values: { ...DEFAULT_TASKS_SETTINGS, enabled: false } }, 1400);
      draw({ values: applyDensity(DEFAULT_TASKS_SETTINGS, "full") });
      const tabs = draw({ phone: true }, 390);
      act(() => hosts(tabs.root, (node) => node.props.accessibilityRole === "tab")[1]!.props.onPress());
      expect(cardIds(r.root).length).toBeGreaterThan(0);
      expect(spy.dataLoaded).toBe(false);
      expect(spy.dataCalls).toEqual([]);
      expect(spy.hostCalls).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
