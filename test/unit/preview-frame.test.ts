import { describe, expect, it } from "vitest";
import {
  PREVIEW_MIN, clampPreview, movePreview, previewCursor, previewEdgeAt, resizePreview,
  type PreviewBox,
} from "../../client/ui/preview-frame";

const bounds = { width: 1600, height: 900 };
const margin = 8;
const start: PreviewBox = { x: 200, y: 132, width: 700, height: 360 };

describe("preview edges", () => {
  const size = { width: 700, height: 360 };
  it("names the edge under the pointer, corners first", () => {
    expect(previewEdgeAt({ x: 4, y: 4 }, size, 8)).toBe("nw");
    expect(previewEdgeAt({ x: 350, y: 4 }, size, 8)).toBe("n");
    expect(previewEdgeAt({ x: 696, y: 4 }, size, 8)).toBe("ne");
    expect(previewEdgeAt({ x: 696, y: 180 }, size, 8)).toBe("e");
    expect(previewEdgeAt({ x: 696, y: 356 }, size, 8)).toBe("se");
    expect(previewEdgeAt({ x: 350, y: 356 }, size, 8)).toBe("s");
    expect(previewEdgeAt({ x: 4, y: 356 }, size, 8)).toBe("sw");
    expect(previewEdgeAt({ x: 4, y: 180 }, size, 8)).toBe("w");
    expect(previewEdgeAt({ x: 350, y: 180 }, size, 8)).toBeNull();
    expect(previewEdgeAt({ x: -1, y: 10 }, size, 8)).toBeNull();
    expect(previewEdgeAt({ x: 701, y: 180 }, size, 8)).toBeNull();
  });
  it("uses the cursor for that edge", () => {
    expect(previewCursor("n")).toBe("ns-resize");
    expect(previewCursor("e")).toBe("ew-resize");
    expect(previewCursor("ne")).toBe("nesw-resize");
    expect(previewCursor("nw")).toBe("nwse-resize");
    expect(previewCursor("move")).toBe("grab");
    expect(previewCursor("moving")).toBe("grabbing");
  });
});

describe("moving a preview", () => {
  it("slides by the pointer and keeps the whole window inside the margin", () => {
    expect(movePreview(start, { x: 80, y: 40 }, bounds, margin)).toEqual({ x: 280, y: 172, width: 700, height: 360 });
    expect(movePreview(start, { x: -1000, y: -1000 }, bounds, margin)).toEqual({ x: 8, y: 8, width: 700, height: 360 });
    expect(movePreview(start, { x: 5000, y: 5000 }, bounds, margin)).toEqual({ x: 892, y: 532, width: 700, height: 360 });
  });
  it("shrinks a window the viewport can no longer hold, pinned to the margin", () => {
    expect(clampPreview(start, { width: 400, height: 900 }, PREVIEW_MIN, margin)).toEqual({
      x: 8, y: 132, width: 384, height: 360,
    });
  });
});

describe("resizing a preview", () => {
  it("keeps the opposite edge put and stops at the minimum and the viewport", () => {
    expect(resizePreview(start, "e", { x: 50, y: 0 }, bounds, PREVIEW_MIN, margin)).toEqual({
      x: 200, y: 132, width: 750, height: 360,
    });
    expect(resizePreview(start, "w", { x: 80, y: 0 }, bounds, PREVIEW_MIN, margin)).toEqual({
      x: 280, y: 132, width: 620, height: 360,
    });
    // Dragging the west edge past the minimum leaves the right edge at 900.
    expect(resizePreview(start, "w", { x: 600, y: 0 }, bounds, PREVIEW_MIN, margin)).toEqual({
      x: 660, y: 132, width: 240, height: 360,
    });
    expect(resizePreview(start, "n", { x: 0, y: 40 }, bounds, PREVIEW_MIN, margin)).toEqual({
      x: 200, y: 172, width: 700, height: 320,
    });
    expect(resizePreview(start, "n", { x: 0, y: 400 }, bounds, PREVIEW_MIN, margin)).toEqual({
      x: 200, y: 372, width: 700, height: 120,
    });
    // The east edge cannot pass the viewport's margin. 1600 - 8 - 200 = 1392.
    expect(resizePreview(start, "e", { x: 5000, y: 0 }, bounds, PREVIEW_MIN, margin).width).toBe(1392);
    expect(resizePreview(start, "ne", { x: 20, y: -30 }, bounds, PREVIEW_MIN, margin)).toEqual({
      x: 200, y: 102, width: 720, height: 390,
    });
  });
});
