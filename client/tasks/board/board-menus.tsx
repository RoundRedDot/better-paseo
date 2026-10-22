import React from "react";
import { View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { LANE_WIDTHS, type LaneWidth } from "../../../shared/tasks-settings";
import { BrandMark, taskTokens } from "../cards";
import { Checkbox, LetterAvatar } from "./board-parts";
import type { ChipGroup, FilterOption, FilterOptions } from "./filter-options";
import type { BoardParams } from "./params";
import type { MenuItem, MenuSection } from "./menu-model";
import { NAME_KEYS, sameSort, type BoardSort, type SortDirection, type SortKey } from "./sort";
import { sortOrderLabel, type BoardStrings } from "./strings";

/** The sort menu's groups, top to bottom; each field opens a submenu of its two directions. */
export const SORT_GROUPS: readonly (readonly SortKey[])[] = [
  ["workspace", "project", "branch", "folder", "title"],
  ["created", "updated"],
  ["context", "duration"],
];

export const SORT_ICONS: Readonly<Record<SortKey | "default", string>> = {
  default: "ListOrdered",
  workspace: "AppWindow",
  project: "FolderKanban",
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

const LANE_WIDTH_ICONS: Record<LaneWidth, string> = { narrow: "FoldHorizontal", default: "Columns3", wide: "UnfoldHorizontal" };

/** The lane width menu: the three widths, the current one checked. */
export function laneWidthMenuSections(current: LaneWidth, strings: BoardStrings, choose: (width: LaneWidth) => void): MenuSection[] {
  return [
    {
      key: "lane-width",
      items: LANE_WIDTHS.map((width) => ({
        key: width,
        label: strings.laneWidth.names[width],
        icon: LANE_WIDTH_ICONS[width],
        checked: width === current,
        onSelect: () => choose(width),
      })),
    },
  ];
}

/** A multi-select option as a row: its checkbox, then whatever marks it, then the label and its count. */
function optionItem(option: FilterOption, theme: PluginTheme, toggle: (id: string) => void, mark?: React.ReactNode): MenuItem {
  return {
    key: option.id,
    label: option.label,
    leading: (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Checkbox on={option.on} theme={theme} />
        {mark}
      </View>
    ),
    hint: String(option.count),
    keepOpen: true,
    onSelect: () => toggle(option.id),
  };
}

function emptySection(text: string): MenuSection[] {
  return [{ key: "empty", items: [{ key: "empty", label: text, disabled: true }] }];
}

/** Workspaces under a titled group per project (Linear's section headers), not a submenu per project: one click per workspace. */
export function workspaceMenuSections(options: FilterOptions, theme: PluginTheme, strings: BoardStrings, toggle: (id: string) => void): MenuSection[] {
  if (options.workspaceGroups.length === 0) return emptySection(strings.noOptions);
  return options.workspaceGroups.map((group) => ({
    key: group.projectId || "missing",
    title: group.projectName,
    titleLeading: <LetterAvatar name={group.projectName} theme={theme} />,
    items: group.items.map((item) => optionItem(item, theme, toggle)),
  }));
}

export function agentMenuSections(options: FilterOptions, theme: PluginTheme, strings: BoardStrings, toggle: (id: string) => void): MenuSection[] {
  if (options.agents.length === 0) return emptySection(strings.noOptions);
  const tokens = taskTokens(theme);
  return [{ key: "agents", items: options.agents.map((agent) => optionItem(agent, theme, toggle, <BrandMark provider={agent.id} size={16} tokens={tokens} />)) }];
}

export function labelMenuSections(options: FilterOptions, theme: PluginTheme, strings: BoardStrings, toggle: (id: string) => void): MenuSection[] {
  if (options.labels.length === 0) return emptySection(strings.noOptions);
  return [
    {
      key: "labels",
      items: options.labels.map((label) =>
        optionItem(label, theme, toggle, <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: label.color ?? theme.colors.foregroundMuted }} />),
      ),
    },
  ];
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
        leading: <Checkbox on theme={theme} />,
        hint: mixed ? chip.kind : undefined,
        keepOpen: true,
        onSelect: () => apply(chip.clear),
      })),
    },
    { key: "clear", items: [{ key: "clear", label: strings.clearFilters, icon: "X", onSelect: () => apply(group.clear) }] },
  ];
}
