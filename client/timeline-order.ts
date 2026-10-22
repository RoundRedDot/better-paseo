import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import type { ToolCallView } from "./tools/classify";
import type { ToolRollupPosition } from "./state/tool-rollup-order";
import { groupAdjacentTools, toolGroupKey } from "./tools/group";
import { hostStacksRows, noteRowGap } from "./host-row-gap";

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
 * the rest count as above it (`lowestTiedKey`). Calls sent together in one
 * message tie the same way, running or not: they share a stamp and a kind,
 * and counted as unordered, every one of them kept its gap. The host passes no
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
   * Two settled items in one millisecond are unordered, as are two calls
   * (`callId`); the same key is the same item (itself, or its copy in
   * another pane).
   */
  settledKey?: string;
  /** A call's id. Two calls in one millisecond are unordered, finished or not. */
  callId?: string;
  /** Where the item is drawn, in the window; null when unknown. */
  measure?: () => ViewBox | null;
  tool?: ToolCallView;
  /** Undefined: original file grouping; null: rollups on, source order unknown. */
  rollup?: ToolRollupPosition | null;
  /**
   * Found below another row of its call in the same column (`hostDuplicates`).
   * Kept until it unmounts: hidden, it has no box left to measure.
   */
  duplicate?: boolean;
  /**
   * Hidden copies of this row's call right under it in its column, and the
   * row's height then: the row takes back the host's gap under each copy.
   */
  copiesBelow?: { count: number; height: number };
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
  /** Whether the first item below the run's last member is a row (`nextEntryIsRow`). */
  rowBelow: boolean;
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
  /** Rows left behind by a newer row of their call (`leftBehind`), as of the last rebuild. */
  superseded: Set<Entry>;
  /** Call ids mounted more than once, as of the last rebuild. */
  repeated: Set<string>;
  /** `lowestTiedKey` for the moment it was last asked about, until an item mounts or unmounts. */
  lowest?: { at: number; key: string | null };
}

/**
 * Settled before running, then the more the call has to say. A call only
 * gains: a status settles, a detail fills in, output grows.
 */
function callProgress(tool: ToolCallView): [number, number] {
  return [tool.status === "running" ? 0 : 1, JSON.stringify(tool).length];
}

/**
 * Rows of a call that another row of the same call has moved past.
 *
 * The host can split one call over two rows: an early update lands in one,
 * the rest in another, and the first stays as it was, a bare "Agent" or a
 * command still waiting for output, running for good. Both carry the call's
 * id, so they also opened and closed together. A copy in another pane is the
 * same row drawn twice and carries the same call, so it is never behind; a
 * row behind another of its id is the one left over, and is not drawn.
 */
function leftBehind(entries: Iterable<Entry>): { superseded: Set<Entry>; repeated: Set<string> } {
  const byId = new Map<string, Entry[]>();
  for (const entry of entries) {
    entry.copiesBelow = undefined;
    const id = entry.tool?.callId;
    if (!id) continue;
    const list = byId.get(id);
    if (list) list.push(entry);
    else byId.set(id, [entry]);
  }
  const superseded = new Set<Entry>();
  const repeated = new Set<string>();
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    repeated.add(id);
    const progress = list.map((entry) => callProgress(entry.tool!));
    const best = progress.reduce((top, value) => (value[0] - top[0] || value[1] - top[1]) > 0 ? value : top);
    list.forEach((entry, index) => {
      const own = progress[index]!;
      if (own[0] < best[0] || (own[0] === best[0] && own[1] < best[1])) superseded.add(entry);
    });
    const copies = hostDuplicates(list.filter((entry) => !superseded.has(entry)));
    for (const entry of copies) superseded.add(entry);
    if (copies.length > 0) countCopiesBelow(list, entries);
  }
  return { superseded, repeated };
}

/**
 * Rows of one call that say the same and sit in one column: every one but
 * the topmost.
 *
 * The host stamps each event's turn on its newest item, even when the event
 * updated an older one. A background call from an earlier turn that reports
 * during this one relabels the newest call; that call's next update no longer
 * finds its item and appends a second one with the same id. The copies say the
 * same, so only where they sit tells them from a copy in another pane: one
 * column is one list. The topmost keeps the call's place in the turn. A row
 * that cannot be measured (a hidden pane, not laid out yet) is left alone.
 */
function hostDuplicates(tied: Entry[]): Entry[] {
  if (tied.length < 2) return [];
  const kept: ViewBox[] = [];
  const placed = tied
    .filter((entry) => !entry.duplicate)
    .map((entry) => ({ entry, box: entry.measure?.() ?? null }))
    .filter((row): row is { entry: Entry; box: ViewBox } => row.box !== null && row.box.height > 0)
    .sort((a, b) => a.box.top - b.box.top);
  for (const { entry, box } of placed) {
    const below = kept.some((other) => Math.abs(other.left - box.left) <= 1 && Math.abs(other.width - box.width) <= 1);
    if (below) entry.duplicate = true;
    else kept.push(box);
  }
  // With every copy hidden, none is left to draw the call.
  if (tied.every((entry) => entry.duplicate)) for (const entry of tied) entry.duplicate = false;
  return tied.filter((entry) => entry.duplicate);
}

/**
 * The host hangs its gap under every item, a hidden copy too, so a copy left
 * a blank gap in the list. A row drawing the call takes back the gaps of the
 * hidden copies right under it, before any other item of its column; a copy
 * with something between them is not beside it.
 */
function countCopiesBelow(list: Entry[], entries: Iterable<Entry>): void {
  const placed: { entry: Entry; box: ViewBox }[] = [];
  for (const entry of entries) {
    const box = entry.measure?.() ?? null;
    if (box) placed.push({ entry, box });
  }
  placed.sort((a, b) => a.box.top - b.box.top || a.box.height - b.box.height);
  for (const own of placed) {
    if (!list.includes(own.entry) || own.entry.duplicate || own.box.height === 0) continue;
    let count = 0;
    for (const other of placed) {
      if (other === own || other.box.top < own.box.top) continue;
      if (Math.abs(other.box.left - own.box.left) > 1 || Math.abs(other.box.width - own.box.width) > 1) continue;
      if (!other.entry.duplicate || !list.includes(other.entry)) break;
      count++;
    }
    if (count > 0) own.entry.copiesBelow = { count, height: own.box.height };
  }
}

/** The items on screen: every mounted one but the rows left behind. */
function* drawn(timeline: AgentTimeline): Iterable<Entry> {
  for (const entry of timeline.entries) if (!timeline.superseded.has(entry)) yield entry;
}

const timelines = new Map<string, AgentTimeline>();
const listeners = new Set<() => void>();
const pendingTimelines = new Set<AgentTimeline>();
let notificationPending = false;
let sequence = 0;

/** The snapshot of a `rowBelow` the row does not follow. */
const notFollowed = () => false;

/** Negative when `a` sits above `b`, zero when their order is unknown. */
function compare(a: { at: number; order: number }, b: { at: number; order: number }): number {
  return a.at - b.at || a.order - b.order;
}

type Tie = Pick<Entry, "at" | "settledKey" | "callId">;

/** What names an item among those it ties with; the same key is the same item. */
function tieKey(entry: Tie): string | undefined {
  return entry.settledKey ?? entry.callId;
}

/**
 * Two different items in one millisecond that their stamps do not order:
 * both settled, or two calls.
 */
function unordered(a: Tie, b: Tie): boolean {
  if (a.at !== b.at) return false;
  const both = (a.settledKey !== undefined && b.settledKey !== undefined) || (a.callId !== undefined && b.callId !== undefined);
  return both && tieKey(a) !== tieKey(b);
}

/**
 * The key of the tied item drawn lowest at `at`, the newest moment; null
 * when one of them cannot be placed in any pane, and every tied item then
 * counts as having one below it. With the chat in two panes the lowest copy
 * overall is the lowest item of its own pane, so its key names the same item
 * in both.
 * Items keep their order on screen, so the answer holds until one mounts or
 * unmounts, however the list scrolls; an unplaced one is asked again.
 */
function lowestTiedKey(timeline: AgentTimeline, at: number): string | null {
  if (timeline.lowest?.at === at) return timeline.lowest.key;
  let key: string | null = null;
  let lowest = -Infinity;
  const placed = new Set<string>();
  const unplaced = new Set<string>();
  for (const entry of drawn(timeline)) {
    const own = tieKey(entry);
    if (entry.at !== at || own === undefined) continue;
    const box = entry.measure?.() ?? null;
    const y = box === null ? null : box.top + box.height / 2;
    if (y === null) {
      unplaced.add(own);
      continue;
    }
    placed.add(own);
    if (y > lowest) {
      lowest = y;
      key = own;
    }
  }
  // A copy in a hidden pane has no size; the copy on screen places it.
  for (const own of unplaced) if (!placed.has(own)) return null;
  if (key !== null) timeline.lowest = { at, key };
  return key;
}

export interface ViewBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The box of a mounted view, read at once. Fabric measures from the committed
 * tree in the call, transforms included, so the inverted list reads as drawn;
 * the web view is a DOM element. Anything that answers later (the old
 * architecture), or a view in a hidden pane (no size), leaves the item
 * unplaced.
 */
export function viewBox(view: unknown): ViewBox | null {
  const node = view as {
    getBoundingClientRect?: () => { left?: number; top: number; width: number; height: number };
    measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  } | null;
  if (!node) return null;
  if (typeof node.getBoundingClientRect === "function") {
    const box = node.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    return { left: box.left ?? 0, top: box.top, width: box.width, height: box.height };
  }
  let measured: ViewBox | null = null;
  node.measureInWindow?.((left, top, width, height) => {
    if (width !== 0 || height !== 0) measured = { left, top, width, height };
  });
  return measured;
}

/** The centre's y of `viewBox`. */
export function viewCentre(view: unknown): number | null {
  const box = viewBox(view);
  return box === null ? null : box.top + box.height / 2;
}

/**
 * Measures the space between this agent's rows until the host's row gap is
 * known (`host-row-gap.ts`). Rows are paired as drawn, one under the other in
 * the same column, so a chat in two panes pairs each pane's rows, and a
 * member a merged row draws (no height) pairs with nothing.
 *
 * Two rows of one call say nothing about the host: a copy the host appended
 * is drawn until the next regroup hides it, and its row may already take
 * back the gap of an earlier copy, so the pair can touch on a spacing host.
 * Read as a stacking host, every row in the app lost its take-back. A row
 * taking back its copies' gaps is skipped for the same reason.
 */
export function probeRowGap(agentId: string): void {
  if (hostStacksRows() !== null) return;
  const placed: { entry: Entry; box: ViewBox }[] = [];
  for (const entry of timelines.get(agentId)?.entries ?? []) {
    if (!entry.row) continue;
    const box = entry.measure?.() ?? null;
    if (box !== null && box.height > 0) placed.push({ entry, box });
  }
  if (placed.length < 2) return;
  placed.sort((a, b) => a.box.left - b.box.left || a.box.width - b.box.width || a.box.top - b.box.top);
  for (let index = 1; index < placed.length; index++) {
    const above = placed[index - 1]!;
    const below = placed[index]!;
    if (Math.abs(above.box.left - below.box.left) > 1 || Math.abs(above.box.width - below.box.width) > 1) continue;
    const call = above.entry.tool?.callId;
    if (above.entry.copiesBelow || (call !== undefined && call === below.entry.tool?.callId)) continue;
    noteRowGap(below.box.top - (above.box.top + above.box.height));
    if (hostStacksRows() !== null) return;
  }
}

/**
 * Regroups one agent. Only a mount, an unmount or a call changing its id,
 * operation or path gets here; a result streaming into a call patches its
 * run in place (`updateTool`).
 */
function toolSlots(timeline: AgentTimeline): Map<Entry, ToolSlot> {
  // A commit may add/remove a whole page. Snapshots keep the previous groups
  // until all its layout effects have finished, then rebuild once.
  if (pendingTimelines.has(timeline)) return timeline.slots;
  if (!timeline.stale) return timeline.slots;
  const { superseded, repeated } = leftBehind(timeline.entries);
  timeline.superseded = superseded;
  timeline.repeated = repeated;
  const ordered = [...drawn(timeline)].sort((a, b) => compare(a, b) || a.sequence - b.sequence);
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
      const key = lowestTiedKey(timeline, lowest.at);
      run.anythingBelow = key === null || ![...own].some((entry) => tieKey(entry) === key);
    }
    run.rowBelow = firstAfterIsRow(drawn(timeline), lowest);
    const head = run.members[0]!;
    const previous = timeline.slots.get(head)?.run.calls;
    if (previous && previous.length === run.calls.length && run.calls.every((call, index) => call === previous[index])) {
      run.calls = previous;
    }
    run.viewers = [head, ...(copies.get(head) ?? [])];
  };
  const byCall = new Map(unique.filter((entry) => entry.tool).map((entry) => [entry.tool!, entry]));
  for (const entry of unique) {
    const calls = groups.get(entry);
    if (!calls) continue;
    run = { calls, members: calls.map((call) => byCall.get(call)!), viewers: [], anythingBelow: false, rowBelow: false };
    for (const [index, member] of run.members.entries()) {
      slots.set(member, { run, index });
    }
    close();
  }
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
 * Marks an agent's groups for rebuilding. Notifications are delivered after
 * the current commit's registrations finish, so subscribers read one complete
 * membership snapshot instead of rebuilding after every mounted/unmounted row.
 */
function invalidate(timeline: AgentTimeline): void {
  timeline.stale = true;
  pendingTimelines.add(timeline);
  publish();
}

/** Records a mounted item; the returned function forgets it. */
export function registerTimelineEntry(
  agentId: string,
  at: number,
  kind: TimelineEntryKind,
  settledKey?: string,
  measure?: () => ViewBox | null,
  callId?: string,
): () => void {
  const entry: Entry = { at, order: KIND_ORDER[kind], row: isRow(kind), sequence: sequence++, settledKey, callId, measure };
  return addEntry(agentId, entry);
}

function addEntry(agentId: string, entry: Entry): () => void {
  let timeline = timelines.get(agentId);
  if (!timeline) {
    timeline = { entries: new Set(), slots: new Map(), stale: true, superseded: new Set(), repeated: new Set() };
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
  if (notificationPending) return;
  notificationPending = true;
  void Promise.resolve().then(() => {
    notificationPending = false;
    const changed = [...pendingTimelines];
    pendingTimelines.clear();
    for (const timeline of changed) {
      for (const entry of timeline.entries) notifyGroup(entry);
    }
    for (const listener of listeners) listener();
  });
}

/**
 * A call's new result. Its run keeps its members, so only the rows drawing
 * that run's header hear about it; a changed id, operation or path regroups.
 */
function updateTool(agentId: string, entry: Entry, previous: ToolCallView | undefined): void {
  const timeline = timelines.get(agentId);
  if (!timeline?.entries.has(entry)) return;
  const tool = entry.tool!;
  // A call drawn more than once may now lead, or trail, another row of it.
  if (
    timeline.stale || previous?.callId !== tool.callId || toolGroupKey(previous) !== toolGroupKey(tool) ||
    (tool.callId !== undefined && timeline.repeated.has(tool.callId))
  ) {
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
 * `group` is null for a member drawn by the row above it, `anythingBelow`
 * is whether something of this agent's sits below the run's last member, and
 * `rowBelow` whether the first thing there is a row.
 * `settled` is whether the call was complete as its row mounted: replayed
 * history, not a call the reader watched start. `view` is the row's root,
 * which places it among calls that share its millisecond.
 *
 * `followRowBelow` false pins `rowBelow` to false: a row whose layout does not
 * depend on it is not drawn again each time the list mounts or unmounts the
 * item below it while scrolling. The hooks stay the same either way.
 */
export function useTimelineToolGroup(
  agentId: string,
  at: number,
  tool: ToolCallView,
  settled = false,
  view?: RefObject<unknown>,
  followRowBelow = true,
  rollup?: ToolRollupPosition | null,
): {
  group: readonly ToolCallView[] | null;
  anythingBelow: boolean;
  rowBelow: boolean;
  /** Hidden copies of the call right under this row, and the row's height then (`countCopiesBelow`). */
  copiesBelow: number;
  copiesBelowHeight: number;
  rollupHead: string | null;
} {
  const entry = useMemo<Entry>(() => ({
    at,
    order: KIND_ORDER.tool,
    row: true,
    sequence: sequence++,
    tool,
    rollup,
    settledKey: settled ? tool.callId : undefined,
    callId: tool.callId,
    measure: view ? () => viewBox(view.current) : undefined,
  }), [agentId, at]);
  const single = useMemo(() => [tool], [tool]);
  useLayoutEffect(() => addEntry(agentId, entry), [agentId, entry]);
  useLayoutEffect(() => probeRowGap(agentId), [agentId, entry]);
  useLayoutEffect(() => {
    if (entry.rollup !== rollup) {
      entry.rollup = rollup;
      const timeline = timelines.get(agentId);
      if (timeline) invalidate(timeline);
    }
  }, [agentId, entry, rollup]);
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
  // A row another row of its call has moved past draws nothing (`leftBehind`).
  const superseded = useCallback(() => {
    const timeline = timelines.get(agentId);
    if (!timeline?.entries.has(entry)) return false;
    toolSlots(timeline);
    return timeline.superseded.has(entry);
  }, [agentId, entry]);
  const getGroup = useCallback(() => {
    const slot = slotOf();
    if (!slot) return superseded() ? null : single;
    // A singleton already received its current tool through props. Returning
    // the store's previous array adds an echo render when the layout effect
    // publishes that same result. Merged headers still follow their members.
    if (slot.index === 0 && slot.run.calls.length === 1) return single;
    return slot.index === 0 ? slot.run.calls : null;
  }, [slotOf, superseded, single]);
  // Not mounted yet (the first render): below is whatever sorts after this slot.
  const getBelow = useCallback(() => {
    const slot = slotOf();
    if (slot) return slot.index === 0 && slot.run.anythingBelow;
    return !superseded() && hasEntryAfter(agentId, at, "tool", entry.settledKey, entry.callId);
  }, [slotOf, superseded, agentId, at, entry]);
  const getRowBelow = useCallback(() => {
    const slot = slotOf();
    if (slot) return slot.index === 0 && slot.run.rowBelow;
    return !superseded() && nextEntryIsRow(agentId, at, "tool");
  }, [slotOf, superseded, agentId, at]);
  const group = useSyncExternalStore(subscribe, getGroup, getGroup);
  const getRollupHead = useCallback(() => {
    const slot = slotOf();
    return entry.rollup && !superseded() && slot
      ? slot.run.calls[0]!.callId ?? null : null;
  }, [slotOf, superseded, entry]);
  const rollupHead = useSyncExternalStore(subscribe, getRollupHead, getRollupHead);
  const anythingBelow = useSyncExternalStore(subscribe, getBelow, getBelow);
  const rowSnapshot = followRowBelow ? getRowBelow : notFollowed;
  const rowBelow = useSyncExternalStore(subscribe, rowSnapshot, rowSnapshot);
  const getCopies = useCallback(() => {
    const timeline = timelines.get(agentId);
    if (!timeline?.entries.has(entry)) return 0;
    toolSlots(timeline);
    return entry.copiesBelow?.count ?? 0;
  }, [agentId, entry]);
  const getCopiesHeight = useCallback(() => entry.copiesBelow?.height ?? 0, [entry]);
  const copiesBelow = useSyncExternalStore(subscribe, getCopies, getCopies);
  const copiesBelowHeight = useSyncExternalStore(subscribe, getCopiesHeight, getCopiesHeight);
  return { group, anythingBelow, rowBelow, copiesBelow, copiesBelowHeight, rollupHead };
}

/**
 * True when the first item after this one is a tool, thought or todo row.
 * Items in the same place count only if every one of them is a row, and an
 * item whose place ties with this one is ambiguous and skipped. Nothing after
 * it (the reply is the newest, or the next row is not mounted) is false: the
 * gap stays.
 */
export function nextEntryIsRow(agentId: string, at: number, kind: TimelineEntryKind): boolean {
  const timeline = timelines.get(agentId);
  return firstAfterIsRow(timeline ? drawn(timeline) : [], { at, order: KIND_ORDER[kind] });
}

function firstAfterIsRow(entries: Iterable<Entry>, self: { at: number; order: number }): boolean {
  let next: Entry | null = null;
  let allRows = false;
  for (const entry of entries) {
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
 * An item tied with others in the newest moment has one below it unless it
 * is drawn lowest.
 */
export function hasEntryAfter(
  agentId: string,
  at: number,
  kind: TimelineEntryKind,
  settledKey?: string,
  callId?: string,
): boolean {
  const timeline = timelines.get(agentId);
  if (!timeline) return false;
  const self = { at, order: KIND_ORDER[kind], settledKey, callId };
  let tied = false;
  for (const entry of drawn(timeline)) {
    if (unordered(entry, self)) tied = true;
    else if (compare(entry, self) > 0) return true;
  }
  if (!tied) return false;
  const key = lowestTiedKey(timeline, at);
  return key === null || key !== tieKey(self);
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
    () => registerTimelineEntry(agentId, at, kind, settledKey, view ? () => viewBox(view.current) : undefined),
    [agentId, at, kind, settledKey, view],
  );
  useLayoutEffect(() => {
    if (isRow(kind)) probeRowGap(agentId);
  }, [agentId, at, kind, settledKey, view]);
}

/** `nextEntryIsRow`, kept current as rows mount and unmount; pinned to false unless `follow`. */
export function useNextEntryIsRow(agentId: string, at: number, kind: TimelineEntryKind, follow = true): boolean {
  const getSnapshot = useCallback(() => nextEntryIsRow(agentId, at, kind), [agentId, at, kind]);
  const snapshot = follow ? getSnapshot : notFollowed;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** `hasEntryAfter`, kept current as items mount and unmount. */
export function useHasEntryAfter(agentId: string, at: number, kind: TimelineEntryKind, settledKey?: string): boolean {
  const getSnapshot = useCallback(() => hasEntryAfter(agentId, at, kind, settledKey), [agentId, at, kind, settledKey]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
