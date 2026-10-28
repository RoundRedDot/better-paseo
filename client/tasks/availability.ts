import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
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

/** Only an open, visible board probes its host; no timer or filesystem work per card. */
export function useTaskAvailability(tasks: TasksHandle, visible: boolean, hostId: string) {
  const load = useRpc(tasksAvailabilityRpc);
  const latest = useRef(load);
  latest.current = load;
  const scope = useRef(hostId);
  scope.current = hostId;
  const [snapshot, setStates] = useState<{ hostId: string; entries: ReadonlyMap<string, TaskAvailability> }>(() => ({ hostId, entries: new Map() }));
  const states = useMemo(() => snapshot.hostId === hostId ? snapshot.entries : new Map<string, TaskAvailability>(), [snapshot, hostId]);
  const cache = useMemo(() => new WeakMap<TaskCard, TaskCard>(), []);
  const cards = new Map(tasks.byId);
  for (const lane of LANE_ORDER) for (const card of tasks.lanes[lane].cards) cards.set(card.id, card);
  const key = JSON.stringify([...cards.values()].map((card) => [card.id, card.location.cwd, card.location.workspaceId, card.provider, card.model, card.archived]));
  const apply = useCallback((entries: Array<{ agentId: string; availability: TaskAvailability }>) => {
    if (scope.current !== hostId) return;
    setStates((previous) => {
      const current = previous.hostId === hostId ? previous.entries : new Map<string, TaskAvailability>();
      const next = new Map(current);
      for (const entry of entries) {
        if (JSON.stringify(current.get(entry.agentId)) !== JSON.stringify(entry.availability)) next.set(entry.agentId, entry.availability);
      }
      return previous.hostId === hostId && next.size === current.size && [...next].every(([id, value]) => value === current.get(id)) ? previous : { hostId, entries: next };
    });
  }, [hostId]);
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
      if (scope.current !== hostId) return UNREACHABLE.issue!;
      apply(result.entries);
      return result.entries.find((entry) => entry.agentId === agentId)?.availability.blocked[operation];
    } catch {
      apply([{ agentId, availability: UNREACHABLE }]);
      return UNREACHABLE.issue!;
    }
  }, [apply, hostId]);
  return { tasks: useMemo(() => withTaskAvailability(tasks, states, cache), [tasks, tasks.lanes, tasks.byId, states, cache]), check };
}
