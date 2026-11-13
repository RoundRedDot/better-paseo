import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, TextInput: rn.TextInput };
});
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced, getReducedMotion: () => motion.reduced }));
import { AccessibilityInfo, Animated } from "react-native";
import { SearchCoverageItems } from "../../client/tasks/board/search-coverage";
import { SearchCoverageProvider, SearchInput } from "../../client/tasks/board/search-loading";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import type { SearchCoverageControl } from "../../client/tasks/data/search-first-prompts";
import { readFileSync } from "node:fs";

let renderer: TestRenderer.ReactTestRenderer;
beforeEach(() => { vi.useFakeTimers(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => renderer?.unmount()); vi.useRealTimers(); });
const hosts = (id: string) => renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);
const testTheme = { colors: { foreground: "#111111", foregroundMuted: "#777777", surface0: "#ffffff", surface1: "#eeeeee", surface2: "#eeeeee", accent: "#2563eb", accentForeground: "#ffffff", statusWarning: "#a36a00", statusDanger: "#d92d20", statusSuccess: "#198754", border: "#dddddd" } } as never;
const text = (node: TestRenderer.ReactTestInstance): string => node.children.map((child) => typeof child === "string" ? child : text(child)).join("");

function mount(counts: ReturnType<SearchCoverageControl["read"]>, language: "en" | "zh" = "zh", phone = false, size = 13, hideSearchIcon = false) {
  const listeners = new Set<() => void>();
  const status: SearchCoverageControl = { read: () => counts, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, prompt: () => ({ state: "idle" }) };
  let query = "deploy";
  let unrelatedRenders = 0;
  function Lanes() { unrelatedRenders++; return null; }
  const render = () => <SearchCoverageProvider status={status} query={query} strings={BOARD_STRINGS[language].searchCoverage}>
    <Lanes />
    <SearchInput theme={testTheme} hideSearchIcon={hideSearchIcon} iconSize={size} iconColor="#777777" value={query} />
    <SearchCoverageItems theme={testTheme} phone={phone} />
  </SearchCoverageProvider>;
  act(() => { renderer = TestRenderer.create(render()); });
  return {
    update(next: typeof counts) { counts = next; act(() => { listeners.forEach((listener) => listener()); }); },
    query(next: string) { query = next; act(() => renderer.update(render())); },
    get laneRenders() { return unrelatedRenders; },
  };
}

const state = (pending = 0, loaded = 0) => ({ pending, loaded });

it("folds the loaded count into the field as a bare badge and leaves notices outside", () => {
  const counts = state(2, 52);
  const status: SearchCoverageControl = { read: () => counts, subscribe: () => () => {}, prompt: () => ({ state: "idle" }) };
  const render = (historyError: string | null) => <SearchCoverageProvider status={status} query="query" strings={BOARD_STRINGS.zh.searchCoverage} historyError={historyError} historyFailedText={BOARD_STRINGS.zh.historyFailed}>
    <SearchCoverageItems theme={testTheme} part="badge" />
    <SearchCoverageItems theme={testTheme} part="notice" />
  </SearchCoverageProvider>;
  act(() => { renderer = TestRenderer.create(render(null)); vi.advanceTimersByTime(200); });
  expect(text(hosts("search-coverage-loaded")[0]!)).toBe("52");
  expect(hosts("search-coverage-loaded")[0]!.props.accessibilityLabel).toBe(BOARD_STRINGS.zh.searchCoverage.loaded(52));
  expect(hosts("search-coverage-notices")).toHaveLength(0);
  act(() => { renderer.update(render("offline")); vi.advanceTimersByTime(200); });
  expect(text(hosts("search-coverage-notices")[0]!)).toContain("加载历史任务失败");
  expect(hosts("search-coverage-loaded")).toHaveLength(1);
  expect(hosts("search-history-failure")).toHaveLength(1);
});

it("announces history loading and offers a retry when its page fails", () => {
  const retry = vi.fn();
  const counts = state();
  const status: SearchCoverageControl = { read: () => counts, subscribe: () => () => {}, prompt: () => ({ state: "idle" }) };
  const render = (historyLoading: boolean, historyError: string | null) => <SearchCoverageProvider status={status} query="query" strings={BOARD_STRINGS.zh.searchCoverage} historyLoading={historyLoading} historyError={historyError} retryHistory={retry} historyLoadingText={BOARD_STRINGS.zh.historyLoading} historyFailedText={BOARD_STRINGS.zh.historyFailed}>
    <SearchInput theme={testTheme} iconSize={13} iconColor="#777" value="query" />
    <SearchCoverageItems theme={testTheme} phone />
  </SearchCoverageProvider>;
  act(() => { renderer = TestRenderer.create(render(true, null)); vi.advanceTimersByTime(300); });
  act(() => { vi.advanceTimersByTime(300); });
  expect(text(hosts("search-announcement")[0]!)).toBe("正在加载更早的任务");
  act(() => { renderer.update(render(false, "offline")); });
  expect(text(hosts("search-history-failure")[0]!)).toContain("加载历史任务失败");
  const button = hosts("search-history-failure")[0]!.find((node) => node.props.accessibilityRole === "button");
  expect(button.props.hitSlop).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  expect(button.props.style.minHeight).toBe(32);
  act(() => button.props.onPress());
  expect(retry).toHaveBeenCalledOnce();
});

it("offers stop and resume without clearing the query", () => {
  const toggle = vi.fn();
  const counts = state(1, 0);
  const status: SearchCoverageControl = { read: () => counts, subscribe: () => () => {}, prompt: () => ({ state: "idle" }) };
  const render = (cancelled: boolean) => <SearchCoverageProvider status={status} query="query" strings={BOARD_STRINGS.zh.searchCoverage} cancelled={cancelled} setCancelled={toggle} cancelText="停止搜索" resumeText="继续搜索" stoppedText="搜索已停止，结果不完整">
    <SearchInput theme={testTheme} iconSize={13} iconColor="#777" value="query" />
  </SearchCoverageProvider>;
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  act(() => { renderer = TestRenderer.create(render(false)); });
  expect(hosts("search-cancel-toggle")[0]!.props.accessibilityLabel).toBe("停止搜索");
  expect(hosts("search-cancel-toggle")[0]!.props.dataSet.bctip).toBe("停止搜索");
  const idleStyle = hosts("search-cancel-toggle")[0]!.props.style;
  act(() => hosts("search-cancel-toggle")[0]!.props.onHoverIn());
  expect(hosts("search-cancel-toggle")[0]!.props.style).not.toEqual(idleStyle);
  const hoverStyle = hosts("search-cancel-toggle")[0]!.props.style;
  act(() => hosts("search-cancel-toggle")[0]!.props.onPressIn());
  expect(hosts("search-cancel-toggle")[0]!.props.style).not.toEqual(hoverStyle);
  act(() => hosts("search-cancel-toggle")[0]!.props.onPressOut());
  act(() => hosts("search-cancel-toggle")[0]!.props.onPress());
  expect(toggle).toHaveBeenLastCalledWith(true);
  act(() => renderer.update(render(true)));
  expect(hosts("search-cancel-toggle")[0]!.props.accessibilityLabel).toBe("继续搜索");
  expect(hosts("search-cancel-toggle")[0]!.props.dataSet.bctip).toBe("继续搜索");
  act(() => hosts("search-cancel-toggle")[0]!.props.onPress());
  expect(toggle).toHaveBeenLastCalledWith(false);
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

it("keeps the search icon in place while loading when the field asks for it", () => {
  const counts = state(1, 0);
  const status: SearchCoverageControl = { read: () => counts, subscribe: () => () => {}, prompt: () => ({ state: "idle" }) };
  act(() => { renderer = TestRenderer.create(<SearchCoverageProvider status={status} query="deploy" strings={BOARD_STRINGS.en.searchCoverage}>
    <SearchInput theme={testTheme} iconSize={13} iconColor="#777777" value="deploy" staticIcon />
  </SearchCoverageProvider>); });
  act(() => { vi.advanceTimersByTime(300); });
  const slot = hosts("search-icon-slot")[0]!;
  expect(slot.findAll((node) => typeof node.type === "string" && node.props.name === "Search")).toHaveLength(1);
  expect(slot.findAll((node) => node.props.testID === "search-spinner")).toHaveLength(0);
});

it("keeps a hidden search icon from reappearing as a loading spinner", () => {
  mount(state(1, 0), "en", false, 16, true);
  act(() => { vi.advanceTimersByTime(300); });
  expect(hosts("search-icon-slot")).toHaveLength(0);
  // The state still reaches assistive tech and the coverage item.
  expect(text(hosts("search-announcement")[0]!)).toBe(BOARD_STRINGS.en.searchCoverage.started);
});

const matrix = [
  ["pending", state(23, 5), true],
  ["pending on a slow board", state(9, 116), true],
  ["finished with gaps", state(0, 104), false],
  ["finished without gaps", state(0, 116), false],
] as const;

describe.each(["en", "zh"] as const)("search coverage (%s)", (language) => {
  it.each(matrix)("renders matrix %s", (name, counts, visible) => {
    mount(counts, language, true);
    expect(hosts("search-coverage-items")).toHaveLength(visible ? 1 : 0);
    if (visible) {
      expect(hosts("search-coverage-items")[0]!.props.style.height).toBe(1);
      expect(text(hosts("search-coverage-loaded")[0]!)).toContain(BOARD_STRINGS[language].searchCoverage.loaded(counts.loaded));
      act(() => hosts("search-coverage-items")[0]!.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(300); });
      expect(text(hosts("search-coverage-popover")[0]!)).toContain(BOARD_STRINGS[language].searchCoverage.readingHint);
      act(() => hosts("search-coverage-backdrop")[0]!.props.onPress());
      expect(hosts("search-coverage-popover")).toHaveLength(0);
    }
    // Nothing failed is counted or offered any more: no failure row, no retry.
    expect(hosts("search-coverage-failure")).toHaveLength(0);
    expect(hosts("search-coverage-retry")).toHaveLength(0);
    expect(hosts("search-coverage-popover-retry")).toHaveLength(0);
  });
});

it.each([13, 16, 15])("delays the %s px icon 300 ms, holds 400 ms, then crossfades 120 ms", (size) => {
  const mounted = mount(state(23, 5), "zh", false, size);
  expect(hosts("search-icon-slot")[0]!.props.style.width).toBe(size);
  act(() => { vi.advanceTimersByTime(299); });
  expect(hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner")).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner").length).toBeGreaterThan(0);
  mounted.update(state(22, 6));
  mounted.update(state(0, 28));
  act(() => { vi.advanceTimersByTime(399); });
  expect(hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner").length).toBeGreaterThan(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner").length).toBeGreaterThan(0);
  act(() => { vi.advanceTimersByTime(120); });
  expect(hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner")).toHaveLength(0);
  expect(mounted.laneRenders).toBe(1);
});

it("never flashes for a short read and resets the delay for a new query", () => {
  const mounted = mount(state(1, 0));
  act(() => { vi.advanceTimersByTime(180); });
  mounted.update(state(0, 1));
  act(() => { vi.advanceTimersByTime(1000); });
  expect(hosts("search-spinner")).toHaveLength(0);
  mounted.update(state(2, 1));
  act(() => { vi.advanceTimersByTime(300); });
  const iconSpinner = () => hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner");
  expect(iconSpinner().length).toBeGreaterThan(0);
  mounted.query("other");
  expect(iconSpinner()).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(299); });
  expect(iconSpinner()).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(iconSpinner().length).toBeGreaterThan(0);
});

it("announces start and completion only, and completion reports loaded tasks", () => {
  const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  const mounted = mount(state(23, 5));
  const announcement = () => text(hosts("search-announcement")[0]!);
  expect(announcement()).toBe("");
  act(() => { vi.advanceTimersByTime(300); });
  expect(announcement()).toBe("正在搜索首条消息");
  mounted.update(state(22, 6));
  mounted.update(state(12, 16));
  expect(announcement()).toBe("正在搜索首条消息");
  mounted.update(state(0, 28));
  expect(announcement()).toBe(BOARD_STRINGS.zh.searchCoverage.complete(28));
  mounted.update(state(0, 29));
  expect(announcement()).toBe(BOARD_STRINGS.zh.searchCoverage.complete(28));
  expect(announce.mock.calls).toEqual([["正在搜索首条消息"], [BOARD_STRINGS.zh.searchCoverage.complete(28)]]);
  announce.mockRestore();
});

it.each([13, 16, 15])("clearing the query removes %s px spinner and items immediately, and clears busy", (size) => {
  const mounted = mount(state(23, 5), "en", false, size);
  act(() => { vi.advanceTimersByTime(300); });
  mounted.query(" ");
  expect(hosts("search-spinner")).toHaveLength(0);
  expect(hosts("search-coverage-items")).toHaveLength(0);
  expect(renderer.root.findAll((node) => String(node.type) === "TextInput")[0]!.props.accessibilityState.busy).toBe(false);
});

it("opens after 300 ms hover and cancels an interrupted hover", () => {
  mount(state(1, 5), "zh", true);
  const row = () => hosts("search-coverage-items")[0]!;
  act(() => row().props.onHoverIn());
  act(() => { vi.advanceTimersByTime(299); });
  expect(hosts("search-coverage-popover")).toHaveLength(0);
  act(() => row().props.onHoverOut());
  act(() => { vi.advanceTimersByTime(500); });
  expect(hosts("search-coverage-popover")).toHaveLength(0);
  act(() => row().props.onHoverIn());
  act(() => { vi.advanceTimersByTime(300); });
  expect(hosts("search-coverage-popover")).toHaveLength(1);
});

it("removes the old bottom-wide coverage component", () => {
  const source = readFileSync(new URL("../../client/tasks/board/board-screen.tsx", import.meta.url), "utf8");
  expect(source).not.toContain("<SearchCoverage board=");
  expect(source).not.toContain('testID="tasks-search-coverage"');
});

it("pulses a stationary icon over 1.6 s when motion is reduced", () => {
  motion.reduced = true;
  const timing = vi.spyOn(Animated, "timing");
  try {
    mount(state(1, 0));
    act(() => { vi.advanceTimersByTime(300); });
    const pulse = timing.mock.calls.filter(([, config]) => config.duration === 800);
    // The icon and the coverage chip each hold a spinner; both pulse instead of rotating.
    expect(pulse.map(([, config]) => config.toValue).sort()).toEqual([0, 0, 1, 1]);
    const iconSpinner = hosts("search-icon-slot")[0]!.findAll((node) => node.props.testID === "search-spinner")[0]!;
    expect(iconSpinner.props.style.transform).toBeUndefined();
  } finally { motion.reduced = false; timing.mockRestore(); }
});

it("fades the row out when the last read finishes, whatever it left uncovered", () => {
  const mounted = mount(state(9, 3));
  expect(text(hosts("search-coverage-loaded")[0]!)).toBe("已加载 3 个");
  mounted.update(state(0, 12));
  act(() => { vi.advanceTimersByTime(120); });
  expect(hosts("search-coverage-items")).toHaveLength(0);
});

it("uses the JS driver for both animations on the phone coverage row", () => {
  const timing = vi.spyOn(Animated, "timing");
  try {
    const mounted = mount(state(), "zh", true);
    timing.mockClear();
    mounted.update(state(1, 0));
    const rowAnimations = timing.mock.calls.filter(([, config]) => config.duration === 120 || config.duration === 160);
    expect(rowAnimations.map(([, config]) => config.useNativeDriver)).toEqual([false, false]);
    timing.mockClear();
    mounted.update(state(0, 1));
    expect(timing.mock.calls.filter(([, config]) => config.duration === 120 || config.duration === 160).map(([, config]) => config.useNativeDriver)).toEqual([false, false]);
  } finally { timing.mockRestore(); }
});
