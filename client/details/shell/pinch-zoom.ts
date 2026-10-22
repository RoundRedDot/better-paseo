/**
 * A pinch on the phone drawer's body sets its text size (`DetailsZoom`).
 *
 * It reads the raw touches (`onTouchStart` / `onTouchMove` / `onTouchEnd`),
 * which reach the body whoever holds the responder: the drawer's own drag
 * (`gestures.ts` lets go of a touch once a second finger is down) or the
 * native scroller. As the second finger lands the body is held still, so the
 * fingers moving apart do not scroll it; the scroller is let go as they lift.
 *
 * The text lays out again at each whole point the pinch passes, and the line
 * under the fingers' midpoint stays under it: the body scrolls to keep that
 * point at the same share of the content once its new height is reported.
 * Only the last size is saved, as the fingers lift.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import type { DetailsZoom } from "../contracts";
import type { PreviewScroller } from "../../ui/preview-scroller";
import { pinchZoom } from "../../ui/text-zoom";

/** How long the size stays up after the fingers lift, with its reset. */
export const ZOOM_BADGE_MS = 2000;
/** Heights reported this long after the lift are still the pinch's last layout. */
const SETTLE_MS = 500;

interface Point {
  x: number;
  y: number;
}

export interface PinchOptions {
  zoom(): DetailsZoom | undefined;
  scroller(): PreviewScroller | null;
  /** The size the drawer draws at, while a pinch moves and as it ends. */
  changed(zoom: number, pinching: boolean): void;
}

export interface Pinch {
  start(event: GestureResponderEvent): void;
  move(event: GestureResponderEvent): void;
  end(event: GestureResponderEvent): void;
  cancel(): void;
  /** The body's content height, each time it is reported. */
  contentSized(height: number): void;
  active(): boolean;
}

export function createPinch(options: PinchOptions): Pinch {
  let gesture: { distance: number; from: number; zoom: number; top: number } | null = null;
  // Where the midpoint was, as a share of the content, for the next height.
  let anchor: { share: number; focus: number; until: number } | null = null;
  let height = 0;
  const begin = (touches: readonly Point[]) => {
    const zoom = options.zoom();
    const distance = spread(touches);
    if (!zoom || distance <= 0) return;
    const from = zoom.current();
    gesture = { distance, from, zoom: from, top: 0 };
    anchor = null;
    const scroller = options.scroller();
    scroller?.hold(true);
    scroller?.measure((top) => {
      if (gesture) gesture.top = top;
    });
    options.changed(from, true);
  };
  const move = (touches: readonly Point[]) => {
    const zoom = options.zoom();
    if (!gesture || !zoom || touches.length < 2) return;
    const next = pinchZoom(zoom.base, gesture.from, spread(touches) / gesture.distance);
    if (next === gesture.zoom) return;
    gesture.zoom = next;
    const scroller = options.scroller();
    if (scroller && height > 0) {
      const focus = midpoint(touches).y - gesture.top;
      anchor = { share: (scroller.offset() + focus) / height, focus, until: Infinity };
    }
    zoom.preview(next);
    options.changed(next, true);
  };
  const finish = () => {
    if (!gesture) return;
    const { from, zoom: reached } = gesture;
    gesture = null;
    if (anchor) anchor.until = Date.now() + SETTLE_MS;
    options.scroller()?.hold(false);
    if (reached !== from) options.zoom()?.commit(reached);
    options.changed(reached, false);
  };
  return {
    start(event) {
      const touches = touchesOf(event);
      if (touches.length >= 2 && !gesture) begin(touches);
      else if (touches.length < 2) anchor = null;
    },
    move(event) {
      const touches = touchesOf(event);
      if (touches.length >= 2 && !gesture) begin(touches);
      else move(touches);
    },
    end(event) {
      if (touchesOf(event).length < 2) finish();
    },
    cancel: finish,
    contentSized(next) {
      height = next;
      const scroller = options.scroller();
      if (anchor && Date.now() > anchor.until) anchor = null;
      if (!anchor || !scroller || next <= 0) return;
      scroller.scrollBy(anchor.share * next - anchor.focus - scroller.offset());
    },
    active: () => gesture !== null,
  };
}

/**
 * The pinch for the drawer's body: its touch handlers, the size to show
 * while it moves and for a moment after, and the height report.
 */
export function usePinchZoom(zoom: DetailsZoom | undefined, scroller: PreviewScroller | null) {
  const latest = useRef({ zoom, scroller });
  latest.current = { zoom, scroller };
  // The size on the badge; null hides it.
  const [badge, setBadge] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinch = useMemo(() => createPinch({
    zoom: () => latest.current.zoom,
    scroller: () => latest.current.scroller,
    changed(next, pinching) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setBadge(next);
      if (!pinching) timer.current = setTimeout(() => setBadge(null), ZOOM_BADGE_MS);
    },
  }), []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const handlers = useMemo(() => (zoom ? {
    onTouchStart: pinch.start,
    onTouchMove: pinch.move,
    onTouchEnd: pinch.end,
    onTouchCancel: pinch.cancel,
  } : undefined), [pinch, zoom !== undefined]);
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBadge(null);
  };
  return { handlers, badge, contentSized: pinch.contentSized, hide };
}

function touchesOf(event: GestureResponderEvent): Point[] {
  const touches = event.nativeEvent.touches ?? [];
  return touches.map((touch) => ({ x: touch.pageX, y: touch.pageY }));
}

function spread(touches: readonly Point[]): number {
  const [a, b] = touches;
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function midpoint(touches: readonly Point[]): Point {
  const [a, b] = touches;
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
}
