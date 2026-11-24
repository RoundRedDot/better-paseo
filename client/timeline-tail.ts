import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { hashText } from "./state/disclosure-store";

/**
 * Which plugin timeline item is currently last.
 *
 * A running-jobs card belongs under the newest thing on screen, and a plugin
 * renderer knows only its own item — the host hands it no position. So each
 * item reports the moment it was first projected, and the highest moment wins.
 * Projection is cached per source item, so that moment is the item's arrival
 * time and does not move when the list re-renders or a row scrolls back in.
 *
 * One tail per agent: every chat on screen shares this module, and another
 * agent's later row must not take the newest reply's footer here, nor make
 * this chat's newest tool row give up its gap above the composer.
 */
interface Tail {
  key: string;
  at: number;
  /**
   * A reply: the host restamps it as it streams, and when it closes, with
   * the moment the item after it arrived. That item ties with it, and wins.
   */
  restamped: boolean;
}

const tails = new Map<string, Tail>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * Records an item's arrival. A later arrival takes the tail; ties keep the
 * incumbent, except that an item with a fixed arrival time takes the tail
 * from a reply (`restamped`) of the same moment.
 */
export function noteTimelineItem(agentId: string, key: string, at: number, restamped = false): void {
  const tail = tails.get(agentId);
  if (tail && tail.key === key && tail.at === at) return;
  if (tail && (at < tail.at || (at === tail.at && !(tail.restamped && !restamped)))) return;
  tails.set(agentId, { key, at, restamped });
  publish();
}

/**
 * Moves the tail from `from` to `to` when `from` holds it: the same item under
 * a key that grew (see `useTextItemTailKey`). Any other tail is left alone.
 */
export function renameTimelineItem(agentId: string, from: string, to: string): void {
  const tail = tails.get(agentId);
  if (from === to || tail?.key !== from) return;
  tails.set(agentId, { ...tail, key: to });
  publish();
}

/** Characters of a text item's opening that name it, as for reasoning keys. */
export const TEXT_ITEM_KEY_PREFIX = 80;

/**
 * A text item's identity: its arrival time plus a hash of its opening. The
 * time alone is not unique — at max speed several replies arrive in the same
 * millisecond — and the host passes no item id. Text only grows, so once the
 * opening is 80 characters long the key is fixed, and the mount that replaces
 * a streamed row (live head to history) computes the same key.
 */
export function textItemTailKey(kind: string, at: number, text: string): string {
  return `${kind}:${at}:${hashText(text.slice(0, TEXT_ITEM_KEY_PREFIX))}`;
}

/**
 * `textItemTailKey`, carried across its growth within one mounted row: while
 * the opening is shorter than 80 characters the key changes with each chunk,
 * and the tail follows it instead of staying with the earlier key. The rename
 * runs after the row's children noted the new key, so the incumbent is the
 * old key at that point. It runs before paint, and until it has run the row
 * still answers to `previous`: a card drawn on the tail neither leaves for a
 * frame nor remounts as a reply's opening streams in.
 */
export function useTextItemTailKey(agentId: string, kind: string, at: number, text: string): { key: string; previous: string | null } {
  const key = textItemTailKey(kind, at, text);
  const previous = useRef<string | null>(null);
  const held = previous.current !== key ? previous.current : null;
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = key;
    if (from !== null) renameTimelineItem(agentId, from, key);
  }, [agentId, key]);
  return { key, previous: held };
}

/**
 * Records the item's arrival before paint, so the row that takes the tail and
 * the row giving it up redraw in the same frame.
 */
export function useNoteTimelineItem(agentId: string, key: string | null, at: number, restamped = false): void {
  useLayoutEffect(() => {
    if (key !== null) noteTimelineItem(agentId, key, at, restamped);
  }, [agentId, key, at, restamped]);
}

/** Tests that reuse an agent ID across cases start from no tail. */
export function resetTimelineTailsForTests(): void {
  tails.clear();
}

export function getTimelineTail(agentId: string): string | null {
  return tails.get(agentId)?.key ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * True while this item is the newest one the plugin has drawn. `previous`
 * is a key the item is being renamed from (`useTextItemTailKey`).
 */
export function useIsTimelineTail(agentId: string, key: string, previous: string | null = null): boolean {
  const getSnapshot = useCallback(() => {
    const tail = tails.get(agentId)?.key;
    return tail === key || (previous !== null && tail === previous);
  }, [agentId, key, previous]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** When the newest item the plugin has drawn arrived, or null before any. */
export function useTimelineTailAt(agentId: string): number | null {
  const getSnapshot = useCallback(() => tails.get(agentId)?.at ?? null, [agentId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
