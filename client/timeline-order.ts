import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * What kind of plugin item sits where in the timeline.
 *
 * Paseo hangs the same 16pt gap under every plugin item. A tool or thought row
 * takes most of it back; a reply that wants to sit tighter above a tool row
 * than Paseo's own (`compactReplySpacing`) cannot do that blindly: the 16pt is
 * right above a prompt or another reply, and the host hands a renderer no
 * neighbours. So each
 * mounted row records its arrival time and kind here, and a reply asks what
 * arrived next. Arrival order is timeline order, as for the tail
 * (`timeline-tail.ts`).
 *
 * Entries are kept per agent. The plugin's module is shared by every chat on
 * screen — a split pane, a tab kept mounted — and another agent's row is not
 * below this agent's reply however late it arrived. Pooled, a running agent
 * next door took the gap from the newest reply here, and its last line slid
 * under the composer.
 */
export type TimelineEntryKind = "row" | "text";

interface Entry {
  at: number;
  kind: TimelineEntryKind;
}

const entriesByAgent = new Map<string, Set<Entry>>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Records a mounted item; the returned function forgets it. */
export function registerTimelineEntry(agentId: string, at: number, kind: TimelineEntryKind): () => void {
  const entry: Entry = { at, kind };
  let entries = entriesByAgent.get(agentId);
  if (!entries) {
    entries = new Set();
    entriesByAgent.set(agentId, entries);
  }
  entries.add(entry);
  publish();
  return () => {
    const current = entriesByAgent.get(agentId);
    current?.delete(entry);
    if (current?.size === 0) entriesByAgent.delete(agentId);
    publish();
  };
}

/**
 * True when the first item after `at` is a tool, thought or todo row. Items
 * sharing that moment count only if every one of them is a row, and an item
 * sharing `at` itself is ambiguous and skipped. Nothing after `at` (the reply
 * is the newest, or the next row is not mounted) is false: the gap stays.
 */
export function nextEntryIsRow(agentId: string, at: number): boolean {
  let nextAt = Infinity;
  let allRows = false;
  for (const entry of entriesByAgent.get(agentId) ?? []) {
    if (entry.at <= at || entry.at > nextAt) continue;
    if (entry.at < nextAt) {
      nextAt = entry.at;
      allRows = entry.kind === "row";
    } else if (entry.kind !== "row") {
      allRows = false;
    }
  }
  return allRows;
}

/**
 * True when anything of this agent's arrived after `at`. A row's bottom gap is
 * only spare with something below it; the newest row sits on the list's own
 * padding, and taking 12 from there puts its last line under the composer.
 */
export function hasEntryAfter(agentId: string, at: number): boolean {
  for (const entry of entriesByAgent.get(agentId) ?? []) {
    if (entry.at > at) return true;
  }
  return false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registers this row for as long as it is mounted. */
export function useTimelineEntry(agentId: string, at: number, kind: TimelineEntryKind): void {
  // Before paint, so a reply that loses its gap to a row arriving below it
  // does not show the gap for a frame first.
  useLayoutEffect(() => registerTimelineEntry(agentId, at, kind), [agentId, at, kind]);
}

/** `nextEntryIsRow`, kept current as rows mount and unmount. */
export function useNextEntryIsRow(agentId: string, at: number): boolean {
  const getSnapshot = useCallback(() => nextEntryIsRow(agentId, at), [agentId, at]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** `hasEntryAfter`, kept current as items mount and unmount. */
export function useHasEntryAfter(agentId: string, at: number): boolean {
  const getSnapshot = useCallback(() => hasEntryAfter(agentId, at), [agentId, at]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
