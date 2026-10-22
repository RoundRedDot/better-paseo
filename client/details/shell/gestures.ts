/**
 * The panel's drags (design 4a, table 5.3). The handle and the header move
 * the drawer up and down; the header alone also swipes sideways to the
 * previous or next block; a pull down on a body already at its top hands the
 * finger to the drawer. Each drag locks its axis after 10 px and keeps it.
 *
 * A sideways swipe that starts within 20 of the screen's left edge is left
 * to the host. As it is granted, the drag holds the host's own pans (the
 * agent-list swipe, the list's scroll) for the rest of the touch.
 */
import { PanResponder, type GestureResponderEvent, type PanResponderGestureState } from "react-native";
import { axisLock } from "../gesture-model";

/** Starts left of this x are the host's edge swipe. */
export const HOST_EDGE = 20;
/** How far past the last detent, or the first and last block, a drag still follows the finger. */
export const OVERDRAG = 0.3;

/** The release velocity is the finger's over about this long, not the last move's alone. */
export const VELOCITY_WINDOW_MS = 100;
/** Moves closer together than this are too short a span to time. */
const VELOCITY_MIN_SPAN_MS = 30;

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
   * Claims on the way down, before a scroller inside: only a pull downwards,
   * and only while this says the body is at its top.
   */
  pullDown?(): boolean;
}) {
  let x0 = 0;
  let y0 = 0;
  let axis: "x" | "y" | null = null;
  let release = () => {};
  let samples: Sample[] = [];
  const sample = (event: GestureResponderEvent) => {
    const stamp = event.nativeEvent.timestamp;
    samples.push({ t: typeof stamp === "number" && stamp > 0 ? stamp : Date.now(), x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
    if (samples.length > 24) samples = samples.slice(-12);
  };
  // PanResponder counts from the grant, which a busy JS thread delays: measure from where the finger went down.
  const travel = (event: GestureResponderEvent) => ({
    dx: event.nativeEvent.pageX - x0,
    dy: event.nativeEvent.pageY - y0,
  });
  const target = () => (axis === "x" ? options.horizontal?.() ?? null : axis === "y" ? options.vertical() : null);
  const decide = (event: GestureResponderEvent) => {
    const { dx, dy } = travel(event);
    const lock = axisLock(dx, dy);
    if (lock === "y" && options.vertical()) {
      if (options.pullDown && !(dy > 0 && options.pullDown())) return false;
      axis = "y";
      return true;
    }
    if (lock === "x" && !options.pullDown && x0 >= HOST_EDGE && options.horizontal?.()) {
      axis = "x";
      return true;
    }
    return false;
  };
  const record = (event: GestureResponderEvent) => {
    x0 = event.nativeEvent.pageX;
    y0 = event.nativeEvent.pageY;
    axis = null;
    samples = [];
    sample(event);
    return false;
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
  };
  return PanResponder.create({
    onStartShouldSetPanResponderCapture: record,
    onStartShouldSetPanResponder: () => false,
    ...(options.pullDown
      ? { onMoveShouldSetPanResponderCapture: decide }
      : { onMoveShouldSetPanResponder: decide }),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      release = options.hold();
      target()?.begin();
    },
    onPanResponderMove: (event) => {
      sample(event);
      const { dx, dy } = travel(event);
      target()?.move(axis === "x" ? dx : dy);
    },
    onPanResponderRelease: finish,
    onPanResponderTerminate: () => {
      release();
      release = () => {};
      target()?.cancel();
      axis = null;
    },
  });
}
