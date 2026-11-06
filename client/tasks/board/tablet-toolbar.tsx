import React, { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View, type LayoutRectangle, type TextInput as NativeTextInput } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, useTasksFontScale, taskControlHeight } from "../typography";
import { tipProps } from "../cards/card-hints";
import { taskTokens } from "../cards/tokens";
import { surfaceLift } from "../cards/surface-lift";
import { CornerBadge, HoverPressable, RollingTotal, SlashMark } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { laneWidthMenuSections, sortMenuSections } from "./board-menus";
import { CascadeMenu, type MenuSection } from "./menu";
import { menuChrome, menuWidth } from "./menu-model";
import { activeFilterCount, resolveBoardParams } from "./params";
import type { BoardController } from "./use-board";
import { FullConversationSwitch, SearchInput } from "./search-loading";
import { SearchCoverageItems } from "./search-coverage";
import { PanelMark, SearchQueryChip } from "./filter-bar";
import { emptyGroupsIcon } from "./filter-options";

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
  const target = taskControlHeight(40, scale);
  const height = taskControlHeight(48, scale);
  const inlineSearch = Platform.OS === "web" && props.width >= 560 * Math.max(1, scale);
  const [page, setPage] = useState<ViewPage | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searching = Boolean(board.params.query.trim());
  const expandedSearch = searchOpen && !inlineSearch;
  const [toolbarWidth, setToolbarWidth] = useState<number | null>(null);
  const [actionLayout, setActionLayout] = useState<LayoutRectangle | null>(null);
  const [viewLayout, setViewLayout] = useState<LayoutRectangle | null>(null);
  const [filterLayout, setFilterLayout] = useState<LayoutRectangle | null>(null);
  const actionWidth = actionLayout?.width ?? 0;
  // Keep the subtask shortcut visible alongside filters and view on narrow boards.
  const minimumActionsWidth = 4 * target;
  // Narrow split views cannot fit a centered count between two equally wide slots.
  const centered = props.width >= 2 * minimumActionsWidth + taskControlHeight(120, scale);
  const separateFilters = compact || actionWidth === 0 || actionWidth >= 2 * target;
  const menuAnchor = toolbarWidth !== null && actionLayout && viewLayout ? {
    right: toolbarWidth - actionLayout.x - viewLayout.x - viewLayout.width,
    top: actionLayout.y + viewLayout.y + target + 6,
  } : null;
  const filterAnchor = separateFilters ? filterLayout : viewLayout;
  const filterRight = toolbarWidth !== null && actionLayout && filterAnchor
    ? Math.min(props.width - menuWidth(320, scale, props.width - 24) - 12, Math.max(12, toolbarWidth - actionLayout.x - filterAnchor.x - filterAnchor.width))
    : 12;
  const resolved = resolveBoardParams(board.params, board.defaults);
  const count = activeFilterCount(board.params, board.defaults);
  const textStyle = { fontSize: F.base, fontWeight: "600" as const, color: colors.foreground, fontVariant: ["tabular-nums" as const] };
  const openPage = (next: ViewPage | null) => { setTrail([]); setPage(next); };
  const closeEmptySearch = () => { if (!board.params.query) setSearchOpen(false); };
  const close = () => { openPage(null); closeEmptySearch(); props.filters?.onClose(); };
  const sections: MenuSection[] = page === "sort" ? [
    { key: "back", items: [{ key: "back", label: strings.back, icon: "ChevronLeft", keepOpen: true, onSelect: () => openPage("view") }] },
    ...sortMenuSections(board.params.sort, strings, (sort) => board.setParams((p) => ({ ...p, sort }))),
  ] : [
    { key: "layout", items: [
      ...(!separateFilters ? [{ key: "filters", label: strings.filters, icon: "ListFilter", onSelect: () => { close(); props.onFilters(); } }] : []),
      { key: "sort", label: strings.sort, icon: "ArrowUpDown", hint: "›", keepOpen: true, onSelect: () => openPage("sort") },
      { key: "width", label: strings.laneWidth.label, icon: "Columns3", submenu: laneWidthMenuSections(board.laneWidth, theme, strings, board.setLaneWidth) },
    ] },
    { key: "visibility", items: [
      { key: "subtasks", label: strings.showSubtasks, icon: resolved.filters.hideSubtasks ? "List" : "Network", checked: !resolved.filters.hideSubtasks, keepOpen: true, onSelect: () => board.setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? board.defaults.hideSubtasks) })) },
      { key: "empty-groups", label: strings.emptyGroups.row, icon: emptyGroupsIcon(board.showEmptyGroups), checked: board.showEmptyGroups, keepOpen: true, onSelect: () => board.setShowEmptyGroups(!board.showEmptyGroups) },
      { key: "empty-lanes", label: props.emptyLanes.collapsed ? strings.emptyLanes.expand : strings.emptyLanes.collapse, icon: props.emptyLanes.collapsed ? "UnfoldHorizontal" : "FoldHorizontal", checked: props.emptyLanes.collapsed, disabled: props.emptyLanes.disabled, keepOpen: true, onSelect: props.emptyLanes.onToggle },
      { key: "archived", label: strings.archivedLane.row, icon: "Archive", checked: board.showArchived, keepOpen: true, onSelect: () => board.setShowArchived(!board.showArchived) },
    ] },
  ];
  // Touch drill-down stays inside the same panel, including in iPad split view.
  const level = trail.reduce((current, key) => current.flatMap((section) => section.items).find((item) => item.key === key)?.submenu ?? current, sections);
  const visibleSections: MenuSection[] = [
    ...(trail.length ? [{ key: "back", items: [{ key: "back", label: strings.back, icon: "ChevronLeft", keepOpen: true, onSelect: () => setTrail(trail.slice(0, -1)) }] }] : []),
    ...level.map((section) => ({ ...section, items: section.items.map((item) => item.submenu ? { ...item, submenu: undefined, hint: "›", keepOpen: true, onSelect: () => setTrail([...trail, item.key]) } : item) })),
  ];
  const search = (
    <View testID="tablet-toolbar-search-group" style={{ flex: 1, minWidth: 0, maxWidth: inlineSearch ? 400 : taskControlHeight(238, scale), flexDirection: "row", alignItems: "center", gap: 8 }}>
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
      {board.params.query ? <ToolbarButton icon="X" label={strings.menuSearch.clear} theme={theme} onPress={() => board.setParams((p) => ({ ...p, query: "" }))} testID="tablet-search-clear" /> : null}
    </View>
    <FullConversationSwitch theme={theme} iconSize={18} />
    </View>
  );
  return (
    <>
      {page || props.filters || (searchOpen && !inlineSearch && !board.params.query) ? <Pressable accessibilityLabel={strings.closeMenu} testID="tablet-toolbar-backdrop" onPress={close} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 9 }} /> : null}
      <View pointerEvents="box-none" testID="tablet-toolbar" onLayout={(event) => setToolbarWidth(event.nativeEvent.layout.width)} style={{ height, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border, zIndex: 10 }}>
        {/* Match both side slots' minimums: native flex otherwise shifts the title towards the search. */}
        <View testID="tablet-toolbar-start" style={{ flex: 1, flexBasis: 0, minWidth: inlineSearch && searching ? 160 : compact && centered && !expandedSearch ? minimumActionsWidth : 0, marginLeft: -8, marginRight: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
          {inlineSearch ? search : <ToolbarButton icon="Search" label={strings.searchButton} selected={searchOpen || !!board.params.query} theme={theme} testID="tablet-search-toggle" onPress={() => { props.filters?.onClose(); setPage(null); setSearchOpen(!searchOpen); }} />}
          {expandedSearch ? search : null}
        </View>
        {expandedSearch ? null : <SearchQueryChip board={board} theme={theme} />}
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
        <View testID="tablet-toolbar-end" pointerEvents="box-none" onLayout={(event) => setActionLayout(event.nativeEvent.layout)} style={{ flex: expandedSearch || searching || !centered ? 0 : 1, flexBasis: expandedSearch || searching || !centered ? "auto" : 0, minWidth: compact && centered ? minimumActionsWidth : 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
        <ToolbarButton icon={resolved.filters.hideSubtasks ? "List" : "Network"} label={strings.showSubtasks} selected={!resolved.filters.hideSubtasks} hideSelectedBackground badge={board.hiddenSubtasks} badgeTestID="subtasks-toggle-count" theme={theme} testID="subtasks-toggle" onPress={() => { closeEmptySearch(); board.setParams((p) => ({ ...p, hideSubtasks: !resolved.filters.hideSubtasks })); }} />
        {separateFilters ? <View testID="tablet-filter-anchor" onLayout={(event) => setFilterLayout(event.nativeEvent.layout)}><ToolbarButton icon="Filter" label={strings.filters} badge={count} expanded={Boolean(props.filters)} theme={theme} testID="toolbar-filters" onPress={() => { close(); if (!props.filters) props.onFilters(); }} /></View> : null}
        <View pointerEvents="box-none" onLayout={(event) => setViewLayout(event.nativeEvent.layout)} style={{ zIndex: 20 }}>
          <ToolbarButton icon="MoreVertical" label={strings.view} badge={separateFilters ? undefined : count} expanded={page !== null} theme={theme} testID="tablet-view" onPress={() => { props.filters?.onClose(); closeEmptySearch(); openPage(page ? null : "view"); }} />
        </View>
        <ToolbarButton icon={<PanelMark open={props.sidebar.open} side="right" color={colors.foreground} />} label={props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show} selected={props.sidebar.open} theme={theme} testID="sidebar-switch" onPress={() => { closeEmptySearch(); props.sidebar.onToggle(); }} />
        </View>
      </View>
      {props.filters ? (
        <View testID="tablet-filter-popover" onAccessibilityEscape={props.filters.onClose} style={{ position: "absolute", top: height + 6, right: filterRight, width: menuWidth(320, scale, props.width - 24), height: Math.min(600, Math.max(0, props.filters.height * 0.8)), borderRadius: 12, borderWidth: HAIRLINE, borderColor: colors.border, backgroundColor: colors.surface1, boxShadow: menuChrome(theme).shadow, elevation: 8, paddingBottom: 16, overflow: "hidden", zIndex: 30 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: taskControlHeight(48, scale), borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>
            <Text accessibilityRole="header" style={{ flex: 1, fontSize: F.base, fontWeight: "600", color: colors.foreground }}>{strings.filters}</Text>
            <ToolbarButton size={compact ? 28 : 44} icon="X" label={strings.closeMenu} theme={theme} testID="tablet-filter-close" onPress={props.filters.onClose} />
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

function ToolbarButton(props: { icon: string | React.ReactElement; label: string; theme: PluginTheme; onPress(): void; testID: string; selected?: boolean; hideSelectedBackground?: boolean; expanded?: boolean; badge?: number; badgeTestID?: string; slashed?: boolean; size?: number }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const target = taskControlHeight(props.size ?? 40, scale);
  const iconSize = 18;
  return (
    <HoverPressable accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={{ ...(props.selected === undefined ? {} : { selected: props.selected }), ...(props.expanded === undefined ? {} : { expanded: props.expanded }) }} {...tipProps(props.label)} onPress={props.onPress} testID={props.testID} style={(hovered, pressed) => ({ minWidth: target, height: target, flexShrink: 0, borderRadius: 7, backgroundColor: props.expanded || (props.selected && !props.hideSelectedBackground) ? colors.surface1 : "transparent", boxShadow: surfaceLift(hovered, pressed).shadow ? taskTokens(props.theme).card.buttonShadowHover : undefined, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 })}>
      <View style={{ width: iconSize, height: iconSize, alignItems: "center", justifyContent: "center" }}>
        {typeof props.icon === "string" ? <Icon name={props.icon} size={iconSize} color={colors.foreground} /> : props.icon}
        {props.slashed ? <SlashMark size={iconSize} color={colors.foreground} gap={colors.surface0} /> : null}
        <CornerBadge count={props.badge ?? 0} theme={props.theme} style={{ bottom: -4, right: -4 }} testID={props.badgeTestID ?? "tablet-filter-count"} />
      </View>
    </HoverPressable>
  );
}
