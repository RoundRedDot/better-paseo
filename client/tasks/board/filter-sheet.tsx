import React, { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { ProviderLogo } from "../../components/provider-logo";
import { taskTokens } from "../cards";
import { Checkbox, WindowSegments } from "./board-parts";
import { HAIRLINE } from "./board-style";
import { LetterAvatar } from "./filter-bar";
import { clearedParams, type FilterOption, type FilterOptions } from "./filter-options";
import { resolveBoardParams, toggleItem } from "./params";
import type { BoardController } from "./use-board";

/** The phone's filters (prototype 04 · 过滤 sheet), drawn inside the host's bottom sheet. */
export function FilterSheetBody(props: { board: BoardController; theme: PluginTheme; options: FilterOptions; onDone(): void }) {
  const { board, theme, options } = props;
  const colors = theme.colors;
  const strings = board.strings;
  const { setParams, defaults } = board;
  const resolved = resolveBoardParams(board.params, defaults);
  return (
    <View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Pressable accessibilityRole="button" onPress={() => setParams(clearedParams)} style={{ height: 36, paddingHorizontal: 4, justifyContent: "center" }}>
            <Text style={{ fontSize: 15, color: colors.foregroundMuted }}>{strings.reset}</Text>
          </Pressable>
        </View>
        <SectionTitle text={strings.workspace} theme={theme} first />
        {options.workspaceGroups.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
        {options.workspaceGroups.map((group) => (
          <View key={group.projectId || "missing"}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, paddingBottom: 6 }}>
              <LetterAvatar name={group.projectName} theme={theme} size={16} />
              <Text style={{ fontSize: 13, color: colors.foreground }}>{group.projectName}</Text>
            </View>
            <ChipWrap>
              {group.items.map((item) => (
                <Chip
                  key={item.id}
                  option={item}
                  theme={theme}
                  onPress={() => setParams((p) => ({ ...p, workspaceIds: toggleItem(p.workspaceIds, item.id) }))}
                />
              ))}
            </ChipWrap>
          </View>
        ))}
        <SectionTitle text={strings.agent} theme={theme} />
        {options.agents.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
        <ChipWrap>
          {options.agents.map((agent) => (
            <Chip
              key={agent.id}
              option={agent}
              theme={theme}
              leading={<ProviderLogo provider={agent.id} size={16} />}
              hideCount
              onPress={() => setParams((p) => ({ ...p, providers: toggleItem(p.providers, agent.id) }))}
            />
          ))}
        </ChipWrap>
        <SectionTitle text={strings.labels} theme={theme} />
        {options.labels.length === 0 ? <Muted text={strings.noOptions} theme={theme} /> : null}
        <ChipWrap>
          {options.labels.map((label) => (
            <Chip
              key={label.id}
              option={label}
              theme={theme}
              leading={<View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: label.color ?? colors.foregroundMuted }} />}
              onPress={() => setParams((p) => ({ ...p, labels: toggleItem(p.labels, label.id) }))}
            />
          ))}
        </ChipWrap>
        <View style={{ height: HAIRLINE, marginTop: 16, marginBottom: 4, backgroundColor: colors.border }} />
        <ToggleRow
          icon="AppWindow"
          label={strings.openTabs}
          hint={strings.openTabsHint}
          on={resolved.filters.openTabsOnly}
          theme={theme}
          onPress={() => setParams((p) => ({ ...p, openTabsOnly: !p.openTabsOnly }))}
        />
        <ToggleRow
          icon="ListTree"
          label={strings.hideSubtasks}
          hint={strings.hideSubtasksHint}
          on={resolved.filters.hideSubtasks}
          theme={theme}
          onPress={() => setParams((p) => ({ ...p, hideSubtasks: !(p.hideSubtasks ?? defaults.hideSubtasks) }))}
        />
        <Text style={{ paddingTop: 12, paddingBottom: 8, fontSize: 12, fontWeight: "500", color: colors.foregroundMuted }}>{strings.doneRange}</Text>
        <WindowSegments value={resolved.doneWindow} onChange={(doneWindow) => setParams((p) => ({ ...p, doneWindow }))} theme={theme} strings={strings} large stretch />
      </View>
      <View style={{ paddingTop: 12, paddingHorizontal: 16, borderTopWidth: HAIRLINE, borderTopColor: colors.border }}>
        <Pressable
          accessibilityRole="button"
          onPress={props.onDone}
          style={{ height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.accentForeground, fontVariant: ["tabular-nums"] }}>{strings.show(board.total)}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SectionTitle({ text, theme, first }: { text: string; theme: PluginTheme; first?: boolean }) {
  return (
    <Text style={{ paddingTop: first ? 0 : 16, paddingBottom: first ? 0 : 8, fontSize: 12, fontWeight: "500", color: theme.colors.foregroundMuted }}>{text}</Text>
  );
}

function Muted({ text, theme }: { text: string; theme: PluginTheme }) {
  return <Text style={{ paddingVertical: 6, fontSize: 13, color: theme.colors.foregroundMuted }}>{text}</Text>;
}

function ChipWrap({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

function Chip(props: { option: FilterOption; theme: PluginTheme; onPress(): void; leading?: ReactNode; hideCount?: boolean }) {
  const colors = props.theme.colors;
  const on = props.option.on;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={props.onPress}
      style={{
        height: 32,
        maxWidth: "100%",
        paddingLeft: props.leading ? 8 : 12,
        paddingRight: 12,
        borderWidth: HAIRLINE,
        borderColor: on ? colors.accent : colors.border,
        borderRadius: 4,
        backgroundColor: on ? taskTokens(props.theme).accentSoft : "transparent",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
      }}
    >
      {props.leading}
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, color: on ? colors.accent : colors.foreground }}>
        {props.option.label}
      </Text>
      {props.hideCount ? null : (
        <Text style={{ fontSize: 12, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{props.option.count}</Text>
      )}
    </Pressable>
  );
}

function ToggleRow(props: { icon: string; label: string; hint?: string; on: boolean; theme: PluginTheme; onPress(): void }) {
  const colors = props.theme.colors;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.on }}
      onPress={props.onPress}
      style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12 }}
    >
      <Icon name={props.icon} size={18} color={colors.foregroundMuted} />
      <View style={{ flex: 1, paddingVertical: 6 }}>
        <Text style={{ fontSize: 15, color: colors.foreground }}>{props.label}</Text>
        {props.hint ? <Text style={{ fontSize: 12, lineHeight: 16, color: colors.foregroundMuted }}>{props.hint}</Text> : null}
      </View>
      <Checkbox on={props.on} theme={props.theme} size={20} />
    </Pressable>
  );
}
