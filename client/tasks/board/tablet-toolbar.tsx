import React, { useState, type Ref } from "react";
import { Platform, Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { DONE_WINDOWS } from "../../../shared/tasks-settings";
import { TaskText as Text, HOST_FONT as F, useTasksFontScale, taskControlHeight } from "../typography";
import { tipProps } from "../cards/card-hints";
import { HoverPressable, RollingCount, SlashMark } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { laneWidthMenuSections, sortMenuSections } from "./board-menus";
import { CascadeMenu, type MenuSection } from "./menu";
import { activeFilterCount, resolveBoardParams } from "./params";
import { emptyGroupsIcon } from "./filter-options";
import type { BoardController } from "./use-board";

type ViewPage = "view" | "sort";

/** Keep menu geometry and hit targets in sync, including nested choices. */
function touchSections(sections: MenuSection[]): MenuSection[] {
  return sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, minHeight: 44, ...(item.submenu ? { submenu: touchSections(item.submenu) } : {}) })) }));
}

/** Native tablets keep every board control in one row; the host owns the title and close action. */
export function TabletToolbar(props: {
  board: BoardController;
  theme: PluginTheme;
  width: number;
  searchRef: Ref<NativeTextInput>;
  onFilters(): void;
  sidebar: { open: boolean; onToggle(): void };
  emptyLanes: { collapsed: boolean; disabled: boolean; onToggle(): void };
}) {
  const { board, theme } = props;
  const colors = theme.colors;
  const strings = board.strings;
  const scale = useTasksFontScale();
  const target = taskControlHeight(44, scale);
  const height = taskControlHeight(56, scale);
  const labels = props.width >= 760 * Math.max(1, scale);
  const inlineSearch = props.width >= 560 * Math.max(1, scale);
  const shortcuts = props.width >= 680 * Math.max(1, scale);
  const archivedShortcut = props.width >= 440 * Math.max(1, scale);
  const [page, setPage] = useState<ViewPage | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const resolved = resolveBoardParams(board.params, board.defaults);
  const count = activeFilterCount(board.params, board.defaults);
  const textStyle = { fontSize: F.base, color: colors.foreground, fontVariant: ["tabular-nums" as const] };
  const openPage = (next: ViewPage | null) => { setTrail([]); setPage(next); };
  const close = () => { openPage(null); setSearchOpen(false); };
  const sections: MenuSection[] = page === "sort" ? [
    { key: "back", items: [{ key: "back", label: strings.back, icon: "ChevronLeft", keepOpen: true, onSelect: () => openPage("view") }] },
    ...sortMenuSections(board.params.sort, strings, (sort) => board.setParams((p) => ({ ...p, sort }))),
  ] : [
    { key: "layout", items: [
      { key: "sort", label: strings.sort, icon: "ArrowUpDown", keepOpen: true, onSelect: () => openPage("sort") },
      { key: "width", label: strings.laneWidth.label, icon: "Columns3", submenu: laneWidthMenuSections(board.laneWidth, theme, strings, board.setLaneWidth) },
      { key: "window", label: strings.doneRange, icon: "Clock", submenu: [{ key: "windows", items: DONE_WINDOWS.map((doneWindow) => ({ key: doneWindow, label: strings.windows[doneWindow], checked: resolved.doneWindow === doneWindow, onSelect: () => board.setParams((p) => ({ ...p, doneWindow })) })) }] },
    ] },
    { key: "visibility", items: [
      { key: "subtasks", label: strings.showSubtasks, icon: resolved.filters.hideSubtasks ? "List" : "Network", checked: !resolved.filters.hideSubtasks, keepOpen: true, onSelect: () => board.setParams((p) => ({ ...p, hideSubtasks: !resolved.filters.hideSubtasks })) },
      { key: "empty-lanes", label: props.emptyLanes.collapsed ? strings.emptyLanes.expand : strings.emptyLanes.collapse, icon: props.emptyLanes.collapsed ? "UnfoldHorizontal" : "FoldHorizontal", checked: props.emptyLanes.collapsed, disabled: props.emptyLanes.disabled, keepOpen: true, onSelect: props.emptyLanes.onToggle },
      { key: "empty-groups", label: strings.emptyGroups.row, icon: emptyGroupsIcon(board.showEmptyGroups), checked: board.showEmptyGroups, keepOpen: true, onSelect: () => board.setShowEmptyGroups(!board.showEmptyGroups) },
      { key: "archived", label: strings.archivedLane.row, icon: "Archive", checked: board.showArchived, keepOpen: true, onSelect: () => board.setShowArchived(!board.showArchived) },
      { key: "sidebar", label: props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show, icon: "PanelRight", checked: props.sidebar.open, onSelect: props.sidebar.onToggle },
    ] },
  ];
  // Touch drill-down stays inside the same panel, including in iPad split view.
  const level = trail.reduce((current, key) => current.flatMap((section) => section.items).find((item) => item.key === key)?.submenu ?? current, sections);
  const visibleSections: MenuSection[] = [
    ...(trail.length ? [{ key: "back", items: [{ key: "back", label: strings.back, icon: "ChevronLeft", keepOpen: true, onSelect: () => setTrail(trail.slice(0, -1)) }] }] : []),
    ...level.map((section) => ({ ...section, items: section.items.map((item) => item.submenu ? { ...item, submenu: undefined, hint: "›", keepOpen: true, onSelect: () => setTrail([...trail, item.key]) } : item) })),
  ];
  const search = (
    <View testID="tablet-toolbar-search" style={{ flex: 1, minWidth: 0, maxWidth: inlineSearch ? 320 : undefined, height: target, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 7, borderWidth: HAIRLINE, borderColor: searchFocused ? colors.foregroundMuted : colors.border, backgroundColor: colors.surface0 }}>
      <Icon name="Search" size={16} color={colors.foregroundMuted} />
      <TextInput
        ref={props.searchRef}
        value={board.params.query}
        onChangeText={(query) => board.setParams((p) => ({ ...p, query }))}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        placeholder={strings.search}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={strings.search}
        autoFocus={!inlineSearch}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        style={{ flex: 1, minWidth: 0, padding: 0, fontSize: Math.max(16, Math.round(F.base * scale)), color: colors.foreground }}
      />
      {board.params.query ? <ToolbarButton icon="X" label={strings.menuSearch.clear} theme={theme} onPress={() => board.setParams((p) => ({ ...p, query: "" }))} testID="tablet-search-clear" /> : null}
    </View>
  );
  return (
    <>
      {page || (searchOpen && !inlineSearch) ? <Pressable accessibilityLabel={strings.closeMenu} testID="tablet-toolbar-backdrop" onPress={close} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 9 }} /> : null}
      <View pointerEvents="box-none" testID="tablet-toolbar" style={{ height, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border, zIndex: 10 }}>
        <View accessible accessibilityLabel={strings.total(board.total)} testID="tablet-toolbar-total" style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {archivedShortcut ? <Text numberOfLines={1} style={{ fontSize: F.base, fontWeight: "600", color: colors.foreground }}>{strings.name}</Text> : null}
          <View testID="tablet-total-slot" style={{ flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
            {/* The same font measures three tabular digits; live counts stay out of layout. */}
            <Text testID="tablet-total-reserve" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" numberOfLines={1} style={[textStyle, { opacity: 0 }]}>{"8".repeat(Math.max(3, String(board.total).length))}</Text>
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center" }}>
              {Platform.OS === "web" ? <RollingCount value={board.total} scope={board.scope} align="center" style={textStyle} /> : <Text numberOfLines={1} style={textStyle}>{board.total}</Text>}
            </View>
          </View>
        </View>
        {inlineSearch ? search : <ToolbarButton icon="Search" label={strings.searchButton} selected={searchOpen || !!board.params.query} theme={theme} testID="tablet-search-toggle" onPress={() => { setPage(null); setSearchOpen(!searchOpen); }} />}
        <View pointerEvents="none" style={{ flex: 1 }} />
        <ToolbarButton icon="ListFilter" label={strings.filters} showLabel={labels} badge={count} theme={theme} testID="toolbar-filters" onPress={() => { close(); props.onFilters(); }} />
        {shortcuts ? <ToolbarButton icon={resolved.filters.hideSubtasks ? "List" : "Network"} label={strings.showSubtasks} selected={!resolved.filters.hideSubtasks} theme={theme} testID="subtasks-toggle" onPress={() => board.setParams((p) => ({ ...p, hideSubtasks: !resolved.filters.hideSubtasks }))} /> : null}
        <View pointerEvents="box-none" style={{ zIndex: 20 }}>
          <ToolbarButton icon="SlidersHorizontal" label={strings.view} showLabel={labels} expanded={page !== null} theme={theme} testID="tablet-view" onPress={() => { setSearchOpen(false); openPage(page ? null : "view"); }} />
          {page ? <CascadeMenu key={`${page}:${trail.join("/")}`} sections={touchSections(visibleSections)} theme={theme} width={Math.min(300, Math.max(240, props.width - 24))} top={target + 6} align="right" onClose={() => openPage(null)} testID="tablet-view-menu" /> : null}
        </View>
        {shortcuts ? <View style={{ width: HAIRLINE, height: 18, backgroundColor: colors.border, marginHorizontal: 2 }} /> : null}
        {archivedShortcut ? <ToolbarButton icon="Archive" label={strings.archivedLane.row} selected={board.showArchived} slashed={!board.showArchived} theme={theme} testID="toolbar-archived" onPress={() => board.setShowArchived(!board.showArchived)} /> : null}
        {shortcuts ? <ToolbarButton icon="PanelRight" label={props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show} selected={props.sidebar.open} theme={theme} testID="sidebar-switch" onPress={props.sidebar.onToggle} /> : null}
        {searchOpen && !inlineSearch ? <View testID="tablet-search-popover" style={{ position: "absolute", top: height, left: 0, right: 0, padding: 8, backgroundColor: colors.surface0, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>{search}</View> : null}
      </View>
    </>
  );
}

function ToolbarButton(props: { icon: string; label: string; theme: PluginTheme; onPress(): void; testID: string; showLabel?: boolean; selected?: boolean; expanded?: boolean; badge?: number; slashed?: boolean }) {
  const colors = props.theme.colors;
  const target = taskControlHeight(44, useTasksFontScale());
  return (
    <HoverPressable accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={{ ...(props.selected === undefined ? {} : { selected: props.selected }), ...(props.expanded === undefined ? {} : { expanded: props.expanded }) }} {...tipProps(props.label)} onPress={props.onPress} testID={props.testID} style={(hovered) => ({ minWidth: target, height: target, flexShrink: 0, paddingHorizontal: props.showLabel ? 10 : 0, borderRadius: 7, backgroundColor: hovered || props.expanded || props.selected ? colors.surface1 : "transparent", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 })}>
      <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
        <Icon name={props.icon} size={18} color={colors.foreground} />
        {props.slashed ? <SlashMark size={18} color={colors.foreground} gap={colors.surface0} /> : null}
      </View>
      {props.showLabel ? <Text numberOfLines={1} style={{ fontSize: F.base, fontWeight: "500", color: colors.foreground }}>{props.label}</Text> : null}
      {props.badge ? <Text testID="tablet-filter-count" style={{ fontSize: F.sm, fontVariant: ["tabular-nums"], color: colors.foregroundMuted }}>{props.badge}</Text> : null}
    </HoverPressable>
  );
}
