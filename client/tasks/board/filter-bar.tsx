import React, { type ReactNode, type Ref } from "react";
import { Platform, Text, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { ProviderLogo } from "../../components/provider-logo";
import { taskTokens } from "../cards";
import { Checkbox, HoverPressable, WindowSegments } from "./board-parts";
import { activeChips, clearedParams, type FilterOption, type FilterOptions } from "./filter-options";
import { resolveBoardParams, toggleItem, type BoardParams } from "./params";
import type { BoardController } from "./use-board";

export type FilterMenu = "workspace" | "agent" | "label";

/**
 * The desktop board's two bars (prototype 01): the count, key hints and
 * search, then the filters, the applied-filter chips and the done window.
 */
export function DesktopToolbar(props: { board: BoardController; theme: PluginTheme; searchRef: Ref<NativeTextInput> }) {
  const { board, theme } = props;
  const colors = theme.colors;
  const strings = board.strings;
  return (
    <View style={{ height: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
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
          borderWidth: 1,
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
    <View style={{ minWidth: 16, height: 16, paddingHorizontal: 3, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 3, alignItems: "center", justifyContent: "center" }}>
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
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        zIndex: 10,
      }}
    >
      <MenuButton icon="Folder" label={strings.workspace + count(params.workspaceIds)} open={menu === "workspace"} onPress={() => toggle("workspace")} theme={theme}>
        <MenuPanel theme={theme} width={300} empty={options.workspaceGroups.length === 0 ? strings.noOptions : null}>
          {options.workspaceGroups.map((group, index) => (
            <View key={group.projectId || "missing"} style={{ marginTop: index ? 4 : 0 }}>
              <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 }}>
                <LetterAvatar name={group.projectName} theme={theme} />
                <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "500", color: colors.foregroundMuted }}>
                  {group.projectName}
                </Text>
              </View>
              {group.items.map((item) => (
                <MenuRow
                  key={item.id}
                  option={item}
                  theme={theme}
                  indent
                  onPress={() => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, item.id) }))}
                />
              ))}
            </View>
          ))}
        </MenuPanel>
      </MenuButton>
      <MenuButton icon="Bot" label={strings.agent + count(params.providers)} open={menu === "agent"} onPress={() => toggle("agent")} theme={theme}>
        <MenuPanel theme={theme} width={200} empty={options.agents.length === 0 ? strings.noOptions : null}>
          {options.agents.map((agent) => (
            <MenuRow
              key={agent.id}
              option={agent}
              theme={theme}
              leading={<ProviderLogo provider={agent.id} size={16} />}
              onPress={() => setParams((p) => ({ ...p, providers: toggleItem(p.providers, agent.id) }))}
            />
          ))}
        </MenuPanel>
      </MenuButton>
      <MenuButton icon="Tag" label={strings.labels + count(params.labels)} open={menu === "label"} onPress={() => toggle("label")} theme={theme}>
        <MenuPanel theme={theme} width={200} empty={options.labels.length === 0 ? strings.noOptions : null}>
          {options.labels.map((label) => (
            <MenuRow
              key={label.id}
              option={label}
              theme={theme}
              leading={<View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: label.color ?? colors.foregroundMuted }} />}
              onPress={() => setParams((p) => ({ ...p, labels: toggleItem(p.labels, label.id) }))}
            />
          ))}
        </MenuPanel>
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
        on={resolved.filters.hideSubtasks}
        onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
        theme={theme}
      />
      {resolved.filters.openTabsOnly ? <Text style={{ fontSize: 11, color: colors.foregroundMuted }}>{strings.openTabsHint}</Text> : null}
      {chips.length ? (
        <>
          <Divider theme={theme} />
          {chips.map((chip) => (
            <View
              key={chip.key}
              style={{ height: 28, flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 10, paddingRight: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 6 }}
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
      <View style={{ flex: 1 }} />
      <Text style={{ fontSize: 13, color: colors.foregroundMuted }}>{strings.doneWindowLabel}</Text>
      <WindowSegments
        value={resolved.doneWindow}
        onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))}
        theme={theme}
        strings={strings}
      />
    </View>
  );
}

function Divider({ theme }: { theme: PluginTheme }) {
  return <View style={{ width: 1, height: 16, marginHorizontal: 4, backgroundColor: theme.colors.border }} />;
}

export function LetterAvatar({ name, theme, size = 14 }: { name: string; theme: PluginTheme; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: 3, borderWidth: 1, borderColor: theme.colors.foregroundMuted, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontSize: size - 6, fontWeight: "600", color: theme.colors.foregroundMuted }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
    </View>
  );
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
          borderWidth: 1,
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

function MenuPanel(props: { theme: PluginTheme; width: number; empty: string | null; children: ReactNode }) {
  const colors = props.theme.colors;
  return (
    <View
      style={{
        position: "absolute",
        top: 32,
        left: 0,
        width: props.width,
        maxHeight: 420,
        padding: 4,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface0,
        boxShadow: taskTokens(props.theme).popoverShadow,
        elevation: 8,
      }}
    >
      {props.empty ? (
        <Text style={{ padding: 8, fontSize: 12, color: colors.foregroundMuted }}>{props.empty}</Text>
      ) : (
        <ScrollView style={{ maxHeight: 410 }}>{props.children}</ScrollView>
      )}
    </View>
  );
}

function MenuRow(props: { option: FilterOption; theme: PluginTheme; onPress(): void; leading?: ReactNode; indent?: boolean }) {
  const colors = props.theme.colors;
  const { option } = props;
  return (
    <HoverPressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: option.on }}
      onPress={props.onPress}
      style={(hovered) => ({
        height: 30,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: props.indent ? 28 : 8,
        paddingRight: 8,
        borderRadius: 5,
        backgroundColor: hovered ? colors.surface1 : "transparent",
      })}
    >
      <Checkbox on={option.on} theme={props.theme} />
      {props.leading}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: colors.foreground }}>
        {option.label}
      </Text>
      <Text style={{ minWidth: 12, textAlign: "right", fontSize: 13, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{option.count}</Text>
    </HoverPressable>
  );
}

function ToggleChip(props: { icon: string; label: string; hint?: string; on: boolean; onPress(): void; theme: PluginTheme }) {
  const colors = props.theme.colors;
  const tint = props.on ? colors.accent : colors.foreground;
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
        borderWidth: 1,
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
