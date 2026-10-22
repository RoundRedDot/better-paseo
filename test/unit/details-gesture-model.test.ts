import { describe, expect, it } from "vitest";
import {
  AXIS_LOCK_DISTANCE,
  HOST_EDGE_WIDTH,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  SWIPE_EDGE_DAMPING,
  axisLock,
  dampSwipeDistance,
  isLongPress,
  shouldHandoverBodyPull,
  shouldYieldEdgeSwipe,
  swipeDecision,
  swipeDamping,
} from "../../client/details/gesture-model";

describe("details gestures", () => {
  it("locks an axis after 10 px using the 1.2 horizontal ratio", () => {
    expect(AXIS_LOCK_DISTANCE).toBe(10);
    expect(axisLock(9.99, 0)).toBeNull();
    expect(axisLock(10, 0)).toBe("x");
    expect(axisLock(12, 10)).toBe("y");
    expect(axisLock(12.1, 10)).toBe("x");
  });

  it("switches at more than 25% width or 0.5 px/ms and damps at an end", () => {
    expect(swipeDecision(-100, 0, 400, true)).toBe(0);
    expect(swipeDecision(-101, 0, 400, true)).toBe(1);
    expect(swipeDecision(101, 0, 400, true)).toBe(-1);
    expect(swipeDecision(-30, -0.5, 400, true)).toBe(0);
    expect(swipeDecision(-30, -0.501, 400, true)).toBe(1);
    expect(swipeDecision(-101, 0, 400, false)).toBe(0);
    expect(swipeDamping(false)).toBe(SWIPE_EDGE_DAMPING);
    expect(dampSwipeDistance(-100, false)).toBe(-30);
  });

  it("yields edge swipes to the host for starts below 20 px", () => {
    expect(HOST_EDGE_WIDTH).toBe(20);
    expect(shouldYieldEdgeSwipe(19.99)).toBe(true);
    expect(shouldYieldEdgeSwipe(20)).toBe(false);
  });

  it("hands a downward body pull to the panel only at scrollTop zero or less", () => {
    expect(shouldHandoverBodyPull(-1, 1)).toBe(true);
    expect(shouldHandoverBodyPull(0, 1)).toBe(true);
    expect(shouldHandoverBodyPull(0.01, 1)).toBe(false);
    expect(shouldHandoverBodyPull(0, 0)).toBe(false);
    expect(shouldHandoverBodyPull(0, -1)).toBe(false);
  });

  it("uses a 500 ms long press and 10 px movement slop", () => {
    expect(LONG_PRESS_MS).toBe(500);
    expect(LONG_PRESS_SLOP).toBe(10);
    expect(isLongPress(499, 0, 0)).toBe(false);
    expect(isLongPress(500, 10, 0)).toBe(true);
    expect(isLongPress(500, 10.01, 0)).toBe(false);
  });
});
