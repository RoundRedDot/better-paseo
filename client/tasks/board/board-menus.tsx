import React from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { LANE_WIDTHS, type LaneWidth } from "../../../shared/tasks-settings";
import { BrandMark, ProjectIcon, TagMark, foldPath, taskTokens, tildePath } from "../cards";
import { FILTER_ICONS, type ActiveChip, type ChipGroup, type FilterOption, type ProjectOption, type ShownFilterOptions } from "./filter-options";
import type { BoardParams } from "./params";
import type { MenuItem, MenuSection } from "./menu-model";
import { NAME_KEYS, sameSort, type BoardSort, type SortDirection, type SortKey } from "./sort";
import { sortOrderLabel, type BoardStrings } from "./strings";
import { LaneWidthMark } from "./lane-width-mark";

/** The sort menu's groups, top to bottom; each field opens a submenu of its two directions. */
export const SORT_GROUPS: readonly (readonly SortKey[])[] = [
  ["workspace", "project", "branch", "folder", "title"],
  ["created", "updated"],
  ["context", "duration"],
];

export const SORT_ICONS: Readonly<Record<SortKey | "default", string>> = {
  default: "ListOrdered",
  workspace: FILTER_ICONS.workspace,
  project: FILTER_ICONS.project,
  branch: "GitBranch",
  folder: "Folder",
  title: "Type",
  created: "CalendarPlus",
  updated: "History",
  context: "Gauge",
  duration: "Timer",
};

/** A direction's icon: names A to Z down, Z to A up; amounts wide-first down, narrow-first up. */
export function sortDirectionIcon(key: SortKey, direction: SortDirection): string {
  if (NAME_KEYS.has(key)) return direction === "asc" ? "ArrowDownAZ" : "ArrowUpZA";
  return direction === "desc" ? "ArrowDownWideNarrow" : "ArrowUpNarrowWide";
}

/** A field's two directions in menu order: names A to Z first, the rest largest or newest first. */
export function sortDirections(key: SortKey): SortDirection[] {
  return NAME_KEYS.has(key) ? ["asc", "desc"] : ["desc", "asc"];
}

export function sortMenuSections(current: BoardSort | null, strings: BoardStrings, choose: (sort: BoardSort | null) => void): MenuSection[] {
  const field = (key: SortKey): MenuItem => ({
    key,
    label: strings.sortKeys[key],
    icon: SORT_ICONS[key],
    hint: current?.key === key ? sortOrderLabel(current, strings) : undefined,
    submenu: [
      {
        key: `${key}-directions`,
        items: sortDirections(key).map((direction) => {
          const sort: BoardSort = { key, direction };
          return {
            key: `${key}-${direction}`,
            label: sortOrderLabel(sort, strings),
            icon: sortDirectionIcon(key, direction),
            checked: sameSort(sort, current),
            onSelect: () => choose(sort),
          };
        }),
      },
    ],
  });
  return [
    { key: "default", items: [{ key: "default", label: strings.sortDefault, icon: SORT_ICONS.default, checked: current === null, onSelect: () => choose(null) }] },
    ...SORT_GROUPS.map((keys, index) => ({ key: `group-${index}`, items: keys.map(field) })),
  ];
}

/** The lane width menu: the three widths, the current one checked. */
export function laneWidthMenuSections(current: LaneWidth, theme: PluginTheme, strings: BoardStrings, choose: (width: LaneWidth) => void): MenuSection[] {
  return [
    {
      key: "lane-width",
      items: LANE_WIDTHS.map((width) => ({
        key: width,
        label: strings.laneWidth.names[width],
        leading: <LaneWidthMark laneWidth={width} size={16} color={theme.colors.foregroundMuted} />,
        checked: width === current,
        onSelect: () => choose(width),
      })),
    },
  ];
}

/**
 * A multi-select option as a row: its mark, the label and its count, and a
 * check at the right while it is picked, as the sort menu shows its choice.
 * Without a mark of its own, the row draws `icon`.
 */
function optionItem(option: FilterOption, toggle: (id: string) => void, mark: { leading: MenuItem["leading"] } | { icon: string }): MenuItem {
  return {
    key: option.id,
    label: option.label,
    ...mark,
    hint: String(option.count),
    checked: option.on,
    keepOpen: true,
    onSelect: () => toggle(option.id),
  };
}

function emptySection(text: string): MenuSection[] {
  return [{ key: "empty", items: [{ key: "empty", label: text, disabled: true }] }];
}

export const PROJECT_MENU_WIDTH = 300;

/**
 * The 12 pt Latin characters a project row's second line holds: the menu's
 * width less the row's insets and padding, the icon, the count, the check
 * and the gaps between them.
 */
const PROJECT_PATH_COLUMNS = Math.floor((PROJECT_MENU_WIDTH - 2 * 6 - 2 * 8 - 16 - 3 * 8 - 20 - 14) / 6);

/**
 * One row per project, its icon leading and its folder under its name, home
 * as "~" and a long middle folded to "…/" (a web Text cannot ellipsize at
 * the head or middle); a click picks or drops all its workspaces.
 */
export function projectMenuSections(options: ShownFilterOptions, strings: BoardStrings, hostId: string, toggle: (project: ProjectOption) => void): MenuSection[] {
  const projects = options.projects;
  if (projects.length === 0) return emptySection(strings.noOptions);
  return [
    {
      key: "projects",
      items: projects.map((project) => {
        const item = optionItem(project, () => toggle(project), { leading: <ProjectIcon location={project.group} size={16} hostId={hostId} /> });
        const path = project.group.projectPath;
        return path ? { ...item, detail: foldPath(tildePath(path), PROJECT_PATH_COLUMNS, 1) } : item;
      }),
    },
  ];
}

/** Workspaces under a titled group per project (Linear's section headers), not a submenu per project: one click per workspace. */
export function workspaceMenuSections(options: ShownFilterOptions, theme: PluginTheme, strings: BoardStrings, hostId: string, toggle: (id: string) => void): MenuSection[] {
  if (options.workspaceGroups.length === 0) return emptySection(strings.noOptions);
  return options.workspaceGroups.map((group) => ({
    key: group.projectId || "missing",
    title: group.projectName,
    titleLeading: group.projectId ? <ProjectIcon location={group} size={14} hostId={hostId} /> : undefined,
    items: group.items.map((item) => optionItem(item, toggle, { icon: FILTER_ICONS.workspace })),
  }));
}

export function agentMenuSections(options: ShownFilterOptions, theme: PluginTheme, strings: BoardStrings, toggle: (id: string) => void): MenuSection[] {
  if (options.agents.length === 0) return emptySection(strings.noOptions);
  const tokens = taskTokens(theme);
  return [{ key: "agents", items: options.agents.map((agent) => optionItem(agent, toggle, { leading: <BrandMark provider={agent.id} size={16} tokens={tokens} /> })) }];
}

export function labelMenuSections(options: ShownFilterOptions, theme: PluginTheme, strings: BoardStrings, toggle: (id: string) => void): MenuSection[] {
  if (options.labels.length === 0) return emptySection(strings.noOptions);
  return [
    {
      key: "labels",
      items: options.labels.map((label) =>
        optionItem(label, toggle, { leading: (fill: string) => <TagMark size={16} color={label.color ?? theme.colors.foregroundMuted} hole={fill} /> }),
      ),
    },
  ];
}

/** A folded chip row's mark: the icon of what it filters on, as the folded chip draws it. */
function chipIcon(chip: ActiveChip): string {
  if (chip.group === "workspace") return FILTER_ICONS[chip.unit ?? "workspace"];
  return FILTER_ICONS[chip.group ?? "label"];
}

/**
 * A folded chip's menu: each of its filters as a checked row that a click
 * removes (the menu stays open for the next), then one row that clears them
 * all. A workspace group says which rows are whole projects.
 */
export function chipGroupMenuSections(group: ChipGroup, theme: PluginTheme, strings: BoardStrings, apply: (change: (params: BoardParams) => BoardParams) => void): MenuSection[] {
  const mixed = new Set(group.chips.map((chip) => chip.unit)).size > 1;
  return [
    {
      key: "chips",
      items: group.chips.map((chip) => ({
        key: chip.key,
        label: chip.value,
        ...(chip.group === "label"
          ? { leading: (fill: string) => <TagMark size={16} color={chip.color ?? theme.colors.foregroundMuted} hole={fill} /> }
          : { icon: chipIcon(chip) }),
        hint: mixed ? chip.kind : undefined,
        checked: true,
        keepOpen: true,
        onSelect: () => apply(chip.clear),
      })),
    },
    { key: "clear", items: [{ key: "clear", label: strings.clearFilters, icon: "X", onSelect: () => apply(group.clear) }] },
  ];
}
