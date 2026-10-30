import React, { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View, type LayoutRectangle, type TextInput as NativeTextInput } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { DONE_WINDOWS } from "../../../shared/tasks-settings";
import { TaskText as Text, HOST_FONT as F, useTasksFontScale, taskControlHeight } from "../typography";
import { tipProps } from "../cards/card-hints";
import { taskTokens } from "../cards/tokens";
import { CornerBadge, HoverPressable, RollingTotal, SlashMark } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { laneWidthMenuSections, sortMenuSections } from "./board-menus";
import { CascadeMenu, type MenuSection } from "./menu";
import { menuChrome, menuWidth } from "./menu-model";
import { activeFilterCount, resolveBoardParams } from "./params";
import type { BoardController } from "./use-board";
import { FullConversationSwitch, SearchInput } from "./search-loading";
import { SearchCoverageItems } from "./search-coverage";
import { SearchQueryChip } from "./filter-bar";

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
  filters?: { content: ReactNode; height: number; onClose(): void };
  sidebar: { open: boolean; onToggle(): void };
  emptyLanes: { collapsed: boolean; disabled: boolean; onToggle(): void };
}) {
  const { board, theme } = props;
  const colors = theme.colors;
  const strings = board.strings;
  const scale = useTasksFontScale();
  const compact = props.width < 680 * Math.max(1, scale);
  const target = taskControlHeight(compact ? 28 : 44, scale);
  const height = taskControlHeight(compact ? 36 : 56, scale);
  const labels = props.width >= 1000 * Math.max(1, scale);
  const inlineSearch = Platform.OS !== "ios" && props.width >= 560 * Math.max(1, scale);
  const shortcuts = props.width >= 680 * Math.max(1, scale);
  const [page, setPage] = useState<ViewPage | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searching = Boolean(board.params.query.trim());
  const expandedSearch = searchOpen && !inlineSearch;
  const [toolbarWidth, setToolbarWidth] = useState<number | null>(null);
  const [actionLayout, setActionLayout] = useState<LayoutRectangle | null>(null);
  const [viewLayout, setViewLayout] = useState<LayoutRectangle | null>(null);
  const actionWidth = actionLayout?.width ?? 0;
  // Three buttons at the right: filters, view and the sidebar, or on a board too narrow for the sidebar's, the subtasks switch first. The other switches live in the view menu.
  const minimumActionsWidth = 3 * target + 2 * 6;
  const separateFilters = compact || actionWidth === 0 || actionWidth >= 2 * target + 6;
  const menuAnchor = toolbarWidth !== null && actionLayout && viewLayout ? {
    right: toolbarWidth - actionLayout.x - viewLayout.x - viewLayout.width,
    top: actionLayout.y + viewLayout.y + target + 6,
  } : null;
  const resolved = resolveBoardParams(board.params, board.defaults);
  const count = activeFilterCount(board.params, board.defaults);
  const textStyle = { fontSize: F.base, fontWeight: "600" as const, color: colors.foreground, fontVariant: ["tabular-nums" as const] };
  const openPage = (next: ViewPage | null) => { setTrail([]); setPage(next); };
  const close = () => { openPage(null); setSearchOpen(false); props.filters?.onClose(); };
  const sections: MenuSection[] = page === "sort" ? [
    { key: "back", items: [{ key: "back", label: strings.back, icon: "ChevronLeft", keepOpen: true, onSelect: () => openPage("view") }] },
    ...sortMenuSections(board.params.sort, strings, (sort) => board.setParams((p) => ({ ...p, sort }))),
  ] : [
    { key: "layout", items: [
      ...(!separateFilters ? [{ key: "filters", label: strings.filters, icon: "ListFilter", onSelect: () => { close(); props.onFilters(); } }] : []),
      { key: "sort", label: strings.sort, icon: "ArrowUpDown", hint: "›", keepOpen: true, onSelect: () => openPage("sort") },
      { key: "width", label: strings.laneWidth.label, icon: "Columns3", submenu: laneWidthMenuSections(board.laneWidth, theme, strings, board.setLaneWidth) },
      { key: "window", label: strings.doneRange, icon: "Clock", submenu: [{ key: "windows", items: DONE_WINDOWS.map((doneWindow) => ({ key: doneWindow, label: strings.windows[doneWindow], checked: resolved.doneWindow === doneWindow, onSelect: () => board.setParams((p) => ({ ...p, doneWindow })) })) }] },
    ] },
    { key: "visibility", items: [
      { key: "empty-lanes", label: props.emptyLanes.collapsed ? strings.emptyLanes.expand : strings.emptyLanes.collapse, icon: props.emptyLanes.collapsed ? "UnfoldHorizontal" : "FoldHorizontal", checked: props.emptyLanes.collapsed, disabled: props.emptyLanes.disabled, keepOpen: true, onSelect: props.emptyLanes.onToggle },
      { key: "subtasks", label: strings.showSubtasks, icon: resolved.filters.hideSubtasks ? "List" : "Network", checked: !resolved.filters.hideSubtasks, keepOpen: true, onSelect: () => board.setParams((p) => ({ ...p, hideSubtasks: !resolved.filters.hideSubtasks })) },
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
    <View testID="tablet-toolbar-search-group" style={{ flex: 1, minWidth: 0, maxWidth: inlineSearch ? 400 : undefined, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <View testID="tablet-toolbar-search" style={{ flex: 1, minWidth: 0, height: target, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderRadius: 7, borderWidth: HAIRLINE, borderColor: searchFocused ? colors.foregroundMuted : colors.border, backgroundColor: colors.surface0 }}>
      <SearchInput iconSize={16} iconColor={colors.foregroundMuted}
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
        style={{ flex: 1, minWidth: 0, padding: 0, fontSize: compact ? Math.round(F.sm * scale) : Math.max(16, Math.round(F.base * scale)), color: colors.foreground }}
      />
      {board.params.query ? <ToolbarButton compact={compact} icon="X" label={strings.menuSearch.clear} theme={theme} onPress={() => board.setParams((p) => ({ ...p, query: "" }))} testID="tablet-search-clear" /> : null}
    </View>
    <FullConversationSwitch theme={theme} />
    </View>
  );
  return (
    <>
      {page || props.filters || (searchOpen && !inlineSearch) ? <Pressable accessibilityLabel={strings.closeMenu} testID="tablet-toolbar-backdrop" onPress={close} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 9 }} /> : null}
      <View pointerEvents="box-none" testID="tablet-toolbar" onLayout={(event) => setToolbarWidth(event.nativeEvent.layout.width)} style={{ height, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border, zIndex: 10 }}>
        {/* Match both side slots' minimums: native flex otherwise shifts the title towards the search. */}
        <View testID="tablet-toolbar-start" style={{ flex: 1, flexBasis: 0, minWidth: inlineSearch && searching ? 160 : compact && !expandedSearch ? minimumActionsWidth : 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
          {inlineSearch ? search : <ToolbarButton compact={compact} icon="Search" label={strings.searchButton} selected={searchOpen || !!board.params.query} theme={theme} testID="tablet-search-toggle" onPress={() => { props.filters?.onClose(); setPage(null); setSearchOpen(!searchOpen); }} />}
          {expandedSearch ? search : null}
        </View>
        <SearchQueryChip board={board} theme={theme} />
        <SearchCoverageItems theme={theme} />
        {expandedSearch ? null : <View accessible accessibilityLabel={strings.total(board.total)} testID="tablet-toolbar-total" style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <View testID="tablet-total-slot" style={{ flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
            {/* Reserve the complete localised phrase, so count changes never move the search. */}
            <Text testID="tablet-total-reserve" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" numberOfLines={1} style={[textStyle, { opacity: 0 }]}>{strings.total(Number("8".repeat(Math.max(3, String(board.total).length))))}</Text>
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, alignItems: "center" }}>
              <RollingTotal board={board} style={textStyle} />
            </View>
          </View>
        </View>}
        <View testID="tablet-toolbar-end" pointerEvents="box-none" onLayout={(event) => setActionLayout(event.nativeEvent.layout)} style={{ flex: expandedSearch || searching ? 0 : 1, flexBasis: expandedSearch || searching ? "auto" : 0, minWidth: compact ? minimumActionsWidth : 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
        {shortcuts ? null : <ToolbarButton compact={compact} icon={resolved.filters.hideSubtasks ? "List" : "Network"} label={strings.showSubtasks} selected={!resolved.filters.hideSubtasks} badge={board.hiddenSubtasks} badgeTestID="subtasks-toggle-count" theme={theme} testID="subtasks-toggle" onPress={() => board.setParams((p) => ({ ...p, hideSubtasks: !resolved.filters.hideSubtasks }))} />}
        {separateFilters ? <ToolbarButton compact={compact} icon="ListFilter" label={strings.filters} showLabel={labels} badge={count} expanded={Boolean(props.filters)} theme={theme} testID="toolbar-filters" onPress={() => { close(); if (!props.filters) props.onFilters(); }} /> : null}
        <View pointerEvents="box-none" onLayout={(event) => setViewLayout(event.nativeEvent.layout)} style={{ zIndex: 20 }}>
          <ToolbarButton compact={compact} icon="SlidersHorizontal" label={strings.view} showLabel={labels} badge={separateFilters ? undefined : count} expanded={page !== null} theme={theme} testID="tablet-view" onPress={() => { props.filters?.onClose(); setSearchOpen(false); openPage(page ? null : "view"); }} />
        </View>
        {shortcuts ? <View style={{ width: HAIRLINE, height: 18, backgroundColor: colors.border, marginHorizontal: 2 }} /> : null}
        {shortcuts ? <ToolbarButton compact={compact} icon="PanelRight" label={props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show} selected={props.sidebar.open} theme={theme} testID="sidebar-switch" onPress={props.sidebar.onToggle} /> : null}
        </View>
      </View>
      {props.filters ? (
        <View testID="tablet-filter-popover" accessibilityViewIsModal onAccessibilityEscape={props.filters.onClose} style={{ position: "absolute", top: height + 6, right: 12, width: menuWidth(480, scale, props.width - 24), height: Math.min(640 * Math.max(1, scale), Math.max(0, props.filters.height - 18)), borderRadius: 12, borderWidth: HAIRLINE, borderColor: colors.border, backgroundColor: colors.surface1, boxShadow: menuChrome(theme).shadow, paddingBottom: 16, overflow: "hidden", zIndex: 30 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: taskControlHeight(48, scale), borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>
            <Text accessibilityRole="header" style={{ flex: 1, fontSize: F.base, fontWeight: "600", color: colors.foreground }}>{strings.filters}</Text>
            <ToolbarButton compact={compact} icon="X" label={strings.closeMenu} theme={theme} testID="tablet-filter-close" onPress={props.filters.onClose} />
          </View>
          {props.filters.content}
        </View>
      ) : null}
      {page && menuAnchor ? (
        // Keep Android AX bounds inside a board-height parent instead of the short toolbar.
        <View pointerEvents="box-none" testID="tablet-view-overlay" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: menuAnchor.right, zIndex: 30 }}>
          <CascadeMenu key={`${page}:${trail.join("/")}`} sections={touchSections(visibleSections)} theme={theme} width={menuWidth(220, scale, props.width - 24)} top={menuAnchor.top} align="right" onClose={() => openPage(null)} testID="tablet-view-menu" />
        </View>
      ) : null}
    </>
  );
}

function ToolbarButton(props: { icon: string; label: string; theme: PluginTheme; onPress(): void; testID: string; showLabel?: boolean; selected?: boolean; expanded?: boolean; badge?: number; badgeTestID?: string; slashed?: boolean; compact?: boolean }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const target = taskControlHeight(props.compact ? 28 : 44, scale);
  const iconSize = props.compact ? 16 : 18;
  return (
    <HoverPressable accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={{ ...(props.selected === undefined ? {} : { selected: props.selected }), ...(props.expanded === undefined ? {} : { expanded: props.expanded }) }} {...tipProps(props.label)} onPress={props.onPress} testID={props.testID} style={(hovered) => ({ minWidth: target, height: target, flexShrink: 0, paddingHorizontal: props.showLabel ? 10 : 0, borderRadius: 7, backgroundColor: hovered || props.expanded || props.selected ? colors.surface1 : "transparent", boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 })}>
      <View style={{ width: iconSize, height: iconSize, alignItems: "center", justifyContent: "center" }}>
        <Icon name={props.icon} size={iconSize} color={colors.foreground} />
        {props.slashed ? <SlashMark size={iconSize} color={colors.foreground} gap={colors.surface0} /> : null}
        <CornerBadge count={props.badge ?? 0} theme={props.theme} style={{ bottom: -4, right: -4 }} testID={props.badgeTestID ?? "tablet-filter-count"} />
      </View>
      {props.showLabel ? <Text numberOfLines={1} style={{ fontSize: F.base, fontWeight: "500", color: colors.foreground }}>{props.label}</Text> : null}
    </HoverPressable>
  );
}
