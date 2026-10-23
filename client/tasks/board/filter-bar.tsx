import React, { useEffect, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { taskTokens } from "../cards";
import { HoverPressable, WindowSegments, RoundButton } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { FILTER_ICONS, activeChips, clearedParams, groupChips, isChipGroup, projectOptions, toggleProject, type ActiveChip, type ChipGroup, type ChipGroupKind, type FilterOptions } from "./filter-options";
import { resolveBoardParams, toggleItem } from "./params";
import { sortLabel } from "./strings";
import { agentMenuSections, chipGroupMenuSections, labelMenuSections, laneWidthMenuSections, projectMenuSections, sortMenuSections, workspaceMenuSections } from "./board-menus";
import { CascadeMenu } from "./menu";
import type { BoardController } from "./use-board";

export type FilterMenu = "project" | "workspace" | "agent" | "label" | "sort" | "laneWidth" | `chips:${ChipGroupKind}`;

/** The narrowest board whose toolbar shows the key hints beside the count and the search. */
export const KEY_HINTS_MIN_WIDTH = 760;

/**
 * The desktop board's two bars (prototype 01): the count, key hints and
 * search, then the filters, the applied-filter chips and the done window.
 * A narrow board (a tablet with the sidebar open) drops the key hints, so
 * the count keeps its line and the search shrinks before it does.
 */
export function DesktopToolbar(props: {
  board: BoardController;
  theme: PluginTheme;
  searchRef: Ref<NativeTextInput>;
  keyHints: boolean;
  /** The details sidebar's switch at the bar's right end; `sheet` when the details rise from the bottom. */
  sidebar?: { open: boolean; onToggle(): void; sheet?: boolean };
  /**
   * A narrow board's one-row header: the filter bar folds into this button
   * (its count of active filters on a badge), which opens the filter sheet,
   * so the lanes keep the height two more rows took.
   */
  filters?: { count: number; onPress(): void };
}) {
  const { board, theme } = props;
  const scale = useTasksFontScale();
  const colors = theme.colors;
  const strings = board.strings;
  return (
    <View style={{ height: taskControlHeight(48, scale), flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>
      <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: F.base, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] }}>{strings.total(board.total)}</Text>
      <View style={{ flex: 1 }} />
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
          <KeyCap label="/" theme={theme} />
          <KeyHint text={strings.keys.search} theme={theme} last={!props.sidebar} />
          {props.sidebar ? (
            <>
              <KeyCap label="I" theme={theme} />
              <KeyHint text={strings.sidebar.key} theme={theme} last />
            </>
          ) : null}
        </View>
      ) : null}
      <View
        style={{
          height: taskControlHeight(28, scale),
          width: 220,
          flexShrink: 1,
          minWidth: 140,
          marginLeft: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          borderWidth: HAIRLINE,
          borderColor: colors.border,
          borderRadius: 6,
        }}
      >
        <Icon name="Search" size={13} color={colors.foregroundMuted} />
        <TextInput
          ref={props.searchRef}
          value={board.params.query}
          onChangeText={(query) => board.setParams((params) => ({ ...params, query }))}
          placeholder={strings.search}
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel={strings.search}
          style={{ flex: 1, minWidth: 0, padding: 0, fontSize: Math.round(F.base * scale), color: colors.foreground }}
        />
      </View>
      {props.filters ? <RoundButton icon="SlidersHorizontal" label={strings.filters} theme={theme} badge={props.filters.count} onPress={props.filters.onPress} testID="toolbar-filters" /> : null}
      {props.sidebar ? <SidebarSwitch open={props.sidebar.open} sheet={!!props.sidebar.sheet} onToggle={props.sidebar.onToggle} theme={theme} label={props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show} /> : null}
    </View>
  );
}

/** Linear's panel switch: a 28 round button, outlined, filled grey while the sidebar shows. */
function SidebarSwitch(props: { open: boolean; sheet: boolean; onToggle(): void; theme: PluginTheme; label: string }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const size = taskControlHeight(Platform.OS === "web" ? 28 : 36, scale);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label} (I)`}
      accessibilityState={{ selected: props.open }}
      onPress={props.onToggle}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={Platform.OS === "web" ? 0 : 4}
      testID="sidebar-switch"
      style={{
        width: size,
        height: size,
        marginLeft: 2,
        borderRadius: size / 2,
        borderWidth: HAIRLINE,
        borderColor: colors.border,
        backgroundColor: props.open ? colors.surface2 : hovered ? colors.surface1 : colors.surface0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <PanelMark open={props.open} side={props.sheet ? "bottom" : "right"} color={props.open ? colors.foreground : colors.foregroundMuted} />
    </Pressable>
  );
}

/**
 * Linear's panel mark at the host's 1.5 stroke: a rounded frame with a thin
 * bar on the side the details come from (right, or bottom when they rise as
 * a sheet) while the sidebar hides, a solid block while it shows.
 */
function PanelMark(props: { open: boolean; side: "right" | "bottom"; color: string }) {
  const bottom = props.side === "bottom";
  const bar = props.open ? { long: 6.5, short: 4, radius: 1 } : { long: 5.5, short: 1.5, radius: 0.75 };
  return (
    <View
      testID="panel-mark"
      style={{
        width: 15,
        height: 12,
        borderWidth: 1.5,
        borderRadius: 3.5,
        borderColor: props.color,
        flexDirection: bottom ? "column" : "row",
        alignItems: "center",
        justifyContent: "flex-end",
        ...(bottom ? { paddingBottom: 2 } : { paddingRight: 2.5 }),
      }}
    >
      <View style={{ width: bottom ? bar.long + 1.5 : bar.short, height: bottom ? (props.open ? 3.5 : bar.short) : bar.long, borderRadius: bar.radius, backgroundColor: props.color }} />
    </View>
  );
}

function KeyCap({ label, theme }: { label: string; theme: PluginTheme }) {
  const scale = useTasksFontScale();
  return (
    <View style={{ minWidth: 16, height: taskControlHeight(16, scale), paddingHorizontal: 3, borderWidth: HAIRLINE, borderColor: theme.colors.border, borderRadius: 3, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: F.sm, color: theme.colors.foregroundMuted }}>{label}</Text>
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
/** Applied filters whose own control on the bar already shows them on. */
const BAR_OWN_CONTROLS = new Set(["tabs", "sub", "win"]);
/** A long sort ("Duration shortest first") ends in an ellipsis past this. */
const SORT_LABEL_MAX_WIDTH = 160;

/** iOS and Android (a tablet): the two toggles fold behind a plus button, the bar keeps one row. */
const foldsToggles = () => Platform.OS === "ios" || Platform.OS === "android";

export function DesktopFilterBar(props: {
  board: BoardController;
  theme: PluginTheme;
  options: FilterOptions;
  menu: FilterMenu | null;
  setMenu(menu: FilterMenu | null): void;
}) {
  const { board, theme, options, menu, setMenu } = props;
  const scale = useTasksFontScale();
  const colors = theme.colors;
  const strings = board.strings;
  const { params, setParams, defaults } = board;
  const resolved = resolveBoardParams(params, defaults);
  // The two switches and the done window show their state on their own
  // controls; a chip beside them would only cost the bar a row.
  const chips = groupChips(activeChips(params, defaults, options, strings).filter((chip) => !BAR_OWN_CONTROLS.has(chip.key)), strings);
  // A folded chip whose picks dropped to one is a plain chip again: its menu goes with it.
  const groupGone = !!menu?.startsWith("chips:") && !chips.some((entry) => entry.key === `group:${menu.slice(6)}`);
  useEffect(() => {
    if (groupGone) setMenu(null);
  }, [groupGone, setMenu]);
  const count = (list: readonly unknown[]) => (list.length ? ` · ${list.length}` : "");
  const toggle = (menuId: FilterMenu) => setMenu(menu === menuId ? null : menuId);
  const folds = foldsToggles();
  const [unfolded, setUnfolded] = useState(false);
  const togglesOn = (resolved.filters.openTabsOnly ? 1 : 0) + (resolved.filters.hideSubtasks ? 1 : 0);
  const showToggles = !folds || unfolded;
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "flex-start",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        zIndex: 10,
      }}
    >
      {/* The filters and their chips wrap among themselves; the done window
          and the sort keep the first row's right end while the filters have
          FILTERS_MIN_WIDTH beside them, and wrap below them, still at the
          right, when they do not. */}
      <View style={{ flex: 1, minWidth: FILTERS_MIN_WIDTH, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, zIndex: menu && menu !== "sort" ? 2 : 1 }}>
        <MenuButton icon={FILTER_ICONS.project} label={strings.project + count(projectOptions(options).filter((project) => project.on))} open={menu === "project"} onPress={() => toggle("project")} theme={theme}>
          <CascadeMenu
            sections={projectMenuSections(options, strings, board.hostId, (project) => setParams((p) => toggleProject(p, project)))}
            theme={theme}
            width={260}
            top={taskControlHeight(28, scale) + 6}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon={FILTER_ICONS.workspace} label={strings.workspace + count(params.workspaceIds)} open={menu === "workspace"} onPress={() => toggle("workspace")} theme={theme}>
          <CascadeMenu
            sections={workspaceMenuSections(options, theme, strings, board.hostId, (id) => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, id) })))}
            theme={theme}
            width={300}
            top={taskControlHeight(28, scale) + 6}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon={FILTER_ICONS.agent} label={strings.agent + count(params.providers)} open={menu === "agent"} onPress={() => toggle("agent")} theme={theme}>
          <CascadeMenu
            sections={agentMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, providers: toggleItem(p.providers, id) })))}
            theme={theme}
            width={200}
            top={taskControlHeight(28, scale) + 6}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon={FILTER_ICONS.label} label={strings.labels + count(params.labels)} open={menu === "label"} onPress={() => toggle("label")} theme={theme}>
          <CascadeMenu
            sections={labelMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, labels: toggleItem(p.labels, id) })))}
            theme={theme}
            width={200}
            top={taskControlHeight(28, scale) + 6}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <Divider theme={theme} />
        {folds ? (
          <MoreButton
            open={unfolded}
            on={togglesOn}
            label={unfolded ? strings.fewerFilters : strings.moreFilters}
            onPress={() => setUnfolded((open) => !open)}
            theme={theme}
          />
        ) : null}
        {showToggles ? (
          <>
            <ToggleChip
              icon="AppWindow"
              label={strings.openTabs}
              hint={strings.openTabsHint}
              on={resolved.filters.openTabsOnly}
              onPress={() => setParams((p) => ({ ...p, openTabsOnly: !p.openTabsOnly }))}
              theme={theme}
            />
            <ToggleChip
              icon="ListTree"
              label={strings.hideSubtasks}
              hint={strings.hideSubtasksHint}
              on={resolved.filters.hideSubtasks}
              onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
              theme={theme}
            />
          </>
        ) : null}
        {/* "Clear all" follows the chips: with only the switches or the done
            window set, it would stand alone beside controls that already
            show their state. */}
        {chips.length ? (
          <>
            <Divider theme={theme} />
            {chips.map((entry) =>
              isChipGroup(entry) ? (
                <GroupChip
                  key={entry.key}
                  group={entry}
                  open={menu === `chips:${entry.kind}`}
                  onPress={() => toggle(`chips:${entry.kind}`)}
                  onClear={() => setParams(entry.clear)}
                  clearLabel={`${strings.clear} ${entry.label}`}
                  theme={theme}
                >
                  <CascadeMenu
                    sections={chipGroupMenuSections(entry, strings, setParams)}
                    theme={theme}
                    width={320}
                    top={taskControlHeight(28, scale) + 6}
                    align="left"
                    onClose={() => setMenu(null)}
                    testID="chip-group-menu"
                  />
                </GroupChip>
              ) : (
                <Chip key={entry.key} chip={entry} onClear={() => setParams(entry.clear)} clearLabel={`${strings.clear} ${entry.value}`} theme={theme} />
              ),
            )}
            <HoverPressable accessibilityRole="button" onPress={() => setParams(clearedParams)} style={() => ({ height: taskControlHeight(28, scale), paddingHorizontal: 4, justifyContent: "center" })}>
              <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foregroundMuted }}>{strings.clearAll}</Text>
            </HoverPressable>
          </>
        ) : null}
      </View>
      <View testID="filter-bar-end" style={{ flexShrink: 1, maxWidth: "100%", marginLeft: "auto", height: taskControlHeight(28, scale), flexDirection: "row", alignItems: "center", gap: 6, zIndex: menu === "sort" || menu === "laneWidth" ? 2 : 1 }}>
        <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foregroundMuted }}>{strings.doneWindowLabel}</Text>
        <WindowSegments
          value={resolved.doneWindow}
          onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))}
          theme={theme}
          strings={strings}
        />
        <Divider theme={theme} />
        <MenuButton
          icon="ArrowUpDown"
          label={params.sort ? sortLabel(params.sort, strings) : strings.sort}
          labelMaxWidth={SORT_LABEL_MAX_WIDTH}
          open={menu === "sort"}
          onPress={() => toggle("sort")}
          theme={theme}
        >
          <CascadeMenu
            sections={sortMenuSections(params.sort, strings, (sort) => setParams((p) => ({ ...p, sort })))}
            theme={theme}
            width={240}
            submenuWidth={200}
            top={taskControlHeight(28, scale) + 6}
            align="right"
            onClose={() => setMenu(null)}
            testID="sort-menu"
          />
        </MenuButton>
        <MenuButton
          icon="Columns3"
          label={strings.laneWidth.names[board.laneWidth]}
          accessibilityLabel={strings.laneWidth.button(strings.laneWidth.names[board.laneWidth])}
          open={menu === "laneWidth"}
          onPress={() => toggle("laneWidth")}
          theme={theme}
        >
          <CascadeMenu
            sections={laneWidthMenuSections(board.laneWidth, strings, board.setLaneWidth)}
            theme={theme}
            width={180}
            top={taskControlHeight(28, scale) + 6}
            align="right"
            onClose={() => setMenu(null)}
            testID="lane-width-menu"
          />
        </MenuButton>
      </View>
    </View>
  );
}


/**
 * An applied filter: its kind, its value and an X that clears it. A
 * multi-select filter's kind is its unit's icon, as on its folded chip; the
 * rest ("Title has", "Done") keep the muted word.
 */
function Chip(props: { chip: ActiveChip; onClear(): void; clearLabel: string; theme: PluginTheme }) {
  const { chip, theme } = props;
  const colors = theme.colors;
  const scale = useTasksFontScale();
  const unit = chip.unit ?? chip.group;
  return (
    <View style={{ height: taskControlHeight(28, scale), maxWidth: "100%", flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 4, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 6 }}>
      {unit ? (
        <View accessible accessibilityLabel={chip.kind}>
          <Icon name={FILTER_ICONS[unit]} size={14} color={colors.foregroundMuted} />
        </View>
      ) : chip.kind ? (
        <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foregroundMuted }}>{chip.kind}</Text>
      ) : null}
      <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foreground, maxWidth: 220, flexShrink: 1 }}>
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
    <View style={{ zIndex: props.open ? 20 : 0, maxWidth: "100%", flexShrink: 1 }}>
      <View
        style={{
          height: taskControlHeight(28, scale),
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
          })}
        >
          {props.group.counts.map(({ unit, count }) => (
            <View key={unit} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginRight: 4 }}>
              <Icon name={FILTER_ICONS[unit]} size={14} color={colors.foregroundMuted} />
              <Text style={{ fontSize: F.base, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{count}</Text>
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
      onPress={props.onPress}
      style={(hovered) => ({ width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? colors.surface2 : "transparent" })}
    >
      <Icon name="X" size={12} color={colors.foregroundMuted} />
    </HoverPressable>
  );
}

function Divider({ theme }: { theme: PluginTheme }) {
  return <View style={{ width: HAIRLINE, height: 16, marginHorizontal: 4, backgroundColor: theme.colors.border }} />;
}


/**
 * A filter's menu button. Its label stays on one line and ends in an ellipsis
 * rather than overflow the group it sits in, or past `labelMaxWidth`.
 */
function MenuButton(props: { icon: string; label: string; accessibilityLabel?: string; labelMaxWidth?: number; open: boolean; onPress(): void; theme: PluginTheme; children: ReactNode }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  return (
    <View style={{ zIndex: props.open ? 20 : 0, maxWidth: "100%", flexShrink: 1 }}>
      <HoverPressable
        accessibilityRole="button"
        accessibilityLabel={props.accessibilityLabel}
        accessibilityState={{ expanded: props.open }}
        onPress={props.onPress}
        style={(hovered) => ({
          height: taskControlHeight(28, scale),
          maxWidth: "100%",
          paddingHorizontal: 10,
          borderRadius: 6,
          borderWidth: HAIRLINE,
          borderColor: colors.border,
          backgroundColor: hovered || props.open ? colors.surface1 : "transparent",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
        })}
      >
        <Icon name={props.icon} size={13} color={colors.foregroundMuted} />
        <Text numberOfLines={1} style={{ flexShrink: 1, maxWidth: props.labelMaxWidth, fontSize: F.base, fontWeight: "500", color: colors.foreground }}>{props.label}</Text>
        <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
      </HoverPressable>
      {props.open ? props.children : null}
    </View>
  );
}



/**
 * The plus that shows the folded toggles; an X while they show. Folded with
 * a toggle on, it takes the accent and says how many, so a hidden filter
 * still shows that it filters.
 */
function MoreButton(props: { open: boolean; on: number; label: string; onPress(): void; theme: PluginTheme }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const tokens = taskTokens(props.theme);
  const marked = !props.open && props.on > 0;
  const tint = marked ? tokens.accentText : colors.foregroundMuted;
  return (
    <HoverPressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ expanded: props.open }}
      onPress={props.onPress}
      testID="filter-bar-more"
      style={(hovered) => ({
        height: taskControlHeight(28, scale),
        minWidth: 28,
        paddingHorizontal: marked ? 8 : 0,
        borderRadius: 6,
        borderWidth: HAIRLINE,
        borderColor: marked ? colors.accent : colors.border,
        backgroundColor: marked ? tokens.accentSoft : hovered || props.open ? colors.surface1 : "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
      })}
    >
      <Icon name={props.open ? "X" : "Plus"} size={14} color={tint} />
      {marked ? <Text style={{ fontSize: F.base, fontWeight: "500", color: tint, fontVariant: ["tabular-nums"] }}>{props.on}</Text> : null}
    </HoverPressable>
  );
}

function ToggleChip(props: { icon: string; label: string; hint?: string; on: boolean; onPress(): void; theme: PluginTheme }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  const tint = props.on ? taskTokens(props.theme).accentText : colors.foreground;
  return (
    <HoverPressable
      accessibilityRole="switch"
      accessibilityState={{ checked: props.on }}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      style={(hovered) => ({
        height: taskControlHeight(28, scale),
        maxWidth: "100%",
        flexShrink: 1,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: HAIRLINE,
        borderColor: props.on ? colors.accent : colors.border,
        backgroundColor: props.on ? taskTokens(props.theme).accentSoft : hovered ? colors.surface1 : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
      })}
    >
      <Icon name={props.icon} size={13} color={tint} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: F.base, fontWeight: "500", color: tint }}>{props.label}</Text>
    </HoverPressable>
  );
}
