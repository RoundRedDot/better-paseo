/**
 * The panel's drags (design 4a, table 5.3). The handle and the header move
 * the drawer up and down; the header alone also swipes sideways to the
 * previous or next block; a pull down on a body already at its top hands the
 * finger to the drawer. Each drag locks its axis after 10 px and keeps it.
 * A phone body at its top does not scroll itself (a native scroller there
 * took the pull first), so a drag up there is the panel's too, and scrolls
 * the body (`pullUp`).
 *
 * A sideways swipe that starts within 20 of the screen's left edge is left
 * to the host. As it is granted, the drag holds the host's own pans (the
 * agent-list swipe, the list's scroll) for the rest of the touch.
 *
 * A press-and-drag that belongs to the content never moves the panel: a
 * touch a content gesture zone claimed (`touch-claim.ts`), and on the body
 * also a touch that first went sideways (it scrolls the code), one that
 * rested before it moved down, and every pull down after a long press until
 * the next tap. The last two are the platform's own text selection, which
 * tells JS nothing: a long press on iOS and Android selects, the finger may
 * go on to extend the range, and on iOS the handles it leaves are dragged by
 * later touches inside the text.
 *
 * A second finger is a pinch (`pinch-zoom.ts`): the drag the first one began
 * is cancelled, and the panel takes nothing more from that touch.
 */
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from "react-native";
import { AXIS_LOCK_DISTANCE, axisLock } from "../gesture-model";
import { contentOwnsTouch } from "../touch-claim";

/** Starts left of this x are the host's edge swipe. */
export const HOST_EDGE = 20;
/** How far past the last detent, or the first and last block, a drag still follows the finger. */
export const OVERDRAG = 0.3;

/** The release velocity is the finger's over about this long, not the last move's alone. */
export const VELOCITY_WINDOW_MS = 100;
/** Moves closer together than this are too short a span to time. */
const VELOCITY_MIN_SPAN_MS = 30;
/**
 * A body touch that rests this long before it moves is a hold, not a pull:
 * the content's shortest (a table cell's range, 350); the gutter's is 400,
 * the platforms' text selection 400 to 500.
 */
export const CONTENT_HOLD_MS = 350;

interface Sample {
  t: number;
  x: number;
  y: number;
}

/**
 * The finger's velocity in px/ms at release, over the last 100 ms of its
 * moves. PanResponder's own `vx` / `vy` time only the last two moves, and a
 * slow drag whose moves arrive bunched (a busy JS thread, a host that
 * coalesces touches) read as a fling there: a slow pull down from full closed
 * the drawer instead of settling at fit.
 */
export function releaseVelocity(samples: readonly Sample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  // The oldest move inside the window; when that spans too little time, the first one before it.
  let from: Sample | undefined;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const earlier = samples[index]!;
    if (last.t - earlier.t > VELOCITY_WINDOW_MS) {
      if (!from || last.t - from.t < VELOCITY_MIN_SPAN_MS) from = earlier;
      break;
    }
    from = earlier;
  }
  if (!from) return { vx: 0, vy: 0 };
  const span = last.t - from.t;
  if (span <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - from.x) / span, vy: (last.y - from.y) / span };
}

export interface DragTarget {
  begin(): void;
  /** `travel` down is positive, from where the finger went down. */
  move(travel: number): void;
  end(travel: number, velocity: number): void;
  cancel(): void;
}

export function panelResponder(options: {
  vertical(): DragTarget | null;
  horizontal?(): DragTarget | null;
  /** Holds the host's pans for this touch; returns what lets them go. */
  hold(): () => void;
  /**
   * Claims on the way down, before a scroller inside, and only while this
   * says the body is at its top: a pull down moves the panel.
   */
  pullDown?(): boolean;
  /** At the body's top, where it does not scroll itself: what a drag up moves instead. */
  pullUp?(): DragTarget | null;
  /**
   * Takes the touch as it starts, when nothing inside took it, and lets its
   * moves decide. On iOS and Android the details Modal's root takes every
   * touch nothing deeper took (`onStartShouldSetResponder`), and once an
   * ancestor holds it, a move is offered only to the views above that
   * ancestor: a claim made only on a move never reached this view.
   */
  claimAtStart?(): boolean;
}) {
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let axis: "x" | "y" | null = null;
  let chosen: DragTarget | null = null;
  // Granted as the touch started, before its first axis.
  let early = false;
  // The touch's first axis has been seen; the body refused it for good.
  let locked = false;
  let refused = false;
  // A long press let go in the body: a selection may be up, until a tap.
  let selecting = false;
  let release = () => {};
  let samples: Sample[] = [];
  const sample = (event: GestureResponderEvent) => {
    samples.push({ t: stampOf(event), x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
    if (samples.length > 24) samples = samples.slice(-12);
  };
  // PanResponder counts from the grant, which a busy JS thread delays: measure from where the finger went down.
  const travel = (event: GestureResponderEvent) => ({
    dx: event.nativeEvent.pageX - x0,
    dy: event.nativeEvent.pageY - y0,
  });
  const target = () => chosen;
  // A second finger came down: the touch is a pinch, not the panel's.
  const abort = () => {
    refused = true;
    if (!chosen) return;
    release();
    release = () => {};
    chosen.cancel();
    axis = null;
    chosen = null;
  };
  const decide = (event: GestureResponderEvent) => {
    if (fingers(event) > 1) abort();
    if (refused || contentOwnsTouch()) return false;
    const { dx, dy } = travel(event);
    const lock = axisLock(dx, dy);
    if (lock === null) return false;
    if (!locked) {
      locked = true;
      refused = Boolean(options.pullDown)
        && (lock === "x" || (dy > 0 && (selecting || stampOf(event) - t0 >= CONTENT_HOLD_MS)));
      if (refused) return false;
    }
    if (lock === "y") {
      if (options.pullDown) {
        if (!options.pullDown()) return false;
        chosen = dy > 0 ? options.vertical() : options.pullUp?.() ?? null;
      } else {
        chosen = options.vertical();
      }
      if (!chosen) return false;
      axis = "y";
      return true;
    }
    chosen = !options.pullDown && x0 >= HOST_EDGE ? options.horizontal?.() ?? null : null;
    if (!chosen) return false;
    axis = "x";
    return true;
  };
  const record = (event: GestureResponderEvent) => {
    if (fingers(event) > 1) {
      abort();
      return false;
    }
    x0 = event.nativeEvent.pageX;
    y0 = event.nativeEvent.pageY;
    t0 = stampOf(event);
    axis = null;
    chosen = null;
    early = false;
    locked = false;
    refused = false;
    samples = [];
    sample(event);
    return false;
  };
  // Whatever took the touch: a long press arms `selecting`, a tap disarms it.
  const lifted = (event: GestureResponderEvent) => {
    if (locked) return;
    const { dx, dy } = travel(event);
    if (Math.hypot(dx, dy) >= AXIS_LOCK_DISTANCE) return;
    selecting = stampOf(event) - t0 >= CONTENT_HOLD_MS;
  };
  const finish = (event: GestureResponderEvent, _gesture: PanResponderGestureState) => {
    release();
    release = () => {};
    const drag = target();
    const { dx, dy } = travel(event);
    sample(event);
    const { vx, vy } = releaseVelocity(samples);
    if (axis === "x") drag?.end(dx, vx);
    else drag?.end(dy, vy);
    axis = null;
    chosen = null;
  };
  const start = () => {
    release = options.hold();
    target()?.begin();
  };
  const pan = PanResponder.create({
    onStartShouldSetPanResponderCapture: record,
    onStartShouldSetPanResponder: () => {
      early = Boolean(options.claimAtStart?.());
      return early;
    },
    ...(options.pullDown
      ? { onMoveShouldSetPanResponderCapture: decide }
      : { onMoveShouldSetPanResponder: decide }),
    // Held from the start but not dragging yet: native scrollers (a code line
    // scrolled sideways) and other responders may still have the touch.
    onShouldBlockNativeResponder: () => !early,
    onPanResponderTerminationRequest: () => chosen === null,
    onPanResponderGrant: () => {
      if (chosen) start();
    },
    onPanResponderMove: (event) => {
      if (fingers(event) > 1) abort();
      if (refused) return;
      sample(event);
      if (!chosen) {
        if (!early || !decide(event)) return;
        start();
      }
      const { dx, dy } = travel(event);
      target()?.move(axis === "x" ? dx : dy);
    },
    onPanResponderRelease: finish,
    onPanResponderTerminate: () => {
      release();
      release = () => {};
      target()?.cancel();
      axis = null;
      chosen = null;
    },
  });
  if (!options.pullDown) return pan;
  return { panHandlers: { ...pan.panHandlers, onTouchEndCapture: lifted } };
}

function fingers(event: GestureResponderEvent): number {
  return event.nativeEvent.touches?.length ?? 1;
}

function stampOf(event: GestureResponderEvent): number {
  const stamp = event.nativeEvent.timestamp;
  return typeof stamp === "number" && stamp > 0 ? stamp : Date.now();
}
