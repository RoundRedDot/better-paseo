import { describe, expect, it, vi } from "vitest";
import type { LaneId, LaneModel, TaskCard } from "../../client/tasks/model";

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
  return { needs_input: lane([]), running: lane(running), review: lane([]), done: lane([]) };
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
});
