import React, { memo, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View, useWindowDimensions, type LayoutChangeEvent, type TextInput as NativeTextInput } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { LANE_WIDTHS } from "../../../shared/tasks-settings";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, TASK_MONO, useTasksFontScale, taskControlHeight } from "../typography";
import { TagMark, taskTokens } from "../cards";
import { tipProps } from "../cards/card-hints";
import { CornerBadge, HoverPressable, RollingTotal, WindowSegments, RoundButton, Segments, SlashMark } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { FILTER_ICONS, activeChips, clearedParams, emptyGroupsIcon, groupChips, isChipGroup, shownFilterOptions, toggleProject, type ActiveChip, type ChipGroup, type ChipGroupKind, type FilterOptions } from "./filter-options";
import { iconlessProjects, useRequestProjectIcons } from "./project-icons";
import { activeFilterCount, resolveBoardParams, toggleItem } from "./params";
import { sortLabel } from "./strings";
import { PROJECT_MENU_WIDTH, agentMenuSections, chipGroupMenuSections, labelMenuSections, laneWidthMenuSections, projectMenuSections, sortMenuSections, workspaceMenuSections } from "./board-menus";
import { CascadeMenu, MenuBoundsContext } from "./menu";
import { MENU_EDGE, menuWidth, type MenuSection } from "./menu-model";
import { LABEL_GAP, nextBarLayout, type BarBoxes, type BarLayout, type Box } from "./label-fit";
import type { BoardController } from "./use-board";
import { LaneWidthMark } from "./lane-width-mark";
import { useSwitchSpace } from "../../ui/use-switch-space";
import { FullConversationSwitch, SearchInput } from "./search-loading";
import { SearchCoverageItems } from "./search-coverage";
import { tasksSettingsOpener } from "./enabled";
import { bindBoardRefreshShortcut } from "../../web";

export type FilterMenu = "project" | "workspace" | "agent" | "label" | "sort" | "laneWidth" | `chips:${ChipGroupKind}`;

/** Toolbar labels follow the host base size on every platform. */
const toolbarFontSize = () => F.base;
const MENU_PADDING = 10;
const MENU_ICON = 13;
const MENU_CHEVRON = 12;
const TOOLBAR_GAP = 10;
const DIVIDER_MARGIN = 4;

/** Round and menu buttons share the same height on each platform. */
const toolbarButtonSize = (scale: number) => taskControlHeight(Platform.OS === "web" ? 28 : 36, scale);
const roundButtonSize = (scale: number) => taskControlHeight(Platform.OS === "web" ? 24 : 36, scale);
const roundIconSize = (scale: number) => Platform.OS === "web" ? taskControlHeight(14, scale) : Math.round(roundButtonSize(scale) / 2);
const laneWidthIconSize = (scale: number) => Math.round(16 * Math.max(1, scale));

export type EmptyLanes = { collapsed: boolean; disabled: boolean; onToggle(): void };

function MoreActions({ board, theme, items }: { board: BoardController; theme: PluginTheme; items: MenuSection["items"] }) {
  const scale = useTasksFontScale();
  const window = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const bounds = useContext(MenuBoundsContext);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refresh = board.tasks.refresh;
  const press = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setBusy(true);
    void Promise.resolve()
      .then(refresh)
      .catch(() => "failed")
      .finally(() => { if (mounted.current) setBusy(false); });
  }, [busy, refresh]);
  useEffect(() => board.visible ? bindBoardRefreshShortcut(bounds?.current, press) : undefined, [board.visible, bounds, press]);
  return (
    <View style={{ zIndex: 20 }}>
    <RoundButton
      icon="MoreVertical"
      label={busy ? board.strings.refreshTasks : board.strings.more}
      theme={theme}
      onPress={() => setOpen(!open)}
      busy={busy}
      size={roundButtonSize(scale)}
      iconSize={roundIconSize(scale)}
      tip={busy ? `${board.strings.refreshTasks} (⌥R)` : board.strings.more}
      testID="desktop-toolbar-more"
    />
    {open ? <CascadeMenu theme={theme} width={menuWidth(200, scale, window.width - MENU_EDGE * 2)} fitContent top={toolbarButtonSize(scale) + 6} align="right" onClose={() => setOpen(false)} testID="desktop-more-menu" sections={[{ key: "more", items: [
      { key: "refresh", label: board.strings.refreshTasks, icon: "RefreshCw", shortcut: "⌥R", disabled: busy, onSelect: press },
      ...items,
    ] }]} /> : null}
    </View>
  );
}

/** The narrowest board whose toolbar shows the key hints beside the count and the search. */
export const KEY_HINTS_MIN_WIDTH = 1200;

/**
 * The desktop board's two bars (prototype 01): the count, key hints and
 * search and applied filters at the left, count in the centre, actions at
 * the right; then the filter controls and done window. Equal side slots keep
 * the count centred regardless of the search and actions' actual widths.
 */
export const DesktopToolbar = memo(DesktopToolbarView);

function DesktopToolbarView(props: {
  board: BoardController;
  theme: PluginTheme;
  searchRef: Ref<NativeTextInput>;
  keyHints: boolean;
  filterOptions?: FilterOptions;
  menu: FilterMenu | null;
  setMenu(menu: FilterMenu | null): void;
  /** The details sidebar's switch at the bar's right end; `sheet` when the details rise from the bottom. */
  sidebar?: { open: boolean; onToggle(): void; sheet?: boolean };
  emptyLanes: EmptyLanes;
  /**
   * A narrow board's one-row header: the filter bar folds into this button
   * (its count of active filters on a badge), which opens the filter sheet,
   * so the lanes keep the height two more rows took. The empty lanes' fold
   * and the archived lane's switch, no filters, stay out as round buttons
   * on its left, in the filter bar's order. A wide board keeps both in the
   * filter bar, beside the lane width, and shows the empty-groups switch
   * here instead, left of the sidebar's.
   */
  filters?: { count: number; onPress(): void };
}) {
  const { board, theme } = props;
  const scale = useTasksFontScale();
  const window = useWindowDimensions();
  const colors = theme.colors;
  const strings = board.strings;
  const chips = props.filterOptions
    ? groupChips(activeChips(board.params, board.defaults, props.filterOptions, strings).filter((chip) => !BAR_OWN_CONTROLS.has(chip.key)), strings)
    : [];
  const chipMenu = props.menu?.startsWith("chips:") ? props.menu : null;
  const groupGone = !!chipMenu && !chips.some((entry) => entry.key === `group:${chipMenu.slice(6)}`);
  useEffect(() => {
    if (groupGone) props.setMenu(null);
  }, [groupGone, props.setMenu]);
  const toggle = (menuId: FilterMenu) => props.setMenu(props.menu === menuId ? null : menuId);
  const [searchFocused, setSearchFocused] = useState(false);
  const [actionWidth, setActionWidth] = useState(0);
  const openSettings = tasksSettingsOpener();
  const actionCount = (props.filters ? 4 : 1) + Number(!!props.sidebar);
  const compactActions = actionWidth > 0 && actionWidth < actionCount * roundButtonSize(scale) + (actionCount - 1) * TOOLBAR_GAP;
  const moreItems: MenuSection["items"] = [
    ...(compactActions && props.filters ? [
      { key: "empty", label: props.emptyLanes.collapsed ? strings.emptyLanes.expand : strings.emptyLanes.collapse, disabled: props.emptyLanes.disabled, onSelect: props.emptyLanes.onToggle },
      { key: "archived", label: strings.archivedLane.row, checked: board.showArchived, onSelect: () => board.setShowArchived(!board.showArchived) },
    ] : []),
    { key: "empty-groups", label: strings.emptyGroups.row, icon: emptyGroupsIcon(board.showEmptyGroups), checked: board.showEmptyGroups, shortcut: "G", onSelect: () => board.setShowEmptyGroups(!board.showEmptyGroups) },
    ...(openSettings ? [{ key: "settings", label: strings.openSettings, icon: "Bolt", shortcut: ",", onSelect: openSettings }] : []),
    ...(compactActions && props.sidebar ? [{ key: "sidebar", label: props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show, onSelect: props.sidebar.onToggle }] : []),
  ];
  return (
    <View testID="desktop-toolbar" style={{ height: taskControlHeight(48, scale), flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP, paddingHorizontal: 16, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border, zIndex: 11 }}>
      <View testID="desktop-toolbar-start" style={{ flex: 1, flexBasis: 0, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        testID="desktop-toolbar-search"
        {...tipProps(`${strings.search} (/)`)}
        style={{
          height: taskControlHeight(28, scale),
          width: 220,
          maxWidth: "100%",
          flexShrink: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          borderWidth: HAIRLINE,
          borderColor: searchFocused ? colors.foregroundMuted : colors.border,
          borderRadius: 6,
        }}
      >
        <SearchInput iconSize={13} iconColor={colors.foregroundMuted}
          ref={props.searchRef}
          value={board.params.query}
          onChangeText={(query) => board.setParams((params) => ({ ...params, query }))}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder={strings.search}
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel={strings.search}
          style={{ flex: 1, minWidth: 0, padding: 0, fontSize: Math.round(F.base * scale), color: colors.foreground, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) }}
        />
        {board.params.query.length > 0 ? (
          <ClearButton label={strings.menuSearch.clear} onPress={() => board.setParams((params) => ({ ...params, query: "" }))} theme={theme} />
        ) : null}
      </View>
      <FullConversationSwitch theme={theme} />
      {chips.length ? (
        <View testID="desktop-toolbar-search-summary" style={{ flexDirection: "row", alignItems: "center", minWidth: 0, maxWidth: "100%", flexShrink: 1, gap: 10 }}>
          {chips.map((entry) =>
            isChipGroup(entry) ? (
              <GroupChip
                key={entry.key}
                group={entry}
                open={props.menu === `chips:${entry.kind}`}
                onPress={() => toggle(`chips:${entry.kind}`)}
                onClear={() => board.setParams(entry.clear)}
                clearLabel={`${strings.clear} ${entry.label}`}
                theme={theme}
              >
                <CascadeMenu
                  sections={chipGroupMenuSections(entry, theme, strings, board.setParams)}
                  theme={theme}
                  width={menuWidth(280, scale, window.width - MENU_EDGE * 2)}
                  top={toolbarButtonSize(scale) + 6}
                  align="left"
                  onClose={() => props.setMenu(null)}
                  testID="chip-group-menu"
                />
              </GroupChip>
            ) : (
              entry.key === "q" ? (
                <View key={entry.key} style={{ flexDirection: "row", alignItems: "center", minWidth: 0, maxWidth: "100%", flexShrink: 1, gap: 10 }}>
                  <Chip chip={entry} onClear={() => board.setParams(entry.clear)} clearLabel={`${strings.clear} ${entry.value}`} theme={theme} />
                  <SearchCoverageItems theme={theme} />
                </View>
              ) : <Chip key={entry.key} chip={entry} onClear={() => board.setParams(entry.clear)} clearLabel={`${strings.clear} ${entry.value}`} theme={theme} />
            ),
          )}
          <ClearAllButton board={board} theme={theme} />
        </View>
      ) : null}
      </View>
      <View testID="desktop-toolbar-total" pointerEvents="none" style={{ flexShrink: 0, alignItems: "center" }}>
        <RollingTotal board={board} style={{ fontSize: F.base, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] }} />
      </View>
      <View testID="desktop-toolbar-end" onLayout={(event) => setActionWidth(event.nativeEvent.layout.width)} style={{ flex: 1, flexBasis: 0, minWidth: 0, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: TOOLBAR_GAP }}>
      {compactActions ? (
        <>
          {props.filters ? <RoundButton icon="SlidersHorizontal" label={strings.filters} theme={theme} badge={props.filters.count} onPress={props.filters.onPress} size={roundButtonSize(scale)} iconSize={roundIconSize(scale)} testID="toolbar-filters" /> : null}
        </>
      ) : <>
      {Platform.OS === "web" && props.keyHints ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <KeyCap label="J" theme={theme} />
          <KeyCap label="K" theme={theme} />
          <KeyHint text={strings.keys.move} theme={theme} />
          <KeyCap label="H" theme={theme} />
          <KeyCap label="L" theme={theme} />
          <KeyHint text={strings.keys.lane} theme={theme} />
          <KeyCap label="↵" theme={theme} />
          <KeyHint text={strings.keys.open} theme={theme} />
          <KeyCap label={strings.keys.space} theme={theme} />
          <KeyHint text={strings.keys.preview} theme={theme} />
          <KeyCap label="/" theme={theme} />
          <KeyHint text={strings.keys.search} theme={theme} last />
        </View>
      ) : null}
      {props.filters ? (
        <>
          <EmptyLanesButton emptyLanes={props.emptyLanes} strings={strings} theme={theme} />
          <RoundButton
            icon="Archive"
            label={strings.archivedLane.row}
            selected={board.showArchived}
            slashed={!board.showArchived}
            theme={theme}
            onPress={() => board.setShowArchived(!board.showArchived)}
            size={roundButtonSize(scale)} iconSize={roundIconSize(scale)}
            tip={`${board.showArchived ? strings.tips.hideArchived : strings.archivedLane.row} (A)`}
            testID="toolbar-archived"
          />
          <RoundButton icon="SlidersHorizontal" label={strings.filters} theme={theme} badge={props.filters.count} onPress={props.filters.onPress} size={roundButtonSize(scale)} iconSize={roundIconSize(scale)} tip={strings.filters} testID="toolbar-filters" />
        </>
      ) : null}
      </>}
      <MoreActions board={board} theme={theme} items={moreItems} />
      {!compactActions && props.sidebar ? <SidebarSwitch open={props.sidebar.open} sheet={!!props.sidebar.sheet} onToggle={props.sidebar.onToggle} theme={theme} label={props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show} /> : null}
      </View>
    </View>
  );
}

/** Folds the empty lanes to slim strips, or opens them again. */
function EmptyLanesButton({ emptyLanes, strings, theme }: { emptyLanes: EmptyLanes; strings: BoardController["strings"]; theme: PluginTheme }) {
  const label = emptyLanes.collapsed ? strings.emptyLanes.expand : strings.emptyLanes.collapse;
  const scale = useTasksFontScale();
  return (
    <RoundButton
      icon={emptyLanes.collapsed ? "UnfoldHorizontal" : "FoldHorizontal"}
      label={label}
      selected={emptyLanes.collapsed}
      disabled={emptyLanes.disabled}
      theme={theme}
      onPress={emptyLanes.onToggle}
      size={roundButtonSize(scale)} iconSize={roundIconSize(scale)}
      tip={`${label} (E)`}
      testID="empty-lanes-toggle"
    />
  );
}

/** A round outlined button, filled grey while the sidebar shows. */
function SidebarSwitch(props: { open: boolean; sheet: boolean; onToggle(): void; theme: PluginTheme; label: string }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const size = roundButtonSize(scale);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} (])`}
      accessibilityState={{ selected: props.open }}
      {...tipProps(`${props.label} (])`)}
      onPress={props.onToggle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={Platform.OS === "web" ? 0 : 4}
      testID="sidebar-switch"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        backgroundColor: props.open ? colors.surface2 : hovered ? colors.surface1 : colors.surface0,
        boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PanelMark open={props.open} side={props.sheet ? "bottom" : "right"} color={props.open ? colors.foreground : colors.foregroundMuted} />
    </Pressable>
  );
}

/**
 * A board-wide switch in the filter bar: the headers' round button at the
 * bar's size. Only the icon tells on from off, the outline stays the same:
 * the archived lane's Archive is struck through while the lane is hidden,
 * the subtasks switch between a network and a flat list.
 */
function BarSwitch(props: { icon: string; on: boolean; onPress(): void; label: string; hint: string; tip: string; theme: PluginTheme; slashed?: boolean; badge?: number; testID: string }) {
  const colors = props.theme.colors;
  const spaceKeys = useSwitchSpace(props.onPress);
  const scale = useTasksFontScale();
  const size = roundButtonSize(scale);
  const icon = roundIconSize(scale);
  const [hovered, setHovered] = useState(false);
  const background = hovered ? colors.surface1 : colors.surface0;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      aria-checked={props.on}
      accessibilityState={{ checked: props.on }}
      {...tipProps(props.tip)}
      onPress={props.onPress}
      {...spaceKeys}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={Platform.OS === "web" ? 0 : 4}
      testID={props.testID}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size / 2,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        backgroundColor: background,
        boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={props.icon} size={icon} color={colors.foreground} />
      {props.slashed ? <SlashMark size={icon} color={colors.foreground} gap={background} /> : null}
      <CornerBadge count={props.badge ?? 0} theme={props.theme} style={{ bottom: -1, right: -1 }} testID={`${props.testID}-count`} />
    </Pressable>
  );
}

/**
 * Keep the original panel silhouette: a rounded frame with a solid block
 * while open and a thin bar while closed, on the edge the details come from.
 * Tighter corners and even insets keep all four states balanced.
 */
export function PanelMark(props: { open: boolean; side: "right" | "bottom"; color: string }) {
  const bottom = props.side === "bottom";
  return (
    <View
      testID="panel-mark"
      style={{
        width: 16,
        height: 13,
        transform: Platform.OS === "web" ? [{ scale: 14 / 16 }] : undefined,
        borderWidth: 1.5,
        borderRadius: 2.5,
        borderColor: props.color,
        flexDirection: bottom ? "column" : "row",
        alignItems: "center",
        justifyContent: "flex-end",
        ...(bottom ? { paddingBottom: 1.5 } : { paddingRight: 1.5 }),
      }}
    >
      <View testID="panel-mark-fill" style={{ width: bottom ? 10 : props.open ? 3.5 : 1.5, height: bottom ? props.open ? 3 : 1.5 : 7, borderRadius: 0.75, backgroundColor: props.color }} />
    </View>
  );
}

function KeyCap({ label, theme }: { label: string; theme: PluginTheme }) {
  const scale = useTasksFontScale();
  return (
    <View style={{ minWidth: 16, height: taskControlHeight(16, scale), paddingHorizontal: 3, borderWidth: HAIRLINE, borderColor: theme.colors.border, borderRadius: 3, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: TASK_MONO, fontSize: F.sm, color: theme.colors.foregroundMuted }}>{label}</Text>
    </View>
  );
}

function KeyHint({ text, theme, last }: { text: string; theme: PluginTheme; last?: boolean }) {
  return <Text style={{ fontSize: F.sm, color: theme.colors.foregroundMuted, marginRight: last ? 0 : 6 }}>{text}</Text>;
}

/**
 * The narrowest the filters' group gets beside the done window and the sort:
 * about two filter buttons. Below it the done window and the sort wrap to a
 * line of their own, at its right end, rather than squeeze the filters into
 * one column whose buttons overlap the window.
 */
const FILTERS_MIN_WIDTH = 240;
const FILTER_BAR_PADDING = 16;
/** Applied filters whose own control on the bar already shows them on. */
const BAR_OWN_CONTROLS = new Set(["sub", "win"]);
/** A long sort ("Duration shortest first") ends in an ellipsis past this. */
const SORT_LABEL_MAX_WIDTH = 160;

export const DesktopFilterBar = memo(DesktopFilterBarView);

function DesktopFilterBarView(props: {
  board: BoardController;
  theme: PluginTheme;
  options: FilterOptions;
  menu: FilterMenu | null;
  setMenu(menu: FilterMenu | null): void;
  onMore(): void;
  /** The empty lanes' fold; the desktop bar keeps it beside the board's other switches. */
  emptyLanes?: EmptyLanes;
}) {
  const { board, theme, options, menu, setMenu } = props;
  const tablet = Platform.OS !== "web";
  const scale = useTasksFontScale();
  const window = useWindowDimensions();
  const colors = theme.colors;
  const strings = board.strings;
  const { params, setParams, defaults } = board;
  const resolved = resolveBoardParams(params, defaults);
  const count = (list: readonly unknown[]) => (list.length ? ` · ${list.length}` : "");
  const toggle = (menuId: FilterMenu) => setMenu(menu === menuId ? null : menuId);
  const shown = shownFilterOptions(options, board.showEmptyGroups);
  useRequestProjectIcons(iconlessProjects(menu === "project" ? shown.projects.map((project) => project.group) : menu === "workspace" ? shown.workspaceGroups : []), board.tasks.requestProjectIcon);
  const words = {
    project: strings.project + count(shown.projects.filter((project) => project.on)),
    workspace: strings.workspace + count(params.workspaceIds),
    agent: strings.agent + count(params.providers),
    label: strings.labels + count(params.labels),
    sort: params.sort ? sortLabel(params.sort, strings) : strings.sort,
    laneWidth: strings.laneWidth.names[board.laneWidth],
  };
  // Every word the buttons drop when icon-only: the toggles' only while they show.
  const fit = useLabelFit([
    words.agent,
    words.project,
    words.workspace,
    words.label,
    { text: words.sort, maxWidth: SORT_LABEL_MAX_WIDTH },
  ], !tablet, strings.laneWidth.label);
  const compact = tablet || fit.compact;
  useEffect(() => {
    if (fit.inlineLaneWidth && menu === "laneWidth") setMenu(null);
  }, [fit.inlineLaneWidth, menu, setMenu]);
  // An icon-only button's tip leads with the words it dropped: its picks, the sort, the width.
  const tip = (dropped: string, what: string) => (compact ? `${dropped}\n${what}` : what);
  const archivedSwitch = (
    <BarSwitch
      icon="Archive"
      on={board.showArchived}
      slashed={!board.showArchived}
      onPress={() => board.setShowArchived(!board.showArchived)}
      label={strings.archivedLane.row}
      hint={strings.archivedLane.hint}
      tip={`${board.showArchived ? strings.tips.hideArchived : strings.archivedLane.row} (A)`}
      theme={theme}
      testID="archived-lane-toggle"
    />
  );
  // At most three switches beside the lane width: the empty groups' sits in the top row, and at the foot of the menus it trims.
  const withEmptyGroups = (sections: MenuSection[]): MenuSection[] => [
    ...sections,
    { key: "empty-groups", items: [{ key: "empty-groups", label: strings.emptyGroups.row, icon: emptyGroupsIcon(board.showEmptyGroups), checked: board.showEmptyGroups, keepOpen: true, onSelect: () => board.setShowEmptyGroups(!board.showEmptyGroups) }] },
  ];
  const subtasksSwitch = (
    <BarSwitch
      icon={resolved.filters.hideSubtasks ? "ListTree" : "Network"}
      on={!resolved.filters.hideSubtasks}
      badge={board.hiddenSubtasks}
      onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
      label={strings.showSubtasks}
      hint={strings.showSubtasksHint}
      tip={`${resolved.filters.hideSubtasks ? strings.showSubtasks : strings.tips.hideSubtasks} (S)`}
      theme={theme}
      testID="subtasks-toggle"
    />
  );
  return (
    <View
      testID="filter-bar"
      // Empty toolbar space must reach the board's menu-dismiss backdrop on native.
      pointerEvents="box-none"
      onLayout={tablet ? undefined : fit.box("bar")}
      style={{
        minHeight: 44,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: TOOLBAR_GAP,
        paddingHorizontal: FILTER_BAR_PADDING,
        paddingVertical: 8,
        zIndex: 10,
      }}
    >
      {/* The filter controls keep the first row's left end; the done window
          and the sort keep the right end while the filters have
          FILTERS_MIN_WIDTH beside them, and wrap below them, still at the
          right, when they do not. */}
      <View pointerEvents="box-none" onLayout={fit.box("filters")} style={{ flex: 1, minWidth: tablet ? 4 * toolbarButtonSize(scale) + 3 * TOOLBAR_GAP : FILTERS_MIN_WIDTH, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: TOOLBAR_GAP, zIndex: menu && menu !== "sort" ? 2 : 1 }}>
        {/* The buttons hold one line: once their words would wrap them, they draw their icons alone. */}
        <View testID="filter-bar-controls" pointerEvents="box-none" onLayout={fit.box("controls")} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP, zIndex: 1 }}>
          <MenuButton icon={FILTER_ICONS.agent} label={words.agent} compact={compact} tip={tip(words.agent, strings.tips.agent)} open={menu === "agent"} onPress={() => toggle("agent")} theme={theme}>
            <CascadeMenu
              sections={withEmptyGroups(agentMenuSections(shown, theme, strings, (id) => setParams((p) => ({ ...p, providers: toggleItem(p.providers, id) }))))}
              theme={theme}
              width={menuWidth(240, scale, window.width - MENU_EDGE * 2)}
              top={toolbarButtonSize(scale) + 6}
              align="left"
              onClose={() => setMenu(null)}
            />
          </MenuButton>
          <MenuButton icon={FILTER_ICONS.project} label={words.project} compact={compact} tip={tip(words.project, strings.tips.project)} open={menu === "project"} onPress={() => toggle("project")} theme={theme}>
            <CascadeMenu
              sections={withEmptyGroups(projectMenuSections(shown, strings, board.hostId, (project) => setParams((p) => toggleProject(p, project))))}
              theme={theme}
              width={menuWidth(PROJECT_MENU_WIDTH, scale, window.width - MENU_EDGE * 2)}
              top={toolbarButtonSize(scale) + 6}
              align="left"
              search={strings.menuSearch}
              onClose={() => setMenu(null)}
            />
          </MenuButton>
          <MenuButton icon={FILTER_ICONS.workspace} label={words.workspace} compact={compact} tip={tip(words.workspace, strings.tips.workspace)} open={menu === "workspace"} onPress={() => toggle("workspace")} theme={theme}>
            <CascadeMenu
              sections={withEmptyGroups(workspaceMenuSections(shown, theme, strings, board.hostId, (id) => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, id) }))))}
              theme={theme}
              width={menuWidth(260, scale, window.width - MENU_EDGE * 2)}
              top={toolbarButtonSize(scale) + 6}
              align="left"
              search={strings.menuSearch}
              onClose={() => setMenu(null)}
            />
          </MenuButton>
          <MenuButton icon={FILTER_ICONS.label} label={words.label} compact={compact} tip={tip(words.label, strings.tips.labels)} open={menu === "label"} onPress={() => toggle("label")} theme={theme}>
            <CascadeMenu
              sections={labelMenuSections(shown, theme, strings, (id) => setParams((p) => ({ ...p, labels: toggleItem(p.labels, id) })))}
              theme={theme}
              width={menuWidth(200, scale, window.width - MENU_EDGE * 2)}
              top={toolbarButtonSize(scale) + 6}
              align="left"
              onClose={() => setMenu(null)}
            />
          </MenuButton>
        </View>
      </View>
      <View testID="filter-bar-end" pointerEvents="box-none" onLayout={fit.box("end")} style={{ flexShrink: tablet ? 0 : 1, maxWidth: "100%", marginLeft: "auto", height: toolbarButtonSize(scale), flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP, zIndex: menu === "sort" || menu === "laneWidth" ? 2 : 1 }}>
        {tablet ? null : (
          <>
            {props.emptyLanes ? <EmptyLanesButton emptyLanes={props.emptyLanes} strings={strings} theme={theme} /> : null}
            {subtasksSwitch}
            {archivedSwitch}
            {compact ? null : <Divider theme={theme} testID="board-switches-divider" />}
            <View testID="lane-width-control" pointerEvents="box-none" onLayout={fit.measureLaneControl} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP, zIndex: menu === "laneWidth" ? 1 : 0 }}>
              {fit.inlineLaneWidth ? (
                <>
                  <Text testID="lane-width-label" numberOfLines={1} style={{ fontSize: toolbarFontSize(), color: colors.foregroundMuted }}>{strings.laneWidth.label}</Text>
                  <Segments
                    items={LANE_WIDTHS}
                    label={(width) => strings.laneWidth.names[width]}
                    mark={(width, selected) => <LaneWidthMark laneWidth={width} size={laneWidthIconSize(scale)} color={selected ? colors.foreground : colors.foregroundMuted} />}
                    value={board.laneWidth}
                    onChange={board.setLaneWidth}
                    theme={theme}
                    tip={strings.laneWidth.title}
                    testID="toolbar-lane-width"
                  />
                </>
              ) : (
                <MenuButton
                  icon={<LaneWidthMark laneWidth={board.laneWidth} size={Platform.OS === "web" ? roundIconSize(scale) : laneWidthIconSize(scale)} color={colors.foreground} />}
                  label={words.laneWidth}
                  compact
                  accessibilityLabel={strings.laneWidth.button(words.laneWidth)}
                  tip={strings.laneWidth.button(words.laneWidth)}
                  open={menu === "laneWidth"}
                  onPress={() => toggle("laneWidth")}
                  theme={theme}
                >
                  <CascadeMenu
                    sections={laneWidthMenuSections(board.laneWidth, theme, strings, board.setLaneWidth)}
                    theme={theme}
                    width={menuWidth(180, scale, window.width - MENU_EDGE * 2)}
                    top={toolbarButtonSize(scale) + 6}
                    align="left"
                    onClose={() => setMenu(null)}
                    testID="lane-width-menu"
                  />
                </MenuButton>
              )}
              {fit.laneWidthMeasure}
            </View>
            {compact ? null : <Divider theme={theme} testID="lane-width-divider" />}
            <Text numberOfLines={1} style={{ fontSize: toolbarFontSize(), color: colors.foregroundMuted }}>{strings.timeRange}</Text>
            <WindowSegments
              value={resolved.doneWindow}
              onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))}
              theme={theme}
              strings={strings}
              tip={strings.tips.doneWindow}
              marks
            />
            {compact ? null : <Divider theme={theme} testID="done-window-divider" />}
          </>
        )}
        {tablet ? subtasksSwitch : null}
        <MenuButton
          icon="ArrowUpDown"
          label={words.sort}
          compact={tablet || compact}
          labelMaxWidth={tablet ? undefined : SORT_LABEL_MAX_WIDTH}
          tip={tablet ? `${words.sort}\n${strings.tips.sort}` : tip(words.sort, strings.tips.sort)}
          open={menu === "sort"}
          onPress={() => toggle("sort")}
          theme={theme}
        >
          <CascadeMenu
            sections={sortMenuSections(params.sort, strings, (sort) => setParams((p) => ({ ...p, sort })))}
            theme={theme}
            width={menuWidth(220, scale, window.width - MENU_EDGE * 2)}
            submenuWidth={menuWidth(190, scale, window.width - MENU_EDGE * 2)}
            top={toolbarButtonSize(scale) + 6}
            align="right"
            onClose={() => setMenu(null)}
            testID="sort-menu"
          />
        </MenuButton>
        {tablet ? (
          <>
            {Platform.OS === "ios" ? null : archivedSwitch}
            <RoundButton icon="SlidersHorizontal" label={strings.filters} theme={theme} badge={activeFilterCount(params, defaults)} onPress={props.onMore} size={roundButtonSize(scale)} iconSize={roundIconSize(scale)} tip={strings.filters} testID="filter-bar-more" />
          </>
        ) : null}
      </View>
      {fit.layer}
    </View>
  );
}

/** A word an icon-only button dropped, and the width its button caps it at. */
type DroppedWord = string | { text: string; maxWidth?: number };

/**
 * Measures the bar before folding lane choices, then filter labels. Hidden
 * measurements let each return only once it fits with room to spare.
 */
function useLabelFit(dropped: readonly DroppedWord[], enabled: boolean, laneWidthLabel: string) {
  const scale = useTasksFontScale();
  const [layout, setLayout] = useState<BarLayout>({ compact: false, inlineLaneWidth: false });
  const { compact, inlineLaneWidth } = layout;
  // Each box notes the mode it was laid out in: a decision waits for the buttons and the end to lay out in the current one.
  const boxes = useRef<Partial<Record<keyof BarBoxes, Box & BarLayout>>>({});
  const widths = useRef<number[]>([]);
  const laneControl = useRef<{ inlineLaneWidth: boolean; width: number } | null>(null);
  const laneMeasure = useRef<{ key: string; width: number } | null>(null);
  const measureKey = `${scale}|${laneWidthLabel}`;
  const latest = useRef({ layout, count: dropped.length });
  latest.current = { layout, count: dropped.length };
  const decide = () => {
    if (!enabled) return;
    const { bar, filters, end, controls } = boxes.current;
    const now = latest.current.layout;
    if (!filters || !end || !controls || end.compact !== now.compact || controls.compact !== now.compact || end.inlineLaneWidth !== now.inlineLaneWidth) return;
    // Restoring the labels also restores the end group's three dividers and their gaps.
    let labels: number | null = 3 * (HAIRLINE + 2 * DIVIDER_MARGIN + TOOLBAR_GAP);
    for (let index = 0; index < latest.current.count; index++) {
      const width = widths.current[index];
      if (width === undefined) {
        labels = null;
        break;
      }
      // Restoring a label also restores the chevron, two gaps and side padding.
      labels += width + 2 * MENU_PADDING + MENU_ICON + MENU_CHEVRON + 2 * LABEL_GAP - toolbarButtonSize(scale);
    }
    const control = laneControl.current;
    const measured = laneMeasure.current;
    const extra = measured?.key === measureKey && control?.inlineLaneWidth === now.inlineLaneWidth
      ? measured.width - control.width : null;
    const next = nextBarLayout(now, { bar, filters, end, controls }, labels, extra);
    if (next.compact === now.compact && next.inlineLaneWidth === now.inlineLaneWidth) return;
    // The words measured last time may have changed since: the layer lays them out afresh.
    if (next.compact !== now.compact) widths.current = [];
    latest.current.layout = next;
    setLayout(next);
  };
  const box = (key: keyof BarBoxes) => (event: LayoutChangeEvent) => {
    const { x, y, width } = event.nativeEvent.layout;
    boxes.current[key] = { x, y, width: key === "bar" ? width - 2 * FILTER_BAR_PADDING - TOOLBAR_GAP : width, ...layout };
    decide();
  };
  const measureLaneControl = (event: LayoutChangeEvent) => {
    laneControl.current = { inlineLaneWidth, width: event.nativeEvent.layout.width };
    decide();
  };
  // Measure the heading and marked Segments together without mounting hidden radios.
  const laneWidthMeasure = enabled ? (
    <View
      key={measureKey}
      testID="lane-width-measure"
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        laneMeasure.current = { key: measureKey, width: event.nativeEvent.layout.width };
        decide();
      }}
      style={{ position: "absolute", left: 0, top: 0, opacity: 0, flexDirection: "row", alignItems: "center", gap: TOOLBAR_GAP }}
    >
      <Text numberOfLines={1} style={{ fontSize: toolbarFontSize() }}>{laneWidthLabel}</Text>
      <View style={{ flexDirection: "row", padding: 2, borderWidth: HAIRLINE, borderColor: "transparent" }}>
        {LANE_WIDTHS.map((width) => (
          <View key={width} style={{ minWidth: toolbarButtonSize(scale) + 2, paddingHorizontal: 6, alignItems: "center" }}>
            <LaneWidthMark laneWidth={width} size={laneWidthIconSize(scale)} color="transparent" />
          </View>
        ))}
      </View>
    </View>
  ) : null;
  const layer = compact ? (
    <View
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="filter-bar-words"
      style={{ position: "absolute", left: 0, top: 0, opacity: 0, alignItems: "flex-start" }}
    >
      {dropped.map((word, index) => {
        const { text, maxWidth } = typeof word === "string" ? { text: word, maxWidth: undefined } : word;
        return (
          <Text
            key={index}
            numberOfLines={1}
            onLayout={(event) => {
              widths.current[index] = event.nativeEvent.layout.width;
              decide();
            }}
            style={{ maxWidth, fontSize: toolbarFontSize(), fontWeight: "500" }}
          >
            {text}
          </Text>
        );
      })}
    </View>
  ) : null;
  return { compact, inlineLaneWidth, box, layer, measureLaneControl, laneWidthMeasure };
}


/**
 * An applied filter: its kind, its value and an X that clears it. A
 * multi-select filter's kind is its unit's icon, as on its folded chip; a
 * label's is its own solid tag in its colour. The rest ("Title has", "Done")
 * keep the muted word.
 */
function Chip(props: { chip: ActiveChip; onClear(): void; clearLabel: string; theme: PluginTheme }) {
  const { chip, theme } = props;
  const colors = theme.colors;
  const scale = useTasksFontScale();
  const unit = chip.unit ?? chip.group;
  return (
    <View style={{ height: toolbarButtonSize(scale), maxWidth: "100%", flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 4, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 6 }}>
      {unit ? (
        <View accessible accessibilityLabel={chip.kind}>
          {unit === "label" ? (
            // The chip has no fill: the hole shows the board under it.
            <TagMark size={14} color={chip.color ?? colors.foregroundMuted} hole={colors.surface0} />
          ) : (
            <Icon name={FILTER_ICONS[unit]} size={14} color={colors.foregroundMuted} />
          )}
        </View>
      ) : chip.kind ? (
        <Text numberOfLines={1} style={{ fontSize: toolbarFontSize(), color: colors.foregroundMuted }}>{chip.kind}</Text>
      ) : null}
      <Text numberOfLines={1} style={{ fontSize: toolbarFontSize(), color: colors.foreground, maxWidth: 220, flexShrink: 1 }}>
        {chip.value}
      </Text>
      <ClearButton label={props.clearLabel} onPress={props.onClear} theme={theme} />
    </View>
  );
}

/**
 * Several picks of one filter as one chip, "3 projects selected": a press
 * opens the menu that lists and removes them, the X clears them all.
 */
function GroupChip(props: { group: ChipGroup; open: boolean; onPress(): void; onClear(): void; clearLabel: string; theme: PluginTheme; children: ReactNode }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  return (
    <View pointerEvents="box-none" style={{ zIndex: props.open ? 20 : 0, maxWidth: "100%", flexShrink: 1 }}>
      <View
        pointerEvents="box-none"
        style={{
          height: toolbarButtonSize(scale),
          maxWidth: "100%",
          flexDirection: "row",
          alignItems: "center",
          paddingRight: 4,
          borderWidth: HAIRLINE,
          borderColor: colors.border,
          borderRadius: 6,
          backgroundColor: props.open ? colors.surface1 : "transparent",
        }}
      >
        <HoverPressable
          accessibilityRole="button"
          accessibilityState={{ expanded: props.open }}
          accessibilityLabel={props.group.label}
          {...tipProps(props.open ? undefined : props.group.label)}
          onPress={props.onPress}
          testID={`chip-group-${props.group.kind}`}
          style={(hovered) => ({
            height: "100%",
            flexShrink: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: 10,
            paddingRight: 4,
            borderTopLeftRadius: 6,
            borderBottomLeftRadius: 6,
            backgroundColor: hovered && !props.open ? colors.surface1 : "transparent",
            boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined,
          })}
        >
          {props.group.counts.map(({ unit, count }) => (
            <View key={unit} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginRight: 4 }}>
              <Icon name={FILTER_ICONS[unit]} size={14} color={colors.foregroundMuted} />
              <Text style={{ fontSize: toolbarFontSize(), color: colors.foreground, fontVariant: ["tabular-nums"] }}>{count}</Text>
            </View>
          ))}
          <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
        </HoverPressable>
        <ClearButton label={props.clearLabel} onPress={props.onClear} theme={props.theme} />
      </View>
      {props.open ? props.children : null}
    </View>
  );
}

function ClearButton(props: { label: string; onPress(): void; theme: PluginTheme }) {
  const colors = props.theme.colors;
  return (
    <HoverPressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      {...tipProps(props.label)}
      onPress={props.onPress}
      style={(hovered) => ({ width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? colors.surface2 : "transparent", boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined })}
    >
      <Icon name="X" size={12} color={colors.foregroundMuted} />
    </HoverPressable>
  );
}

function ClearAllButton(props: { board: BoardController; theme: PluginTheme }) {
  const scale = useTasksFontScale();
  return (
    <HoverPressable
      accessibilityRole="button"
      onPress={() => props.board.setParams(clearedParams)}
      style={(hovered) => ({
        height: toolbarButtonSize(scale),
        paddingHorizontal: MENU_PADDING,
        justifyContent: "center",
        borderRadius: 6,
        borderWidth: HAIRLINE,
        borderColor: props.theme.colors.border,
        backgroundColor: hovered ? props.theme.colors.surface1 : "transparent",
        boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined,
      })}
    >
      <Text numberOfLines={1} style={{ fontSize: toolbarFontSize(), color: props.theme.colors.foregroundMuted }}>{props.board.strings.clearAll}</Text>
    </HoverPressable>
  );
}

function Divider({ theme, testID }: { theme: PluginTheme; testID?: string }) {
  return <View testID={testID} style={{ width: HAIRLINE, height: 16, marginHorizontal: DIVIDER_MARGIN, backgroundColor: theme.colors.border }} />;
}


/**
 * A filter's menu button. Its intrinsic label width lets the bar switch to
 * icons before native labels truncate; desktop sorts retain `labelMaxWidth`.
 * `compact` drops it for the icon alone, which reads it out.
 */
function MenuButton(props: { icon: string | React.ReactElement; label: string; compact?: boolean; accessibilityLabel?: string; labelMaxWidth?: number; tip?: string; open: boolean; onPress(): void; theme: PluginTheme; children: ReactNode }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const iconOnly = !!props.compact;
  const size = iconOnly ? roundButtonSize(scale) : toolbarButtonSize(scale);
  return (
    <View pointerEvents="box-none" style={{ zIndex: props.open ? 20 : 0, maxWidth: Platform.OS === "web" ? "100%" : undefined, flexShrink: Platform.OS === "web" ? 1 : 0 }}>
      <HoverPressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel ?? (props.compact ? props.label : undefined)}
        accessibilityState={{ expanded: props.open }}
        // An open menu covers where the tip would show.
        {...tipProps(props.open ? undefined : props.tip)}
        onPress={props.onPress}
        style={(hovered) => ({
          height: size,
          maxWidth: Platform.OS === "web" ? "100%" : undefined,
          width: iconOnly ? size : undefined,
          paddingHorizontal: iconOnly ? 0 : MENU_PADDING,
          justifyContent: "center",
          borderRadius: iconOnly ? size / 2 : 6,
          borderWidth: HAIRLINE,
          borderColor: colors.border,
          backgroundColor: hovered || props.open ? colors.surface1 : "transparent",
          boxShadow: Platform.OS === "web" && hovered ? taskTokens(props.theme).card.buttonShadowHover : undefined,
          flexDirection: "row",
          alignItems: "center",
          gap: LABEL_GAP,
        })}
      >
        {typeof props.icon === "string" ? <Icon name={props.icon} size={iconOnly ? roundIconSize(scale) : MENU_ICON} color={iconOnly ? colors.foreground : colors.foregroundMuted} /> : props.icon}
        {props.compact ? null : (
          <Text numberOfLines={1} style={{ flexShrink: Platform.OS === "web" ? 1 : 0, maxWidth: props.labelMaxWidth, fontSize: toolbarFontSize(), fontWeight: "500", color: colors.foreground }}>{props.label}</Text>
        )}
        {iconOnly ? null : <Icon name="ChevronDown" size={MENU_CHEVRON} color={colors.foregroundMuted} />}
      </HoverPressable>
      {props.open ? props.children : null}
    </View>
  );
}


/** The same Contains chip beside compact search fields. */
export function SearchQueryChip({ board, theme }: { board: BoardController; theme: PluginTheme }) {
  if (!board.params.query.trim()) return null;
  return <Chip chip={{ key: "q", kind: board.strings.searchContains, value: `「${board.params.query.trim()}」`, clear: (params) => ({ ...params, query: "" }) }} onClear={() => board.setParams((params) => ({ ...params, query: "" }))} clearLabel={`${board.strings.clear} ${board.strings.searchContains}`} theme={theme} />;
}
