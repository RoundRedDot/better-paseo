import { useCallback, useSyncExternalStore } from "react";

/**
 * What a tabbed details card learns from its layout and scrolling: where its
 * tabs sit, how tall its scroller is, whether the tabs have pinned and
 * whether content runs under the tabs or the action bar.
 *
 * Kept out of the card's own state: each first layout set three of these, and
 * the card then drew all its sections again for them (22 ms of JS plus a
 * commit on an Android foldable, while the sheet waited to slide in). Only
 * the parts that read a value (the tab bar's shadow, a page's least height,
 * the action bar's edge) draw again when it changes.
 */
export interface DetailChromeState {
  /** Sticky tabs reached the top of the scroller. */
  tabsPinned: boolean;
  /** The fixed tabs' page has scrolled. */
  bodyScrolled: boolean;
  /** Content runs under the action bar, for fixed tabs and for sticky tabs. */
  bodyUnderBar: boolean;
  headerUnderBar: boolean;
  /** The sticky tab bar's offset and height in the scroller. */
  tabTop: number;
  tabHeight: number;
  /** The scroller's height: a page fills at least what the tabs leave of it. */
  viewport: number;
}

export interface DetailChrome {
  get(): DetailChromeState;
  set(patch: Partial<DetailChromeState>): void;
  subscribe(listener: () => void): () => void;
}

const INITIAL: DetailChromeState = { tabsPinned: false, bodyScrolled: false, bodyUnderBar: false, headerUnderBar: false, tabTop: 0, tabHeight: 0, viewport: 0 };

export function createDetailChrome(): DetailChrome {
  let state = INITIAL;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const keys = Object.keys(patch) as (keyof DetailChromeState)[];
      if (keys.every((key) => patch[key] === undefined || patch[key] === state[key])) return;
      state = { ...state };
      for (const key of keys) {
        const value = patch[key];
        if (value !== undefined) (state as Record<keyof DetailChromeState, unknown>)[key] = value;
      }
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** One value read from the chrome: the caller draws again only when it changes. */
export function useDetailChrome<T extends boolean | number>(chrome: DetailChrome, select: (state: DetailChromeState) => T): T {
  const read = useCallback(() => select(chrome.get()), [chrome, select]);
  return useSyncExternalStore(chrome.subscribe, read, read);
}
