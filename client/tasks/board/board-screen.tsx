import React, { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TasksTypography } from "../typography";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useTasksLanguage } from "../i18n";
import { HAIRLINE } from "./board-style";
import { DesktopBoard } from "./desktop-board";
import { MenuBoundsContext } from "./menu";
import { tasksSettingsOpener, useTasksEnabledStore, useTasksSettings } from "./enabled";
import { boardIsCompact } from "./navigation";
import { PhoneBoard } from "./phone-board";
import { BOARD_STRINGS } from "./strings";
import { useBoard, type BoardLayoutHandlers } from "./use-board";

/**
 * The Tasks board (`addScreen` id `tasks`): four lanes side by side on wide
 * layouts, one lane behind a tab bar on a phone or a board too narrow for
 * two lanes (`boardIsCompact`). Filters
 * live in the session per host and travel as the screen's params; see
 * `params.ts`.
 *
 * Always registered, so a reload, a restored tab or a link resolves before
 * the settings arrive (the host resolves the route once). It mounts only
 * when open. Off, it says so and how to turn it on, from what the startup
 * read or the settings page already told the store: no read of its own.
 * While the startup read is out it draws an empty page and waits for it;
 * without one (or after it failed) it reads the settings itself.
 */
export function TasksBoardScreen(props: PluginScreenProps) {
  const store = useTasksEnabledStore();
  // Off, as the startup read or the settings page said: say so, and read nothing more.
  if (store.enabled === false) return <BoardOff {...props} />;
  // The startup read is still out: wait for it rather than read a second time.
  if (store.enabled === null && store.startupRead === "pending") return <BoardBlank {...props} />;
  return <BoardReader {...props} />;
}

/** The settings, read (or shared with the board's own read when on), and followed. */
function BoardReader(props: PluginScreenProps) {
  const settings = useTasksSettings();
  if (!settings) return <BoardBlank {...props} />;
  if (!settings.enabled) return <BoardOff {...props} />;
  return <BoardContent {...props} />;
}

function BoardBlank(props: PluginScreenProps) {
  return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
}

/**
 * The layout follows the board's own width as well as the host's: a wide
 * host whose board is too narrow for two lanes (a split pane) switches to
 * the phone layout once measured. Until then it draws as the host says, so
 * a warm board still draws at once.
 */
function BoardContent(props: PluginScreenProps) {
  const rootRef = useRef<View>(null);
  const handlers = useRef<BoardLayoutHandlers | null>(null);
  const [width, setWidth] = useState(0);
  const compact = boardIsCompact(props.layout.compact, width);
  const board = useBoard(props, rootRef, handlers, compact);
  const Layout = compact ? PhoneBoard : DesktopBoard;
  return (
    <TasksTypography theme={props.theme}>
      <View
        style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }}
        onLayout={props.layout.compact ? undefined : (event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
      >
        <MenuBoundsContext.Provider value={rootRef}>
          <Layout screen={props} board={board} rootRef={rootRef} handlers={handlers} />
        </MenuBoundsContext.Provider>
      </View>
    </TasksTypography>
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
