import { describe, expect, it } from "vitest";
import { boardLaneLayout, flowLaneLayout, LANES } from "../../client/tasks/board/navigation";
import { ACTIVE_LANE_ORDER, LANE_ORDER } from "../../client/tasks/model";

describe("stable tablet lane widths", () => {
  it.each(["narrow", "default", "wide"] as const)("keeps %s lanes at their all-open width through every fold combination", (size) => {
    for (const boardWidth of [540, 600, 800, 1024, 1300, 1600]) {
      const width = boardLaneLayout(boardWidth, ACTIVE_LANE_ORDER, [], size).laneWidth;
      for (const order of [ACTIVE_LANE_ORDER, LANE_ORDER]) {
        for (let mask = 0; mask < 1 << order.length; mask++) {
          const collapsed = order.filter((_, index) => mask & (1 << index));
          for (const viewport of [boardWidth, boardWidth - 392]) {
            const layout = boardLaneLayout(boardWidth, order, collapsed, size, viewport, "stable");
            const extent = 2 * LANES.edge + (order.length - 1) * LANES.gap
              + collapsed.length * LANES.collapsed + (order.length - collapsed.length) * width;
            expect(layout).toEqual({ laneWidth: width, contentWidth: Math.max(viewport, extent), scroll: extent > viewport });
          }
        }
      }
    }
  });

  it("still adapts to the viewport and lane width preset", () => {
    const collapsed = ["needs_input", "review"] as const;
    expect(boardLaneLayout(1024, LANE_ORDER, collapsed, "default", 1024, "stable").laneWidth).toBe(300);
    expect(boardLaneLayout(600, LANE_ORDER, collapsed, "default", 600, "stable").laneWidth).toBe(284);
    expect(boardLaneLayout(1024, LANE_ORDER, collapsed, "wide", 1024, "stable").laneWidth).toBe(340);
    // Desktop retains its existing redistribution of the freed space.
    expect(boardLaneLayout(1024, LANE_ORDER, collapsed).laneWidth).toBe(340);
  });
});


describe("desktop flow sections", () => {
  it.each(["narrow", "default", "wide"] as const)("fits %s cards beside an open details panel at every window size", (size) => {
    for (const width of [180, 320, 540, 800, 1024, 1600, 3000]) {
      for (const sidebar of [0, 392]) {
        for (const scale of [1, 1.5, 2]) {
          const viewport = Math.max(100, width - sidebar);
          const full = flowLaneLayout(viewport, size, 40, scale);
          const empty = flowLaneLayout(viewport, size, 0, scale);
          expect(full.width + 2 * LANES.edge).toBeLessThanOrEqual(viewport);
          expect(full.columns).toBeGreaterThanOrEqual(1);
          expect(empty.columns).toBe(1);
          expect(empty.width * full.columns + (full.columns - 1) * 12).toBeCloseTo(full.width);
          const card = (full.width - 18 - (full.columns - 1) * 12) / full.columns;
          expect(card).toBeGreaterThan(0);
        }
      }
    }
  });

  it("reflows cards as the window or card width preference changes", () => {
    expect(flowLaneLayout(1200, "narrow", 40).columns).toBe(4);
    expect(flowLaneLayout(1200, "wide", 40).columns).toBe(3);
    expect(flowLaneLayout(500, "narrow", 40).columns).toBe(1);
    expect(flowLaneLayout(1200, "narrow", 40, 2).columns).toBe(2);
  });
});


it("gives a single task one card slot rather than a full-width empty grid", () => {
  const single = flowLaneLayout(1200, "narrow", 1);
  const full = flowLaneLayout(1200, "narrow", 20);
  expect(single.columns).toBe(1);
  expect(single.width).toBeLessThan(full.width / 2);
  const pair = flowLaneLayout(1200, "narrow", 2);
  expect(pair.columns).toBe(2);
  expect(pair.width).toBeCloseTo(single.width * 2 + 12);
});
