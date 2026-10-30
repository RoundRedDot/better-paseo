import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import { Animated } from "react-native";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { ScrollView: rn.ScrollView, TextInput: rn.TextInput, Icon: () => null };
});
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => ({}), useRpc: () => vi.fn() }));
// Each render of the sheet body draws its done-range segments once: counting them counts the body's renders.
const sheetRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../client/tasks/board/board-parts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../client/tasks/board/board-parts")>();
  return {
    ...actual,
    WindowSegments: (props: Parameters<typeof actual.WindowSegments>[0]) => {
      sheetRenders.count++;
      return actual.WindowSegments(props);
    },
  };
});

import { FilterSheetBody } from "../../client/tasks/board/filter-sheet";
import { EMPTY_PARAMS, type BoardParams } from "../../client/tasks/board/params";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import type { FilterOptions } from "../../client/tasks/board/filter-options";
import type { BoardController } from "../../client/tasks/board/use-board";
import { setTasksSettingsOpener } from "../../client/tasks/board/enabled";

const theme = {
  colors: {
    surface0: "#ffffff", surface1: "#fafafa", surface2: "#eeeeee", border: "#dddddd",
    foreground: "#111111", foregroundMuted: "#777777", accent: "#20744a", accentForeground: "#ffffff",
    statusSuccess: "#20744a", statusWarning: "#aa7700", statusDanger: "#dd3333",
  },
};
const board = {
  params: EMPTY_PARAMS, defaults: { hideSubtasks: false, doneWindow: "24h" }, strings: BOARD_STRINGS.en,
  showEmptyGroups: false, total: 0, tasks: { requestProjectIcon() {} }, setParams() {},
} as unknown as BoardController;

let renderer: TestRenderer.ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  setTasksSettingsOpener(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(controller = board, options: FilterOptions = { agents: [], labels: [], workspaceGroups: [] }) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  act(() => {
    renderer = TestRenderer.create(<FilterSheetBody board={controller} theme={theme} options={options} onDone={() => {}} />);
  });
  return renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "filter-sheet-scroll");
}

describe("filter sheet reset", () => {
  it("closes the sheet and opens Tasks settings from the footer", () => {
    const calls: string[] = [];
    setTasksSettingsOpener(() => calls.push("settings"));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    act(() => {
      renderer = TestRenderer.create(<FilterSheetBody board={board} theme={theme} options={{ agents: [], labels: [], workspaceGroups: [] }} onDone={() => calls.push("close")} />);
    });
    const button = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "filter-sheet-settings");
    expect(button.props.accessibilityLabel).toBe(BOARD_STRINGS.en.openSettings);
    const footer = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "filter-sheet-footer");
    expect(footer.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.testID)).toEqual(["filter-sheet-reset", undefined, "filter-sheet-settings"]);
    expect(button.findAll((node) => (node.type as unknown) === "Text").map((node) => node.children.join(""))).toContain("Settings");
    act(() => button.props.onPress());
    expect(calls).toEqual(["close", "settings"]);
  });

  it.each(["ios", "android", "web"])("clears active filters and keeps sorting on %s", (os) => {
    vi.stubGlobal("__rnMockOS", os);
    const params: BoardParams = {
      ...EMPTY_PARAMS, query: "监控", providers: ["codex"], labels: ["linear"], workspaceIds: ["workspace"],
      doneWindow: "7d", sort: { key: "title", direction: "asc" },
    };
    const setParams = vi.fn();
    const scroll = render({ ...board, params, setParams });
    const reset = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "filter-sheet-reset");
    expect(scroll.findAll((node) => node === reset)).toHaveLength(0);
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "filter-sheet-clear-all")).toHaveLength(0);
    act(() => reset.props.onPress());
    expect(setParams).toHaveBeenCalledOnce();
    expect(setParams.mock.calls[0]![0](params)).toEqual({ ...EMPTY_PARAMS, sort: params.sort });
  });
});

describe("filter sheet groups", () => {
  it("places lane width and time range between switches and agents on the board filter panel", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    act(() => {
      renderer = TestRenderer.create(<FilterSheetBody board={board} theme={theme} options={{ agents: [], labels: [], workspaceGroups: [] }} showEmptyGroupsToggle laneWidth={{ value: "default", onChange() {} }} onDone={() => {}} />);
    });
    const ids = renderer!.root.findAll((node) => typeof node.type === "string" && ["filter-sheet-subtasks", "filter-sheet-empty-groups", "filter-sheet-lane-width", "filter-sheet-range-toggle", "filter-sheet-agents-toggle"].includes(node.props.testID)).map((node) => node.props.testID);
    expect(ids).toEqual(["filter-sheet-subtasks", "filter-sheet-empty-groups", "filter-sheet-lane-width", "filter-sheet-range-toggle", "filter-sheet-agents-toggle"]);
  });

  it("folds the time range, sort and workspaces independently without changing filters", () => {
    const setParams = vi.fn();
    render({ ...board, setParams }, {
      agents: [], labels: [],
      workspaceGroups: [{ projectId: "p", projectName: "Project", items: [{ id: "w", label: "main", count: 1, on: true }] }] as FilterOptions["workspaceGroups"],
    });
    const find = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    expect(find("filter-sheet-workspaces").props.style.paddingBottom).toBe(0);
    act(() => find("filter-sheet-workspaces-toggle").props.onPress());
    expect(find("filter-sheet-workspaces").props.style.paddingBottom).toBe(8);
    act(() => find("filter-sheet-workspaces-toggle").props.onPress());
    for (const group of ["range", "sort-group", "workspaces"]) {
      const toggle = find(`filter-sheet-${group}-toggle`);
      expect(toggle.props.accessibilityState.expanded).toBe(false);
      act(() => toggle.props.onPress());
      expect(toggle.props.accessibilityState.expanded).toBe(true);
      act(() => toggle.props.onPress());
      expect(toggle.props.accessibilityState.expanded).toBe(false);
    }
    expect(find("filter-sheet-range-content").props.accessibilityElementsHidden).toBe(true);
    expect(find("filter-sheet-sort-group-content").props.accessibilityElementsHidden).toBe(true);
    expect(renderer!.root.findAll((node) => node.props.testID === "filter-sheet-search")).toHaveLength(0);
    act(() => find("filter-sheet-workspaces-toggle").props.onPress());
    expect(find("filter-sheet-search")).toBeDefined();
    expect(renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "checkbox")[0]!.props.accessibilityState.checked).toBe(true);
    expect(setParams).not.toHaveBeenCalled();
  });

  it("folds each group independently without changing selected filters", () => {
    const params = { ...EMPTY_PARAMS, providers: ["codex"], labels: ["bug"] };
    const setParams = vi.fn();
    const timing = vi.spyOn(Animated, "timing");
    render({ ...board, params, setParams }, {
      agents: [{ id: "codex", label: "Codex", count: 1, on: true }],
      labels: [{ id: "bug", label: "bug", count: 1, on: true }],
      workspaceGroups: [],
    });
    const toggle = (id: string) => renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === id);
    const choices = () => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "checkbox");
    expect(choices()).toHaveLength(2);
    act(() => toggle("filter-sheet-agents-toggle").props.onPress());
    act(() => toggle("filter-sheet-labels-toggle").props.onPress());
    act(() => toggle("filter-sheet-agents-toggle").props.onPress());
    expect(toggle("filter-sheet-agents-toggle").props.accessibilityState.expanded).toBe(false);
    expect(toggle("filter-sheet-labels-toggle").props.accessibilityState.expanded).toBe(true);
    expect(toggle("filter-sheet-agents-content").props.accessibilityElementsHidden).toBe(true);
    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, duration: 140, useNativeDriver: false }));
    act(() => toggle("filter-sheet-labels-toggle").props.onPress());
    expect(choices()).toHaveLength(2);
    act(() => toggle("filter-sheet-agents-toggle").props.onPress());
    act(() => toggle("filter-sheet-labels-toggle").props.onPress());
    expect(choices()).toHaveLength(2);
    expect(choices().every((choice) => choice.props.accessibilityState.checked)).toBe(true);
    expect(setParams).not.toHaveBeenCalled();
    expect(timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 1, duration: 180 }));
    timing.mockRestore();
  });
});

describe("filter sheet group folding cost", () => {
  it("folds a group and follows its height change without rendering the rest of the sheet", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const scrollTo = vi.fn();
    const options: FilterOptions = {
      agents: [{ id: "codex", label: "Codex", count: 1, on: false }],
      labels: [{ id: "bug", label: "bug", count: 1, on: false }],
      workspaceGroups: [{ projectId: "p", projectName: "Project", items: [{ id: "w", label: "main", count: 1, on: false }] }] as FilterOptions["workspaceGroups"],
    };
    act(() => {
      renderer = TestRenderer.create(<FilterSheetBody board={board} theme={theme} options={options} onDone={() => {}} />, { createNodeMock: () => ({ scrollTo }) });
    });
    const find = (match: (props: Record<string, unknown>) => boolean) => renderer!.root.find((node) => typeof node.type === "string" && match(node.props));
    const before = sheetRenders.count;
    expect(before).toBeGreaterThan(0);

    act(() => (find((props) => props.testID === "filter-sheet-agents-toggle").props.onPress as () => void)());
    act(() => (find((props) => props.testID === "filter-sheet-agents-toggle").props.onPress as () => void)());
    expect(find((props) => props.testID === "filter-sheet-agents-toggle").props.accessibilityState).toEqual({ expanded: false });
    // While the group folds, the block above the workspaces reports a new height on every frame.
    const top = find((props) => typeof props.onLayout === "function" && (props.style as { paddingHorizontal?: number } | undefined)?.paddingHorizontal === 16);
    for (const height of [520, 470, 430]) act(() => (top.props.onLayout as (event: unknown) => void)({ nativeEvent: { layout: { height } } }));
    expect(sheetRenders.count).toBe(before);

    // The search still scrolls to where the workspaces start now.
    act(() => (find((props) => props.testID === "filter-sheet-workspaces-toggle").props.onPress as () => void)());
    const field = find((props) => props.accessibilityLabel === BOARD_STRINGS.en.sheetSearch);
    act(() => (field.props.onFocus as () => void)());
    act(() => {
      vi.runAllTimers();
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 430, animated: true });
  });
});

describe("filter sheet scrollbar", () => {
  it("starts hidden on web, stays visible through scrolling, and hides after the last scroll", () => {
    vi.useFakeTimers();
    vi.stubGlobal("__rnMockOS", "web");
    const listeners = new Map<string, EventListener>();
    const styles = new Map<string, { id: string; textContent: string; remove(): void }>();
    vi.stubGlobal("document", {
      getElementById: (id: string) => styles.get(id),
      createElement: () => ({ id: "", textContent: "", remove() { styles.delete(this.id); } }),
      head: { appendChild: (style: { id: string; textContent: string; remove(): void }) => styles.set(style.id, style) },
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    class Element {
      attrs = new Map<string, string>();
      hasAttribute(name: string) { return this.attrs.has(name); }
      setAttribute(name: string, value: string) { this.attrs.set(name, value); }
      removeAttribute(name: string) { this.attrs.delete(name); }
    }
    vi.stubGlobal("Element", Element);

    const scroll = render();
    expect(scroll.props.showsVerticalScrollIndicator).toBe(true);
    expect(scroll.props.dataSet).toEqual({ bcdetails: "inset" });
    const element = new Element();
    element.setAttribute("data-bcdetails", scroll.props.dataSet.bcdetails);
    const css = styles.get("better-paseo-lane-scrollbar")!.textContent;
    expect(css).toMatch(/\[data-bcdetails="inset"\] \{[^}]*--bc-scroll-thumb: transparent;/);
    expect(css).toContain('[data-bcdetails="inset"][data-bcscrolling]');
    expect(css).toContain('[data-bcdetails="inset"][data-bcscrolling]::-webkit-scrollbar-thumb:hover');
    expect(css).not.toContain('[data-bcdetails="inset"]::-webkit-scrollbar-thumb:hover');
    expect(element.hasAttribute("data-bcscrolling")).toBe(false);

    const scrollEvent = () => listeners.get("scroll")!({ target: element } as unknown as Event);
    scrollEvent();
    expect(element.hasAttribute("data-bcscrolling")).toBe(true);
    vi.advanceTimersByTime(700);
    scrollEvent();
    vi.advanceTimersByTime(799);
    expect(element.hasAttribute("data-bcscrolling")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(element.hasAttribute("data-bcscrolling")).toBe(false);

    // Each details column has its own idle timer; scrolling one leaves the other hidden.
    const other = new Element();
    other.setAttribute("data-bcdetails", "inset");
    scrollEvent();
    expect(other.hasAttribute("data-bcscrolling")).toBe(false);
    vi.advanceTimersByTime(300);
    listeners.get("scroll")!({ target: other } as unknown as Event);
    vi.advanceTimersByTime(500);
    expect(element.hasAttribute("data-bcscrolling")).toBe(false);
    expect(other.hasAttribute("data-bcscrolling")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(other.hasAttribute("data-bcscrolling")).toBe(false);

    const footer = renderer!.root.find((node) => typeof node.type === "string" && node.props.testID === "filter-sheet-footer");
    expect(scroll.findAll((node) => node === footer)).toHaveLength(0);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(listeners.has("scroll")).toBe(false);
    expect(styles.size).toBe(0);
  });

  it.each(["ios", "android"])("keeps the platform's transient indicator on %s", (os) => {
    vi.stubGlobal("__rnMockOS", os);
    const scroll = render();
    expect(scroll.props.showsVerticalScrollIndicator).toBe(true);
    expect(scroll.props.dataSet).toBeUndefined();
    expect(scroll.props.scrollIndicatorInsets).toEqual({ bottom: 8 });
  });
});
