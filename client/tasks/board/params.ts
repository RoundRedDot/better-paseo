import type { PluginScreenParams } from "@getpaseo/plugin/client";
import { DONE_WINDOWS, type DoneWindow } from "../../../shared/tasks-settings";
import { LANE_ORDER, type BoardFilters, type LaneId } from "../model";
import { carriedSession, carrySession, forgetCarried } from "./carry";
import { decodeSort, encodeSort, type BoardSort } from "./sort";

/**
 * What the board's filter bar holds, as it travels in the screen's params.
 *
 * `doneWindow` starts from the shared setting; null follows that setting.
 * `hideSubtasks` remains in the codec for explicit links and pure filter
 * decisions. The live board reads and writes the device preference instead
 * of carrying that switch in its remembered route params.
 */
export interface BoardParams {
  query: string;
  workspaceIds: string[];
  providers: string[];
  labels: string[];
  hideSubtasks: boolean | null;
  doneWindow: DoneWindow | null;
  /** One order for every lane; null keeps each lane's own (the spec's). Not a filter: clearing filters keeps it. */
  sort: BoardSort | null;
}

export const EMPTY_PARAMS: BoardParams = {
  query: "",
  workspaceIds: [],
  providers: [],
  labels: [],
  hideSubtasks: null,
  doneWindow: null,
  sort: null,
};

/** The settings the board falls back to while a filter follows them. */
export interface BoardDefaults {
  hideSubtasks: boolean;
  doneWindow: DoneWindow;
}

// Short keys: params ride in the screen's URL.
const KEY = { query: "q", workspaceIds: "ws", providers: "agent", labels: "label", hideSubtasks: "sub", doneWindow: "win", sort: "sort" } as const;

/** A list as one param: each item URI-encoded, so ids and label names may hold commas. */
function encodeList(values: readonly string[]): string {
  return values.map(encodeURIComponent).join(",");
}

function decodeList(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const part of value.split(",")) {
    if (!part) continue;
    try {
      const item = decodeURIComponent(part);
      if (item && !out.includes(item)) out.push(item);
    } catch {
      // A malformed escape drops that item only.
    }
  }
  return out;
}

/** The params to open the board with; empty and following values are left out. */
export function encodeBoardParams(params: BoardParams): PluginScreenParams {
  const out: PluginScreenParams = {};
  const query = params.query.trim();
  if (query) out[KEY.query] = query;
  if (params.workspaceIds.length) out[KEY.workspaceIds] = encodeList(params.workspaceIds);
  if (params.providers.length) out[KEY.providers] = encodeList(params.providers);
  if (params.labels.length) out[KEY.labels] = encodeList(params.labels);
  if (params.hideSubtasks !== null) out[KEY.hideSubtasks] = params.hideSubtasks ? "1" : "0";
  if (params.doneWindow !== null) out[KEY.doneWindow] = params.doneWindow;
  const sort = encodeSort(params.sort);
  if (sort) out[KEY.sort] = sort;
  return out;
}

/** The board's state from screen params; anything unreadable falls back to its empty value. */
export function decodeBoardParams(params: PluginScreenParams | null | undefined): BoardParams {
  const read = (key: string): string | undefined => {
    const value = params?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const sub = read(KEY.hideSubtasks);
  const win = read(KEY.doneWindow);
  return {
    query: read(KEY.query)?.trim() ?? "",
    workspaceIds: decodeList(read(KEY.workspaceIds)),
    providers: decodeList(read(KEY.providers)),
    labels: decodeList(read(KEY.labels)),
    hideSubtasks: sub === "1" ? true : sub === "0" ? false : null,
    doneWindow: (DONE_WINDOWS as readonly string[]).includes(win ?? "") ? (win as DoneWindow) : null,
    sort: decodeSort(read(KEY.sort)),
  };
}

/** True when the params carry no board state, so the session's last state applies. */
export function isEmptyParams(params: PluginScreenParams | null | undefined): boolean {
  return Object.keys(encodeBoardParams(decodeBoardParams(params))).length === 0;
}

/** Restore edits made to this route before the web page was reloaded. */
export function restoreBoardRoute(hostId: string, route: PluginScreenParams | null | undefined): BoardParams {
  const key = JSON.stringify(encodeBoardParams(decodeBoardParams(route)));
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(`better-paseo/tasks/route/${hostId}`);
    if (raw) {
      const saved = JSON.parse(raw) as { route: string; params: PluginScreenParams };
      if (saved.route === key) return decodeBoardParams(saved.params);
    }
  } catch {
    // The route remains usable when session storage is unavailable.
  }
  return key === "{}" ? lastBoardParams(hostId) : decodeBoardParams(route);
}

export function rememberBoardRoute(hostId: string, route: PluginScreenParams | null | undefined, params: BoardParams): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(`better-paseo/tasks/route/${hostId}`, JSON.stringify({
      route: JSON.stringify(encodeBoardParams(decodeBoardParams(route))),
      params: encodeBoardParams({ ...params, hideSubtasks: null }),
    }));
  } catch {
    // A blocked or full session storage leaves the current board usable.
  }
}

/** The filters `filterLanes` takes and the done window `useTasks` takes. */
export function resolveBoardParams(params: BoardParams, defaults: BoardDefaults): { filters: BoardFilters; doneWindow: DoneWindow } {
  return {
    filters: {
      query: params.query,
      workspaceIds: params.workspaceIds,
      providers: params.providers,
      labels: params.labels,
      hideSubtasks: params.hideSubtasks ?? defaults.hideSubtasks,
    },
    doneWindow: params.doneWindow ?? defaults.doneWindow,
  };
}

/**
 * The filter badge on the phone More button, the tablet Filters button, and
 * the desktop sheet's Filters button: one per selected workspace, agent and
 * label, and one for a search. The done window and subtask visibility have
 * their own controls and do not contribute.
 */
export function activeFilterCount(params: BoardParams, defaults: BoardDefaults): number {
  const { filters } = resolveBoardParams(params, defaults);
  return (
    filters.workspaceIds.length +
    filters.providers.length +
    filters.labels.length +
    (filters.query.trim() ? 1 : 0)
  );
}

export function toggleItem(list: readonly string[], item: string): string[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

/**
 * The board's state for this session, by host. The screen's props carry the
 * params it was opened with but no way to change them (the host's
 * `openScreen` pushes a new route), so the board keeps what it shows here,
 * and the sidebar entry and the Command Center open it with these params.
 * Module state lives as long as the plugin's client bundle, and a
 * reconnect evaluates the bundle again, so each change is also carried
 * (`carry.ts`) in the params' own encoding, and a host's first read after a
 * reconnect decodes it.
 */
interface HostSession {
  params: BoardParams;
  /** The phone lane picked by a tab press or a swipe; null until then. */
  lane: LaneId | null;
  collapsed: LaneId[];
  phoneTabsOffset?: number;
  phoneLaneOffsets: Partial<Record<LaneId, number>>;
}

const sessions = new Map<string, HostSession>();
let lastHost: string | null = null;
const paramsListeners = new Set<() => void>();

const isLane = (value: unknown): value is LaneId => LANE_ORDER.includes(value as LaneId);

function reviveSession(raw: unknown): HostSession {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const params = record.params && typeof record.params === "object" ? (record.params as PluginScreenParams) : null;
  return {
    params: params && !isEmptyParams(params) ? decodeBoardParams(params) : EMPTY_PARAMS,
    lane: isLane(record.lane) ? record.lane : null,
    collapsed: Array.isArray(record.collapsed) ? record.collapsed.filter(isLane) : [],
    phoneLaneOffsets: {},
  };
}

function session(hostId: string): HostSession {
  let entry = sessions.get(hostId);
  if (!entry) {
    entry = reviveSession(carriedSession(hostId));
    sessions.set(hostId, entry);
  }
  return entry;
}

function update(hostId: string, change: Partial<HostSession>): void {
  const entry = Object.assign(session(hostId), change);
  carrySession(hostId, { params: encodeBoardParams(entry.params), lane: entry.lane, collapsed: entry.collapsed });
}

export function rememberBoardParams(hostId: string, params: BoardParams): void {
  const changed = session(hostId).params !== params;
  update(hostId, { params });
  lastHost = hostId;
  if (changed) for (const listener of [...paramsListeners]) listener();
}

const clearRequests = new Map<string, number>();

// A route can be restored long after a tap. Keep the target in memory and
// consume it only when the matching route reaches the board on the same host.
const openRequests = new Map<string, { token: string; agentId: string }>();
let nextOpenRequest = 0;

export function requestBoardOpen(hostId: string, agentId: string): string {
  const token = `${Date.now()}-${++nextOpenRequest}`;
  openRequests.set(hostId, { token, agentId });
  return token;
}

export function consumeBoardOpen(hostId: string, token: string | undefined): string | undefined {
  const request = openRequests.get(hostId);
  if (!request || request.token !== token) return undefined;
  openRequests.delete(hostId);
  return request.agentId;
}

/**
 * The sidebar's hidden-task dialog asks the open board to drop its search and
 * filters. A screen's props cannot change while it is open, and cleared params
 * encode to `{}`, which the board reads as "no route" and ignores, so the
 * request travels beside the params instead.
 */
export function requestBoardClear(hostId: string): void {
  clearRequests.set(hostId, (clearRequests.get(hostId) ?? 0) + 1);
  for (const listener of [...paramsListeners]) listener();
}

/** How many times this host has been asked to clear; the board applies each new value once. */
export function boardClearCount(hostId: string): number {
  return clearRequests.get(hostId) ?? 0;
}

/** Re-runs `listener` when a board remembers new params on any host. */
export function subscribeBoardParams(listener: () => void): () => void {
  paramsListeners.add(listener);
  return () => {
    paramsListeners.delete(listener);
  };
}

/** The board's last state on this host; the most recent host's when none is given. */
export function lastBoardParams(hostId?: string | null): BoardParams {
  const id = hostId ?? lastHost;
  return id !== null ? session(id).params : EMPTY_PARAMS;
}

export function rememberLane(hostId: string, lane: LaneId): void {
  update(hostId, { lane });
}

export function rememberedLane(hostId: string): LaneId | null {
  return session(hostId).lane;
}

export function rememberPhoneTabsOffset(hostId: string, offset: number): void {
  session(hostId).phoneTabsOffset = Math.max(0, offset);
}

export function rememberedPhoneTabsOffset(hostId: string): number | undefined {
  return session(hostId).phoneTabsOffset;
}

export function rememberPhoneLaneOffset(hostId: string, lane: LaneId, offset: number): void {
  session(hostId).phoneLaneOffsets[lane] = Math.max(0, offset);
}

export function rememberedPhoneLaneOffset(hostId: string, lane: LaneId): number {
  return session(hostId).phoneLaneOffsets[lane] ?? 0;
}

export function rememberCollapsed(hostId: string, lanes: LaneId[]): void {
  update(hostId, { collapsed: lanes });
}

export function rememberedCollapsed(hostId: string): LaneId[] {
  return session(hostId).collapsed;
}

/** Tests only. */
export function resetBoardSessions(): void {
  sessions.clear();
  paramsListeners.clear();
  clearRequests.clear();
  openRequests.clear();
  lastHost = null;
  forgetCarried();
}
