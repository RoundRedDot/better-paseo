import React, { useRef } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useTasksLanguage } from "../i18n";
import { HAIRLINE } from "./board-style";
import { DesktopBoard } from "./desktop-board";
import { MenuBoundsContext } from "./menu";
import { tasksSettingsOpener, useTasksSettings } from "./enabled";
import { PhoneBoard } from "./phone-board";
import { BOARD_STRINGS } from "./strings";
import { useBoard, type BoardLayoutHandlers } from "./use-board";

/**
 * The Tasks board (`addScreen` id `tasks`): four lanes side by side on wide
 * layouts, one lane behind a tab bar on a phone (`layout.compact`). Filters
 * live in the session per host and travel as the screen's params; see
 * `params.ts`.
 *
 * Always registered, so a reload, a restored tab or a link resolves before
 * the settings arrive (the host resolves the route once). It mounts only
 * when open: while the settings load it draws an empty page, while the
 * board is off it says so; neither subscribes to anything.
 */
export function TasksBoardScreen(props: PluginScreenProps) {
  const settings = useTasksSettings();
  if (!settings) return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
  if (!settings.enabled) return <BoardOff {...props} />;
  return <BoardContent {...props} />;
}

function BoardContent(props: PluginScreenProps) {
  const rootRef = useRef<View>(null);
  const handlers = useRef<BoardLayoutHandlers | null>(null);
  const board = useBoard(props, rootRef, handlers);
  const Layout = props.layout.compact ? PhoneBoard : DesktopBoard;
  return (
    <MenuBoundsContext.Provider value={rootRef}>
      <Layout screen={props} board={board} rootRef={rootRef} handlers={handlers} />
    </MenuBoundsContext.Provider>
  );
}

function BoardOff(props: PluginScreenProps) {
  const strings = BOARD_STRINGS[useTasksLanguage()];
  const colors = props.theme.colors;
  const open = tasksSettingsOpener();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.surface0 }}>
      <View style={{ maxWidth: 360, alignItems: "center", gap: 8 }}>
        <Icon name="SquareKanban" size={20} color={colors.foregroundMuted} />
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>{strings.boardOff}</Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: colors.foregroundMuted, textAlign: "center" }}>{strings.boardOffHint}</Text>
        {open ? (
          <Pressable
            accessibilityRole="button"
            onPress={open}
            style={{ marginTop: 6, height: 32, paddingHorizontal: 14, borderRadius: 6, borderWidth: HAIRLINE, borderColor: colors.border, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground }}>{strings.openSettings}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
