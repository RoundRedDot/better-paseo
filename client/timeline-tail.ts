import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
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
}

const tails = new Map<string, Tail>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Records an item's arrival. A later arrival takes the tail; ties keep the incumbent. */
export function noteTimelineItem(agentId: string, key: string, at: number): void {
  const tail = tails.get(agentId);
  if (tail && (at < tail.at || (at === tail.at && key !== tail.key))) return;
  if (tail && tail.key === key && tail.at === at) return;
  tails.set(agentId, { key, at });
  publish();
}

/**
 * Moves the tail from `from` to `to` when `from` holds it: the same item under
 * a key that grew (see `useTextItemTailKey`). Any other tail is left alone.
 */
export function renameTimelineItem(agentId: string, from: string, to: string): void {
  const tail = tails.get(agentId);
  if (from === to || tail?.key !== from) return;
  tails.set(agentId, { key: to, at: tail.at });
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
 * old key at that point.
 */
export function useTextItemTailKey(agentId: string, kind: string, at: number, text: string): string {
  const key = textItemTailKey(kind, at, text);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const from = previous.current;
    previous.current = key;
    if (from !== null) renameTimelineItem(agentId, from, key);
  }, [agentId, key]);
  return key;
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

/** True while this item is the newest one the plugin has drawn. */
export function useIsTimelineTail(agentId: string, key: string): boolean {
  const getSnapshot = useCallback(() => tails.get(agentId)?.key === key, [agentId, key]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
