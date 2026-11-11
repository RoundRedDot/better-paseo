import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: Record<string, unknown>) => React.createElement("Icon", props), TextInput: rn.TextInput, ScrollView: rn.ScrollView };
});
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => true, getReducedMotion: () => true }));
import { AccessibilityInfo, View } from "react-native";
import { SearchQueryChip } from "../../client/tasks/board/filter-bar";
import { TabletToolbar } from "../../client/tasks/board/tablet-toolbar";
import { SearchCoverageProvider } from "../../client/tasks/board/search-loading";
import type { SearchCoverageControl } from "../../client/tasks/data/search-first-prompts";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { EMPTY_PARAMS, type BoardParams } from "../../client/tasks/board/params";
import type { BoardController } from "../../client/tasks/board/use-board";
import { TasksTypographyScale } from "../../client/tasks/typography";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { SearchCoverageItems } from "../../client/tasks/board/search-coverage";
import { measureHostTree, type Frame } from "./helpers/yoga-host-layout";

const theme = { colors: { foreground: "#222222", foregroundMuted: "#777777", surface0: "#ffffff", surface1: "#eeeeee", surface2: "#dddddd", border: "#cccccc", accent: "#2563eb", accentForeground: "#ffffff", statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" } };
let renderer: TestRenderer.ReactTestRenderer;
beforeEach(() => { vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __rnMockOS: "ios" }); });
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });
const hosts = (id: string) => renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === "string" ? child : text(child)).join("");

function mount(width: number, scale = 1, language: "en" | "zh" = "en", palette: typeof theme = theme) {
  let cancelled = false;
  let historyError: string | null = null;
  let fullConversation = false;
  let counts = { loaded: 52, pending: 3 };
  const status: SearchCoverageControl = { read: () => counts, subscribe: () => () => {}, prompt: () => ({ state: "idle" }) };
  // This fixture supplies only the controller fields consumed by the toolbar.
  const board = {
    params: { ...EMPTY_PARAMS, query: "a long search query skill 搜索关键词" }, defaults: { hideSubtasks: true, doneWindow: "7d" }, strings: BOARD_STRINGS[language], total: 29, hiddenSubtasks: 0, laneWidth: "standard", showArchived: false,
    setParams(update: (params: BoardParams) => BoardParams) { board.params = update(board.params); render(); },
    setLaneWidth() {}, setShowArchived() {},
  } as unknown as BoardController;
  const retry = vi.fn(() => { historyError = null; render(); });
  const render = () => renderer.update(view());
  const view = () => <TasksTypographyScale factor={scale}><SearchCoverageProvider status={status} query={board.params.query} strings={BOARD_STRINGS[language].searchCoverage}
    cancelled={cancelled} setCancelled={(value) => { cancelled = value; render(); }} cancelText="Stop search" resumeText="Resume search" stoppedText="Search stopped; results incomplete"
    historyError={historyError} historyFailedText={BOARD_STRINGS[language].historyFailed} retryHistory={retry}
    fullConversation={fullConversation} fullConversationLabel="Full conversation" onFullConversationChange={(value) => { fullConversation = value; render(); }}>
    <View testID="fixture"><TabletToolbar board={board} theme={palette} width={width} laneWidth={300} searchRef={null} onFilters={() => {}} sidebar={{ open: false, sheet: false, onToggle() {} }} emptyLanes={{ collapsed: false, disabled: false, onToggle() {} }} /></View>
  </SearchCoverageProvider></TasksTypographyScale>;
  act(() => { renderer = TestRenderer.create(view()); });
  return { board, retry,
    state(state: "stopped" | "failed" | "stopped+failed") { cancelled = state !== "failed"; historyError = state !== "stopped" ? "offline" : null; counts = { pending: cancelled ? 0 : 3, loaded: 52 }; act(render); act(() => { vi.advanceTimersByTime(200); }); },
    error() { historyError = "offline"; act(render); }, complete() { counts = { pending: 0, loaded: 55 }; act(render); act(() => { vi.advanceTimersByTime(200); }); } };
}

function inside(child: Frame, parent: Frame) {
  expect(child.left).toBeGreaterThanOrEqual(parent.left - 0.5);
  expect(child.left + child.width).toBeLessThanOrEqual(parent.left + parent.width + 0.5);
  expect(child.top).toBeGreaterThanOrEqual(parent.top - 0.5);
  expect(child.top + child.height).toBeLessThanOrEqual(parent.top + parent.height + 0.5);
}

it.each((["ios", "android"] as const).flatMap((os) => [408, 574, 802, 1024].flatMap((width) => [1, 1.5].flatMap((scale) => (["en", "zh"] as const).map((language) => [os, width, scale, language] as const)))))(
  "%s search fits %ipt at UI scale %f in %s without duplicate query or status rows", (os, width, scale, language) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const fixture = mount(width, scale, language);
    const layout = () => measureHostTree(hosts("fixture")[0]!, { width });
    const check = () => {
      const frames = layout();
      const bar = frames.get(hosts("tablet-toolbar")[0]!)!;
      for (const id of ["tablet-toolbar-total", "subtasks-toggle", "toolbar-filters", "tablet-view", "sidebar-switch"]) inside(frames.get(hosts(id)[0]!)!, bar);
      const field = hosts("tablet-toolbar-search")[0];
      const chip = hosts("search-query-chip")[0];
      expect(Boolean(field)).not.toBe(Boolean(chip));
      const search = frames.get((field ?? chip)!)!;
      expect(hosts("tablet-search-summary-row")).toHaveLength(0);
      if (chip) {
        expect(Math.abs(search.top + search.height / 2 - bar.top - bar.height / 2)).toBeLessThan(1);
        expect(search.top).toBeGreaterThanOrEqual(bar.top);
        expect(search.top + search.height).toBeLessThanOrEqual(bar.top + bar.height);
      }
      for (const host of hosts("search-coverage-items")) {
        const coverage = frames.get(host)!;
        expect(Math.abs(search.top + search.height / 2 - coverage.top - coverage.height / 2)).toBeLessThan(1);
      }
      for (const id of ["search-query-chip", "tablet-toolbar-search", "search-cancel-toggle", "search-full-conversation-toggle", "search-coverage-items", "search-coverage-notices"]) {
        for (const host of hosts(id)) inside(frames.get(host)!, frames.get(hosts("fixture")[0]!)!);
      }
      expect(hosts("search-coverage-loaded")).toHaveLength(!field && width < 480 * scale ? 0 : 1);
      checkControls(width);
      if (chip) expect(hosts("search-query-edit")[0]!.props.accessibilityLabel).toContain(BOARD_STRINGS[language].editSearch);
      if (field) {
        const input = field.find((node) => (node.type as unknown) === "TextInput");
        expect(frames.get(input)!.width).toBeGreaterThan(35);
      }
    };
    check();
    if (hosts("search-query-edit").length) act(() => hosts("search-query-edit")[0]!.props.onPress());
    check();
    expect(hosts("search-query-chip")).toHaveLength(0);
    const input = () => hosts("tablet-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput");
    act(() => input().props.onChangeText("skill"));
    expect(fixture.board.params.query).toBe("skill");
    act(() => hosts("search-full-conversation-toggle")[0]!.props.onPress());
    expect(hosts("search-full-conversation-toggle")[0]!.props.accessibilityState.selected).toBe(true);
    act(() => hosts("search-cancel-toggle")[0]!.props.onPress());
    expect(hosts("search-cancel-toggle")[0]!.props.accessibilityLabel).toBe("Resume search");
    check();
    act(() => hosts("search-cancel-toggle")[0]!.props.onPress());
    fixture.error();
    check();
    const retry = hosts("search-history-failure")[0]!.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
    act(() => retry.props.onPress());
    expect(fixture.retry).toHaveBeenCalledOnce();
    act(() => input().props.onSubmitEditing());
    if (width < 960 * scale) {
      expect(hosts("search-query-chip")).toHaveLength(1);
      expect(text(hosts("search-query-chip")[0]!)).toBe("「skill」");
      expect(hosts("tablet-toolbar-search")).toHaveLength(0);
      check();
      if (width >= 700 * scale) {
        act(() => hosts("search-query-edit")[0]!.props.onPress());
        act(() => hosts("tablet-search-close")[0]!.props.onPress());
        expect(fixture.board.params.query).toBe("skill");
        expect(hosts("tablet-toolbar-search")).toHaveLength(0);
      }
      const clear = hosts("search-query-chip")[0]!.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.testID !== "search-query-edit");
      act(() => clear.props.onPress());
    } else act(() => hosts("tablet-search-clear")[0]!.props.onPress());
    expect(fixture.board.params.query).toBe("");
    expect(hosts("search-query-chip")).toHaveLength(0);
    expect(hosts("search-cancel-toggle")).toHaveLength(0);
    expect(hosts("search-coverage-items")).toHaveLength(0);
  },
);

it("removes inline loading controls when loading completes without adding a status strip", () => {
  const fixture = mount(802);
  expect(hosts("search-cancel-toggle")).toHaveLength(1);
  fixture.complete();
  expect(hosts("search-cancel-toggle")).toHaveLength(0);
  expect(hosts("search-coverage-items")).toHaveLength(0);
  expect(hosts("search-query-chip")).toHaveLength(1);
});

/** Check actionable leaf bounds, not only their potentially overflowing flex containers. */
function checkControls(width: number) {
  const frames = measureHostTree(hosts("fixture")[0]!, { width });
  const root = frames.get(hosts("fixture")[0]!)!;
  const controls = ["search-query-edit", "search-coverage-loaded", "search-cancel-toggle", "tablet-toolbar-total", "tablet-search-toggle", "tablet-search-clear", "tablet-search-close", "subtasks-toggle", "toolbar-filters", "tablet-view", "sidebar-switch", "search-full-conversation-toggle"].flatMap(hosts);
  for (const chip of hosts("search-query-chip")) controls.push(chip.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button" && node.props.testID !== "search-query-edit"));
  for (const failure of hosts("search-history-failure")) controls.push(failure.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button"));
  for (const control of controls) inside(frames.get(control)!, root);
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = frames.get(controls[i]!)!, b = frames.get(controls[j]!)!;
    const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    expect(overlapX > 0.5 && overlapY > 0.5, `${controls[i]!.props.testID ?? controls[i]!.props.accessibilityLabel} vs ${controls[j]!.props.testID ?? controls[j]!.props.accessibilityLabel}`).toBe(false);
  }
  for (const host of hosts("search-coverage-items").concat(hosts("search-coverage-notices"))) {
    const parent = frames.get(host)!;
    for (const leaf of host.findAll((node) => (node.type as unknown) === "Text" || (typeof node.type === "string" && node.props.accessibilityRole === "button"))) inside(frames.get(leaf)!, parent);
  }
  return frames;
}

it.each((["ios", "android"] as const).flatMap((os) => [744, 820].flatMap((width) => (["en", "zh"] as const).flatMap((language) => (["stopped", "failed", "stopped+failed"] as const).map((state) => [os, width, language, state] as const)))))(
  "%s collapsed long query at %i/%s keeps %s controls separate from each other and the count", (os, width, language, state) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const fixture = mount(width, 1, language);
    act(() => fixture.board.setParams((params) => ({ ...params, query: "A deliberately long query to force ellipsis while paused or failed 搜索关键词" })));
    fixture.state(state);
    expect(hosts("tablet-toolbar-search")).toHaveLength(0);
    expect(hosts("tablet-search-summary-row")).toHaveLength(0);
    const frames = checkControls(width);
    if (state !== "failed") {
      expect(hosts("search-cancel-toggle")[0]!.props.accessibilityHint).toBe("Search stopped; results incomplete");
      expect(text(hosts("search-stopped")[0]!)).toBe(BOARD_STRINGS[language].searchStoppedShort);
    }
    if (state !== "stopped") {
      const retry = hosts("search-history-failure")[0]!.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
      expect(frames.get(retry)!.width).toBeGreaterThanOrEqual(32);
      expect(frames.get(retry)!.height).toBeGreaterThanOrEqual(32);
      act(() => retry.props.onPress());
      expect(fixture.retry).toHaveBeenCalledOnce();
    }
  },
);

it.each(["ios", "android"] as const)("%s keeps one live region and completion/failure announcements after the input unmounts", (os) => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  try {
    const fixture = mount(802);
    act(() => hosts("search-query-edit")[0]!.props.onPress());
    act(() => { vi.advanceTimersByTime(300); });
    const input = hosts("tablet-toolbar-search")[0]!.find((node) => (node.type as unknown) === "TextInput");
    act(() => input.props.onSubmitEditing());
    expect(hosts("tablet-toolbar-search")).toHaveLength(0);
    expect(hosts("search-announcement")).toHaveLength(1);
    fixture.complete();
    expect(text(hosts("search-announcement")[0]!)).toBe(BOARD_STRINGS.en.searchCoverage.complete(55));
    fixture.error();
    expect(text(hosts("search-announcement")[0]!)).toBe(BOARD_STRINGS.en.historyFailed);
    expect(hosts("search-announcement")[0]!.props.accessibilityLiveRegion).toBe("polite");
    if (os === "ios") expect(announce).toHaveBeenCalledWith(BOARD_STRINGS.en.historyFailed);
  } finally { announce.mockRestore(); }
});

it.each((["ios", "android"] as const).flatMap((os) => [1, 1.5].map((scale) => [os, scale] as const)))("%s phone query keeps its existing 36pt summary height at scale %f", (os, scale) => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const fixture = mount(802, scale);
  act(() => renderer.update(<TasksTypographyScale factor={scale}><SearchQueryChip board={fixture.board} theme={theme} /></TasksTypographyScale>));
  const chip = hosts("search-query-chip")[0]!;
  const frames = measureHostTree(chip, { width: 320 });
  expect(frames.get(chip)!.height).toBe(Math.round(36 * scale));
  const fill = frames.get(hosts("search-query-chip-fill")[0]!)!;
  expect(fill.height).toBe(Math.round(24 * scale));
  expect(fill.top + fill.height / 2).toBeCloseTo(frames.get(chip)!.height / 2, 0);
});

it.each((["ios", "android"] as const).flatMap((os) => (["loading", "stopped", "failed"] as const).map((state) => [os, state] as const)))("%s narrow query visibly indicates %s without another row or icon gutter", (os, state) => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const fixture = mount(408, 1.5);
  if (state !== "loading") fixture.state(state);
  const chip = hosts("search-query-chip")[0]!;
  if (state === "loading") expect(chip.findAll((node) => typeof node.type === "string" && node.props.testID === "search-spinner")).toHaveLength(1);
  else expect(chip.findAll((node) => (node.type as unknown) === "Icon" && node.props.name === (state === "stopped" ? "Pause" : "CircleAlert"))).toHaveLength(1);
  expect(hosts("tablet-search-summary-row")).toHaveLength(0);
  const frames = checkControls(408);
  const bar = hosts("tablet-toolbar")[0]!;
  expect(frames.get(chip)!.left).toBe(bar.props.style.paddingHorizontal);
  expect(frames.get(hosts("search-query-edit")[0]!)!.width).toBeGreaterThan(24);
  act(() => hosts("search-query-edit")[0]!.props.onPress());
  expect(hosts("tablet-toolbar-search")).toHaveLength(1);
  if (state === "failed") expect(hosts("search-history-failure")).toHaveLength(1);
  else expect(hosts("search-cancel-toggle")).toHaveLength(1);
});

it.each((["ios", "android"] as const).flatMap((os) => (["en", "zh"] as const).map((language) => [os, language] as const)))("%s narrow query in %s speaks the state its mark shows", (os, language) => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  const fixture = mount(408, 1, language);
  const hint = () => hosts("search-query-edit")[0]!.props.accessibilityHint;
  expect(hint()).toBe(BOARD_STRINGS[language].searchCoverage.started);
  fixture.state("stopped");
  expect(hint()).toBe("Search stopped; results incomplete");
  fixture.state("failed");
  expect(hint()).toBe(BOARD_STRINGS[language].historyFailed);
  fixture.state("stopped+failed");
  expect(hint()).toBe(BOARD_STRINGS[language].historyFailed);
  act(() => fixture.retry());
  expect(hint()).toBe("Search stopped; results incomplete");
  fixture.state("failed");
  act(() => fixture.retry());
  fixture.complete();
  expect(hosts("search-query-chip")).toHaveLength(1);
  expect(hint()).toBeUndefined();
});

it("leaves the wider pill's edit button without a state hint; the count, retry and short words carry it", () => {
  const fixture = mount(802);
  expect(hosts("search-query-edit")[0]!.props.accessibilityHint).toBeUndefined();
  fixture.state("failed");
  expect(hosts("search-query-edit")[0]!.props.accessibilityHint).toBeUndefined();
  expect(hosts("search-history-failure")).toHaveLength(1);
});

const dark = { colors: { ...theme.colors, foreground: "#e6edf3", foregroundMuted: "#8b949e", surface0: "#0d1117", surface1: "#161b22", surface2: "#21262d", border: "#30363d", statusDanger: "#f85149" } };
it.each([["light", theme], ["dark", dark]] as const)("paints the %s failure marks with the theme's danger token", (_name, palette) => {
  const danger = taskTokens(palette).danger;
  const fixture = mount(802, 1, "en", palette);
  fixture.state("failed");
  const retry = hosts("search-history-failure")[0]!.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
  expect(retry.findByProps({ name: "RotateCw" }).props.color).toBe(danger);
  const counts = { loaded: 52, pending: 0 };
  const status: SearchCoverageControl = { read: () => counts, subscribe: () => () => {}, prompt: () => ({ state: "idle" }) };
  act(() => renderer.update(<SearchCoverageProvider status={status} query="skill" strings={BOARD_STRINGS.en.searchCoverage}
    historyError="offline" historyFailedText={BOARD_STRINGS.en.historyFailed} retryHistory={() => {}}><SearchCoverageItems theme={palette} /></SearchCoverageProvider>));
  expect(hosts("search-history-failure")[0]!.findByProps({ name: "CircleAlert" }).props.color).toBe(danger);
  act(() => renderer.unmount());
  mount(408, 1, "en", palette).state("failed");
  expect(hosts("search-query-chip")[0]!.findByProps({ name: "CircleAlert" }).props.color).toBe(danger);
});
