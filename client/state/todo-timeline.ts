import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Platform } from "react-native";
import { viewBox, type ViewBox } from "../timeline-order";

/**
 * One checklist per update, not one per change.
 *
 * Paseo splits a todo update into one timeline item per change it finds —
 * "completed A", "started B", "added C" — and every one of them carries the
 * whole list, under the update's timestamp (paseo `types/stream.ts`,
 * `appendTodoList`). Its own timeline draws each as a one-line badge naming
 * the change, closed by default. The plugin is handed only the list: the
 * projection drops the change (`plugins/timeline/projection.ts`), and no id or
 * neighbour reaches a renderer. Drawn as checklists, one update showed two
 * identical lists, and every update added another.
 *
 * So each mounted todo records its agent, timestamp and list here. Items with
 * the same timestamp and the same list are one update: the one highest on
 * screen draws it and the rest draw nothing (`drawsBefore`). The newest
 * update draws the checklist; an earlier one folds to a row naming what
 * changed, read off the list before it (`deriveTodoActivities`, the host's
 * own rule).
 *
 * Updates are remembered after their item unmounts, so a list scrolled out of
 * a virtualised timeline still counts as newest and still names the changes
 * of the one after it.
 *
 * An item that draws nothing is still an empty plugin slot, and the host hangs
 * its 16pt under it: an update split five ways left 64pt of blank space by its
 * checklist. With no height the empty slot cannot give that back (a negative
 * margin leaves the host's wrapper at zero), so the item that draws the update
 * does, on the side its siblings sit (`EmptyGapTakeBack`). Drawn highest, it
 * has them under it, and its bottom slides over their slots.
 */

/** A task as the host sends it (`AgentTaskItem`). */
export interface TodoTask {
  text: string;
  completed?: boolean;
  id?: string;
  status?: string;
  activeForm?: string;
}

export type TodoActivity =
  | { type: "created"; count: number }
  | { type: "added" | "started" | "completed"; task: string };

/** `full` draws the checklist, `summary` one row, `hidden` nothing. */
export type TodoRole = "full" | "summary" | "hidden";

export function todoTaskStatus(task: TodoTask): "completed" | "in_progress" | "pending" {
  if (task.completed === true || task.status === "completed") return "completed";
  return task.status === "in_progress" ? "in_progress" : "pending";
}

function taskKey(task: TodoTask, index: number): string {
  return task.id ?? `${index}:${task.text}`;
}

/**
 * What one update changed, as Paseo reads it: no list before is a list
 * created; after that, a task not seen before was added, and a task whose
 * status moved was started or completed.
 */
export function deriveTodoActivities(
  previous: readonly TodoTask[] | null,
  current: readonly TodoTask[],
): TodoActivity[] {
  if (!previous || previous.length === 0) {
    return current.length > 0 ? [{ type: "created", count: current.length }] : [];
  }
  const previousByKey = new Map(previous.map((task, index) => [taskKey(task, index), task]));
  const activities: TodoActivity[] = [];
  for (const [index, task] of current.entries()) {
    const prior = previousByKey.get(taskKey(task, index));
    if (!prior) {
      activities.push({ type: "added", task: task.text });
      continue;
    }
    const before = todoTaskStatus(prior);
    const after = todoTaskStatus(task);
    if (before === after) continue;
    if (after === "completed") activities.push({ type: "completed", task: task.text });
    else if (after === "in_progress") activities.push({ type: "started", task: task.text });
  }
  return activities;
}

/** The list as content: two items with the same key show the same list. */
export function todoListKey(items: readonly TodoTask[]): string {
  return JSON.stringify(
    items.map((task) => [task.id ?? null, task.text, todoTaskStatus(task), task.activeForm ?? null]),
  );
}

interface Entry {
  at: number;
  key: string;
  sequence: number;
  /** Where the item is drawn, in the window; null when unknown. */
  measure?: () => ViewBox | null;
}

/** The gap Paseo up to 0.11.2 hangs under every plugin item, an empty one too. */
export const HOST_ITEM_GAP = 16;

/**
 * The gaps of an update's empty siblings that the item drawing it takes back,
 * as negative margins: `above` for siblings over it, `below` for those under
 * it. Which side they sit on is how the host mounts its list (top-down on the
 * web, inverted on native), so it is read off the screen. The take-back stops
 * at the item's own height: the host's wrapper does not shrink below zero.
 */
export interface EmptyGapTakeBack {
  above: number;
  below: number;
}

const NO_TAKE_BACK: EmptyGapTakeBack = { above: 0, below: 0 };

interface Update {
  at: number;
  key: string;
  items: readonly TodoTask[];
}

interface AgentTodos {
  mounted: Set<Entry>;
  /** Every update seen, by `updateId`. */
  updates: Map<string, Update>;
}

const agents = new Map<string, AgentTodos>();
const listeners = new Set<() => void>();
let sequence = 0;

function updateId(at: number, key: string): string {
  return `${at}\u0000${key}`;
}

function agentTodos(agentId: string): AgentTodos {
  let agent = agents.get(agentId);
  if (!agent) {
    agent = { mounted: new Set(), updates: new Map() };
    agents.set(agentId, agent);
  }
  return agent;
}

function publish(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Which of two items of one update draws it: the one higher on screen. The
 * web lists top-down and mounts in that order; the native list is inverted
 * and mounts bottom-up, so there the last mounted is the highest.
 *
 * On iOS each cell of the inverted list lies over the cells below it on
 * screen. When the lowest item drew and took back the gaps above it, its top
 * slid under the empty slots of its siblings, and they took every touch
 * there: the header's window button, its long press and the first rows' taps
 * did nothing. Drawn by the highest item, the checklist overlaps only slots
 * under it, and they stay behind it.
 */
function drawsBefore(other: Entry, self: Entry): boolean {
  return Platform.OS === "web" ? other.sequence < self.sequence : other.sequence > self.sequence;
}

/**
 * How the item `self` draws the update at `at` with list `key`. Before it
 * mounts (its first render) it is weighed as if it had.
 */
function todoRole(agentId: string, self: Entry, at: number, key: string): TodoRole {
  const agent = agents.get(agentId);
  let newest = at;
  if (agent) {
    for (const other of agent.mounted) {
      if (other !== self && other.at === at && other.key === key && drawsBefore(other, self)) {
        return "hidden";
      }
    }
    for (const update of agent.updates.values()) newest = Math.max(newest, update.at);
  }
  return at >= newest ? "full" : "summary";
}

/** Mounted items drawing the same update as `self`, `self` excluded. */
function siblingCount(agentId: string, self: Entry): number {
  let count = 0;
  for (const other of agents.get(agentId)?.mounted ?? []) {
    if (other !== self && other.at === self.at && other.key === self.key) count++;
  }
  return count;
}

/**
 * `EmptyGapTakeBack` for `self`, which already takes `takenAbove` above it:
 * that margin moved it up, so its own top is read back where it was. A sibling
 * in another column (a second pane) or with no size (a hidden pane) is not
 * beside it.
 */
function measureEmptyGaps(agentId: string, self: Entry, takenAbove: number): EmptyGapTakeBack {
  const own = self.measure?.() ?? null;
  if (!own) return NO_TAKE_BACK;
  const top = own.top + takenAbove;
  let above = 0;
  let below = 0;
  for (const other of agents.get(agentId)?.mounted ?? []) {
    if (other === self || other.at !== self.at || other.key !== self.key) continue;
    const box = other.measure?.() ?? null;
    if (!box || Math.abs(box.left - own.left) > 1 || Math.abs(box.width - own.width) > 1) continue;
    if (box.top < top) above++;
    else below++;
  }
  const takeBelow = Math.min(below * HOST_ITEM_GAP, own.height);
  const takeAbove = Math.min(above * HOST_ITEM_GAP, own.height - takeBelow);
  return takeAbove === 0 && takeBelow === 0 ? NO_TAKE_BACK : { above: takeAbove, below: takeBelow };
}

/** The list of the update before `at`, or null when none is known. */
function previousItems(agentId: string, at: number): readonly TodoTask[] | null {
  let best: Update | null = null;
  for (const update of agents.get(agentId)?.updates.values() ?? []) {
    if (update.at < at && (!best || update.at > best.at)) best = update;
  }
  return best?.items ?? null;
}

/** The list of the agent's newest update; of two at one time, the one seen last. */
function latestItems(agentId: string): readonly TodoTask[] | null {
  let best: Update | null = null;
  for (const update of agents.get(agentId)?.updates.values() ?? []) {
    if (!best || update.at >= best.at) best = update;
  }
  return best?.items ?? null;
}

/**
 * The agent's newest list, read while `enabled`: the checklist's panel follows
 * it after the item it was opened from folds to a row (`live-renderers.tsx`).
 * Null while disabled or before any update is known.
 */
export function useLatestTodoItems(agentId: string, enabled: boolean): readonly TodoTask[] | null {
  const getLatest = useCallback(() => (enabled ? latestItems(agentId) : null), [agentId, enabled]);
  return useSyncExternalStore(subscribe, getLatest, getLatest);
}

/**
 * Records this todo item while it is mounted and says how it draws. `previous`
 * is the list of the update before it, null when none is known. `view` is the
 * item's root; `emptyGaps` is what a drawing item takes back for its empty
 * siblings, read again by `measureEmptyGaps` as the root lays out.
 */
export function useTodoTimeline(
  agentId: string,
  at: number,
  items: readonly TodoTask[],
  view?: RefObject<unknown>,
): {
  role: TodoRole;
  previous: readonly TodoTask[] | null;
  emptyGaps: EmptyGapTakeBack;
  measureEmptyGaps: () => void;
} {
  const key = useMemo(() => todoListKey(items), [items]);
  const entry = useMemo<Entry>(
    () => ({ at, key, sequence: sequence++, measure: view ? () => viewBox(view.current) : undefined }),
    [],
  );
  const last = useRef<{ agentId: string; at: number; key: string } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useLayoutEffect(() => {
    const agent = agentTodos(agentId);
    const prior = last.current;
    // The host rewrote this item in place (a list still being created grows
    // under a new timestamp): its old list was never an update of its own.
    if (prior && prior.agentId === agentId && (prior.at !== at || prior.key !== key)) {
      const shared = [...agent.mounted].some(
        (other) => other !== entry && other.at === prior.at && other.key === prior.key,
      );
      if (!shared) agent.updates.delete(updateId(prior.at, prior.key));
    }
    last.current = { agentId, at, key };
    entry.at = at;
    entry.key = key;
    agent.mounted.add(entry);
    const id = updateId(at, key);
    if (!agent.updates.has(id)) agent.updates.set(id, { at, key, items: itemsRef.current });
    publish();
    return () => {
      agent.mounted.delete(entry);
      publish();
    };
  }, [agentId, at, key, entry]);

  const getRole = useCallback(() => todoRole(agentId, entry, at, key), [agentId, entry, at, key]);
  const getPrevious = useCallback(() => previousItems(agentId, at), [agentId, at]);
  const getSiblings = useCallback(() => siblingCount(agentId, entry), [agentId, entry, at, key]);
  const role = useSyncExternalStore(subscribe, getRole, getRole);
  const previous = useSyncExternalStore(subscribe, getPrevious, getPrevious);
  const siblings = useSyncExternalStore(subscribe, getSiblings, getSiblings);

  // Before paint, so the blank space never shows for a frame.
  const [emptyGaps, setEmptyGaps] = useState(NO_TAKE_BACK);
  const takenAbove = useRef(0);
  takenAbove.current = emptyGaps.above;
  const measure = useCallback(() => {
    const next = role === "hidden" || siblings === 0 ? NO_TAKE_BACK : measureEmptyGaps(agentId, entry, takenAbove.current);
    setEmptyGaps((prev) => (prev.above === next.above && prev.below === next.below ? prev : next));
  }, [agentId, entry, role, siblings]);
  useLayoutEffect(measure, [measure]);
  return { role, previous, emptyGaps, measureEmptyGaps: measure };
}
