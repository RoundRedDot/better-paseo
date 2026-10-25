/**
 * A pinch on a native details panel's body sets its absolute text size.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Platform, type GestureResponderEvent, type View } from "react-native";
import type { DetailsZoom } from "../contracts";
import type { PreviewScroller } from "../../ui/preview-scroller";
import { pinchZoom } from "../../ui/text-zoom";
import { holdHostGestures } from "../../ui/hold-host-gestures";
import { clampDetailsFontSize } from "../../../shared/preferences-settings";

/** How long the size stays up after the fingers lift, with its reset. */
export const ZOOM_BADGE_MS = 2000;
/** Coalesce repeated button presses before saving or laying out a long body. */
export const ZOOM_STEP_MS = 150;
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
 * The largest absolute size that keeps content `height` tall at size `from`
 * within the iOS text limit.
 */
export function zoomCap(from: number, height: number, scale = PixelRatio.get(), os = Platform.OS): number {
  if (os !== "ios" || height <= 0) return Infinity;
  const fits = Math.floor((from * IOS_TEXT_LIMIT_PX * 0.95) / (height * scale));
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
    gesture = { distance, from, zoom: from, top: 0, live: height <= LIVE_LIMIT, mid: midpoint(touches).y, cap: zoomCap(from, height) };
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
    const next = Math.min(gesture.cap, pinchZoom(gesture.from, spread(touches) / gesture.distance));
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
  const [cap, setCap] = useState(Infinity);
  const height = useRef(0);
  const interacting = useRef(false);
  const pinching = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  const cancelHide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    if (!interacting.current && !pinching.current) {
      timer.current = setTimeout(() => setBadge(null), ZOOM_BADGE_MS);
    }
  }, [cancelHide]);
  const cancelStep = useCallback(() => {
    if (stepTimer.current) clearTimeout(stepTimer.current);
    stepTimer.current = null;
  }, []);
  const flush = useCallback(() => {
    cancelStep();
    const next = pending.current;
    pending.current = null;
    if (next !== null) latest.current.zoom?.commit(next);
  }, [cancelStep]);
  const scheduleStep = useCallback(() => {
    cancelStep();
    if (pending.current !== null && !interacting.current) {
      stepTimer.current = setTimeout(flush, ZOOM_STEP_MS);
    }
  }, [cancelStep, flush]);
  const pinch = useMemo(() => createPinch({
    zoom: () => latest.current.zoom,
    scroller: () => latest.current.scroller,
    changed(next, active) {
      pinching.current = active;
      setBadge(next);
      if (active) cancelHide();
      else scheduleHide();
    },
    hold: () => (Platform.OS === "android" ? holdHostGestures(body.current) : () => {}),
  }), [cancelHide, scheduleHide]);
  useEffect(() => () => {
    cancelHide();
    // Closing or switching the block still saves its last requested size.
    flush();
  }, [cancelHide, flush]);
  const handlers = useMemo(() => (zoom ? {
    onTouchStart(event: GestureResponderEvent) {
      flush();
      pinch.start(event);
    },
    onTouchMove: pinch.move,
    onTouchEnd: pinch.end,
    onTouchCancel: pinch.cancel,
  } : undefined), [pinch, flush, zoom !== undefined]);
  const contentSized = useCallback((nextHeight: number) => {
    height.current = nextHeight;
    pinch.contentSized(nextHeight);
    const current = latest.current.zoom;
    if (current) setCap(zoomCap(current.current(), nextHeight));
  }, [pinch]);
  const nextStep = (direction: -1 | 1) => {
    const current = pending.current ?? zoom?.current() ?? 0;
    // A stale height may still describe the smaller size before its layout.
    // Keep that cap until the new height arrives, but always allow shrinking.
    return Math.min(Math.max(current, cap), clampDetailsFontSize(current + direction));
  };
  const setSize = (next: number) => {
    if (!zoom) return;
    pending.current = next;
    setBadge(next);
    // Long native text is expensive to remount and reflow. Count the steps
    // immediately, then apply only the last size once the reader pauses.
    if (height.current <= LIVE_LIMIT) zoom.preview(next);
    scheduleStep();
    scheduleHide();
  };
  const step = (direction: -1 | 1) => {
    const next = nextStep(direction);
    if (next !== (pending.current ?? zoom?.current() ?? 0)) setSize(next);
    else scheduleHide();
  };
  const interaction = (active: boolean) => {
    interacting.current = active;
    if (active) {
      cancelHide();
      cancelStep();
    } else {
      scheduleStep();
      scheduleHide();
    }
  };
  const current = pending.current ?? zoom?.current() ?? 0;
  return { handlers, badge, body, contentSized, reset: () => { if (zoom) setSize(zoom.base); }, step, interaction,
    canDecrease: Boolean(zoom && nextStep(-1) < current),
    canIncrease: Boolean(zoom && nextStep(1) > current),
  };
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
