import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as pluginClient from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import { LANE_ORDER, type BoardCounts, type LaneId, type LaneModel, type TaskCard, type TaskHost, type TaskLabel } from "../model";
import { laneCompare, remoteTasksSnapshot, setRemoteArchivedLane, subscribeRemoteTasks, type TasksHandle, type TasksOptions, type TasksRefreshResult, type WorkspaceOption } from "./index";

/**
 * One board for every connected Paseo host.
 *
 * The plugin runs on one host (the board's own) and its data layer reads
 * that host through `usePaseo()`. Paseo 0.16's client SDK also lists the
 * hosts the app is configured with (`useHosts()`) and lends an online
 * host's API (`getPaseoClient(serverId)`). The board reads each other
 * online host through its own API into a store of its own (`remote`: no
 * plugin server answers for it there), stamps every card with its host, and
 * merges the lanes in the board's order. An agent's reads and writes then go
 * to its own host (`routedPaseo`).
 *
 * On a Paseo without those two calls, or with one host configured, nothing
 * here changes the board: the cards carry no host and no filter shows.
 */

/** A configured host as `useHosts()` reports it. */
export interface HostSummary {
  serverId: string;
  label: string;
  status: "idle" | "connecting" | "online" | "offline" | "error";
}

interface HostApis {
  useHosts(): readonly HostSummary[];
  getPaseoClient(serverId: string): PaseoApi;
}

/**
 * The SDK's host calls, or null on a Paseo that does not supply them. The
 * app hands the plugin `@getpaseo/plugin/client` as a plain object, so an
 * older app simply lacks the two names; reading them never throws there,
 * but a test's module mock may, hence the guard.
 */
export function readHostApis(source: unknown): HostApis | null {
  try {
    const module = source as Partial<HostApis> | null;
    const useHosts = module?.useHosts;
    const getPaseoClient = module?.getPaseoClient;
    return typeof useHosts === "function" && typeof getPaseoClient === "function" ? { useHosts, getPaseoClient } : null;
  } catch {
    return null;
  }
}

const HOST_APIS = readHostApis(pluginClient);
const NO_HOSTS: readonly HostSummary[] = [];
function useNoHosts(): readonly HostSummary[] {
  return NO_HOSTS;
}

/** Every configured host, or none on a Paseo without `useHosts()`. Chosen once, so it is always the same hook. */
export const useConfiguredHosts: () => readonly HostSummary[] = HOST_APIS ? HOST_APIS.useHosts : useNoHosts;

/** An online host's API, or null when it is not online or the SDK lends none. */
export function hostApi(serverId: string, apis: HostApis | null = HOST_APIS): PaseoApi | null {
  if (!apis) return null;
  try {
    return apis.getPaseoClient(serverId);
  } catch {
    return null;
  }
}

/** Another host the board reads: online, with its API. */
export interface RemoteHost {
  id: string;
  label: string;
  api: PaseoApi;
}

/** The hosts as the board shows them. */
export interface BoardHosts {
  /** More than one host configured: cards carry their host and the host filter shows. */
  multi: boolean;
  /** Every configured host, the board's own first. */
  all: { id: string; label: string }[];
  /** The other hosts the board reads now. */
  remotes: RemoteHost[];
  /** The other hosts it cannot read now, with why, for the notice. */
  away: { id: string; label: string; status: HostSummary["status"] }[];
}

const ONE_HOST: Omit<BoardHosts, "all"> = { multi: false, remotes: [], away: [] };

/**
 * The board's hosts from `useHosts()`'s list. `connect` lends an online
 * host's API; one it cannot lend counts as away. The board's own host is
 * the plugin's (`props.host`), whether or not the list names it.
 */
export function boardHosts(own: { id: string; label: string }, hosts: readonly HostSummary[], connect: (serverId: string) => PaseoApi | null): BoardHosts {
  const others = hosts.filter((host) => host.serverId !== own.id);
  const ownLabel = hosts.find((host) => host.serverId === own.id)?.label || own.label;
  const all = [{ id: own.id, label: ownLabel }, ...others.map((host) => ({ id: host.serverId, label: host.label || host.serverId }))];
  if (others.length === 0) return { ...ONE_HOST, all };
  const remotes: RemoteHost[] = [];
  const away: BoardHosts["away"] = [];
  for (const host of others) {
    const label = host.label || host.serverId;
    const api = host.status === "online" ? connect(host.serverId) : null;
    if (api) remotes.push({ id: host.serverId, label, api });
    else away.push({ id: host.serverId, label, status: host.status === "online" ? "connecting" : host.status });
  }
  return { multi: true, all, remotes, away };
}

/**
 * `boardHosts` for the board: the same object while the hosts, their
 * states and the APIs they lend hold, so the remote subscriptions stay.
 */
export function useBoardHosts(own: { id: string; label: string }): BoardHosts {
  const hosts = useConfiguredHosts();
  const last = useRef<BoardHosts | null>(null);
  return useMemo(() => {
    const next = boardHosts(own, hosts, (serverId) => hostApi(serverId));
    const was = last.current;
    const same = was !== null && JSON.stringify([was.multi, was.all, was.away]) === JSON.stringify([next.multi, next.all, next.away])
      && was.remotes.length === next.remotes.length
      && was.remotes.every((host, index) => host.id === next.remotes[index]!.id && host.label === next.remotes[index]!.label && host.api === next.remotes[index]!.api);
    if (!same) last.current = next;
    return last.current!;
  }, [own.id, own.label, hosts]);
}

/** One other host's board data, as its store last drew it. */
export interface RemoteTasks {
  host: RemoteHost;
  tasks: TasksHandle;
}

const NO_REMOTE_TASKS: readonly RemoteTasks[] = [];

/**
 * Subscribes to each remote host's store as `useTasks` does to the board's
 * own, and returns their snapshots: the same array while none changed.
 */
export function useRemoteTasks(remotes: readonly RemoteHost[], options: TasksOptions): readonly RemoteTasks[] {
  const archived = options.includeDone && options.includeArchived === true;
  useLayoutEffect(() => {
    for (const host of remotes) setRemoteArchivedLane(host.api, archived);
  }, [remotes, archived]);
  const subscribe = useMemo(() => (listener: () => void) => {
    const releases = remotes.map((host) => subscribeRemoteTasks(host.api, listener, options.includeDone));
    return () => {
      for (const release of releases) release();
    };
  }, [remotes, options.includeDone]);
  const last = useRef<readonly RemoteTasks[]>(NO_REMOTE_TASKS);
  const getSnapshot = useMemo(() => () => {
    if (remotes.length === 0) return NO_REMOTE_TASKS;
    const next = remotes.map((host) => ({ host, tasks: remoteTasksSnapshot(host.api, options) }));
    const was = last.current;
    if (was.length === next.length && was.every((entry, index) => entry.host === next[index]!.host && entry.tasks === next[index]!.tasks)) return was;
    last.current = next;
    return next;
  }, [remotes, options.doneWindow, options.includeDone, options.includeArchived]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// --- Ids ---------------------------------------------------------------------

/**
 * A remote host's workspace and project ids, scoped to it: two daemons
 * number their own, so the filters, the sidebar's groups and the icons would
 * otherwise mix them up. The board's own ids stay as they are.
 */
export function scopedId(hostId: string, id: string): string {
  return `${hostId}/${id}`;
}

/** The host and the id a `scopedId` was made from, among `hostIds`; null for one of the board's own. */
export function unscopeId(value: string, hostIds: Iterable<string>): { hostId: string; id: string } | null {
  for (const hostId of hostIds) if (value.startsWith(`${hostId}/`)) return { hostId, id: value.slice(hostId.length + 1) };
  return null;
}

// --- Cards -------------------------------------------------------------------

const stamped = new WeakMap<TaskCard, { host: TaskHost; card: TaskCard }>();
const hostCache = new Map<string, TaskHost>();

function taskHost(id: string, label: string, remote: boolean): TaskHost {
  const key = JSON.stringify([id, label, remote]);
  let host = hostCache.get(key);
  if (!host) hostCache.set(key, host = { id, label, remote });
  return host;
}

/** The card with its host, and a remote card's ids scoped; the same object while the card and host hold. */
export function stampCard(card: TaskCard, host: TaskHost): TaskCard {
  const cached = stamped.get(card);
  if (cached?.host === host) return cached.card;
  const location = host.remote
    ? {
        ...card.location,
        workspaceId: card.location.workspaceId === null ? null : scopedId(host.id, card.location.workspaceId),
        projectId: card.location.projectId === null ? null : scopedId(host.id, card.location.projectId),
      }
    : card.location;
  const next = { ...card, host, location };
  stamped.set(card, { host, card: next });
  return next;
}

function scopedWorkspace(workspace: WorkspaceOption, hostId: string): WorkspaceOption {
  return { ...workspace, id: scopedId(hostId, workspace.id), projectId: scopedId(hostId, workspace.projectId) };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The merged board, and which host each agent it mentions belongs to. */
export interface MergedTasks {
  tasks: TasksHandle;
  /** Agent id → its host's server id, for every remote card, child and parent the board shows. */
  routes: ReadonlyMap<string, string>;
}

const NO_ROUTES: ReadonlyMap<string, string> = new Map();

function laneOf(own: LaneModel, others: readonly LaneModel[], cards: TaskCard[], resort: boolean): LaneModel {
  return {
    ...own,
    cards: resort ? cards.sort(laneCompare(own.id)) : cards,
    hasMore: own.hasMore || others.some((lane) => lane.hasMore),
    loading: own.loading || others.some((lane) => lane.loading),
  };
}

function settle(results: TasksRefreshResult[]): TasksRefreshResult {
  if (results[0] === "superseded") return "superseded";
  return results.every((result) => result === "done") ? "done" : results.includes("failed") ? "failed" : "superseded";
}

/** What the merged handle's calls act on: the latest merge's parts. */
export interface MergeParts {
  own: TasksHandle;
  remotes: readonly RemoteTasks[];
  routes: ReadonlyMap<string, string>;
}

/** The calls a merged handle makes on its hosts' handles. */
export type HostMethods = Required<Pick<TasksHandle, "refresh" | "loadMoreDone" | "loadMoreSearch" | "beginHistorySearch" | "endHistorySearch" | "resolveParent" | "refreshParent" | "requestProjectIcon">>;

/**
 * The merged handle's calls, reading the latest parts when called. Made
 * once per board: the board's effects key on these functions
 * (`useSearchHistory` begins a history search again whenever
 * `beginHistorySearch` changes), so a new set per merge would restart them
 * on every update, and each restart updates the stores again.
 */
export function hostMethods(read: () => MergeParts): HostMethods {
  const others = () => read().remotes.map((remote) => remote.tasks);
  const handleFor = (agentId: string): TasksHandle => {
    const { own, remotes, routes } = read();
    const hostId = routes.get(agentId);
    return remotes.find((remote) => remote.host.id === hostId)?.tasks ?? own;
  };
  return {
    refresh: () => Promise.all([read().own.refresh(), ...others().map((handle) => handle.refresh().catch((): TasksRefreshResult => "failed"))]).then(settle),
    loadMoreDone: () => {
      for (const handle of [read().own, ...others()]) if (handle.lanes.done.hasMore || handle.lanes.archived.hasMore) handle.loadMoreDone();
    },
    loadMoreSearch: (current) => {
      for (const handle of [read().own, ...others()]) handle.loadMoreSearch?.(current);
    },
    beginHistorySearch: (owner) => {
      for (const handle of [read().own, ...others()]) handle.beginHistorySearch?.(owner);
    },
    endHistorySearch: (owner) => {
      for (const handle of [read().own, ...others()]) handle.endHistorySearch?.(owner);
    },
    resolveParent: (agentId) => handleFor(agentId).resolveParent(agentId),
    refreshParent: (agentId) => handleFor(agentId).refreshParent(agentId),
    requestProjectIcon: (projectId) => {
      const { own, remotes } = read();
      const scoped = unscopeId(projectId, remotes.map((remote) => remote.host.id));
      const remote = scoped ? remotes.find((entry) => entry.host.id === scoped.hostId) : undefined;
      if (scoped && remote) remote.tasks.requestProjectIcon(scoped.id);
      else own.requestProjectIcon(projectId);
    },
  };
}

/**
 * The board's own data with every remote host's, as one `TasksHandle`. Pure.
 *
 * Each lane holds every host's cards in the lane's own order (`laneCompare`),
 * so the board's sorts and filters apply as they do to one host's. A remote
 * host's error stays out of the handle, whose error the board shows as a
 * toast: the host notice names it instead (`useRemoteReadFailures`).
 * With one host the board's own data is returned as it is. `methods` are
 * the handle's calls (`hostMethods`); by default made for this merge alone.
 */
export function mergeHostTasks(own: TasksHandle, hosts: BoardHosts, remotes: readonly RemoteTasks[], methods?: HostMethods): MergedTasks {
  if (!hosts.multi) return { tasks: own, routes: NO_ROUTES };
  const ownHost = taskHost(hosts.all[0]!.id, hosts.all[0]!.label, false);
  const routes = new Map<string, string>();
  const lanes = {} as Record<LaneId, LaneModel>;
  for (const lane of LANE_ORDER) {
    const cards = own.lanes[lane].cards.map((card) => stampCard(card, ownHost));
    let added = false;
    for (const remote of remotes) {
      const host = taskHost(remote.host.id, remote.host.label, true);
      for (const card of remote.tasks.lanes[lane].cards) {
        cards.push(stampCard(card, host));
        added = true;
      }
    }
    lanes[lane] = laneOf(own.lanes[lane], remotes.map((remote) => remote.tasks.lanes[lane]), cards, added);
  }
  const byId = new Map<string, TaskCard>();
  for (const [id, card] of own.byId) byId.set(id, stampCard(card, ownHost));
  const workspaces = [...own.workspaces];
  const providers = new Map(own.providers.map((provider) => [provider.id, provider.label]));
  const labels = new Map<string, TaskLabel>(own.labels.map((label) => [label.name, label]));
  const counts: BoardCounts = { ...own.counts };
  for (const remote of remotes) {
    const hostId = remote.host.id;
    const host = taskHost(hostId, remote.host.label, true);
    for (const [id, card] of remote.tasks.byId) {
      routes.set(id, hostId);
      if (card.parent) routes.set(card.parent.id, hostId);
      for (const child of card.children) routes.set(child.id, hostId);
      if (!byId.has(id)) byId.set(id, stampCard(card, host));
    }
    for (const lane of LANE_ORDER) for (const card of remote.tasks.lanes[lane].cards) routes.set(card.id, hostId);
    for (const workspace of remote.tasks.workspaces) workspaces.push(scopedWorkspace(workspace, hostId));
    for (const provider of remote.tasks.providers) if (!providers.has(provider.id)) providers.set(provider.id, provider.label);
    for (const label of remote.tasks.labels) if (!labels.has(label.name)) labels.set(label.name, label);
    for (const key of Object.keys(counts) as (keyof BoardCounts)[]) counts[key] += remote.tasks.counts[key] ?? 0;
  }
  workspaces.sort((a, b) => compareText(a.projectName, b.projectName) || compareText(a.name, b.name));
  const calls = methods ?? hostMethods(() => ({ own, remotes, routes }));
  const tasks: TasksHandle = {
    ...own,
    lanes,
    counts,
    byId,
    workspaces,
    providers: [...providers].map(([id, label]) => ({ id, label })).sort((a, b) => compareText(a.label, b.label)),
    labels: [...labels.values()].sort((a, b) => compareText(a.name, b.name)),
    hosts: hosts.all,
    refresh: calls.refresh,
    loadMoreDone: calls.loadMoreDone,
    // Optional on a handle: present while the board's own store has them.
    loadMoreSearch: own.loadMoreSearch ? calls.loadMoreSearch : undefined,
    beginHistorySearch: own.beginHistorySearch ? calls.beginHistorySearch : undefined,
    endHistorySearch: own.endHistorySearch ? calls.endHistorySearch : undefined,
    resolveParent: calls.resolveParent,
    refreshParent: calls.refreshParent,
    requestProjectIcon: calls.requestProjectIcon,
  };
  return { tasks, routes };
}

/**
 * The board's merged data, the same object while its parts hold: one
 * merge per change on any host, none per render.
 */
export function useMergedTasks(own: TasksHandle, hosts: BoardHosts, remotes: readonly RemoteTasks[]): MergedTasks {
  const parts = useRef<MergeParts>({ own, remotes, routes: NO_ROUTES });
  const methods = useMemo(() => hostMethods(() => parts.current), []);
  return useMemo(() => {
    const merged = mergeHostTasks(own, hosts, remotes, methods);
    parts.current = { own, remotes, routes: merged.routes };
    return merged;
  }, [own, hosts, remotes, methods]);
}

// --- Routing -----------------------------------------------------------------

/**
 * The board's API for an agent's own reads and writes: `agents.ref(id)`
 * resolves on the agent's host (`route`), everything else is the board's
 * own host's. Every per-agent call the board makes (timelines, first
 * prompts, the plan, Archive, permission answers) goes through
 * `agents.ref`, so one routed API serves every card.
 *
 * An agent `route` does not place, or whose host can no longer lend its API,
 * resolves on the board's own host, where it is not found: the callers
 * already handle a missing agent, while a throw here would reach a render.
 */
export function routedPaseo(own: PaseoApi, route: (agentId: string) => PaseoApi | null): PaseoApi {
  const ref = (agent: Parameters<PaseoApi["agents"]["ref"]>[0]) => {
    const id = typeof agent === "string" ? agent : agent.id;
    return (route(id) ?? own).agents.ref(agent);
  };
  const agents = new Proxy(own.agents, {
    get: (target, key) => (key === "ref" ? ref : Reflect.get(target, key, target)),
  });
  return new Proxy(own, {
    get: (target, key) => (key === "agents" ? agents : Reflect.get(target, key, target)),
  });
}

// --- Read failures -----------------------------------------------------------

/** How long after a remote host's task read fails the board reads it again; each failure doubles it, to `REMOTE_RETRY_MAX_MS`. */
export const REMOTE_RETRY_MS = 5_000;
export const REMOTE_RETRY_MAX_MS = 60_000;

/** An online host whose tasks the board could not read: its cards may be missing or out of date. */
export interface FailedHost {
  id: string;
  label: string;
}

const NO_FAILED: readonly FailedHost[] = [];

interface FailureWatch {
  label: string;
  delay: number;
  timer: ReturnType<typeof setTimeout> | null;
  retrying: boolean;
}

/**
 * The remote hosts whose task subscription or read failed while they stay
 * online, for the host notice: the merged handle carries only the board's
 * own error, and `BoardHosts.away` only connection states.
 *
 * A failed host's store is read again (`refresh`) after `REMOTE_RETRY_MS`,
 * then at doubling intervals. A refresh clears the store's error as it
 * starts, so a host stays listed until a retry lands, and the notice does
 * not blink with each attempt. A host whose error clears otherwise (the
 * board's own refresh) leaves the list; one that goes offline leaves it to
 * the away notice.
 */
export function useRemoteReadFailures(remotes: readonly RemoteTasks[]): readonly FailedHost[] {
  const [failed, setFailed] = useState<readonly FailedHost[]>(NO_FAILED);
  const latest = useRef(remotes);
  latest.current = remotes;
  const control = useMemo(() => {
    const watches = new Map<string, FailureWatch>();
    let live = true;
    const publish = () => {
      if (!live) return;
      const next = [...watches].map(([id, watch]) => ({ id, label: watch.label }));
      setFailed((was) => (was.length === next.length && was.every((host, index) => host.id === next[index]!.id && host.label === next[index]!.label) ? was : next.length ? next : NO_FAILED));
    };
    const drop = (id: string, watch: FailureWatch) => {
      if (watch.timer !== null) clearTimeout(watch.timer);
      watches.delete(id);
    };
    const schedule = (id: string, watch: FailureWatch) => {
      watch.timer = setTimeout(() => retry(id, watch), watch.delay);
      watch.delay = Math.min(watch.delay * 2, REMOTE_RETRY_MAX_MS);
    };
    const retry = (id: string, watch: FailureWatch) => {
      watch.timer = null;
      const remote = latest.current.find((entry) => entry.host.id === id);
      if (!remote || watches.get(id) !== watch) return;
      watch.retrying = true;
      void remote.tasks.refresh().catch((): TasksRefreshResult => "failed").then((result) => {
        if (!live || watches.get(id) !== watch) return;
        watch.retrying = false;
        // The result, not the last drawn snapshot, says how the retry went: the
        // store may have set its error again before the board drew it.
        const error = latest.current.find((entry) => entry.host.id === id)?.tasks.error ?? null;
        if (result === "failed" || (result === "done" && error !== null)) {
          if (watch.timer === null) schedule(id, watch);
        } else if (result === "done") {
          drop(id, watch);
          publish();
        } else {
          reconcile();
        }
      });
    };
    const reconcile = () => {
      live = true;
      const present = new Set(latest.current.map((remote) => remote.host.id));
      for (const [id, watch] of [...watches]) if (!present.has(id)) drop(id, watch);
      for (const remote of latest.current) {
        const id = remote.host.id;
        const watch = watches.get(id);
        if (remote.tasks.error !== null) {
          if (!watch) {
            const added: FailureWatch = { label: remote.host.label, delay: REMOTE_RETRY_MS, timer: null, retrying: false };
            watches.set(id, added);
            schedule(id, added);
          } else {
            watch.label = remote.host.label;
            if (watch.timer === null && !watch.retrying) schedule(id, watch);
          }
        } else if (watch && !watch.retrying) {
          drop(id, watch);
        }
      }
      publish();
    };
    const stop = () => {
      live = false;
      for (const [id, watch] of [...watches]) drop(id, watch);
    };
    return { reconcile, stop };
  }, []);
  useEffect(() => control.reconcile(), [remotes, control]);
  useEffect(() => () => control.stop(), [control]);
  return failed;
}

// --- Notice ------------------------------------------------------------------

/** The host notice: which hosts' cards are missing, and whether a read failed (`failed`) rather than a connection. */
export interface HostNotice {
  text: string;
  failed: boolean;
}

function listOf(names: string[], language: "en" | "zh"): string {
  if (language === "zh") return names.join("、");
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The quiet line naming the hosts whose cards are missing; null while every host is read. */
export function awayNotice(away: BoardHosts["away"], language: "en" | "zh"): string | null {
  if (away.length === 0) return null;
  const names = away.map((host) => host.label);
  const connecting = away.every((host) => host.status === "connecting");
  const list = listOf(names, language);
  if (language === "zh") return connecting ? `正在重新连接 ${list}，连上后显示它的任务。` : `${list} 已离线，它的任务暂不显示。`;
  const its = names.length === 1 ? "its" : "their";
  return connecting ? `Reconnecting to ${list}; ${its} tasks return once connected.` : `${list} ${names.length === 1 ? "is" : "are"} offline; ${its} tasks are hidden for now.`;
}

/** The line naming online hosts whose task read failed; null while none did. */
export function failedNotice(failed: readonly FailedHost[], language: "en" | "zh"): string | null {
  if (failed.length === 0) return null;
  const list = listOf(failed.map((host) => host.label), language);
  return language === "zh" ? `读取 ${list} 的任务失败，部分任务可能缺失，正在重试。` : `Couldn't load tasks from ${list}; some may be missing. Retrying.`;
}

/** The board's host notice: offline or reconnecting hosts first, then online ones whose read failed; null while every host is read. */
export function hostNotice(away: BoardHosts["away"], failed: readonly FailedHost[], language: "en" | "zh"): HostNotice | null {
  const parts = [awayNotice(away, language), failedNotice(failed, language)].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return { text: parts.join(language === "zh" ? "" : " "), failed: failed.length > 0 };
}
