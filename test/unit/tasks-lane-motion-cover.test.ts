import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import type { LaneId, LaneModel, TaskCard } from "../../client/tasks/model";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

type Box = { x: number; y: number; width: number; height: number };
const node = (box: () => Box | null) => ({
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void) {
    const at = box();
    if (at) callback(at.x, at.y, at.width, at.height);
  },
});

function lanes(running: string[]): Record<LaneId, LaneModel> {
  const lane = (ids: string[]) => ({ cards: ids.map((id) => ({ id }) as TaskCard) }) as LaneModel;
  return { needs_input: lane([]), running: lane(running), review: lane([]), done: lane([]), archived: lane([]) };
}

describe("native lane motion (cover)", () => {
  it("slides the cards above down when the last card leaves a list scrolled to its end", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    vi.resetModules();
    const { createLaneMotionStore } = await import("../../client/tasks/board/lane-motion");
    const store = createLaneMotionStore(false);
    // A 400-tall list at y 100, scrolled 80 down to the end of its 480-tall content.
    const content = { x: 0, y: 20, width: 300, height: 480 };
    const at: Record<string, Box | null> = {
      a: { x: 0, y: 40, width: 300, height: 100 },
      b: { x: 0, y: 160, width: 300, height: 100 },
      c: { x: 0, y: 280, width: 300, height: 100 },
    };
    store.layer = node(() => ({ x: 0, y: 100, width: 300, height: 400 }));
    const scroller = { ...node(() => ({ x: 0, y: 100, width: 300, height: 400 })), getInnerViewRef: () => node(() => content) };
    store.setLane("running", () => scroller);
    for (const id of ["a", "b", "c"]) store.attach(id, node(() => at[id] ?? null), null);

    const last = lanes(["a", "b", "c"]);
    const next = lanes(["a", "b"]);
    const before = store.snapshot(last);
    store.freeze(before, last, next);
    expect(store.covered().has("running")).toBe(true);
    // Laid out without c, measured with the list's old offset: the content is 120 shorter.
    at.c = null;
    content.height = 360;
    store.play(before, next);

    const ghosts = new Map(store.ghosts().map((ghost) => [ghost.key, ghost]));
    // The list will scroll back by 80 (all of it): a and b go to where they will be then.
    expect(ghosts.get("a")).toMatchObject({ from: { y: 40 }, to: { y: 120 }, fade: "none" });
    expect(ghosts.get("b")).toMatchObject({ from: { y: 160 }, to: { y: 240 }, fade: "none" });
    expect(ghosts.get("c")).toMatchObject({ from: { y: 280 }, fade: "out" });
    store.settle();
  });

  it("leaves the cards where they are when the list has room to keep its offset", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    vi.resetModules();
    const { createLaneMotionStore } = await import("../../client/tasks/board/lane-motion");
    const store = createLaneMotionStore(false);
    // Scrolled 80 into 800 of content: losing a card still leaves 680, more than the offset needs.
    const content = { x: 0, y: 20, width: 300, height: 800 };
    const at: Record<string, Box | null> = {
      a: { x: 0, y: 40, width: 300, height: 100 },
      b: { x: 0, y: 160, width: 300, height: 100 },
    };
    store.layer = node(() => ({ x: 0, y: 100, width: 300, height: 400 }));
    const scroller = { ...node(() => ({ x: 0, y: 100, width: 300, height: 400 })), getInnerViewRef: () => node(() => content) };
    store.setLane("running", () => scroller);
    for (const id of ["a", "b"]) store.attach(id, node(() => at[id] ?? null), null);

    const last = lanes(["a", "b"]);
    const next = lanes(["b"]);
    const before = store.snapshot(last);
    store.freeze(before, last, next);
    at.a = null;
    at.b = { x: 0, y: 40, width: 300, height: 100 };
    content.height = 680;
    store.play(before, next);

    const ghosts = new Map(store.ghosts().map((ghost) => [ghost.key, ghost]));
    expect(ghosts.get("b")).toMatchObject({ from: { y: 160 }, to: { y: 40 } });
    store.settle();
  });

  it("goes on with a copy fading out when another change covers its lane", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    vi.resetModules();
    const { createLaneMotionStore } = await import("../../client/tasks/board/lane-motion");
    const store = createLaneMotionStore(false);
    const content = { x: 0, y: 20, width: 300, height: 800 };
    const at: Record<string, Box | null> = {
      a: { x: 0, y: 40, width: 300, height: 100 },
      b: { x: 0, y: 160, width: 300, height: 100 },
    };
    store.layer = node(() => ({ x: 0, y: 100, width: 300, height: 400 }));
    const scroller = { ...node(() => ({ x: 0, y: 100, width: 300, height: 400 })), getInnerViewRef: () => node(() => content) };
    store.setLane("running", () => scroller);
    for (const id of ["a", "b"]) store.attach(id, node(() => at[id] ?? null), null);

    const first = lanes(["a", "b"]);
    const second = lanes(["b"]);
    let before = store.snapshot(first);
    store.freeze(before, first, second);
    at.a = null;
    at.b = { x: 0, y: 40, width: 300, height: 100 };
    store.play(before, second);
    const fading = store.ghosts().find((ghost) => ghost.key === "a")!;
    expect(fading.fade).toBe("out");

    // A second change while a still fades: the same ghost, so its animation is not started over.
    const third = lanes([]);
    before = store.snapshot(second);
    store.freeze(before, second, third);
    expect(store.ghosts().find((ghost) => ghost.key === "a")).toBe(fading);
    store.settle();
  });

  it.each([[3, true], [6, false]] as const)("covers a change of %i cards past a churn limit of 4: %s", async (added, covers) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetModules();
    const { useLaneMotion } = await import("../../client/tasks/board/lane-motion");
    type Store = ReturnType<typeof useLaneMotion>;
    let store: Store | undefined;
    const coveredInRender: boolean[] = [];
    function Board(props: { lanes: Record<LaneId, LaneModel> }) {
      store = useLaneMotion(props.lanes, { enabled: true, scope: null, flights: true, churnLimit: 4 });
      coveredInRender.push(store.covered().has("running"));
      return null;
    }
    const at: Record<string, Box> = { a: { x: 0, y: 140, width: 300, height: 100 }, b: { x: 0, y: 260, width: 300, height: 100 } };
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(Board, { lanes: lanes(["a", "b"]) }));
    });
    store!.layer = node(() => ({ x: 0, y: 100, width: 300, height: 400 }));
    store!.setLane("running", () => ({ ...node(() => ({ x: 0, y: 100, width: 300, height: 400 })), getInnerViewRef: () => node(() => ({ x: 0, y: 100, width: 300, height: 400 })) }));
    for (const id of ["a", "b"]) store!.attach(id, node(() => at[id]!), null);
    const subtasks = Array.from({ length: added }, (_, index) => `s${index}`);
    act(() => renderer!.update(React.createElement(Board, { lanes: lanes(["a", ...subtasks, "b"]) })));
    // The render that carries the new lanes is the one that decides the cover.
    expect(coveredInRender.at(-1)).toBe(covers);
    act(() => renderer!.unmount());
  });

  it.each([["ios", true], ["web", false]] as const)("%s moves the copies with useNativeDriver %s, from a fresh value per flight", async (os, native) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetModules();
    const rn = await import("react-native");
    const timing = vi.spyOn(rn.Animated, "timing");
    const { LaneMotionLayer } = await import("../../client/tasks/board/lane-motion");
    const listeners = new Set<() => void>();
    const box = { x: 0, y: 0, width: 300, height: 100 };
    const ghost = (start: number) => ({ key: "a", card: { id: "a" } as TaskCard, from: box, to: { ...box, y: 120 }, fade: "none" as const, reveal: false, start, duration: 200, origin: { x: 0, y: 0 } });
    let ghosts = [ghost(Number.POSITIVE_INFINITY)];
    const store = {
      layer: null,
      ghosts: () => ghosts,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      finish: () => {},
    } as unknown as Parameters<typeof LaneMotionLayer>[0]["store"];
    const renderCard = (card: TaskCard) => React.createElement("Card", { id: card.id });
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(LaneMotionLayer, { store, renderCard }));
    });
    // Waiting for its new place: drawn at rest, not animated.
    expect(timing).not.toHaveBeenCalled();
    ghosts = [ghost(Date.now())];
    act(() => listeners.forEach((listener) => listener()));
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0]![1]).toMatchObject({ toValue: 1, useNativeDriver: native });
    // Another copy's update leaves this one's animation alone.
    ghosts = [ghosts[0]!, { ...ghost(Date.now()), key: "b" }];
    act(() => listeners.forEach((listener) => listener()));
    expect(timing).toHaveBeenCalledTimes(2);
    expect(timing.mock.calls[1]![0]).not.toBe(timing.mock.calls[0]![0]);
    // Sent on from where it is: a new value, starting at 0 in the draw that moves it.
    ghosts = [ghost(Date.now()), ghosts[1]!];
    act(() => listeners.forEach((listener) => listener()));
    expect(timing).toHaveBeenCalledTimes(3);
    const sent = timing.mock.calls[2]![0] as unknown as { __value: number };
    expect(sent).not.toBe(timing.mock.calls[0]![0]);
    expect(sent.__value).toBe(0);
    act(() => renderer!.unmount());
    timing.mockRestore();
  });
});
