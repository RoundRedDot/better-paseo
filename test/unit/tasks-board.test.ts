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
  claimsSwipe,
  LANES,
  laneLayout,
  popoverPlacement,
  type LaneShape,
} from "../../client/tasks/board/navigation";
import { activeChips, buildFilterOptions, clearedParams } from "../../client/tasks/board/filter-options";
import { boardPalette, cubicBezier } from "../../client/tasks/board/board-style";
import { withStopReasons } from "../../client/tasks/board/use-board";
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
      openTabsOnly: true,
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
      filters: { query: "", workspaceIds: [], providers: [], labels: [], openTabsOnly: false, hideSubtasks: true },
      doneWindow: "all",
    });
    expect(resolveBoardParams({ ...EMPTY_PARAMS, hideSubtasks: false, doneWindow: "7d" }, { hideSubtasks: true, doneWindow: "all" }).doneWindow).toBe("7d");
  });

  it("counts active filters for the phone badge", () => {
    expect(activeFilterCount(EMPTY_PARAMS, defaults)).toBe(0);
    const params: BoardParams = { ...EMPTY_PARAMS, workspaceIds: ["a", "b"], providers: ["claude"], openTabsOnly: true, query: "x", doneWindow: "7d" };
    expect(activeFilterCount(params, defaults)).toBe(6);
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

  it("claims a native touch from the host while it is still under the host's 15, only when horizontal", () => {
    expect(SWIPE.claim).toBeLessThan(15);
    expect(claimsSwipe(SWIPE.claim, 0)).toBe(true);
    expect(claimsSwipe(-SWIPE.claim, 4)).toBe(true);
    expect(claimsSwipe(SWIPE.claim - 1, 0)).toBe(false);
    expect(claimsSwipe(8, 6)).toBe(false);
    expect(claimsSwipe(2, 30)).toBe(false);
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
  const counts = { running: 3, needsInput: 2 };
  it.each([
    ["running-and-input", counts, { running: 3, input: 2 }, "3 running, 2 need input", "3 个运行中，2 个待输入"],
    ["input-only", counts, { running: null, input: 2 }, "2 need input", "2 个待输入"],
    ["none", counts, { running: null, input: null }, "", ""],
    ["running-and-input", { running: 0, needsInput: 1 }, { running: null, input: 1 }, "1 need input", "1 个待输入"],
    ["running-and-input", { running: 4, needsInput: 0 }, { running: 4, input: null }, "4 running", "4 个运行中"],
    ["input-only", { running: 4, needsInput: 0 }, { running: null, input: null }, "", ""],
    ["running-and-input", { running: 0, needsInput: 0 }, { running: null, input: null }, "", ""],
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
    counts: { needsInput: 1, running: 2, review: 2, done: 1 },
    byId: new Map(cards.map((card) => [card.id, card])),
    workspaces: [
      { id: "wks_sample", name: "tasks-board", projectId: "prj_sample", projectName: "better-paseo" },
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
    requestProjectIcon() {},
  };
}

describe("filter options", () => {
  it("groups workspaces by project and counts active cards", () => {
    const options = buildFilterOptions(handle(), { ...EMPTY_PARAMS, providers: ["codex", "gone"] });
    expect(options.workspaceGroups.map((group) => group.projectName)).toEqual(["better-paseo", "paseo"]);
    expect(options.workspaceGroups[0]!.items[0]).toMatchObject({ id: "wks_sample", count: 5, on: false });
    expect(options.agents).toEqual([
      { id: "claude", label: "Claude", count: 4, on: false },
      { id: "codex", label: "Codex", count: 1, on: true },
      { id: "gone", label: "gone", count: 0, on: true },
    ]);
    expect(options.labels.find((label) => label.id === "docs")).toMatchObject({ count: 1, color: "#0ea5e9" });
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

describe("details popover placement", () => {
  const root = { x: 100, y: 50, width: 1200, height: 800 };
  it("sits 8 px right of the card", () => {
    expect(popoverPlacement({ x: 110, y: 150, width: 300, height: 120 }, root)).toEqual({ x: 318, y: 100 });
  });
  it("flips left near the right edge and drops below when neither side fits", () => {
    expect(popoverPlacement({ x: 1000, y: 150, width: 290, height: 120 }, root)).toEqual({ x: 900 - 288 - 8, y: 100 });
    const narrow = { x: 0, y: 0, width: 500, height: 800 };
    expect(popoverPlacement({ x: 10, y: 20, width: 300, height: 100 }, narrow)).toEqual({ x: 18, y: 126 });
  });
  it("stays inside the board vertically", () => {
    expect(popoverPlacement({ x: 110, y: 790, width: 300, height: 50 }, root).y).toBe(800 - 420);
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

describe("stopped manually", () => {
  it("says so on a review or done card without its own error, keeping its identity", () => {
    const lanes = handle().lanes;
    const stopped = new Set(["sample-unread", "sample-failed", "sample-running", "sample-done"]);
    const once = withStopReasons(lanes, stopped, "已手动停止");
    const unread = once.review.cards.find((card) => card.id === "sample-unread")!;
    expect(unread.error).toBe("已手动停止");
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

  it("shares a wide window among four lanes with no scrolling and no maximum", () => {
    const layout = laneLayout(2000, 4, 0);
    expect(layout.scroll).toBe(false);
    expect(layout.contentWidth).toBe(2000);
    expect(layout.laneWidth).toBeCloseTo((2000 - fixed(4, 0)) / 4);
    expect(layout.laneWidth * 4 + fixed(4, 0)).toBeCloseTo(2000);
  });

  it("keeps the minimum and scrolls when four lanes do not fit", () => {
    const layout = laneLayout(1000, 4, 0);
    expect(layout).toEqual({ laneWidth: LANES.min, contentWidth: fixed(4, 0) + 4 * LANES.min, scroll: true });
    // Exactly the minimum still fits.
    expect(laneLayout(fixed(4, 0) + 4 * LANES.min, 4, 0).scroll).toBe(false);
    // A card stays at least 280 wide: the panel pads 8 on each side.
    expect(LANES.min - 16).toBeGreaterThanOrEqual(280);
  });

  it("gives collapsed lanes 40 and the rest to the expanded ones", () => {
    const one = laneLayout(1000, 3, 1);
    expect(one.scroll).toBe(false);
    expect(one.laneWidth).toBeCloseTo((1000 - fixed(4, 1)) / 3);
    const two = laneLayout(700, 2, 2);
    expect(two).toEqual({ laneWidth: LANES.min, contentWidth: fixed(4, 2) + 2 * LANES.min, scroll: true });
    expect(laneLayout(1000, 2, 2).laneWidth).toBeCloseTo((1000 - fixed(4, 2)) / 2);
    expect(laneLayout(1000, 0, 4)).toEqual({ laneWidth: 0, contentWidth: 1000, scroll: false });
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
