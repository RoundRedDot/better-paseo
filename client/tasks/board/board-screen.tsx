import React, { useRef } from "react";
import type { View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { DesktopBoard } from "./desktop-board";
import { PhoneBoard } from "./phone-board";
import { useBoard, type BoardLayoutHandlers } from "./use-board";

/**
 * The Tasks board (`addScreen` id `tasks`): four lanes side by side on wide
 * layouts, one lane behind a tab bar on a phone (`layout.compact`). Filters
 * live in the session per host and travel as the screen's params; see
 * `params.ts`.
 */
export function TasksBoardScreen(props: PluginScreenProps) {
  const rootRef = useRef<View>(null);
  const handlers = useRef<BoardLayoutHandlers | null>(null);
  const board = useBoard(props, rootRef, handlers);
  const Layout = props.layout.compact ? PhoneBoard : DesktopBoard;
  return <Layout screen={props} board={board} rootRef={rootRef} handlers={handlers} />;
}
