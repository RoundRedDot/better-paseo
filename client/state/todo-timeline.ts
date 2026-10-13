import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

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
 * the same timestamp and the same list are one update: the first mounted
 * draws it and the rest draw nothing. The newest update draws the checklist;
 * an earlier one folds to a row naming what changed, read off the list before
 * it (`deriveTodoActivities`, the host's own rule).
 *
 * Updates are remembered after their item unmounts, so a list scrolled out of
 * a virtualised timeline still counts as newest and still names the changes
 * of the one after it.
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
}

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
 * How the item `self` draws the update at `at` with list `key`. Before it
 * mounts (its first render) it is weighed as if it had.
 */
function todoRole(agentId: string, self: Entry, at: number, key: string): TodoRole {
  const agent = agents.get(agentId);
  let newest = at;
  if (agent) {
    for (const other of agent.mounted) {
      if (other !== self && other.at === at && other.key === key && other.sequence < self.sequence) {
        return "hidden";
      }
    }
    for (const update of agent.updates.values()) newest = Math.max(newest, update.at);
  }
  return at >= newest ? "full" : "summary";
}

/** The list of the update before `at`, or null when none is known. */
function previousItems(agentId: string, at: number): readonly TodoTask[] | null {
  let best: Update | null = null;
  for (const update of agents.get(agentId)?.updates.values() ?? []) {
    if (update.at < at && (!best || update.at > best.at)) best = update;
  }
  return best?.items ?? null;
}

/**
 * Records this todo item while it is mounted and says how it draws. `previous`
 * is the list of the update before it, null when none is known.
 */
export function useTodoTimeline(
  agentId: string,
  at: number,
  items: readonly TodoTask[],
): { role: TodoRole; previous: readonly TodoTask[] | null } {
  const key = useMemo(() => todoListKey(items), [items]);
  const entry = useMemo<Entry>(() => ({ at, key, sequence: sequence++ }), []);
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
  const role = useSyncExternalStore(subscribe, getRole, getRole);
  const previous = useSyncExternalStore(subscribe, getPrevious, getPrevious);
  return { role, previous };
}
