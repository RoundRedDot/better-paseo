import type { TasksHandle } from "../data";
import { fallbackLabelColor } from "../label-colors";
import { LANE_ORDER, isHistoryLane } from "../model";
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
  workspaceGroups: {
    projectId: string;
    projectName: string;
    projectKey: string | null;
    projectIcon: string | null;
    /** The project's root directory; null for the group of picked workspaces that are gone. */
    projectPath: string | null;
    items: FilterOption[];
  }[];
  agents: FilterOption[];
  labels: FilterOption[];
}

/** The filter menus' options from the data layer, with any selected id that is gone kept so it can be cleared. */
export function buildFilterOptions(tasks: TasksHandle, params: BoardParams): FilterOptions {
  const byWorkspace = new Map<string, number>();
  const byProvider = new Map<string, number>();
  const byLabel = new Map<string, number>();
  for (const lane of LANE_ORDER) {
    if (isHistoryLane(lane)) continue;
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
      group = {
        projectId: workspace.projectId,
        projectName: workspace.projectName,
        projectKey: workspace.projectKey ?? null,
        projectIcon: workspace.projectIcon ?? null,
        projectPath: workspace.projectPath ?? null,
        items: [],
      };
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
    groups.set("", { projectId: "", projectName: "—", projectKey: null, projectIcon: null, projectPath: null, items: missing.map((id) => ({ id, label: id, count: 0, on: true })) });
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
  for (const name of params.labels) if (!labels.some((label) => label.id === name)) labels.push({ id: name, label: name, color: fallbackLabelColor(name), count: 0, on: true });

  return { workspaceGroups: [...groups.values()], agents, labels };
}

/** A project as one filter option: on while every one of its workspaces is picked. */
export interface ProjectOption extends FilterOption {
  group: FilterOptions["workspaceGroups"][number];
}

/**
 * The projects to filter by. Picking one picks all its workspaces, as the
 * sidebar's project rows do, so its chip reads "Project payments-svc";
 * `count` sums its workspaces' active cards.
 */
export function projectOptions(options: FilterOptions): ProjectOption[] {
  return options.workspaceGroups
    .filter((group) => group.projectId !== "")
    .map((group) => ({
      id: group.projectId,
      label: group.projectName,
      count: group.items.reduce((sum, item) => sum + item.count, 0),
      on: group.items.length > 0 && group.items.every((item) => item.on),
      group,
    }));
}

/** Picks every workspace of the project, or drops them all when every one is already picked. */
export function toggleProject(params: BoardParams, project: ProjectOption): BoardParams {
  const ids = project.group.items.map((item) => item.id);
  const on = ids.length > 0 && ids.every((id) => params.workspaceIds.includes(id));
  return {
    ...params,
    workspaceIds: on ? params.workspaceIds.filter((id) => !ids.includes(id)) : [...params.workspaceIds, ...ids.filter((id) => !params.workspaceIds.includes(id))],
  };
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

/** The options a menu, the filter sheet or the sidebar's groups list. */
export interface ShownFilterOptions {
  workspaceGroups: FilterOptions["workspaceGroups"];
  projects: ProjectOption[];
  agents: FilterOption[];
  labels: FilterOption[];
}

/**
 * What to list of the options: every one with `board.showEmptyGroups` on;
 * off, those with an active task or picked, and a project left with none
 * drops out. Projects come from the full options, so picking one still picks
 * the workspaces that are not listed.
 */
export function shownFilterOptions(options: FilterOptions, showEmpty: boolean): ShownFilterOptions {
  const projects = projectOptions(options);
  if (showEmpty) return { workspaceGroups: options.workspaceGroups, projects, agents: options.agents, labels: options.labels };
  const busy = (option: FilterOption) => option.count > 0 || option.on;
  return {
    workspaceGroups: options.workspaceGroups.flatMap((group) => {
      const items = group.items.filter(busy);
      return items.length ? [{ ...group, items }] : [];
    }),
    projects: projects.filter(busy),
    agents: options.agents.filter(busy),
    labels: options.labels.filter(busy),
  };
}

/** An applied filter as a removable chip on the desktop filter bar. */
export interface ActiveChip {
  key: string;
  /** The muted prefix: "Workspace", "Agent", ... ; empty for a switch. */
  kind: string;
  value: string;
  clear(params: BoardParams): BoardParams;
  /** A multi-select filter's chip: several of one group fold into a `ChipGroup`. */
  group?: ChipGroupKind;
  /** A workspace chip: a whole project or workspaces in it. */
  unit?: "project" | "workspace";
  /** A label chip: the label's colour, for its tag. */
  color?: string | null;
}

export type ChipGroupKind = "workspace" | "label" | "agent";

/** What a filter picks, as the folded chips and the sidebar's groups count it. */
export type FilterUnit = "agent" | "project" | "workspace" | "label";

/** Each unit's Lucide icon, the same in the filter buttons, folded chips, chip menus and the sidebar's groups. */
export const FILTER_ICONS: Readonly<Record<FilterUnit, string>> = {
  agent: "Bot",
  project: "FolderKanban",
  workspace: "FolderGit2",
  label: "Tag",
};

/**
 * The empty groups' switch draws its state as its icon: the whole list while
 * groups without an active task show, Lucide's narrowing list while they
 * are left out.
 */
export const EMPTY_GROUPS_ICONS = { shown: "List", hidden: "ListFilter" } as const;

export function emptyGroupsIcon(showEmpty: boolean): string {
  return showEmpty ? EMPTY_GROUPS_ICONS.shown : EMPTY_GROUPS_ICONS.hidden;
}

/** Several chips of one filter as one "3 projects selected" chip; its menu lists them. */
export interface ChipGroup {
  key: `group:${ChipGroupKind}`;
  kind: ChipGroupKind;
  /** Read out: "3 projects and 1 workspace selected". */
  label: string;
  /** Drawn: an icon and a count per unit, projects before workspaces. */
  counts: { unit: FilterUnit; count: number }[];
  chips: ActiveChip[];
  clear(params: BoardParams): BoardParams;
}

export function activeChips(params: BoardParams, defaults: BoardDefaults, options: FilterOptions, strings: BoardStrings): ActiveChip[] {
  const name = (list: FilterOption[], id: string) => list.find((option) => option.id === id)?.label ?? id;
  const chips: ActiveChip[] = [
    ...params.labels.map((id) => ({
      key: `label:${id}`,
      kind: strings.labels,
      value: id,
      group: "label" as const,
      color: options.labels.find((label) => label.id === id)?.color ?? null,
      clear: (p: BoardParams) => ({ ...p, labels: toggleItem(p.labels, id) }),
    })),
    ...workspaceChips(params.workspaceIds, options, strings),
    ...params.providers.map((id) => ({
      key: `agent:${id}`,
      kind: strings.agent,
      value: name(options.agents, id),
      group: "agent" as const,
      clear: (p: BoardParams) => ({ ...p, providers: toggleItem(p.providers, id) }),
    })),
  ];
  if (params.hideSubtasks ?? defaults.hideSubtasks) chips.push({ key: "sub", kind: "", value: strings.hideSubtasks, clear: (p) => ({ ...p, hideSubtasks: false }) });
  if (params.query.trim()) chips.push({ key: "q", kind: strings.titleContains, value: `「${params.query.trim()}」`, clear: (p) => ({ ...p, query: "" }) });
  if (params.doneWindow !== null && params.doneWindow !== defaults.doneWindow) {
    chips.push({ key: "win", kind: strings.doneWindowLabel, value: strings.windows[params.doneWindow], clear: (p) => ({ ...p, doneWindow: null }) });
  }
  return chips;
}

/**
 * The filters that leave cards out, as one line: "Agent: Claude · Hide
 * subtasks". The done window is left out: it picks which cards load, and the
 * history lanes' headers name it.
 */
export function filterSummary(params: BoardParams, defaults: BoardDefaults, options: FilterOptions, strings: BoardStrings): string {
  return activeChips(params, defaults, options, strings)
    .filter((chip) => chip.key !== "win")
    .map((chip) => (chip.kind ? `${chip.kind}: ${chip.value}` : chip.value))
    .join(" \u00b7 ");
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
      chips.push({ key: `ws:${id}`, kind: strings.workspace, value: label, group: "workspace", unit: "workspace", clear: without([id]) });
      continue;
    }
    if (done.has(group.projectId)) continue;
    done.add(group.projectId);
    const picked = group.items.filter((item) => selected.includes(item.id));
    const ids = picked.map((item) => item.id);
    if (picked.length > 1 && picked.length === group.items.length) {
      chips.push({ key: `prj:${group.projectId}`, kind: strings.sidebar.groups.project, value: group.projectName, group: "workspace", unit: "project", clear: without(ids) });
    } else if (picked.length > 1) {
      chips.push({ key: `prj:${group.projectId}`, kind: strings.workspace, value: `${group.projectName} \u00b7 ${picked.length}`, group: "workspace", unit: "workspace", clear: without(ids) });
    } else {
      const item = picked[0]!;
      chips.push({
        key: `ws:${id}`,
        kind: strings.workspace,
        value: group.projectName === item.label ? item.label : `${group.projectName} / ${item.label}`,
        group: "workspace",
        unit: "workspace",
        clear: without(ids),
      });
    }
  }
  return chips;
}

/**
 * The bar's chips with each multi-select filter that has more than one chip
 * folded into a group where its first chip stood: "2 projects and 1
 * workspace selected" instead of a row of project chips.
 */
export function groupChips(chips: readonly ActiveChip[], strings: BoardStrings): (ActiveChip | ChipGroup)[] {
  const members = new Map<ChipGroupKind, ActiveChip[]>();
  for (const chip of chips) if (chip.group) members.set(chip.group, [...(members.get(chip.group) ?? []), chip]);
  const entries: (ActiveChip | ChipGroup)[] = [];
  const placed = new Set<ChipGroupKind>();
  for (const chip of chips) {
    const same = chip.group ? members.get(chip.group)! : [];
    if (!chip.group || same.length < 2) {
      entries.push(chip);
      continue;
    }
    if (placed.has(chip.group)) continue;
    placed.add(chip.group);
    const kind = chip.group;
    const group: ChipGroup = {
      key: `group:${kind}`,
      kind,
      label: groupLabel(kind, same, strings),
      counts: groupCounts(kind, same),
      chips: same,
      clear: (params) => same.reduce((next, member) => member.clear(next), params),
    };
    entries.push(group);
  }
  return entries;
}

export function isChipGroup(entry: ActiveChip | ChipGroup): entry is ChipGroup {
  return "chips" in entry;
}

function groupCounts(kind: ChipGroupKind, chips: readonly ActiveChip[]): ChipGroup["counts"] {
  if (kind !== "workspace") return [{ unit: kind, count: chips.length }];
  const projects = chips.filter((chip) => chip.unit === "project").length;
  const workspaces = chips.length - projects;
  return [...(projects ? [{ unit: "project" as const, count: projects }] : []), ...(workspaces ? [{ unit: "workspace" as const, count: workspaces }] : [])];
}

function groupLabel(kind: ChipGroupKind, chips: readonly ActiveChip[], strings: BoardStrings): string {
  const units = strings.selectedUnits;
  if (kind === "label") return strings.selected([units.label(chips.length)]);
  if (kind === "agent") return strings.selected([units.agent(chips.length)]);
  const projects = chips.filter((chip) => chip.unit === "project").length;
  const workspaces = chips.length - projects;
  return strings.selected([...(projects ? [units.project(projects)] : []), ...(workspaces ? [units.workspace(workspaces)] : [])]);
}

/** "Clear all": no selections, switches and window back to the settings. */
export function clearedParams(params: BoardParams): BoardParams {
  return { ...params, query: "", workspaceIds: [], providers: [], labels: [], hideSubtasks: null, doneWindow: null };
}
