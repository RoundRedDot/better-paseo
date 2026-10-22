/**
 * A pinch on the phone drawer's body sets its text size (`DetailsZoom`).
 *
 * It reads the raw touches (`onTouchStart` / `onTouchMove` / `onTouchEnd`),
 * which reach the body whoever holds the responder: the drawer's own drag
 * (`gestures.ts` lets go of a touch once a second finger is down) or the
 * native scroller. As the second finger lands the body is held still, so the
 * fingers moving apart do not scroll it; the scroller is let go as they lift.
 *
 * A body of ordinary length lays out again at each whole point the pinch
 * passes. A longer one (`LIVE_LIMIT`) only counts the size on the badge until
 * the fingers lift and then lays out once: a 2,852-line output took over a
 * second per point on the iOS simulator. A preview scale was no way out: one
 * text that tall drew nothing while scaled, and its line numbers kept the
 * scaled places afterwards. Either way the line under the fingers' midpoint
 * stays under it, the body scrolling to keep that point at the same share of
 * the content once a new height is reported. Only the last size is saved.
 *
 * On Android the body is made the JS responder for the rest of the pinch
 * (`holdHostGestures`): fingers resting mid-pinch otherwise started the
 * text's own long-press selection, and the scroller could still take them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, type GestureResponderEvent, type View } from "react-native";
import type { DetailsZoom } from "../contracts";
import type { PreviewScroller } from "../../ui/preview-scroller";
import { pinchZoom } from "../../ui/text-zoom";
import { holdHostGestures } from "../../ui/hold-host-gestures";

/** How long the size stays up after the fingers lift, with its reset. */
export const ZOOM_BADGE_MS = 2000;
/** Heights reported this long after the lift are still the pinch's last layout. */
const SETTLE_MS = 500;
/** Content taller than this lays out only as the fingers lift. */
export const LIVE_LIMIT = 4000;
/**
 * On iOS one text taller than about this many pixels draws nothing and takes
 * no pinch: a 2,852-line output drew at 20pt (85,500pt, 256,500px at 3x) and
 * stayed blank at 22pt (94,000pt, 282,000px). A pinch does not grow the body
 * past it; at most it stays as tall as it already is.
 */
export const IOS_TEXT_LIMIT_PX = 2 ** 18;

/**
 * The largest zoom that keeps content `height` tall at zoom `from` within the
 * iOS limit. `base` is the smaller of the body and code sizes: the smaller
 * one grows fastest by a point.
 */
export function zoomCap(base: number, from: number, height: number, scale = PixelRatio.get(), os = Platform.OS): number {
  if (os !== "ios" || height <= 0) return Infinity;
  const fits = Math.floor(((base + from) * IOS_TEXT_LIMIT_PX * 0.95) / (height * scale)) - base;
  return Math.max(from, fits);
}

interface Point {
  x: number;
  y: number;
}

export interface PinchOptions {
  zoom(): DetailsZoom | undefined;
  scroller(): PreviewScroller | null;
  /** The size the badge shows, while a pinch moves and as it ends. */
  changed(zoom: number, pinching: boolean): void;
  /** Keeps the touch from the body's text and scroller while two fingers are down; returns its release. */
  hold?(): () => void;
}

export interface Pinch {
  start(event: GestureResponderEvent): void;
  move(event: GestureResponderEvent): void;
  end(event: GestureResponderEvent): void;
  cancel(): void;
  /** The body's content height, each time it is reported. */
  contentSized(height: number): void;
}

export function createPinch(options: PinchOptions): Pinch {
  let gesture: { distance: number; from: number; zoom: number; top: number; live: boolean; mid: number; cap: number } | null = null;
  // Where the midpoint was, as a share of the content, for the next height.
  let anchor: { share: number; focus: number; until: number } | null = null;
  let height = 0;
  let release = () => {};
  const keep = (mid: number, top: number) => {
    const scroller = options.scroller();
    if (!scroller || height <= 0) return;
    const focus = mid - top;
    anchor = { share: (scroller.offset() + focus) / height, focus, until: Infinity };
  };
  const begin = (touches: readonly Point[]) => {
    const zoom = options.zoom();
    const distance = spread(touches);
    if (!zoom || distance <= 0) return;
    const from = zoom.current();
    gesture = { distance, from, zoom: from, top: 0, live: height <= LIVE_LIMIT, mid: midpoint(touches).y, cap: zoomCap(Math.min(zoom.base, zoom.code), from, height) };
    anchor = null;
    release = options.hold?.() ?? (() => {});
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
    gesture.mid = midpoint(touches).y;
    const next = Math.min(gesture.cap, pinchZoom(zoom.base, gesture.from, spread(touches) / gesture.distance));
    if (next === gesture.zoom) return;
    gesture.zoom = next;
    if (gesture.live) {
      keep(gesture.mid, gesture.top);
      zoom.preview(next);
    }
    options.changed(next, true);
  };
  const finish = () => {
    if (!gesture) return;
    const { from, zoom: reached, live, mid, top } = gesture;
    gesture = null;
    release();
    release = () => {};
    if (!live && reached !== from) keep(mid, top);
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
  };
}

/**
 * The pinch for the drawer's body: its touch handlers, the size to show
 * while it moves and for a moment after, and the height report.
 */
export function usePinchZoom(zoom: DetailsZoom | undefined, scroller: PreviewScroller | null) {
  const latest = useRef({ zoom, scroller });
  latest.current = { zoom, scroller };
  // The body the pinch's touches land on.
  const body = useRef<View>(null);
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
    hold: () => (Platform.OS === "android" ? holdHostGestures(body.current) : () => {}),
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
  return { handlers, badge, body, contentSized: pinch.contentSized, hide };
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
