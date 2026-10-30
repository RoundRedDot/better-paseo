import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaseoApi } from "@getpaseo/client";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { tasksAvailabilityRpc, unavailableTask, type TaskAvailability, type TaskIssue, type TaskOperation } from "../../shared/task-availability";
import type { TasksHandle } from "./data";
import { LANE_ORDER, type TaskCard } from "./model";

const CHECKING = unavailableTask({ code: "checking", detail: null });
const UNREACHABLE = unavailableTask({ code: "host_unavailable", detail: null });
export const TASK_AVAILABILITY_REFRESH_MS = 30_000;

/** The card and menu share the same reason, including operation-specific failures. */
export function taskOperationIssue(card: TaskCard, operation: TaskOperation): TaskIssue | undefined {
  return card.availability?.blocked[operation];
}

/** Unchanged cards retain their identity when a periodic check returns the same facts. */
export function withTaskAvailability(tasks: TasksHandle, states: ReadonlyMap<string, TaskAvailability>, cache: WeakMap<TaskCard, TaskCard>): TasksHandle {
  const decorate = (card: TaskCard) => {
    const availability = states.get(card.id) ?? CHECKING;
    const previous = cache.get(card);
    const next = availability.issue === null && Object.keys(availability.blocked).length === 0 ? card : previous?.availability === availability ? previous : { ...card, availability };
    cache.set(card, next);
    return next;
  };
  const byId = new Map([...tasks.byId].map(([id, card]) => [id, decorate(card)]));
  const lanes = { ...tasks.lanes };
  for (const id of LANE_ORDER) lanes[id] = { ...lanes[id], cards: lanes[id].cards.map(decorate) };
  return { ...tasks, byId, lanes };
}

type AvailabilityEntries = ReadonlyMap<string, TaskAvailability>;
const NONE: AvailabilityEntries = new Map();

/**
 * The last availability each host reported, per client, so a board mounted
 * again shows it at once. A late answer lands in its own host's entries and
 * never in the selected host's.
 */
function createAvailabilityStore() {
  const hosts = new Map<string, AvailabilityEntries>();
  const listeners = new Set<() => void>();
  return {
    get: (hostId: string) => hosts.get(hostId) ?? NONE,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    apply(hostId: string, entries: Array<{ agentId: string; availability: TaskAvailability }>) {
      const current = hosts.get(hostId) ?? NONE;
      let next: Map<string, TaskAvailability> | null = null;
      for (const entry of entries) {
        if (JSON.stringify(current.get(entry.agentId)) === JSON.stringify(entry.availability)) continue;
        next ??= new Map(current);
        next.set(entry.agentId, entry.availability);
      }
      if (!next) return;
      hosts.set(hostId, next);
      for (const listener of listeners) listener();
    },
  };
}

const stores = new WeakMap<PaseoApi, ReturnType<typeof createAvailabilityStore>>();

function availabilityStore(paseo: PaseoApi) {
  let store = stores.get(paseo);
  if (!store) stores.set(paseo, store = createAvailabilityStore());
  return store;
}

/** Only an open, visible board probes its host; no timer or filesystem work per card. */
export function useTaskAvailability(tasks: TasksHandle, visible: boolean, hostId: string) {
  const load = useRpc(tasksAvailabilityRpc);
  const latest = useRef(load);
  latest.current = load;
  const scope = useRef(hostId);
  scope.current = hostId;
  const store = availabilityStore(usePaseo());
  const get = useCallback(() => store.get(hostId), [store, hostId]);
  const states = useSyncExternalStore(store.subscribe, get, get);
  const cache = useMemo(() => new WeakMap<TaskCard, TaskCard>(), []);
  const cards = new Map(tasks.byId);
  for (const lane of LANE_ORDER) for (const card of tasks.lanes[lane].cards) cards.set(card.id, card);
  const key = JSON.stringify([...cards.values()].map((card) => [card.id, card.location.cwd, card.location.workspaceId, card.provider, card.model, card.archived]));
  const apply = useCallback((entries: Array<{ agentId: string; availability: TaskAvailability }>) => store.apply(hostId, entries), [store, hostId]);
  useEffect(() => {
    if (!visible) return;
    const ids = (JSON.parse(key) as string[][]).map((entry) => entry[0]!);
    if (ids.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      for (let offset = 0; offset < ids.length && !cancelled; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        try {
          const result = await latest.current({ agentIds: batch });
          if (!cancelled) apply(result.entries);
        } catch {
          if (!cancelled) apply(batch.map((agentId) => ({ agentId, availability: UNREACHABLE })));
        }
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), TASK_AVAILABILITY_REFRESH_MS);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, visible, apply]);
  const check = useCallback(async (agentId: string, operation: TaskOperation) => {
    try {
      const result = await latest.current({ agentIds: [agentId] });
      apply(result.entries);
      if (scope.current !== hostId) return UNREACHABLE.issue!;
      return result.entries.find((entry) => entry.agentId === agentId)?.availability.blocked[operation];
    } catch {
      apply([{ agentId, availability: UNREACHABLE }]);
      return UNREACHABLE.issue!;
    }
  }, [apply, hostId]);
  return { tasks: useMemo(() => withTaskAvailability(tasks, states, cache), [tasks, tasks.lanes, tasks.byId, states, cache]), check };
}
