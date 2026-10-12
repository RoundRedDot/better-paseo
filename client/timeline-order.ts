import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * What kind of plugin item sits where in the timeline.
 *
 * Paseo hangs the same 16pt gap under every plugin item, where its own layout
 * leaves 4pt between a reply and the tool row under it. A tool or thought row
 * takes its own gap back, but a reply cannot: the 16pt is right above a prompt
 * or another reply, and the host hands a renderer no neighbours. So each
 * mounted row records its arrival time and kind here, and a reply asks what
 * arrived next. Arrival order is timeline order, as for the tail
 * (`timeline-tail.ts`).
 */
export type TimelineEntryKind = "row" | "text";

interface Entry {
  at: number;
  kind: TimelineEntryKind;
}

const entries = new Set<Entry>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Records a mounted item; the returned function forgets it. */
export function registerTimelineEntry(at: number, kind: TimelineEntryKind): () => void {
  const entry: Entry = { at, kind };
  entries.add(entry);
  publish();
  return () => {
    entries.delete(entry);
    publish();
  };
}

/**
 * True when the first item after `at` is a tool, thought or todo row. Items
 * sharing that moment count only if every one of them is a row, and an item
 * sharing `at` itself is ambiguous and skipped. Nothing after `at` (the reply
 * is the newest, or the next row is not mounted) is false: the gap stays.
 */
export function nextEntryIsRow(at: number): boolean {
  let nextAt = Infinity;
  let allRows = false;
  for (const entry of entries) {
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registers this row for as long as it is mounted. */
export function useTimelineEntry(at: number, kind: TimelineEntryKind): void {
  // Before paint, so a reply that loses its gap to a row arriving below it
  // does not show the gap for a frame first.
  useLayoutEffect(() => registerTimelineEntry(at, kind), [at, kind]);
}

/** `nextEntryIsRow`, kept current as rows mount and unmount. */
export function useNextEntryIsRow(at: number): boolean {
  const getSnapshot = useCallback(() => nextEntryIsRow(at), [at]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
