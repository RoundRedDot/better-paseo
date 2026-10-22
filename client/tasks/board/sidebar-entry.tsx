import React, { type ReactNode } from "react";
import { View } from "react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import type { SidebarCount } from "../../../shared/tasks-settings";
import { StatusIcon, useTaskTokens } from "../cards";
import { useTaskCounts } from "../data";
import { LANE_STATUS } from "../model";
import { HOST_FONT, TaskText as Text, TasksTypography } from "../typography";
import { useTasksLanguage } from "../i18n";
import { useTasksSettings } from "./enabled";
import { sidebarCountParts, sidebarCountText } from "./navigation";
import { encodeBoardParams, lastBoardParams } from "./params";
import { useBoardIntent } from "./prefetch";
import { BOARD_STRINGS } from "./strings";

/** The board's screen id; mirrors `TASKS_SCREEN_ID` in `contribute.tsx`, which imports this file. */
const SCREEN_ID = "tasks";

/**
 * The sidebar's Tasks row (prototype 03): highlighted while the board is
 * open, with "input · running · review" counts on the right per `sidebar.count`.
 * Opens the board with the filters it showed last in this session.
 *
 * Nothing at all while the settings load or the board is off: no row, and
 * no agent subscription (the counts live in a child that mounts only when
 * the row shows counts; only `all` lists the unread and failed agents).
 * The host wraps an item only in providers, so a null item leaves no gap.
 */
export function TasksSidebarEntry(props: PluginSidebarItemProps) {
  const settings = useTasksSettings();
  const language = useTasksLanguage();
  if (!settings?.enabled) return null;
  const mode = settings.sidebar.count;
  const label = BOARD_STRINGS[language].name;
  return mode === "none" ? <TasksRow {...props} label={label} /> : <CountedTasksRow {...props} label={label} mode={mode} />;
}

/**
 * The row in a plain wrapper that warms the board on intent (`prefetch.ts`):
 * pointer over it or focus on web, a touch on iOS and Android. The host's
 * row takes no hover or press-in handler of its own.
 */
function TasksRow(props: PluginSidebarItemProps & { label: string; trailing?: ReactNode }) {
  const intent = useBoardIntent(usePaseo());
  return (
    <View {...intent}>
      <SidebarRow
        icon="SquareKanban"
        label={props.label}
        active={props.currentScreen?.screenId === SCREEN_ID}
        trailing={props.trailing}
        onPress={() => props.openScreen({ screenId: SCREEN_ID, params: encodeBoardParams(lastBoardParams(props.host.id)) })}
      />
    </View>
  );
}

/** Needs input, running and review, in the board's lane order; needs input in the warning colour. */
function CountedTasksRow(props: PluginSidebarItemProps & { label: string; mode: Exclude<SidebarCount, "none"> }) {
  const paseo = usePaseo();
  const counts = useTaskCounts(paseo, props.mode === "all");
  const language = useTasksLanguage();
  const parts = sidebarCountParts(counts, counts.ready ? props.mode : "none");
  const colors = props.theme.colors;
  const warning = useTaskTokens(props.theme).status.warning;
  const trailing =
    parts.length > 0 ? (
      // The host's row scales its own label with the interface size; the counts follow the same ramp.
      <TasksTypography theme={props.theme}>
        <View accessible accessibilityLabel={sidebarCountText(parts, language)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {parts.map((part) => {
            const input = part.lane === "needs_input";
            return (
              <View key={part.lane} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <StatusIcon kind={LANE_STATUS[part.lane]} size={14} theme={props.theme} />
                <Text
                  style={{
                    fontSize: HOST_FONT.sm,
                    ...(input ? { fontWeight: "600" as const } : null),
                    color: input ? warning : colors.foregroundMuted,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {part.count}
                </Text>
              </View>
            );
          })}
        </View>
      </TasksTypography>
    ) : undefined;
  return <TasksRow {...props} trailing={trailing} />;
}
