import React, { useRef } from "react";
import { View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { DesktopBoard } from "./desktop-board";
import { useTasksSettings } from "./enabled";
import { PhoneBoard } from "./phone-board";
import { useBoard, type BoardLayoutHandlers } from "./use-board";

/**
 * The Tasks board (`addScreen` id `tasks`): four lanes side by side on wide
 * layouts, one lane behind a tab bar on a phone (`layout.compact`). Filters
 * live in the session per host and travel as the screen's params; see
 * `params.ts`.
 *
 * Registered only while the board is enabled. While its settings load, or
 * in the moment between another client turning it off and the screen being
 * unregistered, it draws an empty page and subscribes to nothing.
 */
export function TasksBoardScreen(props: PluginScreenProps) {
  const settings = useTasksSettings();
  if (!settings?.enabled) return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
  return <BoardContent {...props} />;
}

function BoardContent(props: PluginScreenProps) {
  const rootRef = useRef<View>(null);
  const handlers = useRef<BoardLayoutHandlers | null>(null);
  const board = useBoard(props, rootRef, handlers);
  const Layout = props.layout.compact ? PhoneBoard : DesktopBoard;
  return <Layout screen={props} board={board} rootRef={rootRef} handlers={handlers} />;
}
