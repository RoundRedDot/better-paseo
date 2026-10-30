import React from "react";
import { Platform, View } from "react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useTasksSettings } from "../board/enabled";
import { encodeBoardParams, lastBoardParams } from "../board/params";
import { BOARD_STRINGS } from "../board/strings";
import { useTasksLanguage } from "../i18n";
import { loadMark } from "../../debug/load-marks";
import { requestChunk } from "./source";

/** The board's screen id; mirrors `TASKS_SCREEN_ID` in `contribute.tsx`. */
const SCREEN_ID = "tasks";

/**
 * The sidebar's Tasks row before the chunk's own row can draw: the same
 * host row with the board's icon and name, no counts. It stands in while
 * the chunk is on its way (fetched after startup, `requestChunkLater`) and
 * while the chunk's row waits for its settings, so the row never goes away
 * and comes back. A touch or press on it (pointer or focus on web) asks for
 * the chunk at once; a press opens the board with the filters it showed
 * last on this host. Hidden only once the settings say the board is off.
 *
 * It leaves the board's warm-up (`prefetch.ts`) to the chunk's row, which
 * would otherwise pull the data layer into the bundle.
 */
export function TasksSidebarPlaceholder(props: PluginSidebarItemProps) {
  const settings = useTasksSettings(props.host.id);
  const language = useTasksLanguage();
  if (settings && !settings.enabled) return null;
  loadMark("sidebar.placeholder");
  const intent = Platform.OS === "web"
    ? { onPointerEnter: requestChunk, onFocus: requestChunk }
    : { onTouchStart: requestChunk };
  return (
    <View {...intent}>
      <SidebarRow
        icon="SquareKanban"
        label={BOARD_STRINGS[language].name}
        active={props.currentScreen?.screenId === SCREEN_ID}
        onPress={() => {
          requestChunk();
          props.openScreen({ screenId: SCREEN_ID, params: encodeBoardParams(lastBoardParams(props.host.id)) });
        }}
      />
    </View>
  );
}
