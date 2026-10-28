import { describe, expect, it } from "vitest";
import { anchorDrift, inView, laneChurn, laneNeighbours, listScroll, movedCards, planLaneMotion, sameOrder, scrollBack, toward, type MotionFrame, type Rect } from "../../client/tasks/board/lane-motion-plan";
import type { LaneId } from "../../client/tasks/model";

const rect = (x: number, y: number, width = 300, height = 80): Rect => ({ x, y, width, height });
const LANES: [LaneId, Rect][] = [
  ["needs_input", rect(0, 40, 320, 600)],
  ["running", rect(330, 40, 320, 600)],
  ["review", rect(660, 40, 320, 600)],
  ["done", rect(990, 40, 320, 600)],
];
const VIEWPORT = rect(0, 0, 1400, 700);

function frame(cards: [string, LaneId, Rect | null][], lanes: [LaneId, Rect][] = LANES): MotionFrame {
  return {
    cards: new Map(cards.filter((card): card is [string, LaneId, Rect] => card[2] !== null).map(([id, , at]) => [id, at])),
    lanes: new Map(lanes),
    laneOf: new Map(cards.map(([id, lane]) => [id, lane])),
    viewport: VIEWPORT,
  };
}

const plan = (before: MotionFrame, after: MotionFrame, flights = true, flying: string[] = []) => planLaneMotion(before, after, { flights, flying: new Set(flying) });

describe("planLaneMotion", () => {
  it("flies a card that changed lanes, and slides the cards it left and joined", () => {
    const before = frame([
      ["a", "running", rect(340, 50)],
      ["b", "running", rect(340, 140)],
      ["c", "review", rect(670, 50)],
    ]);
    const after = frame([
      ["a", "review", rect(670, 50)],
      ["b", "running", rect(340, 50)],
      ["c", "review", rect(670, 140)],
    ]);
    expect(plan(before, after)).toEqual([
      { kind: "fly", id: "a", from: rect(340, 50), to: rect(670, 50), land: true },
      { kind: "slide", id: "b", dx: 0, dy: 90 },
      { kind: "slide", id: "c", dx: 0, dy: -90 },
    ]);
  });

  it("leaves still cards and rounding alone", () => {
    const before = frame([["a", "running", rect(340, 50.2)]]);
    const after = frame([["a", "running", rect(340, 50)]]);
    expect(plan(before, after)).toEqual([]);
  });

  it("lets a card that was out of view fade in instead of flying", () => {
    const before = frame([["a", "running", rect(340, 900)]]);
    const after = frame([["a", "review", rect(670, 50)]]);
    expect(plan(before, after)).toEqual([]);
  });

  it("flies towards a collapsed lane's pill and fades on the way", () => {
    const lanes: [LaneId, Rect][] = [["running", rect(330, 40, 320, 600)], ["review", rect(660, 40, 36, 300)]];
    const before = frame([["a", "running", rect(340, 50)]], lanes);
    const after = frame([["a", "review", null]], lanes);
    expect(plan(before, after)).toEqual([{ kind: "fly", id: "a", from: rect(340, 50), to: { x: 660 + 18 - 150, y: 50, width: 300, height: 80 }, land: false }]);
  });

  it("heads for the lane's edge when the card lands below what the lane shows", () => {
    const before = frame([["a", "running", rect(340, 50)]]);
    const after = frame([["a", "review", rect(670, 2000)]]);
    expect(plan(before, after)).toEqual([{ kind: "fly", id: "a", from: rect(340, 50), to: rect(670, 640 - 80), land: false }]);
  });

  it("fades a card that left the board where it was", () => {
    const before = frame([["a", "running", rect(340, 50)]]);
    const after = frame([]);
    expect(plan(before, after)).toEqual([{ kind: "leave", id: "a", from: rect(340, 50) }]);
  });

  it("does nothing for a card its list stopped rendering", () => {
    const before = frame([["a", "running", rect(340, 600)]]);
    const after = frame([["a", "running", null]]);
    expect(plan(before, after)).toEqual([]);
  });

  it("on the phone, fades a card that left the lane on screen", () => {
    const before = frame([["a", "running", rect(0, 50)]], []);
    // The pager keeps the next lane rendered off to the side.
    const after = frame([["a", "review", rect(1500, 50)]], []);
    expect(plan(before, after, false)).toEqual([{ kind: "leave", id: "a", from: rect(0, 50) }]);
  });

  it("flies a card again when it moves while its copy is in the air", () => {
    const before = frame([["a", "review", rect(500, 50)]]);
    const after = frame([["a", "review", rect(670, 140)]]);
    expect(plan(before, after, true, ["a"])).toEqual([{ kind: "fly", id: "a", from: rect(500, 50), to: rect(670, 140), land: true }]);
  });
});

describe("toward", () => {
  it("keeps the height it left from when its new place is unknown", () => {
    expect(toward(rect(340, 300), null, rect(660, 40, 320, 600))).toEqual(rect(670, 300));
  });
});

describe("scrollBack", () => {
  const list = rect(0, 100, 300, 400);
  it("is how far a list scrolled past its new end", () => {
    // Offset 80 into content now 420 tall: its end is at 20, so 60 back.
    expect(scrollBack(list, rect(0, 20, 300, 420))).toBe(60);
    // Shorter than the list: all the way to the top.
    expect(scrollBack(list, rect(0, 20, 300, 300))).toBe(80);
  });
  it("is nothing while the offset still fits", () => {
    expect(scrollBack(list, rect(0, 20, 300, 480))).toBe(0);
    expect(scrollBack(list, rect(0, 100, 300, 200))).toBe(0);
  });
});

describe("listScroll", () => {
  const list = rect(0, 100, 300, 400);
  it("follows the drift within the content", () => {
    // Offset 80 into 1000 of content: a drift of 100 scrolls to 180, every card 100 up.
    expect(listScroll(list, rect(0, 20, 300, 1000), 100)).toEqual({ offset: 80, target: 180, shift: -100 });
    // Not past the end (600) nor before the start.
    expect(listScroll(list, rect(0, 20, 300, 1000), 900).target).toBe(600);
    expect(listScroll(list, rect(0, 20, 300, 1000), -200)).toMatchObject({ target: 0, shift: 80 });
  });
});

describe("anchorDrift", () => {
  // A phone's archived lane scrolled 300 down: x shows partly at its top, r and y below it.
  const list = rect(0, 100, 300, 400);
  const order = (ids: string[]) => laneNeighbours({ needs_input: { cards: [] }, running: { cards: [] }, review: { cards: [] }, done: { cards: [] }, archived: { cards: ids.map((id) => ({ id })) } }, ["archived"]);
  const at = (cards: [string, Rect][]): MotionFrame => ({ cards: new Map(cards), lanes: new Map([["archived", list]]), laneOf: new Map(cards.map(([id]) => [id, "archived" as LaneId])), viewport: rect(0, 0, 300, 600) });
  const before = at([["x", rect(0, 60, 300, 120)], ["r", rect(0, 190, 300, 120)], ["y", rect(0, 320, 300, 120)]]);
  // r was renamed and sorted to the top: the content above x grew by r's 130.
  const after = at([["r", rect(0, -1000, 300, 120)], ["x", rect(0, 190, 300, 120)], ["y", rect(0, 320, 300, 120)]]);

  it("picks the card that moved, not the ones it left or went between", () => {
    expect([...movedCards(order(["w", "x", "r", "y"]), order(["r", "w", "x", "y"]))]).toEqual(["r"]);
  });
  it("is how far the top card on screen moved", () => {
    expect(anchorDrift("archived", 300, before, after, new Set(["r"]))).toBe(130);
  });
  it("is nothing at the start of the list, or when the top card is the one that moved or left", () => {
    expect(anchorDrift("archived", 0, before, after, new Set(["r"]))).toBe(0);
    expect(anchorDrift("archived", 300, before, after, new Set(["x"]))).toBe(0);
    expect(anchorDrift("archived", 300, before, at([["y", rect(0, 60, 300, 120)]]), new Set())).toBe(0);
  });
});

describe("inView", () => {
  it("needs the card inside its lane and the board", () => {
    expect(inView(rect(340, 50), rect(330, 40, 320, 600), VIEWPORT)).toBe(true);
    expect(inView(rect(340, 700), rect(330, 40, 320, 600), VIEWPORT)).toBe(false);
    expect(inView(rect(1500, 50), null, VIEWPORT)).toBe(false);
  });
});

describe("sameOrder", () => {
  const lanes = (running: string[], review: string[]) =>
    ({
      needs_input: { cards: [] },
      running: { cards: running.map((id) => ({ id })) },
      review: { cards: review.map((id) => ({ id })) },
      done: { cards: [] },
      archived: { cards: [] },
    }) as Record<LaneId, { cards: { id: string }[] }>;
  const order: LaneId[] = ["needs_input", "running", "review", "done"];
  it("sees a card that changed lanes or places", () => {
    expect(sameOrder(lanes(["a", "b"], []), lanes(["a", "b"], []), order)).toBe(true);
    expect(sameOrder(lanes(["a", "b"], []), lanes(["b"], ["a"]), order)).toBe(false);
    expect(sameOrder(lanes(["a", "b"], []), lanes(["b", "a"], []), order)).toBe(false);
  });
});

describe("laneChurn", () => {
  const lanes = (running: string[], review: string[]) =>
    ({
      needs_input: { cards: [] },
      running: { cards: running.map((id) => ({ id })) },
      review: { cards: review.map((id) => ({ id })) },
      done: { cards: [] },
      archived: { cards: [] },
    }) as Record<LaneId, { cards: { id: string }[] }>;
  const order: LaneId[] = ["needs_input", "running", "review", "done"];
  it("counts the cards that came into a lane or left it, a reorder as none", () => {
    expect(laneChurn(lanes(["a", "b"], []), lanes(["b", "a"], []), order, 10)).toBe(0);
    expect(laneChurn(lanes(["a", "b"], []), lanes(["b"], ["a"]), order, 10)).toBe(2);
    expect(laneChurn(lanes(["a"], ["b"]), lanes(["a", "s1", "s2"], ["s3", "b"]), order, 10)).toBe(3);
  });
  it("stops counting past the limit", () => {
    const many = Array.from({ length: 50 }, (_, index) => `s${index}`);
    expect(laneChurn(lanes([], []), lanes(many, many.map((id) => `r${id}`)), order, 6)).toBe(50);
  });
});
