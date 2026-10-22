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
  for (const group of groups.values()) group.items = distinctLabels(group.items, tasks.workspaces);
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

/**
 * Workspaces of one project that share a name (several worktrees on one
 * branch) get their folder after it, "fix/x · payments-svc-2"; where the
 * folders match too, the end of the id. Unique names stay as they are.
 */
export function distinctLabels(items: FilterOption[], workspaces: readonly { id: string; folder?: string | null }[]): FilterOption[] {
  const folders = new Map(workspaces.map((workspace) => [workspace.id, workspace.folder ?? null]));
  const named = new Map<string, FilterOption[]>();
  for (const item of items) named.set(item.label, [...(named.get(item.label) ?? []), item]);
  if ([...named.values()].every((same) => same.length < 2)) return items;
  return items.map((item) => {
    const same = named.get(item.label)!;
    if (same.length < 2) return item;
    const folder = folders.get(item.id);
    const folderUnique = folder && folder !== item.label && same.filter((other) => folders.get(other.id) === folder).length === 1;
    return { ...item, label: `${item.label} \u00b7 ${folderUnique ? folder : item.id.slice(-6)}` };
  });
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
  const chips: ActiveChip[] = [
    ...params.labels.map((id) => ({ key: `label:${id}`, kind: strings.labels, value: id, clear: (p: BoardParams) => ({ ...p, labels: toggleItem(p.labels, id) }) })),
    ...workspaceChips(params.workspaceIds, options, strings),
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

/**
 * The workspace selection, one chip per project: a whole project picked (the
 * sidebar's project rows pick every workspace) is "Project payments-svc", a
 * few of its workspaces "payments-svc · 3", a single one "payments-svc / fix/refund".
 * Picking a few projects whole must not fill the bar with dozens of chips.
 */
function workspaceChips(selected: readonly string[], options: FilterOptions, strings: BoardStrings): ActiveChip[] {
  const groupOf = new Map<string, FilterOptions["workspaceGroups"][number]>();
  for (const group of options.workspaceGroups) for (const item of group.items) groupOf.set(item.id, group);
  const without = (ids: readonly string[]) => (p: BoardParams) => ({ ...p, workspaceIds: p.workspaceIds.filter((id) => !ids.includes(id)) });
  const chips: ActiveChip[] = [];
  const done = new Set<string>();
  for (const id of selected) {
    const group = groupOf.get(id);
    if (!group || !group.projectId) {
      const label = group?.items.find((item) => item.id === id)?.label ?? id;
      chips.push({ key: `ws:${id}`, kind: strings.workspace, value: label, clear: without([id]) });
      continue;
    }
    if (done.has(group.projectId)) continue;
    done.add(group.projectId);
    const picked = group.items.filter((item) => selected.includes(item.id));
    const ids = picked.map((item) => item.id);
    if (picked.length > 1 && picked.length === group.items.length) {
      chips.push({ key: `prj:${group.projectId}`, kind: strings.sidebar.groups.project, value: group.projectName, clear: without(ids) });
    } else if (picked.length > 1) {
      chips.push({ key: `prj:${group.projectId}`, kind: strings.workspace, value: `${group.projectName} \u00b7 ${picked.length}`, clear: without(ids) });
    } else {
      const item = picked[0]!;
      chips.push({ key: `ws:${id}`, kind: strings.workspace, value: group.projectName === item.label ? item.label : `${group.projectName} / ${item.label}`, clear: without(ids) });
    }
  }
  return chips;
}

/** "Clear all": no selections, switches and window back to the settings. */
export function clearedParams(params: BoardParams): BoardParams {
  return { ...params, query: "", workspaceIds: [], providers: [], labels: [], openTabsOnly: false, hideSubtasks: null, doneWindow: null };
}
