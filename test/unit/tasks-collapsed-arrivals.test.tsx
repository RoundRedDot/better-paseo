import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import type { LaneId, LaneModel, TaskCard } from "../../client/tasks/model";

vi.mock("react-native", async () => import("./helpers/rn-mock"));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
import { Animated } from "react-native";
import { CollapsedArrivalMarker, createCollapsedArrivals } from "../../client/tasks/board/collapsed-arrivals";

const now = Date.parse("2026-11-10T12:00:00Z");
const card = (id: string, lane: LaneId, age = 0) => ({ id, lane, timing: { createdAt: new Date(now - age).toISOString() } }) as TaskCard;
const lanes = (cards: TaskCard[]) => Object.fromEntries(["needs_input", "running", "review", "done", "archived"].map((lane) => [lane, { cards: cards.filter((item) => item.lane === lane) }])) as Record<LaneId, LaneModel>;

beforeEach(() => { motion.reduced = false; });

describe("collapsed lane arrivals", () => {
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
    const theme = { colors: { foreground: "#111111", surface0: "#ffffff" } } as never;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(<CollapsedArrivalMarker ids={["a"]} hue="#228844" lane="review" theme={theme} />); });
    expect(timing).toHaveBeenCalledTimes(1);
    const call = timing.mock.calls[0]!;
    expect(call[1]).toMatchObject({ toValue: 1, duration: 300 });
    expect(renderer.root.findByProps({ testID: "lane-new-marker-review" }).children).toHaveLength(1);
    const marker = renderer.root.findByProps({ testID: "lane-new-marker-review" });
    const animated = marker.findByType(Animated.View);
    expect(animated.props.style.opacity).toBe(call[0]);
    const interpolate = vi.spyOn(call[0] as Animated.Value, "interpolate");
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.children).toEqual(["+", 1]);
    act(() => renderer.update(<CollapsedArrivalMarker ids={["a", "b"]} hue="#228844" lane="review" theme={theme} />));
    expect(interpolate).toHaveBeenCalledWith({ inputRange: [0, 1], outputRange: [0.45, 1] });
    expect(timing).toHaveBeenCalledTimes(1);
    act(() => renderer.update(<CollapsedArrivalMarker ids={["b"]} hue="#228844" lane="review" theme={theme} />));
    expect(timing).toHaveBeenCalledTimes(1);
    motion.reduced = true;
    act(() => renderer.update(<CollapsedArrivalMarker ids={["a", "b", "c"]} hue="#228844" lane="review" theme={theme} />));
    expect(timing).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ testID: "lane-new-count-review" }).props.children).toEqual(["+", 3]);
    act(() => renderer.update(<CollapsedArrivalMarker ids={[]} hue="#228844" lane="review" theme={theme} />));
    motion.reduced = false;
    act(() => renderer.update(<CollapsedArrivalMarker ids={["d"]} hue="#228844" lane="review" theme={theme} />));
    expect(timing).toHaveBeenCalledTimes(2);
    act(() => renderer.unmount());
    timing.mockRestore();
  });
});
