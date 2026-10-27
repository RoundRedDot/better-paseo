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
  /** Scrolls by `delta`, kept within the content, at once or gliding there; returns the distance moved. */
  scrollBy(delta: number, glide?: boolean): number;
}

export const PreviewScrollerContext = createContext<PreviewScroller | null>(null);

/** Native text readers listen without re-rendering the panel on every scroll. */
export function createPreviewViewport() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    changed() { Array.from(listeners).forEach((listener) => listener()); },
  };
}

export const PreviewViewportContext = createContext<ReturnType<typeof createPreviewViewport> | null>(null);
