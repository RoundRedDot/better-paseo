import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { HubAgentRow, HubJobRow } from "../shared/contracts";

/**
 * The last background-work snapshot seen for one agent.
 *
 * A plugin has no access to omp's job manager: everything it knows about
 * background work arrives as a `hub` tool result in the timeline. So this is a
 * record of an observation, not a live feed. `at` is when the snapshot was
 * taken, and by the time it is read a job may already have finished. Every view
 * built on this store has to show that age rather than imply liveness.
 */
export interface HubActivity {
  running: HubJobRow[];
  agents: HubAgentRow[];
  at: number;
}

const listeners = new Set<() => void>();

/**
 * One entry per agent, keyed at runtime and deleted when an agent goes quiet.
 *
 * The map value doubles as the cached `getSnapshot` result: React compares
 * snapshots by identity and re-renders forever if the getter allocates, so
 * nothing here builds a value per read.
 */
const snapshots = new Map<string, HubActivity>();

function publish(): void {
  for (const listener of listeners) listener();
}

/**
 * Whether two job rows carry the same value.
 *
 * `running` holds running jobs, so the result, error and schema fields are
 * empty by construction. A row's identity, state, label and elapsed time are
 * the whole of what a snapshot says about it.
 */
function sameJob(left: HubJobRow, right: HubJobRow): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.status === right.status &&
    left.label === right.label &&
    left.durationMs === right.durationMs
  );
}

function sameAgent(left: HubAgentRow, right: HubAgentRow): boolean {
  return (
    left.id === right.id &&
    left.parentId === right.parentId &&
    left.activity === right.activity &&
    left.ageMs === right.ageMs &&
    left.live === right.live
  );
}

function sameRows<T>(left: T[], right: T[], equal: (a: T, b: T) => boolean): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    // Unreachable at equal lengths. It keeps the indexed reads honest under
    // `noUncheckedIndexedAccess` instead of asserting them away.
    if (a === undefined || b === undefined) return a === b;
    if (!equal(a, b)) return false;
  }
  return true;
}

/**
 * Records `snapshot` as everything currently known about `agentId`'s background
 * work, replacing any earlier entry. An empty snapshot, meaning no running jobs
 * and no jobless subagents, removes the entry instead of storing a blank one.
 *
 * Rows are compared by content and `at` is ignored, so a repeated `hub jobs`
 * call reporting the same work is dropped: it is the same news, and a fresh
 * timestamp alone would re-render every listener for nothing. The stored object
 * then keeps its original `at`, so the reported age counts from the first
 * sighting of this exact state. That errs towards calling a snapshot staler
 * than it is, which is the safe direction. This store must never make a view
 * look more live than the evidence behind it.
 */
/**
 * Only the newest hub result may speak.
 *
 * Every `hub` card in the timeline republishes its snapshot whenever it
 * renders, and an old card scrolling back into view would otherwise overwrite
 * the current state with history. `at` is the source item's own timestamp, so
 * an older snapshot is dropped rather than applied.
 */
export function publishHubSnapshot(agentId: string, snapshot: HubActivity): void {
  const previous = snapshots.get(agentId);
  if (previous !== undefined && snapshot.at < previous.at) return;

  if (snapshot.running.length === 0 && snapshot.agents.length === 0) {
    if (previous === undefined) return;
    snapshots.delete(agentId);
    publish();
    return;
  }

  if (
    previous !== undefined &&
    sameRows(previous.running, snapshot.running, sameJob) &&
    sameRows(previous.agents, snapshot.agents, sameAgent)
  ) {
    return;
  }

  snapshots.set(agentId, snapshot);
  publish();
}

/** The stored snapshot for `agentId`, or null when nothing is in flight. */
export function getHubActivity(agentId: string): HubActivity | null {
  return snapshots.get(agentId) ?? null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored snapshot for `agentId`, re-read whenever the store changes. */
export function useHubActivity(agentId: string): HubActivity | null {
  const read = useCallback(() => getHubActivity(agentId), [agentId]);
  return useSyncExternalStore(subscribe, read, read);
}
