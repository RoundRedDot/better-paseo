import React from "react";
import { Text, View } from "react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS } from "../../../shared/tasks-settings";
import { StatusIcon, useTaskTokens } from "../cards";
import { useTaskCounts } from "../data";
import { useTasksLanguage } from "../i18n";
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <StatusIcon kind="running" size={14} theme={props.theme} />
            <Text style={{ fontSize: 12, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{parts.running}</Text>
          </View>
        ) : null}
        {parts.input !== null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <StatusIcon kind="needs_input" size={14} theme={props.theme} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: warning, fontVariant: ["tabular-nums"] }}>{parts.input}</Text>
          </View>
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
