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
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
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
const text = (node: TestRenderer.ReactTestInstance): string => node.children.map((child) => typeof child === "string" ? child : text(child)).join("");

function mount(counts: ReturnType<SearchCoverageControl["read"]>, language: "en" | "zh" = "zh", phone = false, size = 13) {
  const listeners = new Set<() => void>();
  const retry = vi.fn(async () => {});
  const status: SearchCoverageControl = { read: () => counts, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }, retry, prompt: () => ({ state: "idle" }) };
  let query = "deploy";
  let unrelatedRenders = 0;
  function Lanes() { unrelatedRenders++; return null; }
  const theme = { colors: { foreground: "#111111", foregroundMuted: "#777777", surface0: "#ffffff", surface1: "#eeeeee", surface2: "#eeeeee", accent: "#2563eb", accentForeground: "#ffffff", statusWarning: "#a36a00", statusDanger: "#d92d20", statusSuccess: "#198754", border: "#dddddd" } } as never;
  const render = () => <SearchCoverageProvider status={status} query={query} strings={BOARD_STRINGS[language].searchCoverage} total={6}>
    <Lanes />
    <SearchInput iconSize={size} iconColor="#777777" value={query} />
    <SearchCoverageItems theme={theme} phone={phone} />
  </SearchCoverageProvider>;
  act(() => { renderer = TestRenderer.create(render()); });
  return {
    retry,
    update(next: typeof counts) { counts = next; act(() => { listeners.forEach((listener) => listener()); }); },
    query(next: string) { query = next; act(() => renderer.update(render())); },
    get laneRenders() { return unrelatedRenders; },
  };
}

const state = (pending = 0, unavailable = 0, failed = 0, retrying = 0) => ({ pending, unavailable, failed, retrying });
const matrix = [
  ["pending", state(23), false],
  ["pending + unavailable", state(23, 56), true],
  ["all three", state(23, 56, 9), true],
  ["unavailable", state(0, 56), true],
  ["failed", state(0, 0, 9), true],
  ["unavailable + failed", state(0, 56, 9), true],
  ["retrying", state(9, 56, 0, 9), true],
  ["finished", state(), false],
  ["popover", state(23, 56, 9), true],
  ["long English", state(23, 56, 9), true],
] as const;

describe.each(["en", "zh"] as const)("search coverage (%s)", (language) => {
  it.each(matrix)("renders matrix %s", (name, counts, visible) => {
    mount(counts, language, true);
    expect(hosts("search-coverage-items")).toHaveLength(visible ? 1 : 0);
    if (visible) {
      expect(hosts("search-coverage-items")[0]!.props.style.height).toBe(1);
      expect(hosts("search-coverage-unavailable")).toHaveLength(counts.unavailable ? 1 : 0);
      expect(hosts("search-coverage-retry")).toHaveLength(counts.failed && !counts.retrying ? 1 : 0);
      if (counts.retrying) expect(text(hosts("search-coverage-failure")[0]!)).toContain(BOARD_STRINGS[language].searchCoverage.retrying(9));
    }
    if (name === "popover") {
      act(() => hosts("search-coverage-unavailable")[0]!.props.onPress());
      expect(text(hosts("search-coverage-popover")[0]!)).toContain(BOARD_STRINGS[language].searchCoverage.unavailableHint);
      act(() => hosts("search-coverage-popover-retry")[0]!.props.onPress());
      act(() => hosts("search-coverage-backdrop")[0]!.props.onPress());
      expect(hosts("search-coverage-popover")).toHaveLength(0);
    }
  });
});

it.each([13, 16, 15])("delays the %s px icon 300 ms, holds 400 ms, then crossfades 120 ms", (size) => {
  const mounted = mount(state(23), "zh", false, size);
  expect(hosts("search-icon-slot")[0]!.props.style.width).toBe(size);
  act(() => { vi.advanceTimersByTime(299); });
  expect(hosts("search-spinner")).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(hosts("search-spinner")).toHaveLength(1);
  mounted.update(state(22));
  mounted.update(state());
  act(() => { vi.advanceTimersByTime(399); });
  expect(hosts("search-spinner")).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(1); });
  expect(hosts("search-spinner")).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(120); });
  expect(hosts("search-spinner")).toHaveLength(0);
  expect(mounted.laneRenders).toBe(1);
});

it("never flashes for a short read and resets the delay for a new query", () => {
  const mounted = mount(state(1));
  act(() => { vi.advanceTimersByTime(180); });
  mounted.update(state());
  act(() => { vi.advanceTimersByTime(1000); });
  expect(hosts("search-spinner")).toHaveLength(0);
  mounted.update(state(2));
  act(() => { vi.advanceTimersByTime(300); });
  expect(hosts("search-spinner")).toHaveLength(1);
  mounted.query("other");
  expect(hosts("search-spinner")).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(299); });
  expect(hosts("search-spinner")).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(hosts("search-spinner")).toHaveLength(1);
});

it("announces start and completion only; intermediate counts are silent", () => {
  const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
  const mounted = mount(state(23, 56, 9));
  const announcement = () => text(hosts("search-announcement")[0]!);
  expect(announcement()).toBe("");
  act(() => { vi.advanceTimersByTime(300); });
  expect(announcement()).toBe("正在搜索首条消息");
  mounted.update(state(22, 56, 9));
  mounted.update(state(12, 56, 9));
  expect(announcement()).toBe("正在搜索首条消息");
  mounted.update(state(0, 56, 9));
  expect(announcement()).toBe(BOARD_STRINGS.zh.searchCoverage.complete(6, 56, 9));
  mounted.update(state(0, 55, 9));
  expect(announcement()).toBe(BOARD_STRINGS.zh.searchCoverage.complete(6, 56, 9));
  expect(announce.mock.calls).toEqual([["正在搜索首条消息"], [BOARD_STRINGS.zh.searchCoverage.complete(6, 56, 9)]]);
  announce.mockRestore();
});

it.each([13, 16, 15])("clearing the query removes %s px spinner and items immediately, and clears busy", (size) => {
  const mounted = mount(state(23, 56, 9), "en", false, size);
  act(() => { vi.advanceTimersByTime(300); });
  mounted.query(" ");
  expect(hosts("search-spinner")).toHaveLength(0);
  expect(hosts("search-coverage-items")).toHaveLength(0);
  expect(renderer.root.findAll((node) => String(node.type) === "TextInput")[0]!.props.accessibilityState.busy).toBe(false);
});

it("squeezes only the unavailable text and keeps failed + retry complete", () => {
  mount(state(0, 56, 9), "en", true);
  act(() => {
    hosts("search-coverage-items")[0]!.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    hosts("search-coverage-failure")[0]!.props.onLayout({ nativeEvent: { layout: { width: 130 } } });
    renderer.root.findAll((node) => String(node.type) === "Text" && node.props.onLayout)[0]!.props.onLayout({ nativeEvent: { layout: { width: 120 } } });
  });
  expect(text(hosts("search-coverage-unavailable")[0]!)).toBe("56");
  expect(text(hosts("search-coverage-failure")[0]!)).toContain("9 failedRetry");
});

it("opens after 300 ms hover and cancels an interrupted hover", () => {
  mount(state(0, 56));
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
    mount(state(1));
    act(() => { vi.advanceTimersByTime(300); });
    const pulse = timing.mock.calls.filter(([, config]) => config.duration === 800);
    expect(pulse.map(([, config]) => config.toValue)).toEqual([1, 0]);
    expect(hosts("search-spinner")[0]!.props.style.transform).toBeUndefined();
  } finally { motion.reduced = false; timing.mockRestore(); }
});

it("returns from retrying to partial failure or fades out after complete success", () => {
  const mounted = mount(state(9, 0, 0, 9));
  expect(text(hosts("search-coverage-failure")[0]!)).toBe("正在重试 9 个");
  mounted.update(state(0, 0, 2));
  expect(text(hosts("search-coverage-failure")[0]!)).toContain("2 个读取失败");
  expect(hosts("search-coverage-retry")).toHaveLength(1);
  mounted.update(state(2, 0, 0, 2));
  mounted.update(state());
  act(() => { vi.advanceTimersByTime(120); });
  expect(hosts("search-coverage-items")).toHaveLength(0);
});

it("uses the JS driver for both animations on the phone coverage row", () => {
  const timing = vi.spyOn(Animated, "timing");
  try {
    const mounted = mount(state(), "zh", true);
    timing.mockClear();
    mounted.update(state(0, 1));
    const rowAnimations = timing.mock.calls.filter(([, config]) => config.duration === 120 || config.duration === 160);
    expect(rowAnimations.map(([, config]) => config.useNativeDriver)).toEqual([false, false]);
    timing.mockClear();
    mounted.update(state());
    expect(timing.mock.calls.filter(([, config]) => config.duration === 120 || config.duration === 160).map(([, config]) => config.useNativeDriver)).toEqual([false, false]);
  } finally { timing.mockRestore(); }
});
