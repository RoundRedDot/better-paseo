import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import type { BlockEntry } from "../../client/details/contracts";
import { getBlockList, registerBlock, setOrderShift } from "../../client/details/block-registry";
import { releaseVelocity } from "../../client/details/shell/gestures";

// Rows sharing a timestamp are ordered by where they sit, not by when they
// registered: the native list is inverted and mounts its newest rows first
// (QA round 1, bug 3: one block read "11 / 11" on iOS and "5 / 11" on web).

let agentCount = 0;

function row(agentId: string, id: string, top: number | null): BlockEntry {
  return {
    id, agentId, at: 1000, kind: "tool", seq: 0, navigable: true, hasBody: true, mounted: true,
    title: id, titleMono: false, subtitle: [], icon: "Terminal", readsImage: false,
    render: () => createElement("Text", null, id), copies: () => [],
    measure: () => Promise.resolve(top === null ? null : { top, height: 28 }),
  };
}

const ids = (agentId: string) => getBlockList(agentId).map((entry) => entry.id);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("tied timestamps", () => {
  it("orders rows by their place in the list once the panel lends the scroll position", async () => {
    const agent = `order-${agentCount++}`;
    // Inverted list: the newest (lowest on screen) registers first.
    registerBlock(row(agent, "c", 300));
    registerBlock(row(agent, "b", 200));
    registerBlock(row(agent, "a", 100));
    expect(ids(agent)).toEqual(["c", "b", "a"]);
    setOrderShift(agent, () => 0);
    await settle();
    expect(ids(agent)).toEqual(["a", "b", "c"]);
    setOrderShift(agent, null);
  });

  it("places a row that mounts later against one measured before a scroll", async () => {
    vi.useFakeTimers();
    const agent = `order-${agentCount++}`;
    // Rows sit at a place in the list's content; on screen they are that place less the shift.
    let shift = 0;
    const at = (id: string, place: number): BlockEntry => ({
      ...row(agent, id, 0), measure: () => Promise.resolve({ top: place - shift, height: 28 }),
    });
    registerBlock(at("c", 300));
    const b = registerBlock(at("b", 200));
    setOrderShift(agent, () => shift);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids(agent)).toEqual(["b", "c"]);
    // "b" scrolls out of the list and is kept as a tombstone; the reader scrolls on to older rows.
    b.release();
    shift = -400;
    registerBlock(at("a", 150));
    await vi.advanceTimersByTimeAsync(200);
    expect(ids(agent)).toEqual(["a", "b", "c"]);
    setOrderShift(agent, null);
  });

  it("keeps the order it has when a row cannot be measured", async () => {
    const agent = `order-${agentCount++}`;
    registerBlock(row(agent, "b", null));
    registerBlock(row(agent, "a", null));
    setOrderShift(agent, () => 0);
    await settle();
    expect(ids(agent)).toEqual(["b", "a"]);
    setOrderShift(agent, null);
  });

  it("measures nothing while no panel lends the scroll position", async () => {
    const agent = `order-${agentCount++}`;
    const measure = vi.fn(() => Promise.resolve({ top: 1, height: 28 }));
    registerBlock({ ...row(agent, "b", 0), measure });
    registerBlock({ ...row(agent, "a", 0), measure });
    await settle();
    expect(measure).not.toHaveBeenCalled();
  });
});

describe("release velocity", () => {
  it("times the finger over the last 100 ms, not the last two moves", () => {
    // 140 down over 1.2 s, with the last two moves bunched 1 ms apart.
    const samples = Array.from({ length: 13 }, (_, index) => ({ t: index * 100, x: 0, y: index * 11 }));
    samples.push({ t: 1201, x: 0, y: 140 });
    expect(releaseVelocity(samples).vy).toBeLessThan(0.3);
  });

  it("still reads a fling", () => {
    const samples = [{ t: 0, x: 0, y: 0 }, { t: 40, x: 0, y: 70 }, { t: 80, x: 0, y: 160 }];
    expect(releaseVelocity(samples).vy).toBeGreaterThan(1.2);
  });
});
