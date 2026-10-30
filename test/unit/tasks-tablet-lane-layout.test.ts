import { describe, expect, it } from "vitest";
import { boardLaneLayout, LANES } from "../../client/tasks/board/navigation";
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
