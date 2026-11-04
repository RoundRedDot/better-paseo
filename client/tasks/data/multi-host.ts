/**
 * One Tasks board over several hosts.
 *
 * Each online host keeps its own `TaskStore` (subscriptions, caches, live
 * updates); this merges their snapshots into the single `TasksHandle` the
 * board draws. Cards keep the host they came from (`hostId`, `hostLabel`), so
 * the host filter can narrow the merged lanes and a later action can route
 * back to the daemon that owns the agent.
 *
 * Progressive: the merged board is `ready` once the local host is, rather
 * than waiting for the slowest remote; `error` is null while any host still
 * answers.
 */
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { PaseoApi } from "@getpaseo/client";
import { getPaseoClient, useHosts, type PluginHostSummary } from "@getpaseo/plugin/client";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard, type TaskLabel } from "../model";
import {
  getStore,
  laneCompare,
  type TasksHandle,
  type TasksOptions,
  type TasksRefreshResult,
  type TaskStore,
  type WorkspaceOption,
} from "./index";

export interface HostTarget {
  serverId: string;
  label: string;
}

/** Where the merged handle sends a call: every host's store, so one call site serves the board. */
export interface MultiHostControls {
  refresh(): Promise<TasksRefreshResult>;
  loadMoreDone(): void;
  resolveParent(agentId: string): void;
  refreshParent(agentId: string): Promise<boolean | null>;
  refreshReads(): void;
  requestProjectIcon(projectId: string): void;
}

const DEFAULT_LOCAL_LABEL = "This host";

/**
 * The hosts a multi-host board reads: every online host, the local one first,
 * and the local host even when `useHosts` does not know it yet. A non-empty
 * `selectedHostIds` narrows the list; an unknown id selects nothing.
 */
export function multiHostTargets(
  hosts: readonly PluginHostSummary[] | null | undefined,
  currentHostId: string,
  selectedHostIds?: readonly string[],
): HostTarget[] {
  const online = (hosts ?? []).filter((host) => host.status === "online");
  const local = (hosts ?? []).find((host) => host.serverId === currentHostId);
  const targets: HostTarget[] = [{ serverId: currentHostId, label: local?.label ?? DEFAULT_LOCAL_LABEL }];
  for (const host of online) {
    if (host.serverId === currentHostId) continue;
    targets.push({ serverId: host.serverId, label: host.label });
  }
  const selected = selectedHostIds && selectedHostIds.length > 0 ? new Set(selectedHostIds) : null;
  return selected ? targets.filter((target) => selected.has(target.serverId)) : targets;
}

export interface MergeInput {
  host: HostTarget;
  snapshot: TasksHandle;
}

/** The same card object tagged the same way, so a host's card keeps its identity while the board lives. */
const taggedCards = new WeakMap<TaskCard, Map<string, TaskCard>>();

function tagCard(card: TaskCard, host: HostTarget): TaskCard {
  let byHost = taggedCards.get(card);
  if (!byHost) {
    byHost = new Map();
    taggedCards.set(card, byHost);
  }
  const key = `${host.serverId}\u0000${host.label}`;
  let tagged = byHost.get(key);
  if (!tagged) {
    tagged = { ...card, hostId: host.serverId, hostLabel: host.label };
    byHost.set(key, tagged);
  }
  return tagged;
}

/** One host's workspaces, tagged so two hosts with the same workspace id stay apart. */
export type HostWorkspaceOption = WorkspaceOption & { hostId: string };

interface MergeCache {
  inputs: readonly MergeInput[];
  localId: string;
  controls: MultiHostControls;
  handle: TasksHandle;
}

let mergeCache: MergeCache | null = null;

function sameInputs(left: readonly MergeInput[], right: readonly MergeInput[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((input, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      input.snapshot === other.snapshot &&
      input.host.serverId === other.host.serverId &&
      input.host.label === other.host.label
    );
  });
}

/**
 * The hosts' snapshots as one board. Memoized: the same per-host snapshots
 * (and controls) give the same handle, so `useSyncExternalStore` sees no
 * change while a host streams.
 *
 * `ready` follows the local host, so a slow remote does not hold the board
 * back; `error` appears only once every host has failed.
 */
export function mergeTasksSnapshots(
  inputs: readonly MergeInput[],
  localId: string,
  controls: MultiHostControls,
): TasksHandle {
  if (mergeCache && mergeCache.localId === localId && mergeCache.controls === controls && sameInputs(mergeCache.inputs, inputs)) {
    return mergeCache.handle;
  }

  const lanes = {} as Record<LaneId, LaneModel>;
  const byId = new Map<string, TaskCard>();
  for (const lane of LANE_ORDER) {
    const cards: TaskCard[] = [];
    let hasMore = false;
    let loading = false;
    let initialLoading = false;
    for (const { host, snapshot } of inputs) {
      const model = snapshot.lanes[lane];
      for (const card of model.cards) cards.push(tagCard(card, host));
      hasMore = hasMore || model.hasMore;
      loading = loading || model.loading;
      initialLoading = initialLoading || model.initialLoading === true;
    }
    cards.sort(laneCompare(lane));
    lanes[lane] = { id: lane, cards, hasMore, loading, initialLoading };
  }
  // First host wins an id collision: the local host is first, so a remote
  // agent named like a local one never replaces the local card.
  for (const lane of LANE_ORDER) for (const card of lanes[lane].cards) if (!byId.has(card.id)) byId.set(card.id, card);

  const workspaces: HostWorkspaceOption[] = [];
  const seenWorkspaces = new Set<string>();
  const providers = new Map<string, string>();
  const labels = new Map<string, TaskLabel>();
  for (const { host, snapshot } of inputs) {
    for (const workspace of snapshot.workspaces) {
      const key = `${host.serverId}\u0000${workspace.id}`;
      if (seenWorkspaces.has(key)) continue;
      seenWorkspaces.add(key);
      workspaces.push({ ...workspace, hostId: host.serverId });
    }
    for (const provider of snapshot.providers) if (!providers.has(provider.id)) providers.set(provider.id, provider.label);
    for (const label of snapshot.labels) if (!labels.has(label.name)) labels.set(label.name, label);
  }

  const local = inputs.find((input) => input.host.serverId === localId);
  const failed = inputs.filter((input) => input.snapshot.error !== null);
  const error =
    inputs.length > 0 && failed.length === inputs.length
      ? failed.map((input) => input.snapshot.error).join("; ")
      : null;

  const handle: TasksHandle = {
    lanes,
    counts: {
      needsInput: lanes.needs_input.cards.length,
      running: lanes.running.cards.length,
      review: lanes.review.cards.length,
      done: lanes.done.cards.length,
      archived: lanes.archived.cards.length,
    },
    byId,
    workspaces,
    providers: [...providers].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    labels: [...labels.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ready: local ? local.snapshot.ready : inputs.some((input) => input.snapshot.ready),
    error,
    refresh: controls.refresh,
    loadMoreDone: controls.loadMoreDone,
    resolveParent: controls.resolveParent,
    refreshParent: controls.refreshParent,
    refreshReads: controls.refreshReads,
    requestProjectIcon: controls.requestProjectIcon,
  };
  mergeCache = { inputs: [...inputs], localId, controls, handle };
  return handle;
}

/** The store a card belongs to; every store is asked, so a call after a relayout still finds it. */
function storeOfCard(stores: readonly { store: TaskStore }[], options: TasksOptions, agentId: string): TaskStore | null {
  for (const { store } of stores) if (store.getSnapshot(options).byId.has(agentId)) return store;
  return null;
}

/**
 * The board over every online host (`useHosts`) plus the local one, narrowed
 * by `selectedHostIds`. Each host keeps its own store and subscriptions.
 */
export function useMultiHostTasks(
  paseo: PaseoApi,
  currentHostId: string,
  options: TasksOptions,
  selectedHostIds?: readonly string[],
  beforeRelease?: (paseo: PaseoApi) => void,
): TasksHandle {
  const hosts = useHosts();
  // A caller passing an inline array must not re-subscribe every render.
  const selectionKey = selectedHostIds?.join("\u0000") ?? "";
  const hostKey = (hosts ?? []).map((host) => `${host.serverId}:${host.status}:${host.label}`).join("|");
  const targets = useMemo(
    () => multiHostTargets(hosts, currentHostId, selectedHostIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostKey, currentHostId, selectionKey],
  );
  const clients = useMemo(
    () =>
      targets.map((host) => ({
        host,
        client: host.serverId === currentHostId ? paseo : getPaseoClient(host.serverId),
      })),
    [targets, currentHostId, paseo],
  );
  const stores = useMemo(() => clients.map(({ host, client }) => ({ host, client, store: getStore(client) })), [clients]);

  const archived = options.includeDone && options.includeArchived === true;
  useLayoutEffect(() => {
    for (const { store } of stores) store.setArchivedLane(archived);
  }, [stores, archived]);

  const includeDone = options.includeDone;
  const subscribe = useMemo(
    () => (listener: () => void) => {
      const releases = stores.map(({ store }) => store.subscribe(listener, { board: true, done: includeDone }));
      return () => {
        for (const { client } of stores) beforeRelease?.(client);
        for (const release of releases) release();
      };
    },
    [stores, includeDone, beforeRelease],
  );

  const controls = useMemo<MultiHostControls>(() => ({
    async refresh() {
      const results = await Promise.all(stores.map(({ store }) => store.refresh()));
      if (results.includes("failed")) return "failed";
      if (results.includes("superseded")) return "superseded";
      return "done";
    },
    loadMoreDone() {
      for (const { store } of stores) {
        if (store.getSnapshot(options).lanes.done.hasMore) store.loadMoreDone(options.doneWindow);
      }
    },
    resolveParent(agentId) {
      const store = storeOfCard(stores, options, agentId);
      if (store) store.resolveParent(agentId);
      else for (const entry of stores) entry.store.resolveParent(agentId);
    },
    async refreshParent(agentId) {
      const store = storeOfCard(stores, options, agentId);
      if (store) return store.refreshParent(agentId);
      const results = await Promise.all(stores.map((entry) => entry.store.refreshParent(agentId)));
      return results.find((result) => result !== null) ?? null;
    },
    refreshReads() {
      for (const { store } of stores) store.refreshReads();
    },
    requestProjectIcon(projectId) {
      for (const { store } of stores) store.requestProjectIcon(projectId);
    },
  }), [stores, options.doneWindow, options.includeDone, options.includeArchived]);

  const getSnapshot = useMemo(
    () => () =>
      mergeTasksSnapshots(
        stores.map(({ host, store }) => ({ host, snapshot: store.getSnapshot(options) })),
        currentHostId,
        controls,
      ),
    // `options` is read whole, so its fields are the dependencies a new object would change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stores, currentHostId, controls, options.doneWindow, options.includeDone, options.includeArchived],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
