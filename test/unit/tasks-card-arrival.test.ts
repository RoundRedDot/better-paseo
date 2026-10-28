import { afterEach, describe, expect, it, vi } from "vitest";
import type { LaneId, LaneModel, TaskCard } from "../../client/tasks/model";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

const card = (id: string, lane: LaneId = "running") => ({ id, title: id, lane }) as TaskCard;
function lanes(cards: TaskCard[]): Record<LaneId, LaneModel> {
  return Object.fromEntries(["needs_input", "running", "review", "done", "archived"].map((id) => [id, { cards: cards.filter((card) => card.lane === id) }])) as Record<LaneId, LaneModel>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

async function setup(os: string) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
  vi.resetModules();
  vi.useFakeTimers();
  const { Animated } = await import("react-native");
  const { createLaneMotionStore } = await import("../../client/tasks/board/lane-motion");
  const store = createLaneMotionStore(true);
  const boxes = {
    a: { x: 0, y: 0, width: 300, height: 100 },
    b: { x: 0, y: 120, width: 300, height: 100 },
  };
  const node = (box: () => typeof boxes.a) => ({
    getBoundingClientRect: () => ({ left: box().x, top: box().y, width: box().width, height: box().height }),
    measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) => done(box().x, box().y, box().width, box().height),
  });
  const viewport = { x: 0, y: 0, width: 700, height: 600 };
  store.layer = node(() => viewport);
  const values = () => os === "web" ? { x: new Animated.Value(0), y: new Animated.Value(0), opacity: new Animated.Value(1) } : null;
  const a = vi.fn();
  const b = vi.fn();
  store.attach("a", node(() => boxes.a), values(), a);
  store.attach("b", node(() => boxes.b), values(), b);
  return { store, boxes, a, b, Animated };
}

describe("updated card arrival", () => {
  it.each(["web", "ios"])("%s pulses only the renamed card after its reorder finishes", async (os) => {
    const { store, boxes, a, b, Animated } = await setup(os);
    const done: Array<(result: { finished: boolean }) => void> = [];
    vi.spyOn(Animated, "parallel").mockImplementation(() => ({ start: (callback) => { if (callback) done.push(callback); }, stop() {}, reset() {} }));
    const first = [card("a"), card("b")];
    const last = lanes(first);
    const next = lanes([first[1]!, { ...first[0]!, title: "Renamed" }]);
    const before = store.snapshot(last);
    store.freeze(before, last, next);
    boxes.a.y = 120;
    boxes.b.y = 0;
    store.play(before, next);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    if (os === "web") done.forEach((callback) => callback({ finished: true }));
    else {
      vi.advanceTimersByTime(350);
      store.finish("a");
    }
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    store.settle();
  });

  it.each(["web", "ios"])("%s pulses a status change after it lands in another lane", async (os) => {
    const { store, boxes, a, b } = await setup(os);
    const first = [card("a"), card("b")];
    const last = lanes(first);
    const next = lanes([{ ...first[0]!, lane: "review", status: "unread" }, first[1]!]);
    const before = store.snapshot(last);
    store.freeze(before, last, next);
    boxes.a.x = 350;
    store.play(before, next);
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    store.finish("a");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    store.finish("a");
    expect(a).toHaveBeenCalledTimes(1);
    store.settle();
  });

  it.each(["web", "ios"])("%s cancels arrival emphasis when motion is settled", async (os) => {
    const { store, boxes, a } = await setup(os);
    const first = [card("a"), card("b")];
    const last = lanes(first);
    const next = lanes([{ ...first[0]!, lane: "review" }, first[1]!]);
    const before = store.snapshot(last);
    store.freeze(before, last, next);
    boxes.a.x = 350;
    store.play(before, next);
    store.settle();
    vi.advanceTimersByTime(1500);
    store.finish("a");
    expect(a).not.toHaveBeenCalled();
  });
});
