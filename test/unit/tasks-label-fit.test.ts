import { describe, expect, it } from "vitest";
import { LABELS_SLACK, nextBarLayout, nextCompact } from "../../client/tasks/board/label-fit";

const row = (filters: number, controls: number, endY = 0) => ({
  filters: { x: 0, y: 0, width: filters },
  end: { x: filters + 6, y: endY, width: 300 },
  controls: { x: 0, y: 0, width: controls },
});

describe("the filter bar's inline lane widths", () => {
  const menu = { compact: false, inlineLaneWidth: false };
  const inline = { compact: false, inlineLaneWidth: true };

  it("expands only after the measured extra width fits with room to spare", () => {
    expect(nextBarLayout(menu, row(800, 600), null, null)).toEqual(menu);
    expect(nextBarLayout(menu, row(800, 600), null, 200 - LABELS_SLACK)).toEqual(inline);
    expect(nextBarLayout(menu, row(800, 600), null, 201 - LABELS_SLACK)).toEqual(menu);
  });

  it("folds the lane widths before dropping the filter labels or wrapping", () => {
    expect(nextBarLayout(inline, row(600, 601), null, 120)).toEqual(menu);
    expect(nextBarLayout(inline, row(800, 600, 44), null, 120)).toEqual(menu);
    expect(nextBarLayout(menu, row(600, 601), null, 120)).toEqual({ compact: true, inlineLaneWidth: false });
  });

  it("restores the filter labels before expanding the lane widths", () => {
    const compact = { compact: true, inlineLaneWidth: false };
    expect(nextBarLayout(compact, row(800, 300), 400, 120)).toEqual(menu);
    expect(nextBarLayout(menu, row(800, 700), null, 120)).toEqual(menu);
    expect(nextBarLayout(menu, row(900, 700), null, 120)).toEqual(inline);
  });

  it("keeps inline widths stable until they no longer fit", () => {
    expect(nextBarLayout(inline, row(600, 600), null, 120)).toEqual(inline);
    expect(nextBarLayout(menu, row(720, 600), null, 120)).toEqual(menu);
    expect(nextBarLayout(menu, row(732, 600), null, 120)).toEqual(inline);
  });

  it("handles a direct resize even when the end does not report its new position", () => {
    const boxes = { ...row(1000, 500), bar: { x: 0, y: 0, width: 700 } };
    expect(nextBarLayout(inline, boxes, null, 120)).toEqual(menu);
    expect(nextBarLayout(menu, boxes, null, 120)).toEqual({ compact: true, inlineLaneWidth: false });
    expect(nextBarLayout({ compact: true, inlineLaneWidth: false }, boxes, 200, 120)).toEqual({ compact: true, inlineLaneWidth: false });
    // A stale second-row y cannot prevent restoring choices after the row grows again.
    expect(nextBarLayout(menu, { ...boxes, end: { ...boxes.end, y: 44 }, bar: { ...boxes.bar, width: 1000 } }, null, 120)).toEqual(inline);
  });
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
