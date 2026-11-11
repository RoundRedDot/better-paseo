import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import type { PluginTheme } from "@getpaseo/plugin";
import type { LaneId, LaneModel, TaskCard } from "../../client/tasks/model";

vi.mock("react-native", async () => import("./helpers/rn-mock"));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
import { Animated } from "react-native";
import { CollapsedArrivalMarker, createCollapsedArrivals } from "../../client/tasks/board/collapsed-arrivals";
import { TasksTypographyScale } from "../../client/tasks/typography";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { withAlpha } from "../../client/components/theme-tokens";

const now = Date.parse("2026-11-10T12:00:00Z");
const card = (id: string, lane: LaneId, age = 0) => ({ id, lane, timing: { createdAt: new Date(now - age).toISOString() } }) as TaskCard;
const lanes = (cards: TaskCard[]) => Object.fromEntries(["needs_input", "running", "review", "done", "archived"].map((lane) => [lane, { cards: cards.filter((item) => item.lane === lane) }])) as Record<LaneId, LaneModel>;
const theme = { colors: { surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#09090b", foregroundMuted: "#71717a", accent: "#2563eb", accentForeground: "#ffffff", statusSuccess: "#16a34a", statusWarning: "#d97706", statusDanger: "#dc2626" } } as PluginTheme;

beforeEach(() => { motion.reduced = false; });

describe("collapsed lane arrivals", () => {
  it.each([[1, 22, 1], [10, 26, 10], [100, 32, "99+"]] as const)("keeps %i arrivals in a circle", (count, diameter, label) => {
    const ids = Array.from({ length: count }, (_, index) => String(index));
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<TasksTypographyScale factor={1.5}><CollapsedArrivalMarker ids={ids} lane="review" theme={theme} /></TasksTypographyScale>); });
    const marker = renderer.root.findByProps({ testID: "lane-new-marker-review" }).findByType(Animated.View);
    expect(marker.props.style).toMatchObject({ width: diameter * 1.5, height: diameter * 1.5, borderRadius: diameter * 0.75 });
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.children).toEqual(["+", label]);
    act(() => renderer.unmount());
  });

  it.each(["needs_input", "running", "review", "done", "archived"] as const)("uses a soft %s status color", (lane) => {
    const tokens = taskTokens(theme);
    const colors = { needs_input: tokens.status.warning, running: tokens.status.running, review: tokens.status.success, done: tokens.status.success, archived: tokens.foregroundMuted };
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<CollapsedArrivalMarker ids={["a"]} lane={lane} theme={theme} />); });
    const marker = renderer.root.findByProps({ testID: `lane-new-marker-${lane}` }).findByType(Animated.View);
    expect(marker.props.style.backgroundColor).toBe(withAlpha(colors[lane], 0.2));
    expect(renderer.root.findByProps({ testID: `lane-new-count-${lane}` }).props.style.color).toBe(theme.colors.foreground);
    act(() => renderer.unmount());
  });

  it("keeps the count readable on a dark theme", () => {
    const darkTheme = { colors: { ...theme.colors, surface0: "#18181b", foreground: "#fafafa" } } as typeof theme;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<CollapsedArrivalMarker ids={["a"]} lane="review" theme={darkTheme} />); });
    const marker = renderer.root.findByProps({ testID: "lane-new-marker-review" }).findByType(Animated.View);
    expect(marker.props.style.backgroundColor).toBe(withAlpha(taskTokens(darkTheme).status.success, 0.25));
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.style.color).toBe(darkTheme.colors.foreground);
    act(() => renderer.unmount());
  });

  it("counts cards moving into a folded lane and fresh tasks, even if another leaves in the same update", () => {
    const store = createCollapsedArrivals();
    const a = card("a", "running", 100000);
    const b = card("b", "running", 100000);
    store.track(lanes([a, b]), ["review"], "all", true, now);
    store.track(lanes([{ ...a, lane: "review" }, b, card("new", "review")]), ["review"], "all", true, now);
    expect(store.get("review")).toEqual(["a", "new"]);
    store.track(lanes([{ ...b, lane: "review" }, card("new", "review")]), ["review"], "all", true, now);
    expect(store.get("review")).toEqual(["new", "b"]);
    store.track(lanes([{ ...b, lane: "review" }, card("new", "review")]), [], "all", true, now);
    expect(store.get("review")).toEqual([]);
  });

  it("seeds initial data, ignores old pagination and resets on scope changes", () => {
    const store = createCollapsedArrivals();
    store.track(lanes([card("a", "review")]), ["review"], "all", true, now);
    store.track(lanes([card("a", "review"), card("old", "review", 120000)]), ["review"], "all", true, now);
    expect(store.get("review")).toEqual([]);
    store.track(lanes([card("a", "review"), card("old", "review", 120000), card("new", "review")]), ["review"], "filtered", true, now);
    expect(store.get("review")).toEqual([]);
  });

  it("fades and grows the marker only when it appears and keeps it static with reduced motion", () => {
    const timing = vi.spyOn(Animated, "timing");
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<CollapsedArrivalMarker ids={["a"]} lane="review" theme={theme} />); });
    expect(timing).toHaveBeenCalledTimes(1);
    const call = timing.mock.calls[0]!;
    expect(call[1]).toMatchObject({ toValue: 1, duration: 300 });
    expect(renderer.root.findByProps({ testID: "lane-new-marker-review" }).children).toHaveLength(1);
    const marker = renderer.root.findByProps({ testID: "lane-new-marker-review" });
    const animated = marker.findByType(Animated.View);
    expect(animated.props.style.opacity).toBe(call[0]);
    expect(animated.props.style).toMatchObject({ width: 22, height: 22, borderRadius: 11 });
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.style.fontSize).toBe(12);
    const interpolate = vi.spyOn(call[0] as Animated.Value, "interpolate");
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.children).toEqual(["+", 1]);
    act(() => renderer.update(<CollapsedArrivalMarker ids={["a", "b"]} lane="review" theme={theme} />));
    expect(interpolate).toHaveBeenCalledWith({ inputRange: [0, 1], outputRange: [0.45, 1] });
    expect(timing).toHaveBeenCalledTimes(1);
    act(() => renderer.update(<CollapsedArrivalMarker ids={["b"]} lane="review" theme={theme} />));
    expect(timing).toHaveBeenCalledTimes(1);
    motion.reduced = true;
    act(() => renderer.update(<CollapsedArrivalMarker ids={["a", "b", "c"]} lane="review" theme={theme} />));
    expect(timing).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.children).toEqual(["+", 3]);
    act(() => renderer.update(<CollapsedArrivalMarker ids={[]} lane="review" theme={theme} />));
    motion.reduced = false;
    act(() => renderer.update(<CollapsedArrivalMarker ids={["d"]} lane="review" theme={theme} />));
    expect(timing).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
    timing.mockRestore();
  });
});
