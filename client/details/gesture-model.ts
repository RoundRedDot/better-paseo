export const AXIS_LOCK_DISTANCE = 10;
export const AXIS_HORIZONTAL_RATIO = 1.2;
export const SWIPE_DISTANCE_RATIO = 0.25;
export const SWIPE_VELOCITY = 0.5;
export const SWIPE_EDGE_DAMPING = 0.3;
export const HOST_EDGE_WIDTH = 20;
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 10;

export function axisLock(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < AXIS_LOCK_DISTANCE) return null;
  return Math.abs(dx) > AXIS_HORIZONTAL_RATIO * Math.abs(dy) ? "x" : "y";
}

/** Leftward header swipes move forward (+1); rightward swipes move backward (-1). */
export function swipeDecision(dx: number, velocityX: number, width: number, hasNeighbour: boolean): -1 | 0 | 1 {
  let direction: -1 | 0 | 1 = 0;
  if (Math.abs(dx) > width * SWIPE_DISTANCE_RATIO) direction = dx < 0 ? 1 : -1;
  else if (Math.abs(velocityX) > SWIPE_VELOCITY) direction = velocityX < 0 ? 1 : -1;
  return hasNeighbour ? direction : 0;
}

export function swipeDamping(hasNeighbour: boolean): number {
  return hasNeighbour ? 1 : SWIPE_EDGE_DAMPING;
}

export function dampSwipeDistance(dx: number, hasNeighbour: boolean): number {
  return dx * swipeDamping(hasNeighbour);
}

/** The host owns horizontal edge gestures that begin inside its 20 px strip. */
export function shouldYieldEdgeSwipe(startX: number): boolean {
  return startX < HOST_EDGE_WIDTH;
}

/** A downward body drag reaches the panel only after the body is at its top. */
export function shouldHandoverBodyPull(scrollTop: number, dy: number): boolean {
  return scrollTop <= 0 && dy > 0;
}

export function isLongPress(elapsedMs: number, dx: number, dy: number): boolean {
  return elapsedMs >= LONG_PRESS_MS && Math.hypot(dx, dy) <= LONG_PRESS_SLOP;
}
