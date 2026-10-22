import React, { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_FONT as F, HOST_LINE, useTasksFontScale, taskControlHeight } from "../typography";
import { taskTokens } from "../cards";
import { HoverPressable, WindowSegments } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { activeChips, clearedParams, type FilterOptions } from "./filter-options";
import { resolveBoardParams, toggleItem } from "./params";
import { sortLabel } from "./strings";
import { agentMenuSections, labelMenuSections, sortMenuSections, workspaceMenuSections } from "./board-menus";
import { CascadeMenu } from "./menu";
import type { BoardController } from "./use-board";

export type FilterMenu = "workspace" | "agent" | "label" | "sort";

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
  /** The details sidebar's switch at the bar's right end. */
  sidebar?: { open: boolean; onToggle(): void };
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
      {props.sidebar ? <SidebarSwitch open={props.sidebar.open} onToggle={props.sidebar.onToggle} theme={theme} label={props.sidebar.open ? strings.sidebar.hide : strings.sidebar.show} /> : null}
    </View>
  );
}

/** Linear's panel switch: a 28 round button, outlined, filled grey while the sidebar shows. */
function SidebarSwitch(props: { open: boolean; onToggle(): void; theme: PluginTheme; label: string }) {
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
      <Icon name="PanelRight" size={15} color={props.open ? colors.foreground : colors.foregroundMuted} />
    </Pressable>
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
  const chips = activeChips(params, defaults, options, strings);
  const count = (list: readonly string[]) => (list.length ? ` · ${list.length}` : "");
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
        <MenuButton icon="Folder" label={strings.workspace + count(params.workspaceIds)} open={menu === "workspace"} onPress={() => toggle("workspace")} theme={theme}>
          <CascadeMenu
            sections={workspaceMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, id) })))}
            theme={theme}
            width={300}
            top={taskControlHeight(28, scale) + 6}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon="Bot" label={strings.agent + count(params.providers)} open={menu === "agent"} onPress={() => toggle("agent")} theme={theme}>
          <CascadeMenu
            sections={agentMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, providers: toggleItem(p.providers, id) })))}
            theme={theme}
            width={240}
            top={taskControlHeight(28, scale) + 6}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon="Tag" label={strings.labels + count(params.labels)} open={menu === "label"} onPress={() => toggle("label")} theme={theme}>
          <CascadeMenu
            sections={labelMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, labels: toggleItem(p.labels, id) })))}
            theme={theme}
            width={240}
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
            {resolved.filters.openTabsOnly ? <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{strings.openTabsHint}</Text> : null}
            {resolved.filters.hideSubtasks ? <Text style={{ fontSize: F.sm, color: colors.foregroundMuted }}>{strings.hideSubtasksHint}</Text> : null}
          </>
        ) : null}
        {chips.length ? (
          <>
            <Divider theme={theme} />
            {chips.map((chip) => (
              <View
                key={chip.key}
                style={{ height: taskControlHeight(28, scale), maxWidth: "100%", flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 4, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 6 }}
              >
                {chip.kind ? <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foregroundMuted }}>{chip.kind}</Text> : null}
                <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foreground, maxWidth: 220, flexShrink: 1 }}>
                  {chip.value}
                </Text>
                <HoverPressable
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.clear} ${chip.value}`}
                  onPress={() => setParams(chip.clear)}
                  style={(hovered) => ({ width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? colors.surface2 : "transparent" })}
                >
                  <Icon name="X" size={12} color={colors.foregroundMuted} />
                </HoverPressable>
              </View>
            ))}
            <HoverPressable accessibilityRole="button" onPress={() => setParams(clearedParams)} style={() => ({ height: taskControlHeight(28, scale), paddingHorizontal: 4, justifyContent: "center" })}>
              <Text numberOfLines={1} style={{ fontSize: F.base, color: colors.foregroundMuted }}>{strings.clearAll}</Text>
            </HoverPressable>
          </>
        ) : null}
      </View>
      <View testID="filter-bar-end" style={{ flexShrink: 1, maxWidth: "100%", marginLeft: "auto", height: taskControlHeight(28, scale), flexDirection: "row", alignItems: "center", gap: 6, zIndex: menu === "sort" ? 2 : 1 }}>
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
      </View>
    </View>
  );
}


function Divider({ theme }: { theme: PluginTheme }) {
  return <View style={{ width: HAIRLINE, height: 16, marginHorizontal: 4, backgroundColor: theme.colors.border }} />;
}


/**
 * A filter's menu button. Its label stays on one line and ends in an ellipsis
 * rather than overflow the group it sits in, or past `labelMaxWidth`.
 */
function MenuButton(props: { icon: string; label: string; labelMaxWidth?: number; open: boolean; onPress(): void; theme: PluginTheme; children: ReactNode }) {
  const colors = props.theme.colors;
  const scale = useTasksFontScale();
  return (
    <View style={{ zIndex: props.open ? 20 : 0, maxWidth: "100%", flexShrink: 1 }}>
      <HoverPressable
        accessibilityRole="button"
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
