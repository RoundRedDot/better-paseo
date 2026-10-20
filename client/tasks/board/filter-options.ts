import type { TasksHandle } from "../data";
import { LANE_ORDER } from "../model";
import { toggleItem, type BoardDefaults, type BoardParams } from "./params";
import type { BoardStrings } from "./strings";

/** One choice in a filter menu or the phone sheet; `count` counts active (not done) cards. */
export interface FilterOption {
  id: string;
  label: string;
  count: number;
  on: boolean;
  /** Labels: the dot colour; null for a neutral dot. */
  color?: string | null;
}

export interface FilterOptions {
  workspaceGroups: { projectId: string; projectName: string; items: FilterOption[] }[];
  agents: FilterOption[];
  labels: FilterOption[];
}

/** The filter menus' options from the data layer, with any selected id that is gone kept so it can be cleared. */
export function buildFilterOptions(tasks: TasksHandle, params: BoardParams): FilterOptions {
  const byWorkspace = new Map<string, number>();
  const byProvider = new Map<string, number>();
  const byLabel = new Map<string, number>();
  for (const lane of LANE_ORDER) {
    if (lane === "done") continue;
    for (const card of tasks.lanes[lane].cards) {
      const workspaceId = card.location.workspaceId;
      if (workspaceId) byWorkspace.set(workspaceId, (byWorkspace.get(workspaceId) ?? 0) + 1);
      byProvider.set(card.provider, (byProvider.get(card.provider) ?? 0) + 1);
      for (const label of card.labels) byLabel.set(label.name, (byLabel.get(label.name) ?? 0) + 1);
    }
  }

  const groups = new Map<string, FilterOptions["workspaceGroups"][number]>();
  for (const workspace of tasks.workspaces) {
    let group = groups.get(workspace.projectId);
    if (!group) {
      group = { projectId: workspace.projectId, projectName: workspace.projectName, items: [] };
      groups.set(workspace.projectId, group);
    }
    group.items.push({
      id: workspace.id,
      label: workspace.name,
      count: byWorkspace.get(workspace.id) ?? 0,
      on: params.workspaceIds.includes(workspace.id),
    });
  }
  const known = new Set(tasks.workspaces.map((workspace) => workspace.id));
  const missing = params.workspaceIds.filter((id) => !known.has(id));
  if (missing.length) {
    groups.set("", { projectId: "", projectName: "—", items: missing.map((id) => ({ id, label: id, count: 0, on: true })) });
  }

  const agents: FilterOption[] = tasks.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    count: byProvider.get(provider.id) ?? 0,
    on: params.providers.includes(provider.id),
  }));
  for (const id of params.providers) if (!agents.some((agent) => agent.id === id)) agents.push({ id, label: id, count: 0, on: true });

  const labels: FilterOption[] = tasks.labels.map((label) => ({
    id: label.name,
    label: label.name,
    color: label.color,
    count: byLabel.get(label.name) ?? 0,
    on: params.labels.includes(label.name),
  }));
  for (const name of params.labels) if (!labels.some((label) => label.id === name)) labels.push({ id: name, label: name, color: null, count: 0, on: true });

  return { workspaceGroups: [...groups.values()], agents, labels };
}

/** An applied filter as a removable chip on the desktop filter bar. */
export interface ActiveChip {
  key: string;
  /** The muted prefix: "Workspace", "Agent", ... ; empty for a switch. */
  kind: string;
  value: string;
  clear(params: BoardParams): BoardParams;
}

export function activeChips(params: BoardParams, defaults: BoardDefaults, options: FilterOptions, strings: BoardStrings): ActiveChip[] {
  const name = (list: FilterOption[], id: string) => list.find((option) => option.id === id)?.label ?? id;
  const workspaces = options.workspaceGroups.flatMap((group) =>
    group.items.map((item) => ({ ...item, label: group.projectName === item.label || !group.projectId ? item.label : `${group.projectName} / ${item.label}` })),
  );
  const chips: ActiveChip[] = [
    ...params.labels.map((id) => ({ key: `label:${id}`, kind: strings.labels, value: id, clear: (p: BoardParams) => ({ ...p, labels: toggleItem(p.labels, id) }) })),
    ...params.workspaceIds.map((id) => ({
      key: `ws:${id}`,
      kind: strings.workspace,
      value: name(workspaces, id),
      clear: (p: BoardParams) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, id) }),
    })),
    ...params.providers.map((id) => ({
      key: `agent:${id}`,
      kind: strings.agent,
      value: name(options.agents, id),
      clear: (p: BoardParams) => ({ ...p, providers: toggleItem(p.providers, id) }),
    })),
  ];
  if (params.openTabsOnly) chips.push({ key: "tabs", kind: "", value: strings.openTabs, clear: (p) => ({ ...p, openTabsOnly: false }) });
  if (params.hideSubtasks ?? defaults.hideSubtasks) chips.push({ key: "sub", kind: "", value: strings.hideSubtasks, clear: (p) => ({ ...p, hideSubtasks: false }) });
  if (params.query.trim()) chips.push({ key: "q", kind: strings.titleContains, value: `「${params.query.trim()}」`, clear: (p) => ({ ...p, query: "" }) });
  if (params.doneWindow !== null && params.doneWindow !== defaults.doneWindow) {
    chips.push({ key: "win", kind: strings.doneWindowLabel, value: strings.windows[params.doneWindow], clear: (p) => ({ ...p, doneWindow: null }) });
  }
  return chips;
}

/** "Clear all": no selections, switches and window back to the settings. */
export function clearedParams(params: BoardParams): BoardParams {
  return { ...params, query: "", workspaceIds: [], providers: [], labels: [], openTabsOnly: false, hideSubtasks: null, doneWindow: null };
}
