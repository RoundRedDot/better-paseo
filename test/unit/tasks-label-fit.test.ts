import { describe, expect, it } from "vitest";
import { LABELS_SLACK, nextCompact } from "../../client/tasks/board/label-fit";

const row = (filters: number, controls: number, endY = 0) => ({
  filters: { x: 0, y: 0, width: filters },
  end: { x: filters + 6, y: endY, width: 300 },
  controls: { x: 0, y: 0, width: controls },
});

describe("the filter bar's icon-only buttons", () => {
  it("keeps the words while the buttons fit their group beside the end", () => {
    expect(nextCompact(false, row(800, 640), null)).toBe(false);
    expect(nextCompact(false, row(800, 800), null)).toBe(false);
  });

  it("drops them once the buttons overflow their group or the end wraps below", () => {
    expect(nextCompact(false, row(800, 801), null)).toBe(true);
    expect(nextCompact(false, row(1200, 640, 44), null)).toBe(true);
  });

  it("takes them back only once every word fits with room to spare", () => {
    expect(nextCompact(true, row(800, 300), null)).toBe(true);
    expect(nextCompact(true, row(800, 300), 500 - LABELS_SLACK)).toBe(false);
    expect(nextCompact(true, row(800, 300), 500 - LABELS_SLACK + 1)).toBe(true);
    expect(nextCompact(true, row(800, 300, 44), 100)).toBe(true);
  });
});
