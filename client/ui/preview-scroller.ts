import { createContext } from "react";

/**
 * The phone preview body's scroller, for a gesture inside it that takes the
 * finger for itself. A gutter drag holds the body still, so the lines under a
 * resting finger stay put, and scrolls it only while the finger is past the
 * body's edge.
 */
export interface PreviewScroller {
  /** Stops the body following the finger, or lets it scroll again. */
  hold(on: boolean): void;
  /** The body's top and height, in the coordinates `measure` reports. */
  measure(done: (top: number, height: number) => void): void;
  /** How far the body has scrolled. */
  offset(): number;
  /** Scrolls by `delta`, kept within the content; returns the distance moved. */
  scrollBy(delta: number): number;
}

export const PreviewScrollerContext = createContext<PreviewScroller | null>(null);
