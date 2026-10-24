import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));

import {
  EMPTY_PARAMS,
  activeFilterCount,
  decodeBoardParams,
  encodeBoardParams,
  isEmptyParams,
  lastBoardParams,
  rememberBoardParams,
  rememberLane,
  rememberedLane,
  resetBoardSessions,
  resolveBoardParams,
  type BoardParams,
} from "../../client/tasks/board/params";
import {
  SWIPE,
  boardKeyReducer,
  clampFocus,
  defaultLane,
  laneAfter,
  sidebarCountParts,
  sidebarCountText,
  swallowsTap,
  swipeStep,
  tabUnderline,
  tabsOverflow,
  LANES,
  LANE_SIZES,
  boardIsCompact,
  laneLayout,
  type LaneShape,
} from "../../client/tasks/board/navigation";
import { activeChips, buildFilterOptions, searchWorkspaceGroups, clearedParams, emptyGroupsIcon, groupChips, isChipGroup, projectOptions, shownFilterOptions, toggleProject, type ChipGroup } from "../../client/tasks/board/filter-options";
import { boardPalette, buttonOutline, cubicBezier } from "../../client/tasks/board/board-style";
import { restoredStops, withStopReasons } from "../../client/tasks/board/use-board";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { hostLanguage, resetTasksLanguage, resolveTasksLanguage } from "../../client/tasks/i18n";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { sampleCards } from "../../client/tasks/sample-cards";
import { LANE_ORDER, type LaneId, type LaneModel } from "../../client/tasks/model";
import type { TasksHandle } from "../../client/tasks/data";

const defaults = { hideSubtasks: false, doneWindow: "24h" as const };

afterEach(() => resetBoardSessions());

describe("board params", () => {
  it("round-trips every field, including commas and non-ASCII in list items", () => {
    const params: BoardParams = {
      query: "迁移 脚本",
      workspaceIds: ["wks_1", "wks,2"],
      providers: ["claude", "codex"],
      labels: ["上游 PR", "a/b%c"],
      hideSubtasks: false,
      doneWindow: "7d",
      sort: { key: "branch", direction: "desc" },
    };
    const encoded = encodeBoardParams(params);
    expect(Object.values(encoded).every((value) => typeof value === "string")).toBe(true);
    expect(decodeBoardParams(encoded)).toEqual(params);
    expect(encodeBoardParams(decodeBoardParams(encoded))).toEqual(encoded);
  });

  it("leaves out empty and following values", () => {
    expect(encodeBoardParams(EMPTY_PARAMS)).toEqual({});
    expect(encodeBoardParams({ ...EMPTY_PARAMS, query: "  " })).toEqual({});
    expect(encodeBoardParams({ ...EMPTY_PARAMS, hideSubtasks: true })).toEqual({ sub: "1" });
    expect(isEmptyParams({})).toBe(true);
    expect(isEmptyParams({ other: "x", win: "1y" })).toBe(true);
    expect(isEmptyParams({ q: "x" })).toBe(false);
  });

  it("decodes garbage to empty values without throwing", () => {
    expect(decodeBoardParams(undefined)).toEqual(EMPTY_PARAMS);
    expect(decodeBoardParams({ ws: "%E0%A4%A,ok,,ok", sub: "maybe", win: "1y", tabs: "true" })).toEqual({
      ...EMPTY_PARAMS,
      workspaceIds: ["ok"],
    });
  });

  it("resolves switches that follow the settings", () => {
    expect(resolveBoardParams(EMPTY_PARAMS, { hideSubtasks: true, doneWindow: "all" })).toEqual({
      filters: { query: "", workspaceIds: [], providers: [], labels: [], hideSubtasks: true },
      doneWindow: "all",
    });
    expect(resolveBoardParams({ ...EMPTY_PARAMS, hideSubtasks: false, doneWindow: "7d" }, { hideSubtasks: true, doneWindow: "all" }).doneWindow).toBe("7d");
  });

  it("counts active filters for the phone badge", () => {
    expect(activeFilterCount(EMPTY_PARAMS, defaults)).toBe(0);
    const params: BoardParams = { ...EMPTY_PARAMS, workspaceIds: ["a", "b"], providers: ["claude"], query: "x", doneWindow: "7d" };
    expect(activeFilterCount(params, defaults)).toBe(5);
    expect(activeFilterCount({ ...EMPTY_PARAMS, doneWindow: "24h" }, defaults)).toBe(0);
    expect(activeFilterCount(EMPTY_PARAMS, { ...defaults, hideSubtasks: true })).toBe(1);
  });

  it("keeps the last board state per host for the session", () => {
    expect(lastBoardParams("h1")).toBe(EMPTY_PARAMS);
    const one = { ...EMPTY_PARAMS, query: "one" };
    const two = { ...EMPTY_PARAMS, query: "two" };
    rememberBoardParams("h1", one);
    rememberBoardParams("h2", two);
    expect(lastBoardParams("h1")).toBe(one);
    expect(lastBoardParams()).toBe(two);
    rememberLane("h1", "review");
    expect(rememberedLane("h1")).toBe("review");
    expect(rememberedLane("h2")).toBeNull();
  });

  it("brings each host's board state back after the bundle is evaluated again", async () => {
    rememberBoardParams("h1", { ...EMPTY_PARAMS, query: "ring", providers: ["codex"], sort: { key: "title", direction: "desc" } });
    rememberLane("h1", "review");
    // A reconnect evaluates the bundle again: fresh module state, the same global.
    vi.resetModules();
    const again = await import("../../client/tasks/board/params");
    again.rememberCollapsed("h2", ["done"]);
    vi.resetModules();
    const third = await import("../../client/tasks/board/params");
    expect(again).not.toBe(third);
    expect(third.lastBoardParams("h1")).toEqual({ ...EMPTY_PARAMS, query: "ring", providers: ["codex"], sort: { key: "title", direction: "desc" } });
    expect(third.rememberedLane("h1")).toBe("review");
    expect(third.rememberedCollapsed("h2")).toEqual(["done"]);
    expect(third.lastBoardParams("h3")).toBe(third.EMPTY_PARAMS);
  });

  it("drops what an earlier version carried that no longer decodes", async () => {
    const carry = new Map([["h1", { session: { params: { q: 3 }, lane: "backlog", collapsed: ["done", "nope", 7] } }]]);
    (globalThis as Record<string, unknown>).__betterPaseoTasksCarry = carry;
    vi.resetModules();
    const fresh = await import("../../client/tasks/board/params");
    expect(fresh.lastBoardParams("h1")).toBe(fresh.EMPTY_PARAMS);
    expect(fresh.rememberedLane("h1")).toBeNull();
    expect(fresh.rememberedCollapsed("h1")).toEqual(["done"]);
  });
});

describe("board keyboard", () => {
  const lanes = (counts: Partial<Record<LaneId, number>>, collapsed: LaneId[] = []): LaneShape[] =>
    LANE_ORDER.map((id) => ({ id, count: counts[id] ?? 0, collapsed: collapsed.includes(id) }));

  it("lands on the first card of the first lane with cards", () => {
    expect(boardKeyReducer(null, "j", lanes({ running: 2, done: 1 }))).toEqual({ focus: { lane: "running", index: 0 }, effect: null, handled: true });
    expect(boardKeyReducer(null, "ArrowRight", lanes({}))).toEqual({ focus: null, effect: null, handled: false });
  });

  it("moves within a lane and stops at its ends", () => {
    const shape = lanes({ running: 3 });
    expect(boardKeyReducer({ lane: "running", index: 0 }, "j", shape).focus).toEqual({ lane: "running", index: 1 });
    expect(boardKeyReducer({ lane: "running", index: 2 }, "ArrowDown", shape).focus).toEqual({ lane: "running", index: 2 });
    expect(boardKeyReducer({ lane: "running", index: 1 }, "k", shape).focus).toEqual({ lane: "running", index: 0 });
    expect(boardKeyReducer({ lane: "running", index: 0 }, "ArrowUp", shape).focus).toEqual({ lane: "running", index: 0 });
  });

  it("moves across lanes, skipping empty and collapsed ones, and clamps the row", () => {
    const shape = lanes({ needs_input: 1, running: 4, review: 2, done: 5 }, ["review"]);
    expect(boardKeyReducer({ lane: "running", index: 3 }, "l", shape).focus).toEqual({ lane: "done", index: 3 });
    expect(boardKeyReducer({ lane: "running", index: 3 }, "h", shape).focus).toEqual({ lane: "needs_input", index: 0 });
    expect(boardKeyReducer({ lane: "needs_input", index: 0 }, "ArrowLeft", shape)).toEqual({ focus: { lane: "needs_input", index: 0 }, effect: null, handled: true });
    const gap = lanes({ needs_input: 1, done: 1 });
    expect(boardKeyReducer({ lane: "needs_input", index: 0 }, "ArrowRight", gap).focus).toEqual({ lane: "done", index: 0 });
  });

  it("maps Enter, Escape and slash to effects", () => {
    const shape = lanes({ running: 1 });
    expect(boardKeyReducer({ lane: "running", index: 0 }, "Enter", shape).effect).toBe("open");
    expect(boardKeyReducer(null, "Enter", shape)).toEqual({ focus: null, effect: null, handled: false });
    expect(boardKeyReducer({ lane: "running", index: 0 }, "Escape", shape).effect).toBe("cancel");
    expect(boardKeyReducer(null, "/", shape)).toEqual({ focus: null, effect: "search", handled: true });
    expect(boardKeyReducer(null, "x", shape).handled).toBe(false);
  });

  it("clamps a focus left behind by a shrinking or collapsed lane", () => {
    expect(clampFocus({ lane: "running", index: 4 }, lanes({ running: 2 }))).toEqual({ lane: "running", index: 1 });
    expect(clampFocus({ lane: "running", index: 0 }, lanes({}))).toBeNull();
    expect(clampFocus({ lane: "running", index: 0 }, lanes({ running: 2 }, ["running"]))).toBeNull();
    expect(boardKeyReducer({ lane: "running", index: 9 }, "Enter", lanes({ running: 2 })).focus).toEqual({ lane: "running", index: 1 });
  });
});

describe("phone lanes", () => {
  it("decides a swipe by distance and by angle", () => {
    expect(swipeStep(-SWIPE.distance, 0)).toBe(1);
    expect(swipeStep(SWIPE.distance, 0)).toBe(-1);
    expect(swipeStep(-(SWIPE.distance - 1), 0)).toBe(0);
    expect(swipeStep(-60, 40)).toBe(1);
    expect(swipeStep(-60, 41)).toBe(0);
    expect(swipeStep(0, 200)).toBe(0);
  });

  it("puts the underline under the active tab's label and count, a quarter less 24 until laid out", () => {
    expect(tabUnderline(undefined, 1, 0)).toBeNull();
    expect(tabUnderline(undefined, 1, 400)).toEqual({ center: 150, width: 76, measured: false });
    // The row is centred in the tab; the label sits after the 14 icon and a gap of 4.
    const box = { tab: { x: 100, width: 100 }, row: { x: 10, width: 80 }, label: { x: 18, width: 62 } };
    expect(tabUnderline(box, 1, 400)).toEqual({ center: 159, width: 62, measured: true });
  });

  it("lets the tabs size to content only when one outgrows its quarter", () => {
    expect(tabsOverflow({}, 400)).toBe(false);
    expect(tabsOverflow({ running: { row: { x: 0, width: 100 } } }, 400)).toBe(false);
    expect(tabsOverflow({ running: { row: { x: 0, width: 112 } } }, 400)).toBe(true);
    expect(tabsOverflow({ running: { row: { x: 0, width: 112 } } }, 0)).toBe(false);
  });

  it("does not wrap past either end", () => {
    expect(laneAfter("needs_input", 1)).toBe("running");
    expect(laneAfter("needs_input", -1)).toBeNull();
    expect(laneAfter("done", 1)).toBeNull();
    expect(laneAfter("review", 0)).toBeNull();
  });

  it("swallows taps for 350 ms after a swipe", () => {
    expect(swallowsTap(null, 1000)).toBe(false);
    expect(swallowsTap(1000, 1349)).toBe(true);
    expect(swallowsTap(1000, 1350)).toBe(false);
  });

  it("opens on needs-input when it has cards, else running, unless the session picked one", () => {
    expect(defaultLane(2, null)).toBe("needs_input");
    expect(defaultLane(0, null)).toBe("running");
    expect(defaultLane(2, "done")).toBe("done");
  });
});

describe("sidebar counts", () => {
  const counts = { needsInput: 2, running: 3, review: 4 };
  const input = (count: number) => ({ lane: "needs_input", count });
  const running = (count: number) => ({ lane: "running", count });
  const review = (count: number) => ({ lane: "review", count });
  it.each([
    ["all", counts, [input(2), running(3), review(4)], "2 need input, 3 running, 4 to review", "2 个待输入，3 个运行中，4 个待查看"],
    ["input-only", counts, [input(2)], "2 need input", "2 个待输入"],
    ["none", counts, [], "", ""],
    ["all", { needsInput: 1, running: 0, review: 0 }, [input(1)], "1 need input", "1 个待输入"],
    ["all", { needsInput: 0, running: 4, review: 1 }, [running(4), review(1)], "4 running, 1 to review", "4 个运行中，1 个待查看"],
    ["all", { needsInput: 0, running: 0, review: 5 }, [review(5)], "5 to review", "5 个待查看"],
    ["input-only", { needsInput: 0, running: 4, review: 1 }, [], "", ""],
    ["all", { needsInput: 0, running: 0, review: 0 }, [], "", ""],
  ] as const)("%s with %j", (mode, value, parts, en, zh) => {
    const result = sidebarCountParts(value, mode);
    expect(result).toEqual(parts);
    expect(sidebarCountText(result, "en")).toBe(en);
    expect(sidebarCountText(result, "zh")).toBe(zh);
  });
});

function handle(): TasksHandle {
  const cards = sampleCards(Date.parse("2026-10-20T12:00:00Z"));
  const lanes = Object.fromEntries(
    LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id), hasMore: false, loading: false }]),
  ) as Record<LaneId, LaneModel>;
  return {
    lanes,
    counts: { needsInput: 1, running: 2, review: 2, done: 1, archived: 0 },
    byId: new Map(cards.map((card) => [card.id, card])),
    workspaces: [
      { id: "wks_sample", name: "tasks-board", projectId: "prj_sample", projectName: "better-paseo", projectPath: "/Users/luke/better-paseo" },
      { id: "wks_other", name: "main", projectId: "prj_other", projectName: "paseo" },
    ],
    providers: [
      { id: "claude", label: "Claude" },
      { id: "codex", label: "Codex" },
    ],
    labels: [
      { name: "frontend", color: "#8b5cf6" },
      { name: "docs", color: "#0ea5e9" },
    ],
    ready: true,
    error: null,
    loadMoreDone() {},
    resolveParent() {},
    refreshParent: async () => false,
    refreshReads() {},
    requestProjectIcon() {},
  };
}

describe("filter options", () => {
  it("keeps the workspaces whose name and project name hold every word of a search", () => {
    const item = (id: string, label: string) => ({ id, label, count: 0, on: false });
    const group = (projectId: string, projectName: string, items: ReturnType<typeof item>[]) => ({ projectId, projectName, projectKey: null, projectIcon: null, projectPath: null, items });
    const groups = [group("pay", "payments-svc", [item("a", "main"), item("b", "fix/refund")]), group("web", "web-app", [item("c", "main")])];
    const kept = (query: string) => searchWorkspaceGroups(groups, query).map((g) => `${g.projectId}:${g.items.map((i) => i.id).join(",")}`);
    expect(searchWorkspaceGroups(groups, "  ")).toBe(groups);
    expect(kept("PAYMENTS")).toEqual(["pay:a,b"]);
    expect(kept("main")).toEqual(["pay:a", "web:c"]);
    expect(kept("web main")).toEqual(["web:c"]);
    expect(kept("refund web")).toEqual([]);
  });

  it("groups workspaces by project and counts active cards", () => {
    const options = buildFilterOptions(handle(), { ...EMPTY_PARAMS, providers: ["codex", "gone"] });
    expect(options.workspaceGroups.map((group) => group.projectName)).toEqual(["better-paseo", "paseo"]);
    expect(options.workspaceGroups[0]!.items[0]).toMatchObject({ id: "wks_sample", count: 5, on: false });
    expect(options.workspaceGroups[0]!.projectPath).toBe("/Users/luke/better-paseo");
    expect(options.agents).toEqual([
      { id: "claude", label: "Claude", count: 4, on: false },
      { id: "codex", label: "Codex", count: 1, on: true },
      { id: "gone", label: "gone", count: 0, on: true },
    ]);
    expect(options.labels.find((label) => label.id === "docs")).toMatchObject({ count: 1, color: "#0ea5e9" });
  });

  it("lists the options with no active task only while empty groups show, a picked one always", () => {
    const tasks = {
      ...handle(),
      workspaces: [
        { id: "wks_sample", name: "tasks-board", projectId: "prj_sample", projectName: "better-paseo" },
        { id: "wks_idle", name: "idle", projectId: "prj_sample", projectName: "better-paseo" },
        { id: "wks_quiet", name: "main", projectId: "prj_quiet", projectName: "quiet" },
      ],
      providers: [...handle().providers, { id: "pi", label: "Pi" }],
      labels: [...handle().labels, { name: "unused", color: null }],
    };
    const options = buildFilterOptions(tasks, EMPTY_PARAMS);
    const all = shownFilterOptions(options, true);
    expect(all.workspaceGroups).toBe(options.workspaceGroups);
    expect(all.projects.map((project) => `${project.id}|${project.count}`)).toEqual(["prj_sample|5", "prj_quiet|0"]);
    expect(all.agents.map((agent) => agent.id)).toContain("pi");
    expect(all.labels.map((label) => label.id)).toContain("unused");

    const busy = shownFilterOptions(options, false);
    expect(busy.workspaceGroups.map((group) => `${group.projectId}:${group.items.map((item) => item.id).join(",")}`)).toEqual(["prj_sample:wks_sample"]);
    expect(busy.projects.map((project) => project.id)).toEqual(["prj_sample"]);
    expect(busy.agents.every((agent) => agent.count > 0)).toBe(true);
    expect(busy.labels.map((label) => label.id)).not.toContain("unused");
    // Picking the listed project still picks its workspace that is not listed.
    expect(toggleProject(EMPTY_PARAMS, busy.projects[0]!).workspaceIds).toEqual(["wks_sample", "wks_idle"]);
    // Picked, an empty one stays listed so it can be dropped.
    const picked = shownFilterOptions(buildFilterOptions(tasks, { ...EMPTY_PARAMS, providers: ["pi"], labels: ["unused"], workspaceIds: ["wks_quiet"] }), false);
    expect(picked.agents.map((agent) => agent.id)).toContain("pi");
    expect(picked.labels.map((label) => label.id)).toContain("unused");
    expect(picked.projects.map((project) => project.id)).toEqual(["prj_sample", "prj_quiet"]);
    expect(emptyGroupsIcon(true)).toBe("List");
    expect(emptyGroupsIcon(false)).toBe("ListFilter");
  });

  it("tells same-named workspaces of a project apart by folder, else by id", () => {
    const base = handle();
    const tasks = {
      ...base,
      workspaces: [
        { id: "wks_a00001", name: "fix/refund", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc" },
        { id: "wks_a00002", name: "fix/refund", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc-2" },
        { id: "wks_a00003", name: "fix/refund", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc-2" },
        { id: "wks_a00004", name: "main", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc" },
        { id: "wks_other", name: "fix/refund", projectId: "prj_other", projectName: "paseo", folder: "paseo" },
      ],
    };
    const options = buildFilterOptions(tasks, EMPTY_PARAMS);
    const pay = options.workspaceGroups.find((group) => group.projectId === "prj_pay")!;
    expect(pay.items.map((item) => item.label)).toEqual([
      "fix/refund \u00b7 payments-svc",
      "fix/refund \u00b7 a00002",
      "fix/refund \u00b7 a00003",
      "main",
    ]);
    // The same name in another project is not a clash.
    expect(options.workspaceGroups.find((group) => group.projectId === "prj_other")!.items[0]!.label).toBe("fix/refund");
    expect(new Set(pay.items.map((item) => item.label)).size).toBe(pay.items.length);
  });

  it("folds a project's picked workspaces into one chip", () => {
    const base = handle();
    const tasks = {
      ...base,
      workspaces: [
        { id: "wks_p1", name: "main", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc" },
        { id: "wks_p2", name: "fix/refund", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc-2" },
        { id: "wks_p3", name: "fix/ledger", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc-3" },
        { id: "wks_o1", name: "main", projectId: "prj_web", projectName: "web", folder: "web" },
        { id: "wks_o2", name: "feat/nav", projectId: "prj_web", projectName: "web", folder: "web-2" },
        { id: "wks_o3", name: "feat/footer", projectId: "prj_web", projectName: "web", folder: "web-3" },
        { id: "wks_s1", name: "solo", projectId: "prj_solo", projectName: "solo", folder: "solo" },
      ],
    };
    const params: BoardParams = { ...EMPTY_PARAMS, workspaceIds: ["wks_p1", "wks_o2", "wks_p2", "wks_s1", "wks_p3", "wks_o3", "wks_gone"] };
    const chips = activeChips(params, defaults, buildFilterOptions(tasks, params), BOARD_STRINGS.zh);
    expect(chips.map((chip) => `${chip.kind}|${chip.value}`)).toEqual(["项目|payments-svc", "Workspace|web \u00b7 2", "Workspace|solo", "Workspace|wks_gone"]);
    expect(chips[0]!.clear(params).workspaceIds).toEqual(["wks_o2", "wks_s1", "wks_o3", "wks_gone"]);
    expect(chips[1]!.clear(params).workspaceIds).toEqual(["wks_p1", "wks_p2", "wks_s1", "wks_p3", "wks_gone"]);
    const one = { ...EMPTY_PARAMS, workspaceIds: ["wks_o2"] };
    expect(activeChips(one, defaults, buildFilterOptions(tasks, one), BOARD_STRINGS.zh).map((chip) => chip.value)).toEqual(["web / feat/nav"]);
  });

  it("picks a project as all of its workspaces", () => {
    const tasks = {
      ...handle(),
      workspaces: [
        { id: "wks_p1", name: "main", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc" },
        { id: "wks_p2", name: "fix/refund", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc-2" },
        { id: "wks_w1", name: "main", projectId: "prj_web", projectName: "web", folder: "web" },
      ],
    };
    const some: BoardParams = { ...EMPTY_PARAMS, workspaceIds: ["wks_p2", "wks_gone"] };
    const projects = projectOptions(buildFilterOptions(tasks, some));
    // The workspace nobody knows has no project to pick.
    expect(projects.map((project) => `${project.id}|${project.label}|${project.on}`)).toEqual(["prj_pay|payments-svc|false", "prj_web|web|false"]);
    // A project with only some workspaces picked picks the rest.
    const picked = toggleProject(some, projects[0]!);
    expect(picked.workspaceIds).toEqual(["wks_p2", "wks_gone", "wks_p1"]);
    const again = projectOptions(buildFilterOptions(tasks, picked));
    expect(again[0]!.on).toBe(true);
    expect(activeChips(picked, defaults, buildFilterOptions(tasks, picked), BOARD_STRINGS.zh).map((chip) => `${chip.kind}|${chip.value}`)).toEqual(["项目|payments-svc", "Workspace|wks_gone"]);
    // Picked whole, it drops all its workspaces.
    expect(toggleProject(picked, again[0]!).workspaceIds).toEqual(["wks_gone"]);
  });

  it("folds several chips of one filter into a group where its first chip stood", () => {
    const base = handle();
    const tasks = {
      ...base,
      workspaces: [
        { id: "wks_p1", name: "main", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc" },
        { id: "wks_p2", name: "fix/refund", projectId: "prj_pay", projectName: "payments-svc", folder: "payments-svc-2" },
        { id: "wks_w1", name: "main", projectId: "prj_web", projectName: "web", folder: "web" },
        { id: "wks_w2", name: "feat/nav", projectId: "prj_web", projectName: "web", folder: "web-2" },
        { id: "wks_s1", name: "solo", projectId: "prj_solo", projectName: "solo", folder: "solo" },
      ],
    };
    const params: BoardParams = { ...EMPTY_PARAMS, labels: ["docs", "api"], workspaceIds: ["wks_p1", "wks_p2", "wks_w1", "wks_w2", "wks_s1"], providers: ["claude"], query: "ring" };
    const entries = groupChips(activeChips(params, defaults, buildFilterOptions(tasks, params), BOARD_STRINGS.zh), BOARD_STRINGS.zh);
    expect(entries.map((entry) => (isChipGroup(entry) ? `[${entry.label}]` : `${entry.kind}|${entry.value}`))).toEqual([
      "[已选择 2 个标签]",
      "[已选择 2 个项目和 1 个 Workspace]",
      "Agent|Claude",
      "标题包含|「ring」",
    ]);
    const workspaces = entries[1] as ChipGroup;
    expect(workspaces.clear(params)).toMatchObject({ workspaceIds: [], labels: ["docs", "api"] });
    expect((entries[0] as ChipGroup).clear(params).labels).toEqual([]);
    const en = groupChips(activeChips(params, defaults, buildFilterOptions(tasks, params), BOARD_STRINGS.en), BOARD_STRINGS.en);
    expect((en[1] as ChipGroup).label).toBe("2 projects and 1 workspace selected");
  });

  it("lists applied filters as chips that clear one at a time", () => {
    const params: BoardParams = { ...EMPTY_PARAMS, workspaceIds: ["wks_sample"], labels: ["docs"], query: "ring", doneWindow: "all", hideSubtasks: true };
    const options = buildFilterOptions(handle(), params);
    const chips = activeChips(params, defaults, options, BOARD_STRINGS.zh);
    expect(chips.map((chip) => `${chip.kind}|${chip.value}`)).toEqual([
      "标签|docs",
      "Workspace|better-paseo / tasks-board",
      "|隐藏子任务",
      "标题包含|「ring」",
      "已完成|全部",
    ]);
    expect(chips[0]!.clear(params).labels).toEqual([]);
    expect(chips.find((chip) => chip.key === "win")!.clear(params).doneWindow).toBeNull();
    expect(clearedParams(params)).toEqual(EMPTY_PARAMS);
  });
});

describe("action button outline", () => {
  afterEach(() => {
    delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  });

  it("is a 0.5 pt border on a phone", () => {
    expect(buttonOutline("#f00")).toEqual({ borderWidth: 0.5, borderColor: "#f00" });
    expect(buttonOutline("#f00", { right: null, left: "#0f0" })).toEqual({
      borderTopWidth: 0.5,
      borderTopColor: "#f00",
      borderRightWidth: 0,
      borderBottomWidth: 0.5,
      borderBottomColor: "#f00",
      borderLeftWidth: 0.5,
      borderLeftColor: "#0f0",
    });
  });

  it("is an inset shadow on the web, where Chrome rounds a half-pixel border up to a whole one", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    expect(buttonOutline("#f00")).toEqual({ borderWidth: 0, boxShadow: "inset 0 0 0 0.5px #f00" });
    expect(buttonOutline("#f00", { right: null, left: "#0f0" })).toEqual({
      borderWidth: 0,
      boxShadow: "inset 0 0.5px 0 0 #f00, inset 0 -0.5px 0 0 #f00, inset 0.5px 0 0 0 #0f0",
    });
  });
});

describe("board easing", () => {
  it("is cubic-bezier(.2, 0, 0, 1): pinned ends, monotonic, front-loaded", () => {
    const ease = cubicBezier(0.2, 0, 0, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let previous = 0;
    for (let t = 0.05; t < 1; t += 0.05) {
      const value = ease(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(ease(0.5)).toBeGreaterThan(0.8);
  });
});

describe("stops restored from the server", () => {
  it("keep a known card's marker until it is prompted again", () => {
    const byId = handle().byId;
    const card = (id: string, lastUserMessageAt: string | null) => ({ ...byId.get(id)!, timing: { ...byId.get(id)!.timing, lastUserMessageAt } });
    const cards = new Map([
      ["quiet", card("sample-done", "2026-10-20T09:00:00.000Z")],
      ["prompted", card("sample-unread", "2026-10-20T11:00:00.000Z")],
      ["never", card("sample-failed", null)],
    ]);
    const own = new Set(["mine"]);
    const restored = new Map([
      ["quiet", "2026-10-20T10:00:00.000Z"],
      ["prompted", "2026-10-20T10:00:00.000Z"],
      ["never", "2026-10-20T10:00:00.000Z"],
      ["unknown", "2026-10-20T10:00:00.000Z"],
    ]);
    expect([...restoredStops(own, restored, cards)].sort()).toEqual(["mine", "never", "quiet"]);
    expect(restoredStops(own, new Map(), cards)).toBe(own);
    expect(restoredStops(own, new Map([["unknown", "x"]]), cards)).toBe(own);
  });
});

describe("stopped manually", () => {
  it("says so on a review or done card without its own error, keeping its identity", () => {
    const lanes = handle().lanes;
    const stopped = new Set(["sample-unread", "sample-failed", "sample-running", "sample-done"]);
    const once = withStopReasons(lanes, stopped, "已手动停止");
    const unread = once.review.cards.find((card) => card.id === "sample-unread")!;
    expect(unread.error).toBe("已手动停止");
    expect(unread.stoppedManually).toBe(true);
    expect(once.review.cards.find((card) => card.id === "sample-failed")!.stoppedManually).toBeUndefined();
    expect(once.review.cards.find((card) => card.id === "sample-failed")!.error).toBe("Provider exited with code 1: rate limit reached");
    expect(once.running).toBe(lanes.running);
    // The daemon idles a stopped agent without asking for attention: it lands in done.
    const done = once.done.cards.find((card) => card.id === "sample-done")!;
    expect(done.error).toBe("已手动停止");
    expect(withStopReasons(lanes, stopped, "已手动停止").done.cards[0]).toBe(done);
    expect(withStopReasons(lanes, new Set(["sample-running"]), "x")).toBe(lanes);
    expect(withStopReasons(lanes, stopped, "已手动停止").review.cards.find((card) => card.id === "sample-unread")).toBe(unread);
    expect(withStopReasons(lanes, new Set(), "x")).toBe(lanes);
  });
});

describe("lane widths", () => {
  const fixed = (lanes: number, collapsed: number) => 2 * LANES.edge + (lanes - 1) * LANES.gap + collapsed * LANES.collapsed;

  it("shares a window among four lanes with no scrolling, up to the maximum", () => {
    const layout = laneLayout(1300, 4, 0);
    expect(layout.scroll).toBe(false);
    expect(layout.contentWidth).toBe(1300);
    expect(layout.laneWidth).toBeCloseTo((1300 - fixed(4, 0)) / 4);
    expect(layout.laneWidth * 4 + fixed(4, 0)).toBeCloseTo(1300);
  });

  it("caps a lane at Linear's card width and leaves the rest of a wide window empty", () => {
    // On web the card is the lane less 8 + 4 of padding and the 6 scrollbar gutter.
    expect(LANES.max - 8 - 4 - 6).toBe(322);
    expect(laneLayout(2000, 4, 0)).toEqual({ laneWidth: LANES.max, contentWidth: 2000, scroll: false });
    expect(laneLayout(fixed(4, 0) + 4 * LANES.max, 4, 0).laneWidth).toBe(LANES.max);
    expect(laneLayout(fixed(4, 0) + 4 * LANES.max - 4, 4, 0).laneWidth).toBeCloseTo(LANES.max - 1);
    // Collapsing lanes does not widen the others past the cap.
    expect(laneLayout(1000, 2, 2).laneWidth).toBe(LANES.max);
  });

  it("keeps the minimum and scrolls when four lanes do not fit", () => {
    const layout = laneLayout(1000, 4, 0);
    expect(layout).toEqual({ laneWidth: LANES.min, contentWidth: fixed(4, 0) + 4 * LANES.min, scroll: true });
    // Exactly the minimum still fits.
    expect(laneLayout(fixed(4, 0) + 4 * LANES.min, 4, 0).scroll).toBe(false);
    // A card stays at least 280 wide while two lanes fit at 300: the panel pads 8 on each side.
    expect(LANES.min - 16).toBeGreaterThanOrEqual(280);
  });

  it.each([
    [700, 300],
    [632, 300],
    [600, 284],
    [540, 280],
    [480, 280],
    [472, 280],
    [400, 280],
    [280, 256],
    [200, 220],
  ])("adapts default lanes to a %d pt board at %d pt", (viewport, width) => {
    for (const expanded of [4, 5]) {
      const layout = laneLayout(viewport, expanded, 0);
      expect(layout).toEqual({ laneWidth: width, contentWidth: fixed(expanded, 0) + expanded * width, scroll: true });
      if (viewport >= 592) expect(2 * width + fixed(2, 0)).toBeLessThanOrEqual(viewport);
    }
  });

  it("fits two expanded lanes on a small board and scrolls below the readability floor", () => {
    expect(laneLayout(480, 2, 0)).toEqual({ laneWidth: 280, contentWidth: 592, scroll: true });
    expect(laneLayout(592, 2, 0)).toEqual({ laneWidth: 280, contentWidth: 592, scroll: false });
    expect(laneLayout(591, 2, 0)).toEqual({ laneWidth: 280, contentWidth: 592, scroll: true });
    expect(laneLayout(280, 1, 0)).toEqual({ laneWidth: 256, contentWidth: 280, scroll: false });
    expect(laneLayout(200, 1, 0)).toEqual({ laneWidth: 220, contentWidth: 244, scroll: true });
  });

  it("reserves collapsed strips when fitting two default lanes", () => {
    expect(laneLayout(540, 2, 1)).toEqual({ laneWidth: 280, contentWidth: 640, scroll: true });
    expect(laneLayout(540, 3, 1)).toEqual({ laneWidth: 280, contentWidth: fixed(4, 1) + 3 * 280, scroll: true });
    expect(laneLayout(480, 2, 2)).toEqual({ laneWidth: 280, contentWidth: 688, scroll: true });
  });

  it("gives collapsed lanes 40 and the rest to the expanded ones", () => {
    const one = laneLayout(1000, 3, 1);
    expect(one.scroll).toBe(false);
    expect(one.laneWidth).toBeCloseTo((1000 - fixed(4, 1)) / 3);
    const two = laneLayout(700, 2, 2);
    expect(two).toEqual({ laneWidth: 286, contentWidth: 700, scroll: false });
    expect(laneLayout(700, 2, 1).laneWidth).toBeCloseTo((700 - fixed(3, 1)) / 2);
    expect(laneLayout(1000, 0, 4)).toEqual({ laneWidth: 0, contentWidth: 1000, scroll: false });
  });

  it("uses the default lane width when no preset is supplied", () => {
    expect(LANE_SIZES.default).toEqual({ min: LANES.min, max: LANES.max });
    for (const viewport of [400, 480, 632, 1000, 1300, 2000]) {
      expect(laneLayout(viewport, 4, 0, "default")).toEqual(laneLayout(viewport, 4, 0));
    }
  });

  it("caps and scrolls narrow and wide lanes at their own widths", () => {
    // Narrow: four lanes fit a 1440 laptop's board (1120 beside the host's sidebar) without scrolling, where the default scrolls.
    expect(laneLayout(1120, 4, 0, "narrow")).toEqual({ laneWidth: 268, contentWidth: 1120, scroll: false });
    expect(laneLayout(1120, 4, 0, "default").scroll).toBe(true);
    // And a 1920 screen's with the details sidebar open (1208): capped at 280.
    expect(laneLayout(1208, 4, 0, "narrow")).toEqual({ laneWidth: 280, contentWidth: 1208, scroll: false });
    expect(laneLayout(fixed(4, 0) + 4 * 260, 4, 0, "narrow").scroll).toBe(false);
    expect(laneLayout(1000, 4, 0, "narrow")).toEqual({ laneWidth: 260, contentWidth: fixed(4, 0) + 4 * 260, scroll: true });
    // Wide: lanes grow to 400 on a big screen and scroll at 340 below it.
    expect(laneLayout(2000, 4, 0, "wide")).toEqual({ laneWidth: 400, contentWidth: 2000, scroll: false });
    expect(laneLayout(1600, 4, 0, "wide").laneWidth).toBeCloseTo((1600 - fixed(4, 0)) / 4);
    expect(laneLayout(1300, 4, 0, "wide")).toEqual({ laneWidth: 340, contentWidth: fixed(4, 0) + 4 * 340, scroll: true });
    // Every width keeps its cards readable: the narrow preset's widest card is 262 on web.
    expect(LANE_SIZES.narrow.max - 8 - 4 - 6).toBe(262);
    expect(LANE_SIZES.wide.max - 8 - 4 - 6).toBe(382);
  });

  it("shows each lane width on a tablet's narrow board, scrolling the row", () => {
    // An iPad in landscape with the host's sidebar open: about 700 for the board.
    expect(laneLayout(700, 4, 0, "wide").laneWidth).toBe(340);
    expect(laneLayout(700, 4, 0, "default").laneWidth).toBe(LANES.min);
    expect(laneLayout(700, 4, 0, "narrow").laneWidth).toBe(260);
    // The default adapts on a smaller board; explicit presets keep their widths.
    expect([...new Set((["narrow", "default", "wide"] as const).map((size) => laneLayout(540, 4, 0, size).laneWidth))]).toEqual([260, 280, 340]);
  });
});

describe("compact board", () => {
  it("draws the phone layout only on a compact host; a narrow board keeps its lanes and scrolls them", () => {
    expect(boardIsCompact(true)).toBe(true);
    expect(boardIsCompact(false)).toBe(false);
    const narrow = laneLayout(400, 4, 0);
    expect(narrow.laneWidth).toBe(280);
    expect(narrow.scroll).toBe(true);
  });
});

describe("board palette", () => {
  const theme = (colors: Record<string, string>) => ({ colors }) as never;
  const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const PASEO_LIGHT = { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", foreground: "#09090b", foregroundMuted: "#71717a", border: "#e4e4e7", accent: "#18181b" };
  const PASEO_DARK = { surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", foreground: "#fafafa", foregroundMuted: "#A1A5A4", border: "#252B2A", accent: "#fafafa" };
  // Made-up themes: the palette must follow whatever the host hands over.
  const SEPIA_LIGHT = { surface0: "#fbf6ec", surface1: "#f5eedf", surface2: "#ede3cf", foreground: "#3b2f20", foregroundMuted: "#7a6a55", border: "#e2d6bf", accent: "#a0522d" };
  const BLUE_DARK = { surface0: "#0f1729", surface1: "#16203a", surface2: "#1e2a48", foreground: "#e6ecff", foregroundMuted: "#93a0c4", border: "#25324f", accent: "#5b8cff" };

  it("lands near Linear's lane colour on Paseo's default light theme", () => {
    const light = boardPalette(theme(PASEO_LIGHT));
    expect(light).toEqual({ page: "#ffffff", panel: "#f7f7f8", panelHover: "#f4f4f5" });
    // Linear: lanes #f6f6f7. A calibration target, not a literal in the code.
    const target = channels("#f6f6f7");
    channels(light.panel).forEach((value, at) => expect(Math.abs(value - target[at]!)).toBeLessThanOrEqual(2));
  });

  it("uses surface1 for the panel on Paseo's dark theme", () => {
    expect(boardPalette(theme(PASEO_DARK))).toEqual({ page: "#181B1A", panel: "#1E2120", panelHover: "#272A29" });
  });

  it("follows a non-default light and dark theme", () => {
    expect(boardPalette(theme(SEPIA_LIGHT))).toEqual({ page: "#fbf6ec", panel: "#f1e9d7", panelHover: "#ede3cf" });
    expect(boardPalette(theme(BLUE_DARK))).toEqual({ page: "#0f1729", panel: "#16203a", panelHover: "#1e2a48" });
    // rgb() colours are read too, so a dark theme written that way still gets surface1.
    expect(boardPalette(theme({ ...BLUE_DARK, surface0: "rgb(15, 23, 41)" })).panel).toBe("#16203a");
  });
});

describe("tasks language", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    resetTasksLanguage();
    resetEnhancerPreferences();
  });

  it("maps the host's language setting to zh or en", () => {
    expect(hostLanguage("zh-CN", "en-US")).toBe("zh");
    expect(hostLanguage("en", "zh-CN")).toBe("en");
    // Every other host language falls back to English, whatever the device says.
    for (const other of ["ar", "es", "fr", "ja", "ko", "pt-BR", "ru", 42]) expect(hostLanguage(other, "zh-CN")).toBe("en");
    // "system" (or no setting) follows the device locale.
    expect(hostLanguage("system", "zh-TW")).toBe("zh");
    expect(hostLanguage("system", "zh_Hans")).toBe("zh");
    expect(hostLanguage("system", "en-GB")).toBe("en");
    expect(hostLanguage(undefined, "zh")).toBe("zh");
    expect(hostLanguage(undefined, null)).toBe("en");
  });

  function hostSettings(raw: string | null) {
    // The stored settings are read at most once a second; start each case fresh.
    resetTasksLanguage();
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => (key === "@paseo:app-settings" ? raw : null) };
  }

  it("reads Paseo's app settings from localStorage on web when following the system", () => {
    hostSettings(JSON.stringify({ theme: "dark", language: "zh-CN" }));
    expect(resolveTasksLanguage()).toBe("zh");
    hostSettings(JSON.stringify({ language: "ja" }));
    expect(resolveTasksLanguage()).toBe("en");
  });

  it("falls back to the locale on unreadable settings, and an explicit preference wins", () => {
    hostSettings("{not json");
    expect(resolveTasksLanguage()).toBe(hostLanguage(undefined));
    hostSettings(JSON.stringify({ language: "zh-CN" }));
    updateEnhancerPreferences({ language: "en" });
    expect(resolveTasksLanguage()).toBe("en");
  });

  it("names the board 任务 in Chinese", () => {
    expect(BOARD_STRINGS.zh.name).toBe("任务");
    expect(BOARD_STRINGS.zh.openBoard).toBe("打开任务");
    expect(BOARD_STRINGS.en.name).toBe("Tasks");
  });
});
