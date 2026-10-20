import { useMemo } from "react";
import type { PaseoApi } from "@getpaseo/client";
import type { DoneWindow } from "../../../shared/tasks-settings";
import { LANE_ORDER, type BoardCounts, type BoardFilters, type LaneId, type LaneModel, type TaskCard, type TaskLabel } from "../model";
import { sampleCards } from "../sample-cards";

/**
 * The data layer's public contract (slice A owns this directory).
 *
 * PLACEHOLDER: until slice A lands, `useTasks` serves `sampleCards()` so the
 * board and cards can be built against the final shapes. The signatures here
 * are the contract; slice A replaces the bodies, and only extends the types.
 */

export interface WorkspaceOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

export interface TasksOptions {
  /** The done lane's time window. */
  doneWindow: DoneWindow;
  /** Page the done lane in; false keeps only the active subscription (the sidebar's case). */
  includeDone: boolean;
}

export interface TasksSnapshot {
  /** Every lane in `LANE_ORDER`, each sorted as the spec's lane table says. Unfiltered. */
  lanes: Record<LaneId, LaneModel>;
  counts: BoardCounts;
  byId: ReadonlyMap<string, TaskCard>;
  /** Filter options: workspaces grouped by project, providers and labels seen on cards. */
  workspaces: WorkspaceOption[];
  providers: { id: string; label: string }[];
  labels: TaskLabel[];
  /** False until the first active snapshot arrives. */
  ready: boolean;
  error: string | null;
}

export interface TasksHandle extends TasksSnapshot {
  /** Fetch the done lane's next page (50). */
  loadMoreDone(): void;
  /** Resolve a parent that is not on the board (archived): `agents.ref(id).refresh()`. */
  resolveParent(agentId: string): void;
}

/** All lanes, all subscriptions. The board screen calls this once. */
export function useTasks(paseo: PaseoApi, options: TasksOptions): TasksHandle {
  void paseo;
  return useMemo(() => fromCards(sampleCards(), options.includeDone), [options.includeDone]);
}

/** Counts from the active subscription only; the sidebar entry calls this. */
export function useTaskCounts(paseo: PaseoApi): BoardCounts & { ready: boolean } {
  return { ...useTasks(paseo, { doneWindow: "24h", includeDone: false }).counts, ready: true };
}

/** The lanes after the filter bar and search; pure. Hidden subtasks stay on their parent's card. */
export function filterLanes(lanes: Record<LaneId, LaneModel>, filters: BoardFilters): Record<LaneId, LaneModel> {
  const query = filters.query.trim().toLowerCase();
  const keep = (card: TaskCard) =>
    (!query || card.title.toLowerCase().includes(query)) &&
    (filters.workspaceIds.length === 0 || (card.location.workspaceId !== null && filters.workspaceIds.includes(card.location.workspaceId))) &&
    (filters.providers.length === 0 || filters.providers.includes(card.provider)) &&
    (filters.labels.length === 0 || card.labels.some((label) => filters.labels.includes(label.name))) &&
    (!filters.openTabsOnly || card.openTab) &&
    (!filters.hideSubtasks || card.parent === null);
  const out = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) out[id] = { ...lanes[id], cards: lanes[id].cards.filter(keep) };
  return out;
}

function fromCards(cards: TaskCard[], includeDone: boolean): TasksHandle {
  const lanes = {} as Record<LaneId, LaneModel>;
  for (const id of LANE_ORDER) {
    lanes[id] = { id, cards: id === "done" && !includeDone ? [] : cards.filter((card) => card.lane === id), hasMore: false, loading: false };
  }
  return {
    lanes,
    counts: {
      needsInput: lanes.needs_input.cards.length,
      running: lanes.running.cards.length,
      review: lanes.review.cards.length,
      done: lanes.done.cards.length,
    },
    byId: new Map(cards.map((card) => [card.id, card])),
    workspaces: [],
    providers: [],
    labels: [],
    ready: true,
    error: null,
    loadMoreDone() {},
    resolveParent() {},
  };
}
