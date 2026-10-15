/**
 * Keeping a streaming preview on its newest output. Hover and the maximized
 * window scroll the same body, so both use this.
 *
 * Pure aside from the DOM binding, so it can be tested without React Native.
 */

/**
 * How close to the end, in pixels, still counts as watching the newest
 * output. A trackpad nudge stays with the stream; a real scroll up does not.
 */
export const PREVIEW_FOLLOW_SLACK = 24;

/**
 * The time constant of the glide toward new output, in milliseconds. Output
 * arrives in chunks; jumping a chunk's height at once read as a stutter. The
 * glide closes about two thirds of the gap in this time, nearly all of it in
 * three times this, so it keeps up with a stream without trailing it.
 */
export const PREVIEW_GLIDE_MS = 90;

/** The offset that puts the end of `extent` at the bottom of `viewport`. */
export function previewTailOffset(viewport: number, extent: number): number {
  if (!(viewport > 0) || !(extent > 0)) return 0;
  return Math.max(0, extent - viewport);
}

/**
 * True when `offset` is on the newest output, or the content still fits.
 * An unmeasured viewport stays pinned, so the first layout can catch the tail.
 */
export function previewFollowsTail(offset: number, viewport: number, extent: number): boolean {
  if (!(viewport > 0) || !(extent > viewport)) return true;
  return extent - viewport - offset <= PREVIEW_FOLLOW_SLACK;
}

/**
 * The offset `elapsed` milliseconds into a glide from `from` down to `to`.
 * More than a screen behind, it starts a screen short of `to`: what it skips
 * could not be read at that speed anyway. Each step moves at least a pixel,
 * so a browser that rounds `scrollTop` still arrives.
 */
export function previewGlideStep(from: number, to: number, elapsed: number, viewport: number): number {
  if (!(to - from > 1)) return to;
  const start = viewport > 0 && to - from > viewport ? to - viewport : from;
  const eased = start + (to - start) * (1 - Math.exp(-Math.max(0, elapsed) / PREVIEW_GLIDE_MS));
  const next = Math.max(eased, from + 1);
  return to - next <= 1 ? to : next;
}

/**
 * Starts at the tail and stays there while the content grows, until a scroll
 * leaves the tail. That scroll is the reader; later growth leaves it where
 * they put it. Scrolling back to the tail follows again.
 *
 * Growth glides to the new tail, a frame at a time, on the scroll offset
 * alone: nothing re-renders. Opening, a resized panel and reduced motion
 * jump there instead.
 *
 * `pinned` outlives this binding, so a re-render can ask `follow` to catch
 * the tail without a DOM mutation of its own. A scroll event fired while the
 * jump is being applied is ignored: it can still report the old offset. So
 * are the glide's own offsets, reported a frame late; only a move up from
 * where the glide left the body is the reader's.
 */
export function bindPreviewTail(
  node: HTMLElement,
  pinned: { current: boolean },
  followRef?: { current: (() => void) | null },
): () => void {
  const view = node.ownerDocument?.defaultView;
  const frames = typeof view?.requestAnimationFrame === "function" ? view : null;
  const still = view?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  let adjusting = false;
  let frame = 0;
  let stamp = 0;
  let left = 0;
  let viewport = node.clientHeight;
  const tail = () => previewTailOffset(node.clientHeight, node.scrollHeight);
  const write = (top: number) => {
    adjusting = true;
    node.scrollTop = top;
    adjusting = false;
    left = node.scrollTop;
  };
  const stop = () => {
    if (frame) frames?.cancelAnimationFrame(frame);
    frame = 0;
  };
  // Whether the reader has taken the body: true once it moved up from where
  // the glide left it and is no longer on the tail.
  const taken = () => {
    if (node.scrollTop >= left - 1) return false;
    pinned.current = previewFollowsTail(node.scrollTop, node.clientHeight, node.scrollHeight);
    return !pinned.current;
  };
  const step = (time: number) => {
    frame = 0;
    if (!pinned.current || taken()) return;
    const elapsed = stamp ? time - stamp : 16;
    stamp = time;
    const top = tail();
    const next = previewGlideStep(node.scrollTop, top, elapsed, node.clientHeight);
    if (next !== node.scrollTop) write(next);
    if (next !== top) frame = frames!.requestAnimationFrame(step);
  };
  const jump = () => {
    stop();
    const top = tail();
    if (node.scrollTop !== top) write(top);
  };
  const follow = () => {
    if (!pinned.current) return;
    const resized = node.clientHeight !== viewport;
    viewport = node.clientHeight;
    const top = tail();
    if (!frames || still || resized || top < node.scrollTop) {
      jump();
      return;
    }
    if (frame || node.scrollTop === top) return;
    left = node.scrollTop;
    stamp = 0;
    frame = frames.requestAnimationFrame(step);
  };
  const onScroll = () => {
    if (adjusting) return;
    if (frame) {
      if (taken()) stop();
      return;
    }
    pinned.current = previewFollowsTail(node.scrollTop, node.clientHeight, node.scrollHeight);
  };
  node.addEventListener("scroll", onScroll, { passive: true });
  if (followRef) followRef.current = follow;
  if (pinned.current) jump();
  const resize = view?.ResizeObserver ? new view.ResizeObserver(follow) : null;
  const watch = () => {
    if (!resize) return;
    resize.observe(node);
    for (let index = 0; index < node.children.length; index++) resize.observe(node.children[index]!);
  };
  watch();
  const mutations = view?.MutationObserver
    ? new view.MutationObserver(() => {
        watch();
        follow();
      })
    : null;
  mutations?.observe(node, { childList: true, subtree: true, characterData: true });
  return () => {
    if (followRef?.current === follow) followRef.current = null;
    node.removeEventListener("scroll", onScroll);
    resize?.disconnect();
    mutations?.disconnect();
    // The last output can land with the end of the stream, in the commit that
    // releases this binding; a glide still under way finishes at once.
    if (pinned.current && (frame || node.scrollTop < tail())) jump();
    stop();
  };
}

/** How long after a stream ends its last output is still followed on a phone. */
export const PREVIEW_SETTLE_MS = 1000;

/** Where a phone body's follow scrolls: an offset, or the end before the viewport is known. */
export type PreviewTailScroll = (offset: number | "end", animated: boolean) => void;

/**
 * The same follow for a phone body, driven by its ScrollView's events. Growth
 * glides with the platform's own animated scroll, which runs on the UI thread;
 * the first output and reduced motion jump.
 *
 * The glide's scroll events report offsets short of the tail on their way
 * there; they are not the reader leaving. A drag is: it ends the glide, and
 * the scroll events after it decide as before.
 *
 * The last output can land in the same update that ends the stream. `end`
 * marks that moment; the growth `settle` sees within `PREVIEW_SETTLE_MS` of
 * it is followed once more, if the reader was on the tail.
 */
export function nativePreviewTail(scroll: PreviewTailScroll, now: () => number = Date.now) {
  let pinned = true;
  let opened = false;
  let gliding: number | null = null;
  let ended: number | null = null;
  return {
    get pinned() { return pinned; },
    end() {
      ended = pinned && opened ? now() : null;
    },
    settle(viewport: number, content: number, offset: number, still: boolean) {
      if (ended === null) return;
      const late = now() - ended > PREVIEW_SETTLE_MS;
      ended = null;
      if (late || !(viewport > 0)) return;
      const top = previewTailOffset(viewport, content);
      if (top - offset > 1) scroll(top, !still);
    },
    reset() {
      pinned = true;
      opened = false;
      gliding = null;
    },
    grow(viewport: number, content: number, offset: number, still: boolean) {
      if (!pinned) return;
      if (!(viewport > 0)) {
        scroll("end", false);
        return;
      }
      const top = previewTailOffset(viewport, content);
      if (top - offset <= 1) {
        opened = true;
        return;
      }
      if (!opened || still) {
        opened = true;
        gliding = null;
        scroll(top, false);
        return;
      }
      // More than a screen behind: the skipped part could not be read at that speed.
      if (top - offset > viewport) scroll(top - viewport, false);
      gliding = top;
      scroll(top, true);
    },
    scrolled(offset: number, viewport: number, content: number) {
      if (gliding !== null) {
        if (offset >= gliding - 1) gliding = null;
        return;
      }
      pinned = previewFollowsTail(offset, viewport, content);
    },
    drag() {
      gliding = null;
      ended = null;
    },
  };
}
