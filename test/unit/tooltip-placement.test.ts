import { describe, expect, it } from "vitest";
import { TOOLTIP_ROOM, anchoredTooltipOrigin, liftStackingRow, tooltipPlacement } from "../../client/ui/tooltip-placement";

describe("native toolbar details placement", () => {
  const stage = { x: 0, y: 44, width: 390, height: 760 };
  const panel = { width: 240, height: 90 };
  it("opens above the pressed control using modal-local coordinates", () => {
    expect(anchoredTooltipOrigin({ x: 60, y: 600, width: 160, height: 24 }, stage, panel))
      .toEqual({ left: 60, top: 462 });
  });
  it("opens below a control near the top and stays within the right edge", () => {
    expect(anchoredTooltipOrigin({ x: 330, y: 60, width: 40, height: 24 }, stage, panel))
      .toEqual({ left: 142, top: 44 });
  });
  it("keeps the panel clear of the left and bottom edges", () => {
    expect(anchoredTooltipOrigin({ x: -10, y: 850, width: 160, height: 24 }, stage, panel))
      .toEqual({ left: 8, top: 662 });
  });
});

describe("path tooltip placement", () => {
  it("opens above on web, where later rows paint over the one below", () => {
    expect(tooltipPlacement("web", 400, 60)).toBe("above");
  });

  it("drops below where the list's top edge leaves no room", () => {
    expect(tooltipPlacement("web", 60 + TOOLTIP_ROOM - 1, 60)).toBe("below");
    expect(tooltipPlacement("web", 60 + TOOLTIP_ROOM, 60)).toBe("above");
  });

  it("stays below on native lists and when the row cannot be measured", () => {
    expect(tooltipPlacement("ios", 400, 0)).toBe("below");
    expect(tooltipPlacement("web", null, 0)).toBe("below");
  });

  it("reserves more space above for an interactive model details panel", () => {
    expect(tooltipPlacement("web", 160, 60, 128)).toBe("below");
    expect(tooltipPlacement("web", 188, 60, 128)).toBe("above");
  });
});

describe("liftStackingRow", () => {
  function box(transform: string, position = "absolute", parent: object | null = null) {
    return { transform, position, style: { zIndex: "", position: "" }, parentElement: parent };
  }

  it("raises the nearest transformed ancestor and puts it back", () => {
    const row = box("matrix(1, 0, 0, 1, 0, 120)", "static", box("none"));
    const inner = box("none", "relative", row);
    const leaf = { parentElement: inner };
    const original = globalThis.getComputedStyle;
    globalThis.getComputedStyle = ((element: { transform: string; position: string }) => element) as never;
    try {
      const restore = liftStackingRow(leaf);
      expect(row.style).toEqual({ zIndex: "1", position: "relative" });
      expect(inner.style).toEqual({ zIndex: "", position: "" });
      restore();
      expect(row.style).toEqual({ zIndex: "", position: "" });
    } finally {
      globalThis.getComputedStyle = original;
    }
  });

  it("touches nothing without a transformed ancestor", () => {
    expect(() => liftStackingRow(null)()).not.toThrow();
  });
});
