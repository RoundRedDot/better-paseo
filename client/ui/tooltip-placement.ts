export type TooltipPlacement = "above" | "below";

/** Room a wrapped full path needs above its row: three lines and the padding. */
export const TOOLTIP_ROOM = 64;

export interface WindowBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert the pressed control's window bounds into its modal's local coordinates. */
export function anchoredTooltipOrigin(anchor: WindowBox, stage: WindowBox, panel: { width: number; height: number }) {
  const margin = 8;
  const gap = 4;
  const x = anchor.x - stage.x;
  const y = anchor.y - stage.y;
  const above = y - panel.height - gap;
  return {
    left: Math.max(margin, Math.min(x, stage.width - panel.width - margin)),
    top: Math.max(margin, Math.min(above >= margin ? above : y + anchor.height + gap,
      stage.height - panel.height - margin)),
  };
}

/**
 * Which side of the path the full-path tooltip opens on.
 *
 * The tooltip overflows its row, and a row cannot lift anything over its
 * neighbours: Paseo's web list positions every virtualised row with a
 * transform, so each row is its own stacking context and a later row paints
 * over an earlier one, `zIndex` or not. Above the path, the rows it covers
 * were painted first. It drops below only where the list's own top edge
 * leaves no room, and then `liftStackingRow` raises its row. Native lists are inverted, which reverses that order, so
 * there (an iPad pointer) it stays below.
 */
export function tooltipPlacement(
  platform: string,
  rowTop: number | null,
  viewportTop: number,
  room = TOOLTIP_ROOM,
): TooltipPlacement {
  if (platform !== "web" || rowTop === null) return "below";
  return rowTop - viewportTop < room ? "below" : "above";
}

/** Where a tooltip for `node` (a web DOM node, a native ref) opens, by the room above it. */
export function placeTooltipNear(node: unknown, platform: string, room = TOOLTIP_ROOM): TooltipPlacement {
  if (platform !== "web") return "below";
  const box = node as DomBox | null;
  const top = box?.getBoundingClientRect?.().top ?? null;
  return tooltipPlacement("web", top, box ? scrollTop(box) : 0, room);
}

export interface DomBox {
  getBoundingClientRect?(): { top: number };
  parentElement?: DomBox | null;
}

/** The top of the nearest scrolling ancestor: the edge an "above" tooltip is clipped at. */
export function scrollTop(node: DomBox): number {
  const view = globalThis as { getComputedStyle?(element: unknown): { overflowY: string } };
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const overflow = view.getComputedStyle?.(parent).overflowY;
    if (overflow === "auto" || overflow === "scroll") return parent.getBoundingClientRect?.().top ?? 0;
  }
  return 0;
}

interface StyledBox extends DomBox {
  style?: { zIndex: string; position: string };
}

/**
 * Lifts the row a below-the-path tooltip spills out of over the rows after
 * it, until the returned function puts it back. The row is the nearest
 * ancestor with a transform, which is what makes it a stacking context; with
 * none, nothing is touched.
 */
export function liftStackingRow(node: DomBox | null): () => void {
  const view = globalThis as {
    getComputedStyle?(element: unknown): { transform: string; position: string };
  };
  for (let parent = node?.parentElement as StyledBox | null | undefined; parent; parent = parent.parentElement as StyledBox | null) {
    const computed = view.getComputedStyle?.(parent);
    if (!computed || computed.transform === "none" || !parent.style) continue;
    const style = parent.style;
    const before = { zIndex: style.zIndex, position: style.position };
    // `z-index` needs a positioned box; `relative` does not move it.
    if (computed.position === "static") style.position = "relative";
    style.zIndex = "1";
    return () => {
      style.zIndex = before.zIndex;
      style.position = before.position;
    };
  }
  return () => {};
}
