import React from "react";
import { Text, View } from "react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS } from "../../../shared/tasks-settings";
import { StatusIcon, useTaskTokens } from "../cards";
import { useTaskCounts } from "../data";
import { useTasksLanguage } from "../i18n";
import type { StatusKind } from "../model";
import { sidebarCountParts, sidebarCountText } from "./navigation";
import { encodeBoardParams, lastBoardParams } from "./params";

/** The board's screen id; mirrors `TASKS_SCREEN_ID` in `contribute.tsx`, which imports this file. */
const SCREEN_ID = "tasks";

/**
 * The sidebar's Tasks row (prototype 03): highlighted while the board is
 * open, with "running · input" counts on the right per `sidebar.count`.
 * Opens the board with the filters it showed last in this session.
 */
export function TasksSidebarEntry(props: PluginSidebarItemProps) {
  const paseo = usePaseo();
  const counts = useTaskCounts(paseo);
  const settings = useSettings(TASKS_SETTINGS);
  const mode = (settings.status === "ready" ? settings.values : DEFAULT_TASKS_SETTINGS).sidebar.count;
  const language = useTasksLanguage();
  const parts = sidebarCountParts(counts, counts.ready ? mode : "none");
  const colors = props.theme.colors;
  const warning = useTaskTokens(props.theme).status.warning;
  const trailing =
    parts.running !== null || parts.input !== null ? (
      <View accessible accessibilityLabel={sidebarCountText(parts, language)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {parts.running !== null ? (
          <SidebarCount count={parts.running} kind="running" idleIcon="LoaderCircle" color={colors.foregroundMuted} theme={props.theme} />
        ) : null}
        {parts.input !== null ? (
          <SidebarCount count={parts.input} kind="needs_input" idleIcon="CircleAlert" color={warning} theme={props.theme} strong />
        ) : null}
      </View>
    ) : undefined;
  return (
    <SidebarRow
      icon="SquareKanban"
      label="Tasks"
      active={props.currentScreen?.screenId === SCREEN_ID}
      trailing={trailing}
      onPress={() => props.openScreen({ screenId: SCREEN_ID, params: encodeBoardParams(lastBoardParams(props.host.id)) })}
    />
  );
}

/** One count: its status icon and number, or, at zero, a static muted icon and "0". */
function SidebarCount(props: { count: number; kind: StatusKind; idleIcon: string; color: string; theme: PluginTheme; strong?: boolean }) {
  const muted = props.theme.colors.foregroundMuted;
  const zero = props.count === 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
      {zero ? <Icon name={props.idleIcon} size={14} color={muted} /> : <StatusIcon kind={props.kind} size={14} theme={props.theme} />}
      <Text style={{ fontSize: 12, fontWeight: props.strong && !zero ? "600" : "400", color: zero ? muted : props.color, fontVariant: ["tabular-nums"] }}>{props.count}</Text>
    </View>
  );
}
