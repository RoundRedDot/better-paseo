/**
 * What the drawer needs to know about the preview body inside it.
 *
 * - The pull-down hand-over (design 4a): once the body is scrolled to its
 *   top, a further pull down moves the drawer instead.
 * - The height a block switch animates to (design 5.5): the new block's
 *   content height, measured while the panel holds the old height.
 *
 * On web the drawer reads both from the DOM. A phone's body is a
 * `ScrollView` inside the content, which the drawer cannot read, so
 * `HoverPreviewBody` reports its offset and sizes here under the details
 * chrome. Until a body reports, the drawer does not take the pull from it: a
 * pull on a body scrolled down must scroll it.
 *
 * The other way, the drawer tells the body when it came to rest after sliding
 * in (`onRedraw`), so iOS text drawn while it was below the screen is drawn
 * again in place, and scrolls a phone body that sits at its top: there the
 * body does not scroll itself (`HoverPreviewBody`), so the drawer takes the
 * finger whichever way it goes.
 */
import { createContext, useContext, useEffect } from "react";
import type { PreviewScroller } from "../../ui/preview-scroller";

export interface DetailsBodyReport {
  scrolled(offset: number): void;
  /** The scroll content's height (`onContentSizeChange`). */
  contentSized(height: number): void;
  /** The scroller's own height (`onLayout`). */
  laidOut(height: number): void;
  /** Calls `listener` each time the panel comes to rest after sliding in; returns its removal. */
  onRedraw(listener: () => void): () => void;
  /** The drawer's or floating panel's drag, for the body to spread on itself. */
  panHandlers(): Record<string, unknown> | undefined;
}

export interface DetailsBodyScroll extends DetailsBodyReport {
  /** A body that reports mounted, with its scroller on a phone; returns its unmount. */
  attach(scroller?: PreviewScroller): () => void;
}

export const DetailsBodyContext = createContext<DetailsBodyScroll | null>(null);

/** Inside the details panel: the body's reports. Undefined elsewhere. */
export function useDetailsBodyScroll(scroller?: PreviewScroller): DetailsBodyReport | undefined {
  const body = useContext(DetailsBodyContext);
  useEffect(() => body?.attach(scroller), [body, scroller]);
  return body ?? undefined;
}

export interface BodySize {
  content: number;
  viewport: number;
}

/** The drawer's side of the reports. */
export interface BodyWatch extends DetailsBodyScroll {
  /** Whether the body is at its top; null while no body reports. */
  atTop(): boolean | null;
  /** Calls `listener` on the next size report; returns its removal. */
  onNextSize(listener: (size: BodySize) => void): () => void;
  /** The panel came to rest after sliding in. */
  redraw(): void;
  /** The phone body's scroller, while one is attached. */
  scroller(): PreviewScroller | null;
  /** The panel's body drag; set as the panel renders, before the body does. */
  setPanHandlers(handlers: Record<string, unknown> | undefined): void;
}

export function createBodyScroll(): BodyWatch {
  let attached = 0;
  let offset = 0;
  // The latest body's: a block switch mounts the next body before the last one lets go.
  let current: PreviewScroller | null = null;
  let pan: Record<string, unknown> | undefined;
  const size: BodySize = { content: 0, viewport: 0 };
  const waiting = new Set<(size: BodySize) => void>();
  const redraws = new Set<() => void>();
  const sized = () => {
    if (size.content <= 0 || size.viewport <= 0 || waiting.size === 0) return;
    const listeners = Array.from(waiting);
    waiting.clear();
    listeners.forEach((listener) => listener({ ...size }));
  };
  return {
    attach(scroller) {
      attached += 1;
      offset = 0;
      if (scroller) current = scroller;
      return () => {
        attached -= 1;
        if (scroller && current === scroller) current = null;
      };
    },
    scrolled(next) {
      offset = next;
    },
    contentSized(height) {
      size.content = height;
      sized();
    },
    laidOut(height) {
      size.viewport = height;
      sized();
    },
    atTop() {
      return attached > 0 ? offset <= 0 : null;
    },
    onNextSize(listener) {
      waiting.add(listener);
      return () => {
        waiting.delete(listener);
      };
    },
    onRedraw(listener) {
      redraws.add(listener);
      return () => {
        redraws.delete(listener);
      };
    },
    redraw() {
      Array.from(redraws).forEach((listener) => listener());
    },
    scroller() {
      return current;
    },
    panHandlers() {
      return pan;
    },
    setPanHandlers(handlers) {
      pan = handlers;
    },
  };
}
