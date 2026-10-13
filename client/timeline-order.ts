import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import type { ToolCallView } from "./tools/classify";
import { groupAdjacentTools, toolGroupKey } from "./tools/group";

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
 *
 * Replayed history breaks that rule. A provider that keeps no times of its own
 * (Grok, over ACP) has its whole history stamped as the daemon reloads it, in
 * one loop, so a call and the thought after it share a millisecond as often
 * as not, and the kind order put the thought above. Every call then kept its
 * gap and every thought gave its up: the rows read unevenly spaced. Complete
 * items (`settledKey`) that share a millisecond have no order in their stamps.
 * Below a moment that is not the newest there is always a later one, so only
 * the newest moment needs one: there the item drawn lowest keeps its gap and
 * the rest count as above it (`lowestSettledKey`). The host passes no
 * position, and mounting order runs newest-first in the native inverted list,
 * oldest-first on web, and restarts as cells scroll back into the window, so
 * the order comes from where each item is drawn.
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
  sequence: number;
  /**
   * The item's identity, given once it is complete; a call gives it only if
   * it was complete as its row mounted, since its stamp is its arrival.
   * Two settled items in one millisecond are unordered; the same key is the
   * same item (itself, or its copy in another pane).
   */
  settledKey?: string;
  /** Where the item is drawn: its centre's y in the window, null when unknown. */
  locate?: () => number | null;
  tool?: ToolCallView;
  /** Subscribers to this tool row's group (`useTimelineToolGroup`). */
  groupListeners?: Set<() => void>;
}

/**
 * Consecutive file operations behind one header. `members` are the calls in
 * timeline order; `viewers` are the rows that draw the header: the first
 * member and its copies in other panes.
 */
interface ToolRun {
  calls: readonly ToolCallView[];
  members: Entry[];
  viewers: Entry[];
  anythingBelow: boolean;
}

interface ToolSlot {
  run: ToolRun;
  index: number;
}

interface AgentTimeline {
  entries: Set<Entry>;
  /** Groups as last computed; rebuilt on first read once `stale`. */
  slots: Map<Entry, ToolSlot>;
  stale: boolean;
  /** `lowestSettledKey` for the moment it was last asked about, until an item mounts or unmounts. */
  lowest?: { at: number; key: string | null };
}

const timelines = new Map<string, AgentTimeline>();
const listeners = new Set<() => void>();
let sequence = 0;

/** Negative when `a` sits above `b`, zero when their order is unknown. */
function compare(a: { at: number; order: number }, b: { at: number; order: number }): number {
  return a.at - b.at || a.order - b.order;
}

/** Two different settled items in one millisecond: their stamps do not order them. */
function unordered(a: Pick<Entry, "at" | "settledKey">, b: Pick<Entry, "at" | "settledKey">): boolean {
  return a.at === b.at && a.settledKey !== undefined && b.settledKey !== undefined && a.settledKey !== b.settledKey;
}

/**
 * The key of the settled item drawn lowest at `at`, the newest moment; null
 * when one of them cannot be placed, and every tied item then counts as having
 * one below it. With the chat in two panes the lowest copy overall is the
 * lowest item of its own pane, so its key names the same item in both.
 * Items keep their order on screen, so the answer holds until one mounts or
 * unmounts, however the list scrolls; an unplaced one is asked again.
 */
function lowestSettledKey(timeline: AgentTimeline, at: number): string | null {
  if (timeline.lowest?.at === at) return timeline.lowest.key;
  let key: string | null = null;
  let lowest = -Infinity;
  for (const entry of timeline.entries) {
    if (entry.at !== at || entry.settledKey === undefined) continue;
    const y = entry.locate?.() ?? null;
    if (y === null) {
      key = null;
      break;
    }
    if (y > lowest) {
      lowest = y;
      key = entry.settledKey;
    }
  }
  if (key !== null) timeline.lowest = { at, key };
  return key;
}

/**
 * The centre of a mounted view, read at once. Fabric measures from the
 * committed tree in the call, transforms included, so the inverted list reads
 * as drawn; the web view is a DOM element. Anything that answers later (the
 * old architecture), or a view in a hidden pane (no size), leaves the item
 * unplaced.
 */
export function viewCentre(view: unknown): number | null {
  const node = view as {
    getBoundingClientRect?: () => { top: number; width: number; height: number };
    measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  } | null;
  if (!node) return null;
  if (typeof node.getBoundingClientRect === "function") {
    const box = node.getBoundingClientRect();
    return box.width === 0 && box.height === 0 ? null : box.top + box.height / 2;
  }
  let centre: number | null = null;
  node.measureInWindow?.((_x, y, width, height) => {
    if (width !== 0 || height !== 0) centre = y + height / 2;
  });
  return centre;
}

/**
 * Regroups one agent. Only a mount, an unmount or a call changing its id,
 * operation or path gets here; a result streaming into a call patches its
 * run in place (`updateTool`).
 */
function toolSlots(timeline: AgentTimeline): Map<Entry, ToolSlot> {
  if (!timeline.stale) return timeline.slots;
  const ordered = [...timeline.entries].sort((a, b) => compare(a, b) || a.sequence - b.sequence);
  const position = new Map<Entry, number>();
  // A chat mounted in two panes must not count the same call twice.
  const firstById = new Map<string, Entry>();
  const copies = new Map<Entry, Entry[]>();
  const unique: Entry[] = [];
  ordered.forEach((entry, index) => {
    position.set(entry, index);
    const id = entry.tool?.callId;
    const first = id ? firstById.get(id) : undefined;
    if (!first) {
      if (id) firstById.set(id, entry);
      unique.push(entry);
    } else {
      const list = copies.get(first);
      if (list) list.push(entry);
      else copies.set(first, [entry]);
    }
  });
  const groups = groupAdjacentTools(unique);
  const slots = new Map<Entry, ToolSlot>();
  let run: ToolRun | null = null;
  const close = () => {
    if (!run) return;
    // A merged row keeps the bottom gap of its last member, not its first:
    // anything sorted after that member, or after a copy of it, is below.
    let last = -1;
    for (const member of run.members) {
      last = Math.max(last, position.get(member)!);
      for (const copy of copies.get(member) ?? []) last = Math.max(last, position.get(copy)!);
    }
    const lowest = ordered[last]!;
    const own = new Set(run.members.flatMap((member) => [member, ...(copies.get(member) ?? [])]));
    let tied = false;
    run.anythingBelow = ordered.some((entry, index) => {
      if (own.has(entry)) return false;
      if (unordered(entry, lowest)) {
        tied = true;
        return false;
      }
      // A merged row's members arrived together: whatever sorts after the
      // last of them is below it.
      const versus = compare(entry, lowest);
      return versus > 0 || (versus === 0 && run!.members.length > 1 && index > last);
    });
    if (!run.anythingBelow && tied) {
      const key = lowestSettledKey(timeline, lowest.at);
      run.anythingBelow = key === null || ![...own].some((entry) => entry.settledKey === key);
    }
    const head = run.members[0]!;
    const previous = timeline.slots.get(head)?.run.calls;
    if (previous && previous.length === run.calls.length && run.calls.every((call, index) => call === previous[index])) {
      run.calls = previous;
    }
    run.viewers = [head, ...(copies.get(head) ?? [])];
  };
  for (const entry of unique) {
    const calls = groups.get(entry);
    if (calls === undefined) continue;
    if (calls !== null) {
      close();
      run = { calls, members: [], viewers: [], anythingBelow: false };
    }
    slots.set(entry, { run: run!, index: run!.members.length });
    run!.members.push(entry);
  }
  close();
  for (const [first, list] of copies) {
    const slot = slots.get(first);
    if (slot) for (const copy of list) slots.set(copy, slot);
  }
  timeline.slots = slots;
  timeline.stale = false;
  return slots;
}

function notifyGroup(entry: Entry): void {
  for (const listener of entry.groupListeners ?? []) listener();
}

/**
 * Marks an agent's groups for rebuilding and tells its tool rows to look again.
 * A listener reads its snapshot as it is told, and that read rebuilds; still
 * stale means nobody has looked since the last call, so a commit mounting a
 * whole page of rows rebuilds once, on the first read after it.
 */
function invalidate(timeline: AgentTimeline): void {
  if (timeline.stale) return;
  timeline.stale = true;
  for (const entry of timeline.entries) notifyGroup(entry);
}

/** Records a mounted item; the returned function forgets it. */
export function registerTimelineEntry(
  agentId: string,
  at: number,
  kind: TimelineEntryKind,
  settledKey?: string,
  locate?: () => number | null,
): () => void {
  const entry: Entry = { at, order: KIND_ORDER[kind], row: isRow(kind), sequence: sequence++, settledKey, locate };
  return addEntry(agentId, entry);
}

function addEntry(agentId: string, entry: Entry): () => void {
  let timeline = timelines.get(agentId);
  if (!timeline) {
    timeline = { entries: new Set(), slots: new Map(), stale: true };
    timelines.set(agentId, timeline);
  }
  timeline.entries.add(entry);
  timeline.lowest = undefined;
  invalidate(timeline);
  publish();
  return () => {
    const current = timelines.get(agentId);
    if (current?.entries.delete(entry)) {
      if (current.entries.size === 0) timelines.delete(agentId);
      current.lowest = undefined;
      invalidate(current);
    }
    publish();
  };
}

/** Rows' order changed: every `nextEntryIsRow` and `hasEntryAfter` may differ. */
function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * A call's new result. Its run keeps its members, so only the rows drawing
 * that run's header hear about it; a changed id, operation or path regroups.
 */
function updateTool(agentId: string, entry: Entry, previous: ToolCallView | undefined): void {
  const timeline = timelines.get(agentId);
  if (!timeline?.entries.has(entry)) return;
  const tool = entry.tool!;
  if (timeline.stale || previous?.callId !== tool.callId || toolGroupKey(previous) !== toolGroupKey(tool)) {
    invalidate(timeline);
    return;
  }
  const slot = timeline.slots.get(entry);
  // A copy in another pane: the run shows the first pane's call.
  if (!slot || slot.run.members[slot.index] !== entry) return;
  const calls = [...slot.run.calls];
  calls[slot.index] = tool;
  slot.run.calls = calls;
  for (const viewer of slot.run.viewers) notifyGroup(viewer);
}

/**
 * Keep the original slot while results update; hidden members stay registered.
 * Grouping follows the mounted timeline window and recomputes as history mounts.
 *
 * `group` is null for a member drawn by the row above it, and `anythingBelow`
 * is whether something of this agent's sits below the run's last member.
 * `settled` is whether the call was complete as its row mounted: replayed
 * history, not a call the reader watched start. `view` is the row's root,
 * which places it among calls that share its millisecond.
 */
export function useTimelineToolGroup(
  agentId: string,
  at: number,
  tool: ToolCallView,
  settled = false,
  view?: RefObject<unknown>,
): { group: readonly ToolCallView[] | null; anythingBelow: boolean } {
  const entry = useMemo<Entry>(() => ({
    at,
    order: KIND_ORDER.tool,
    row: true,
    sequence: sequence++,
    tool,
    settledKey: settled ? tool.callId : undefined,
    locate: view ? () => viewCentre(view.current) : undefined,
  }), [agentId, at]);
  const single = useMemo(() => [tool], [tool]);
  useLayoutEffect(() => addEntry(agentId, entry), [agentId, entry]);
  useLayoutEffect(() => {
    if (entry.tool === tool) return;
    const previous = entry.tool;
    entry.tool = tool;
    updateTool(agentId, entry, previous);
  }, [agentId, entry, tool]);
  const subscribe = useCallback((listener: () => void) => {
    (entry.groupListeners ??= new Set()).add(listener);
    return () => {
      entry.groupListeners?.delete(listener);
    };
  }, [entry]);
  const slotOf = useCallback(() => {
    const timeline = timelines.get(agentId);
    return timeline?.entries.has(entry) ? toolSlots(timeline).get(entry) : undefined;
  }, [agentId, entry]);
  const getGroup = useCallback(() => {
    const slot = slotOf();
    if (!slot) return single;
    return slot.index === 0 ? slot.run.calls : null;
  }, [slotOf, single]);
  // Not mounted yet (the first render): below is whatever sorts after this slot.
  const getBelow = useCallback(() => {
    const slot = slotOf();
    if (slot) return slot.index === 0 && slot.run.anythingBelow;
    return hasEntryAfter(agentId, at, "tool", entry.settledKey);
  }, [slotOf, agentId, at, entry]);
  const group = useSyncExternalStore(subscribe, getGroup, getGroup);
  const anythingBelow = useSyncExternalStore(subscribe, getBelow, getBelow);
  return { group, anythingBelow };
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
  for (const entry of timelines.get(agentId)?.entries ?? []) {
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
 * A settled item tied with others in the newest moment has one below it
 * unless it is drawn lowest.
 */
export function hasEntryAfter(agentId: string, at: number, kind: TimelineEntryKind, settledKey?: string): boolean {
  const timeline = timelines.get(agentId);
  if (!timeline) return false;
  const self = { at, order: KIND_ORDER[kind], settledKey };
  let tied = false;
  for (const entry of timeline.entries) {
    if (unordered(entry, self)) tied = true;
    else if (compare(entry, self) > 0) return true;
  }
  if (!tied) return false;
  const key = lowestSettledKey(timeline, at);
  return key === null || key !== settledKey;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers this item for as long as it is mounted. `settledKey` identifies an
 * item that is complete (see `Entry`); leave it out while the item streams.
 */
export function useTimelineEntry(
  agentId: string,
  at: number,
  kind: TimelineEntryKind,
  settledKey?: string,
  view?: RefObject<unknown>,
): void {
  // Before paint, so a reply that loses its gap to a row arriving below it
  // does not show the gap for a frame first.
  useLayoutEffect(
    () => registerTimelineEntry(agentId, at, kind, settledKey, view ? () => viewCentre(view.current) : undefined),
    [agentId, at, kind, settledKey, view],
  );
}

/** `nextEntryIsRow`, kept current as rows mount and unmount. */
export function useNextEntryIsRow(agentId: string, at: number, kind: TimelineEntryKind): boolean {
  const getSnapshot = useCallback(() => nextEntryIsRow(agentId, at, kind), [agentId, at, kind]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** `hasEntryAfter`, kept current as items mount and unmount. */
export function useHasEntryAfter(agentId: string, at: number, kind: TimelineEntryKind, settledKey?: string): boolean {
  const getSnapshot = useCallback(() => hasEntryAfter(agentId, at, kind, settledKey), [agentId, at, kind, settledKey]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
