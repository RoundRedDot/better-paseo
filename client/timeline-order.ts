import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * What kind of plugin item sits where in the timeline.
 *
 * Paseo hangs the same 16pt gap under every plugin item. A tool or thought row
 * takes most of it back; a reply that wants to sit tighter above a tool row
 * than Paseo's own (`compactReplySpacing`) cannot do that blindly: the 16pt is
 * right above a prompt or another reply, and the host hands a renderer no
 * neighbours. So each
 * mounted item records its arrival time and kind here, and a row or reply asks
 * what arrived after it. Arrival order is timeline order, as for the tail
 * (`timeline-tail.ts`).
 *
 * Entries are kept per agent. The plugin's module is shared by every chat on
 * screen — a split pane, a tab kept mounted — and another agent's row is not
 * below this agent's reply however late it arrived. Pooled, a running agent
 * next door took the gap from the newest reply here, and its last line slid
 * under the composer.
 *
 * The daemon stamps each event as it dispatches it, to the millisecond, and
 * one model message — a thought, its reply, its tool calls — goes out in one
 * burst, so the items of a message often share a moment. Within a moment the
 * kind decides the order (`KIND_ORDER`): a message reads thought, then reply,
 * then tool calls. Counted as ambiguous, a thought kept its gap above the tool
 * call it led to until that call finished and took a later stamp.
 */
export type TimelineEntryKind = "prompt" | "thought" | "reply" | "notice" | "tool";

/**
 * Order within one millisecond. A prompt opens its turn; a notice has no fixed
 * place in a message and ties with the reply, which leaves the pair ambiguous.
 */
const KIND_ORDER: Record<TimelineEntryKind, number> = {
  prompt: 0,
  thought: 1,
  reply: 2,
  notice: 2,
  tool: 3,
};

/** Thoughts, tool calls and checklists are rows; the rest are text. */
function isRow(kind: TimelineEntryKind): boolean {
  return kind === "thought" || kind === "tool";
}

interface Entry {
  at: number;
  order: number;
  row: boolean;
}

const entriesByAgent = new Map<string, Set<Entry>>();
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

/** Negative when `a` sits above `b`, zero when their order is unknown. */
function compare(a: { at: number; order: number }, b: { at: number; order: number }): number {
  return a.at - b.at || a.order - b.order;
}

/** Records a mounted item; the returned function forgets it. */
export function registerTimelineEntry(agentId: string, at: number, kind: TimelineEntryKind): () => void {
  const entry: Entry = { at, order: KIND_ORDER[kind], row: isRow(kind) };
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
 * True when the first item after this one is a tool, thought or todo row.
 * Items in the same place count only if every one of them is a row, and an
 * item whose place ties with this one is ambiguous and skipped. Nothing after
 * it (the reply is the newest, or the next row is not mounted) is false: the
 * gap stays.
 */
export function nextEntryIsRow(agentId: string, at: number, kind: TimelineEntryKind): boolean {
  const self = { at, order: KIND_ORDER[kind] };
  let next: Entry | null = null;
  let allRows = false;
  for (const entry of entriesByAgent.get(agentId) ?? []) {
    if (compare(entry, self) <= 0) continue;
    const versusNext = next ? compare(entry, next) : -1;
    if (versusNext > 0) continue;
    if (versusNext < 0) {
      next = entry;
      allRows = entry.row;
    } else if (!entry.row) {
      allRows = false;
    }
  }
  return allRows;
}

/**
 * True when anything of this agent's sits below this item. A row's bottom gap
 * is only spare with something below it; the newest row sits on the list's own
 * padding, and taking 12 from there puts its last line under the composer.
 */
export function hasEntryAfter(agentId: string, at: number, kind: TimelineEntryKind): boolean {
  const self = { at, order: KIND_ORDER[kind] };
  for (const entry of entriesByAgent.get(agentId) ?? []) {
    if (compare(entry, self) > 0) return true;
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
export function useNextEntryIsRow(agentId: string, at: number, kind: TimelineEntryKind): boolean {
  const getSnapshot = useCallback(() => nextEntryIsRow(agentId, at, kind), [agentId, at, kind]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** `hasEntryAfter`, kept current as items mount and unmount. */
export function useHasEntryAfter(agentId: string, at: number, kind: TimelineEntryKind): boolean {
  const getSnapshot = useCallback(() => hasEntryAfter(agentId, at, kind), [agentId, at, kind]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
