import { createContext, useCallback, useContext, useRef, type Context } from "react";
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
 * well before the press), `arm` says the press went through and the change is
 * coming, and `settle` measures it again once the surrounding view has laid
 * out and scrolls the difference away. A press that turns into a scroll never
 * arms, so a later, unrelated layout change is left alone. A host without the list
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
/** One correction, then one check that it held. */
const PASSES = 2;

export interface ScrollAnchor {
  /** For the control that has to stay put. */
  ref: React.RefObject<View | null>;
  /** On press-in: remember where the control is. */
  hold(): void;
  /** On press, just before the change: correct the next layout. */
  arm(): void;
  /** After the change has laid out: scroll it back there. */
  settle(): void;
}

export function useScrollAnchor(): ScrollAnchor {
  const list = useContext(resolveListContext());
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

  const settle = useCallback(() => {
    const from = target.current;
    if (from === null || !list?.getOutermostParentListRef || !list.getScrollMetrics) return;
    target.current = null;
    held.current = null;
    armed.current = false;
    const correct = (pass: number) => {
      requestAnimationFrame(() => {
        measure((y) => {
          const moved = y - from;
          if (Math.abs(moved) <= TOLERANCE) return;
          const scroller = list.getOutermostParentListRef?.();
          const offset = list.getScrollMetrics?.().offset;
          if (!scroller?.scrollToOffset || typeof offset !== "number") return;
          // An inverted list's offset runs from the bottom: content that
          // moved down the screen needs a smaller offset, not a larger one.
          const delta = scroller.props?.inverted ? -moved : moved;
          scroller.scrollToOffset({ offset: Math.max(0, offset + delta), animated: false });
          if (pass + 1 < PASSES) correct(pass + 1);
        });
      });
    };
    correct(0);
  }, [list, measure]);

  return { ref, hold, arm, settle };
}
