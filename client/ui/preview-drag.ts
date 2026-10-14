/**
 * The phone preview's fingers. The toolbar waits until the finger has moved,
 * so a tap still presses a button; an edge takes the finger at once, and a
 * tap that never moves does not resize. Both report a box in the stage's
 * coordinates through the same frame math the desktop pointer uses.
 */
import { space } from "../components/theme-tokens";
import {
  PREVIEW_DRAG_SLOP, PREVIEW_EDGES, movePreview, resizePreview,
  type PreviewBox, type PreviewEdge, type PreviewSize,
} from "./preview-frame";

export interface FrameDrag {
  box(): PreviewBox | null;
  bounds(): PreviewSize;
  margin: number;
  min: PreviewSize;
  commit(next: PreviewBox): void;
}

interface TouchPointEvent {
  nativeEvent: { pageX: number; pageY: number };
}

export function touchPoint(event: TouchPointEvent): { x: number; y: number } {
  return { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
}

function moved(from: { x: number; y: number } | null, to: { x: number; y: number }): boolean {
  return Boolean(from) && Math.hypot(to.x - from!.x, to.y - from!.y) >= PREVIEW_DRAG_SLOP;
}

/** Capture-phase props for the toolbar. A still finger never becomes the responder. */
export function toolbarResponder(drag: FrameDrag) {
  let origin: { x: number; y: number } | null = null;
  let active: { start: PreviewBox; x: number; y: number } | null = null;
  const apply = (point: { x: number; y: number }) => {
    if (!active) return;
    drag.commit(movePreview(active.start, { x: point.x - active.x, y: point.y - active.y }, drag.bounds(), drag.margin));
  };
  return {
    onStartShouldSetResponderCapture(event: TouchPointEvent) {
      origin = touchPoint(event);
      return false;
    },
    onMoveShouldSetResponderCapture(event: TouchPointEvent) {
      return moved(origin, touchPoint(event));
    },
    onResponderGrant(event: TouchPointEvent) {
      const start = drag.box();
      if (!start || !origin) return;
      active = { start, x: origin.x, y: origin.y };
      apply(touchPoint(event));
    },
    onResponderMove(event: TouchPointEvent) {
      apply(touchPoint(event));
    },
    onResponderRelease() {
      active = null;
    },
    onResponderTerminate() {
      active = null;
    },
    onResponderTerminationRequest: () => false,
  };
}

/** An edge claims the touch immediately; the box changes only after the finger moves. */
export function edgeResponder(edge: PreviewEdge, drag: FrameDrag) {
  let origin: { x: number; y: number } | null = null;
  let active: { start: PreviewBox; x: number; y: number } | null = null;
  return {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant(event: TouchPointEvent) {
      const start = drag.box();
      origin = touchPoint(event);
      active = start ? { start, x: origin.x, y: origin.y } : null;
    },
    onResponderMove(event: TouchPointEvent) {
      if (!active || !origin) return;
      const point = touchPoint(event);
      if (!moved(origin, point)) return;
      drag.commit(resizePreview(
        active.start,
        edge,
        { x: point.x - active.x, y: point.y - active.y },
        drag.bounds(),
        drag.min,
        drag.margin,
      ));
    },
    onResponderRelease() {
      active = null;
    },
    onResponderTerminate() {
      active = null;
    },
  };
}

export function previewEdgeResponders(drag: FrameDrag): Record<PreviewEdge, ReturnType<typeof edgeResponder>> {
  return Object.fromEntries(PREVIEW_EDGES.map((edge) => [edge, edgeResponder(edge, drag)])) as Record<PreviewEdge, ReturnType<typeof edgeResponder>>;
}

/**
 * Where an edge's grab strip sits. The top strip is only the toolbar's top
 * padding, so it does not cover the buttons; the other edges are a finger wide.
 */
export function previewEdgeStyle(edge: PreviewEdge): {
  position: "absolute";
  zIndex: number;
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height?: number;
} {
  const top = edge.includes("n");
  const bottom = edge.includes("s");
  const left = edge.includes("w");
  const right = edge.includes("e");
  const corner = edge.length === 2;
  const along = 14;
  const header = space.sm + 24 + space.sm + 1;
  if (top && !corner) return { position: "absolute", top: 0, left: space.md, right: space.md, height: space.sm, zIndex: 2 };
  if (bottom && !corner) return { position: "absolute", bottom: 0, left: along, right: along, height: along, zIndex: 2 };
  if (!corner && (left || right)) {
    return { position: "absolute", top: header, bottom: along, width: along, zIndex: 2, ...(left ? { left: 0 } : { right: 0 }) };
  }
  return {
    position: "absolute",
    zIndex: 3,
    width: top ? space.md : along,
    height: top ? space.sm : along,
    ...(top ? { top: 0 } : { bottom: 0 }),
    ...(left ? { left: 0 } : { right: 0 }),
  };
}
