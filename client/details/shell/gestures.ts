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
    return false;
  };
  const finish = (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
    release();
    release = () => {};
    const drag = target();
    const { dx, dy } = travel(event);
    if (axis === "x") drag?.end(dx, gesture.vx);
    else drag?.end(dy, gesture.vy);
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
