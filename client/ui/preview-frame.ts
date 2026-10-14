/**
 * Moving and resizing a preview window inside the space it floats in.
 * Desktop (`openPreviewLayer`) and the phone panel share this so a drag
 * cannot park the window past the edge it is being pulled toward, and a
 * resize keeps the opposite edge where the reader left it.
 */

export interface PreviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewSize {
  width: number;
  height: number;
}

/** Wide enough for the toolbar, tall enough for the toolbar and a line of body. */
export const PREVIEW_MIN = { width: 240, height: 120 } as const;

/**
 * A pointer this close to the frame grabs that edge. Touch uses a wider
 * strip; the phone's drawn strips are separate and stay clear of the buttons.
 */
export const PREVIEW_EDGE_HIT = { pointer: 8, touch: 16 } as const;

/** How far a press moves before it is a drag, so a tap still reaches a button. */
export const PREVIEW_DRAG_SLOP = 4;

export type PreviewEdge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

export const PREVIEW_EDGES: readonly PreviewEdge[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const EAST = new Set<PreviewEdge>(["e", "ne", "se"]);
const WEST = new Set<PreviewEdge>(["w", "nw", "sw"]);
const SOUTH = new Set<PreviewEdge>(["s", "se", "sw"]);
const NORTH = new Set<PreviewEdge>(["n", "ne", "nw"]);

/** Which edge `point` is on, in the box's own coordinates, or null in the body. */
export function previewEdgeAt(point: { x: number; y: number }, size: PreviewSize, hit: number): PreviewEdge | null {
  const { x, y } = point;
  const { width, height } = size;
  if (x < 0 || y < 0 || x > width || y > height) return null;
  const west = x <= hit;
  const east = x >= width - hit;
  const north = y <= hit;
  const south = y >= height - hit;
  if (north && west) return "nw";
  if (north && east) return "ne";
  if (south && west) return "sw";
  if (south && east) return "se";
  if (north) return "n";
  if (south) return "s";
  if (west) return "w";
  if (east) return "e";
  return null;
}

/** The cursor for an edge, or the toolbar's grab. `moving` is the drag in progress. */
export function previewCursor(edge: PreviewEdge | "move" | "moving"): string {
  if (edge === "move") return "grab";
  if (edge === "moving") return "grabbing";
  if (edge === "n" || edge === "s") return "ns-resize";
  if (edge === "e" || edge === "w") return "ew-resize";
  if (edge === "ne" || edge === "sw") return "nesw-resize";
  return "nwse-resize";
}

/**
 * Fits `box` inside `bounds`, `margin` clear of each side. A minimum larger
 * than the space gives way, so a short viewport still shows the window.
 */
export function clampPreview(box: PreviewBox, bounds: PreviewSize, min: PreviewSize, margin: number): PreviewBox {
  const width = fit(box.width, bounds.width, min.width, margin);
  const height = fit(box.height, bounds.height, min.height, margin);
  return {
    x: place(box.x, width, bounds.width, margin),
    y: place(box.y, height, bounds.height, margin),
    width,
    height,
  };
}

/** Slides `start` by a pointer delta and keeps the whole window inside `bounds`. */
export function movePreview(start: PreviewBox, delta: { x: number; y: number }, bounds: PreviewSize, margin: number): PreviewBox {
  return clampPreview(
    { x: start.x + delta.x, y: start.y + delta.y, width: start.width, height: start.height },
    bounds,
    { width: start.width, height: start.height },
    margin,
  );
}

/**
 * Grows or shrinks `start` from one edge. The opposite edge stays put, and
 * the size stops at `min` and at the far side of `bounds`. A minimum the
 * viewport cannot hold shrinks to the space that is left.
 */
export function resizePreview(
  start: PreviewBox,
  edge: PreviewEdge,
  delta: { x: number; y: number },
  bounds: PreviewSize,
  min: PreviewSize,
  margin: number,
): PreviewBox {
  const minWidth = Math.min(min.width, Math.max(0, bounds.width - margin * 2));
  const minHeight = Math.min(min.height, Math.max(0, bounds.height - margin * 2));
  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;
  if (EAST.has(edge) || WEST.has(edge)) {
    const right = start.x + start.width;
    const proposed = WEST.has(edge) ? start.width - delta.x : start.width + delta.x;
    const limit = WEST.has(edge) ? right - margin : bounds.width - margin - start.x;
    width = clampSize(proposed, minWidth, limit);
    x = WEST.has(edge) ? right - width : start.x;
  }
  if (NORTH.has(edge) || SOUTH.has(edge)) {
    const bottom = start.y + start.height;
    const proposed = NORTH.has(edge) ? start.height - delta.y : start.height + delta.y;
    const limit = NORTH.has(edge) ? bottom - margin : bounds.height - margin - start.y;
    height = clampSize(proposed, minHeight, limit);
    y = NORTH.has(edge) ? bottom - height : start.y;
  }
  return { x, y, width, height };
}

function clampSize(proposed: number, min: number, limit: number): number {
  const cap = Math.max(0, limit);
  return Math.min(Math.max(proposed, Math.min(min, cap)), cap);
}

function fit(size: number, limit: number, min: number, margin: number): number {
  const room = Math.max(0, limit - margin * 2);
  return Math.min(room, Math.max(Math.min(min, room), size));
}

function place(position: number, size: number, limit: number, margin: number): number {
  const room = Math.max(0, limit - margin * 2);
  if (room <= size) return margin;
  return Math.min(Math.max(position, margin), margin + room - size);
}
