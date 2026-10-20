import type { PluginScreenParams } from "@getpaseo/plugin/client";
import { DONE_WINDOWS, type DoneWindow } from "../../../shared/tasks-settings";
import type { BoardFilters, LaneId } from "../model";
import { decodeSort, encodeSort, type BoardSort } from "./sort";

/**
 * What the board's filter bar holds, as it travels in the screen's params.
 *
 * `hideSubtasks` and `doneWindow` start from the settings (`board.*`) and
 * only override them once someone flips them on the board; null means
 * "follow the setting", so "Clear all" returns to the settings' values.
 */
export interface BoardParams {
  query: string;
  workspaceIds: string[];
  providers: string[];
  labels: string[];
  openTabsOnly: boolean;
  hideSubtasks: boolean | null;
  doneWindow: DoneWindow | null;
  /** One order for every lane; null keeps each lane's own (the spec's). Not a filter: "Clear all" keeps it. */
  sort: BoardSort | null;
}

export const EMPTY_PARAMS: BoardParams = {
  query: "",
  workspaceIds: [],
  providers: [],
  labels: [],
  openTabsOnly: false,
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
const KEY = { query: "q", workspaceIds: "ws", providers: "agent", labels: "label", openTabsOnly: "tabs", hideSubtasks: "sub", doneWindow: "win", sort: "sort" } as const;

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
  if (params.openTabsOnly) out[KEY.openTabsOnly] = "1";
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
    openTabsOnly: read(KEY.openTabsOnly) === "1",
    hideSubtasks: sub === "1" ? true : sub === "0" ? false : null,
    doneWindow: (DONE_WINDOWS as readonly string[]).includes(win ?? "") ? (win as DoneWindow) : null,
    sort: decodeSort(read(KEY.sort)),
  };
}

/** True when the params carry no board state, so the session's last state applies. */
export function isEmptyParams(params: PluginScreenParams | null | undefined): boolean {
  return Object.keys(encodeBoardParams(decodeBoardParams(params))).length === 0;
}

/** The filters `filterLanes` takes and the done window `useTasks` takes. */
export function resolveBoardParams(params: BoardParams, defaults: BoardDefaults): { filters: BoardFilters; doneWindow: DoneWindow } {
  return {
    filters: {
      query: params.query,
      workspaceIds: params.workspaceIds,
      providers: params.providers,
      labels: params.labels,
      openTabsOnly: params.openTabsOnly,
      hideSubtasks: params.hideSubtasks ?? defaults.hideSubtasks,
    },
    doneWindow: params.doneWindow ?? defaults.doneWindow,
  };
}

/**
 * The phone's filter badge: one per selected workspace, agent and label, one
 * per switch that is on, one for a search, one for a done window off its
 * setting (prototype 6.6).
 */
export function activeFilterCount(params: BoardParams, defaults: BoardDefaults): number {
  const { filters, doneWindow } = resolveBoardParams(params, defaults);
  return (
    filters.workspaceIds.length +
    filters.providers.length +
    filters.labels.length +
    (filters.openTabsOnly ? 1 : 0) +
    (filters.hideSubtasks ? 1 : 0) +
    (filters.query.trim() ? 1 : 0) +
    (doneWindow !== defaults.doneWindow ? 1 : 0)
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
 * Module state lives as long as the plugin's client bundle: one evaluation
 * per host, kept across reconnects while the bundle is unchanged.
 */
interface HostSession {
  params: BoardParams;
  /** The phone lane picked by a tab press or a swipe; null until then. */
  lane: LaneId | null;
  collapsed: LaneId[];
}

const sessions = new Map<string, HostSession>();
let lastHost: string | null = null;

function session(hostId: string): HostSession {
  let entry = sessions.get(hostId);
  if (!entry) {
    entry = { params: EMPTY_PARAMS, lane: null, collapsed: [] };
    sessions.set(hostId, entry);
  }
  return entry;
}

export function rememberBoardParams(hostId: string, params: BoardParams): void {
  session(hostId).params = params;
  lastHost = hostId;
}

/** The board's last state on this host; the most recent host's when none is given. */
export function lastBoardParams(hostId?: string | null): BoardParams {
  const id = hostId ?? lastHost;
  return (id !== null && sessions.get(id)?.params) || EMPTY_PARAMS;
}

export function rememberLane(hostId: string, lane: LaneId): void {
  session(hostId).lane = lane;
}

export function rememberedLane(hostId: string): LaneId | null {
  return sessions.get(hostId)?.lane ?? null;
}

export function rememberCollapsed(hostId: string, lanes: LaneId[]): void {
  session(hostId).collapsed = lanes;
}

export function rememberedCollapsed(hostId: string): LaneId[] {
  return sessions.get(hostId)?.collapsed ?? [];
}

/** Tests only. */
export function resetBoardSessions(): void {
  sessions.clear();
  lastHost = null;
}
