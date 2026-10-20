import React, { type ReactNode, type Ref } from "react";
import { Platform, Text, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
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

/**
 * The desktop board's two bars (prototype 01): the count, key hints and
 * search, then the filters, the applied-filter chips and the done window.
 */
export function DesktopToolbar(props: { board: BoardController; theme: PluginTheme; searchRef: Ref<NativeTextInput> }) {
  const { board, theme } = props;
  const colors = theme.colors;
  const strings = board.strings;
  return (
    <View style={{ height: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, fontVariant: ["tabular-nums"] }}>{strings.total(board.total)}</Text>
      <View style={{ flex: 1 }} />
      {Platform.OS === "web" ? (
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
          <KeyHint text={strings.keys.search} theme={theme} last />
        </View>
      ) : null}
      <View
        style={{
          height: 28,
          width: 220,
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
          style={{ flex: 1, minWidth: 0, padding: 0, fontSize: 13, color: colors.foreground }}
        />
      </View>
    </View>
  );
}

function KeyCap({ label, theme }: { label: string; theme: PluginTheme }) {
  return (
    <View style={{ minWidth: 16, height: 16, paddingHorizontal: 3, borderWidth: HAIRLINE, borderColor: theme.colors.border, borderRadius: 3, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{label}</Text>
    </View>
  );
}

function KeyHint({ text, theme, last }: { text: string; theme: PluginTheme; last?: boolean }) {
  return <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted, marginRight: last ? 0 : 6 }}>{text}</Text>;
}

export function DesktopFilterBar(props: {
  board: BoardController;
  theme: PluginTheme;
  options: FilterOptions;
  menu: FilterMenu | null;
  setMenu(menu: FilterMenu | null): void;
}) {
  const { board, theme, options, menu, setMenu } = props;
  const colors = theme.colors;
  const strings = board.strings;
  const { params, setParams, defaults } = board;
  const resolved = resolveBoardParams(params, defaults);
  const chips = activeChips(params, defaults, options, strings);
  const count = (list: readonly string[]) => (list.length ? ` · ${list.length}` : "");
  const toggle = (menuId: FilterMenu) => setMenu(menu === menuId ? null : menuId);
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        zIndex: 10,
      }}
    >
      {/* The filters and their chips wrap among themselves; the done window
          and the sort keep the first row's right end. */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, zIndex: menu && menu !== "sort" ? 2 : 1 }}>
        <MenuButton icon="Folder" label={strings.workspace + count(params.workspaceIds)} open={menu === "workspace"} onPress={() => toggle("workspace")} theme={theme}>
          <CascadeMenu
            sections={workspaceMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, id) })))}
            theme={theme}
            width={300}
            top={34}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon="Bot" label={strings.agent + count(params.providers)} open={menu === "agent"} onPress={() => toggle("agent")} theme={theme}>
          <CascadeMenu
            sections={agentMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, providers: toggleItem(p.providers, id) })))}
            theme={theme}
            width={240}
            top={34}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <MenuButton icon="Tag" label={strings.labels + count(params.labels)} open={menu === "label"} onPress={() => toggle("label")} theme={theme}>
          <CascadeMenu
            sections={labelMenuSections(options, theme, strings, (id) => setParams((p) => ({ ...p, labels: toggleItem(p.labels, id) })))}
            theme={theme}
            width={240}
            top={34}
            align="left"
            onClose={() => setMenu(null)}
          />
        </MenuButton>
        <Divider theme={theme} />
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
        {resolved.filters.openTabsOnly ? <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{strings.openTabsHint}</Text> : null}
        {resolved.filters.hideSubtasks ? <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{strings.hideSubtasksHint}</Text> : null}
        {chips.length ? (
          <>
            <Divider theme={theme} />
            {chips.map((chip) => (
              <View
                key={chip.key}
                style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 4, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 6 }}
              >
                {chip.kind ? <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{chip.kind}</Text> : null}
                <Text numberOfLines={1} style={{ fontSize: 13, color: colors.foreground, maxWidth: 220 }}>
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
            <HoverPressable accessibilityRole="button" onPress={() => setParams(clearedParams)} style={() => ({ height: 28, paddingHorizontal: 4, justifyContent: "center" })}>
              <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{strings.clearAll}</Text>
            </HoverPressable>
          </>
        ) : null}
      </View>
      <View testID="filter-bar-end" style={{ flexShrink: 0, height: 28, flexDirection: "row", alignItems: "center", gap: 6, zIndex: menu === "sort" ? 2 : 1 }}>
        <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{strings.doneWindowLabel}</Text>
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
          open={menu === "sort"}
          onPress={() => toggle("sort")}
          theme={theme}
        >
          <CascadeMenu
            sections={sortMenuSections(params.sort, strings, (sort) => setParams((p) => ({ ...p, sort })))}
            theme={theme}
            width={240}
            submenuWidth={200}
            top={34}
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


function MenuButton(props: { icon: string; label: string; open: boolean; onPress(): void; theme: PluginTheme; children: ReactNode }) {
  const colors = props.theme.colors;
  return (
    <View style={{ zIndex: props.open ? 20 : 0 }}>
      <HoverPressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        onPress={props.onPress}
        style={(hovered) => ({
          height: 28,
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
        <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground }}>{props.label}</Text>
        <Icon name="ChevronDown" size={12} color={colors.foregroundMuted} />
      </HoverPressable>
      {props.open ? props.children : null}
    </View>
  );
}



function ToggleChip(props: { icon: string; label: string; hint?: string; on: boolean; onPress(): void; theme: PluginTheme }) {
  const colors = props.theme.colors;
  const tint = props.on ? taskTokens(props.theme).accentText : colors.foreground;
  return (
    <HoverPressable
      accessibilityRole="switch"
      accessibilityState={{ checked: props.on }}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      style={(hovered) => ({
        height: 28,
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
      <Text style={{ fontSize: 13, fontWeight: "500", color: tint }}>{props.label}</Text>
    </HoverPressable>
  );
}
