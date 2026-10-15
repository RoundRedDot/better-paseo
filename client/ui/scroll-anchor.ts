import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type Context } from "react";
import { Platform, VirtualizedList } from "react-native";
import type { View } from "react-native";

/**
 * Keeps a pressed control under the finger when what it toggles changes
 * height.
 *
 * Paseo's native chat is an inverted FlatList, so it holds the newest content
 * still and grows or shrinks everything above a change. Hiding a 480pt image
 * therefore drops the card's own header 480pt down the screen — usually off
 * it — and the reader is left looking at an older turn, as if the press had
 * done nothing at all. The plugin API has no scroll call, but every timeline
 * item renders inside the list's own `VirtualizedList` context, which hands
 * out the list and its current offset; the correction scrolls by exactly how
 * far the control moved.
 *
 * `hold` measures the control before the change (on press-in, which lands
 * well before the press) and `arm` says the press went through and the change
 * is coming. When `changed` — the state the press flips — next differs, a
 * layout effect measures the control again and scrolls the difference away.
 * A press that turns into a scroll never arms, so a later, unrelated layout
 * change is left alone.
 *
 * The correction has to land in the same frame as the change. Waiting for
 * `onLayout` and a frame callback, as the first version did, let the list draw
 * one frame at the jumped position before scrolling back, and the whole chat
 * flashed. On the new architecture a layout effect runs after the shadow tree
 * is laid out but before the UI thread mounts it, `measureInWindow` answers
 * from that tree synchronously, and the scroll command queued here is applied
 * with the same mount. A host without the list
 * context, or web, where the timeline is not inverted and the browser keeps
 * the scroll position, gets plain toggling.
 */

interface ScrollMetrics {
  offset: number;
}

interface ListRef {
  props?: { inverted?: boolean | null };
  scrollToOffset?(params: { offset: number; animated?: boolean }): void;
}

interface ListContextValue {
  getScrollMetrics?(): ScrollMetrics;
  getOutermostParentListRef?(): ListRef;
}

const NO_LIST = createContext<ListContextValue | null>(null);
let listContext: Context<ListContextValue | null> | null = null;

/** The host's own `VirtualizedListContext`, reached through the list class. */
function resolveListContext(): Context<ListContextValue | null> {
  if (listContext) return listContext;
  let found: Context<ListContextValue | null> | undefined;
  try {
    found = (VirtualizedList as unknown as { contextType?: Context<ListContextValue | null> } | undefined)
      ?.contextType;
  } catch {
    found = undefined;
  }
  listContext = found ?? NO_LIST;
  return listContext;
}

/** A move under this many points is layout noise, not a jump. */
const TOLERANCE = 1;

/** Observe the native timeline's offset only while a floating menu is open. */
export function useScrollDismiss(active: boolean, dismiss: () => void): void {
  const list = useContext(resolveListContext());
  const latest = useRef({ list, dismiss });
  latest.current = { list, dismiss };
  useEffect(() => {
    if (!active || Platform.OS === "web" || !latest.current.list?.getScrollMetrics) return;
    const offset = latest.current.list.getScrollMetrics().offset;
    let frame: number;
    const check = () => {
      if (latest.current.list?.getScrollMetrics?.().offset !== offset) {
        latest.current.dismiss();
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [active]);
}

export interface ScrollAnchor {
  /** For the control that has to stay put. */
  ref: React.MutableRefObject<View | null>;
  /** On press-in: remember where the control is. */
  hold(): void;
  /** On press, just before the change: correct the next layout. */
  arm(): void;
}

export function useScrollAnchor(changed: unknown): ScrollAnchor {
  const list = useContext(resolveListContext());
  // The list hands out a fresh context object whenever it re-renders (every
  // streamed chunk), so the effect reads it through a ref and runs only when
  // `changed` does.
  const listRef = useRef(list);
  listRef.current = list;
  const ref = useRef<View>(null);
  const held = useRef<number | null>(null);
  const armed = useRef(false);
  const target = useRef<number | null>(null);
  const native = Platform.OS !== "web";

  const measure = useCallback((done: (y: number) => void) => {
    const node = ref.current as unknown as {
      measureInWindow?(callback: (x: number, y: number) => void): void;
    } | null;
    node?.measureInWindow?.((_x, y) => {
      if (Number.isFinite(y)) done(y);
    });
  }, []);

  const hold = useCallback(() => {
    if (!native || !list?.getOutermostParentListRef) return;
    held.current = null;
    armed.current = false;
    measure((y) => {
      held.current = y;
      if (armed.current) target.current = y;
    });
  }, [native, list, measure]);

  const arm = useCallback(() => {
    armed.current = true;
    if (held.current !== null) target.current = held.current;
  }, []);

  // Not on mount: only a change the press armed is corrected.
  useLayoutEffect(() => {
    const list = listRef.current;
    const from = target.current;
    target.current = null;
    held.current = null;
    armed.current = false;
    if (from === null || !list?.getOutermostParentListRef || !list.getScrollMetrics) return;
    measure((y) => {
      const moved = y - from;
      if (Math.abs(moved) <= TOLERANCE) return;
      const scroller = list.getOutermostParentListRef?.();
      const offset = list.getScrollMetrics?.().offset;
      if (!scroller?.scrollToOffset || typeof offset !== "number") return;
      // An inverted list's offset runs from the bottom: content that moved
      // down the screen needs a smaller offset, not a larger one.
      const delta = scroller.props?.inverted ? -moved : moved;
      scroller.scrollToOffset({ offset: Math.max(0, offset + delta), animated: false });
    });
  }, [changed, measure]);

  return useMemo(() => ({ ref, hold, arm }), [hold, arm]);
}
