/**
 * Expanded/collapsed state that outlives the row (plan §3.3 item 1, BC-01).
 *
 * The host draws the live head and the history in different component trees,
 * so a card is remounted when its turn settles and a `useState` resets right
 * then. This store sits at module level instead: keyed by
 * `${agentId}:${callId}`, it records only what the reader chose, and a key
 * nobody touched answers with the caller's default. Finishing the tool,
 * re-running the transformer or remounting the row leaves a choice alone.
 *
 * In memory only, bounded to the 2000 most recently chosen keys; a reload
 * returns every card to its default.
 */
import { useCallback, useSyncExternalStore } from "react";

export const DISCLOSURE_LIMIT = 2000;

const choices = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

/** The reader's choice for `key`, or undefined when they never made one. */
export function getDisclosure(key: string): boolean | undefined {
  return choices.get(key);
}

export function setDisclosure(key: string, expanded: boolean): void {
  // Re-inserting moves the key to the young end of the Map's insertion order,
  // which is what makes the eviction below least-recently-chosen.
  choices.delete(key);
  choices.set(key, expanded);
  while (choices.size > DISCLOSURE_LIMIT) {
    const oldest = choices.keys().next().value as string;
    choices.delete(oldest);
    notify(oldest);
  }
  notify(key);
}

export function subscribeDisclosure(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Test seam: forget every choice. */
export function resetDisclosureStore(): void {
  const keys = [...choices.keys()];
  choices.clear();
  for (const key of keys) notify(key);
}

/** A tool call's key. The protocol guarantees `callId` on every tool call. */
export function disclosureKey(agentId: string, callId: string): string {
  return `${agentId}:${callId}`;
}

/**
 * Key for a call without a `callId`: its name and a hash of its input. Never
 * the timestamp, which the host rewrites on every chunk.
 */
export function fallbackDisclosureKey(agentId: string, name: string, input: unknown): string {
  return `${agentId}:${name}:${hashText(stableStringify(input))}`;
}

/** FNV-1a, 32 bit, as hex. Small and stable across platforms. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/**
 * `[expanded, setExpanded]` for one key. Only the cards reading `key` are
 * woken when it changes.
 */
export function useDisclosure(
  key: string,
  defaultExpanded: boolean,
): [boolean, (expanded: boolean) => void] {
  const subscribe = useCallback((listener: () => void) => subscribeDisclosure(key, listener), [key]);
  const read = useCallback(() => getDisclosure(key), [key]);
  const choice = useSyncExternalStore(subscribe, read, read);
  const set = useCallback((expanded: boolean) => setDisclosure(key, expanded), [key]);
  return [choice ?? defaultExpanded, set];
}
