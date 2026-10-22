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
 */
import { createContext, useContext, useEffect } from "react";

export interface DetailsBodyReport {
  scrolled(offset: number): void;
  /** The scroll content's height (`onContentSizeChange`). */
  contentSized(height: number): void;
  /** The scroller's own height (`onLayout`). */
  laidOut(height: number): void;
}

export interface DetailsBodyScroll extends DetailsBodyReport {
  /** A body that reports mounted; returns its unmount. */
  attach(): () => void;
}

export const DetailsBodyContext = createContext<DetailsBodyScroll | null>(null);

/** Inside the details panel: the body's reports. Undefined elsewhere. */
export function useDetailsBodyScroll(): DetailsBodyReport | undefined {
  const body = useContext(DetailsBodyContext);
  useEffect(() => body?.attach(), [body]);
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
}

export function createBodyScroll(): BodyWatch {
  let attached = 0;
  let offset = 0;
  const size: BodySize = { content: 0, viewport: 0 };
  const waiting = new Set<(size: BodySize) => void>();
  const sized = () => {
    if (size.content <= 0 || size.viewport <= 0 || waiting.size === 0) return;
    const listeners = Array.from(waiting);
    waiting.clear();
    listeners.forEach((listener) => listener({ ...size }));
  };
  return {
    attach() {
      attached += 1;
      offset = 0;
      return () => {
        attached -= 1;
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
  };
}
