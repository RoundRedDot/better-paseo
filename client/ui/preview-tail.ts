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
 * Starts at the tail and stays there while the content grows, until a scroll
 * leaves the tail. That scroll is the reader; later growth leaves it where
 * they put it. Scrolling back to the tail follows again.
 *
 * `pinned` outlives this binding, so a re-render can ask `follow` to catch
 * the tail without a DOM mutation of its own. A scroll event fired while the
 * jump is being applied is ignored: it can still report the old offset.
 */
export function bindPreviewTail(
  node: HTMLElement,
  pinned: { current: boolean },
  followRef?: { current: (() => void) | null },
): () => void {
  let adjusting = false;
  const follow = () => {
    if (!pinned.current) return;
    const top = previewTailOffset(node.clientHeight, node.scrollHeight);
    if (node.scrollTop === top) return;
    adjusting = true;
    node.scrollTop = top;
    adjusting = false;
  };
  const onScroll = () => {
    if (adjusting) return;
    pinned.current = previewFollowsTail(node.scrollTop, node.clientHeight, node.scrollHeight);
  };
  node.addEventListener("scroll", onScroll, { passive: true });
  if (followRef) followRef.current = follow;
  follow();
  const view = node.ownerDocument?.defaultView;
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
  };
}
