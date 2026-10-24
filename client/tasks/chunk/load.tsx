import React, { useEffect, useSyncExternalStore, type ComponentProps } from "react";
import { View } from "react-native";
import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { chunkNow, requestChunk, subscribeChunk } from "./source";
import type { TasksChunk } from "./types";

/**
 * The Tasks chunk for the rest of the bundle: the board, its sidebar entry
 * and its settings, as stand-ins that draw the chunk's components once it
 * is here (at once in a checkout; see `entry.ts`) and ask for it when it is
 * not. `source.ts` is the one place that says how it arrives.
 */
export { chunkNow, requestChunk, setChunkClient, subscribeChunk } from "./source";

export function useTasksChunk(): TasksChunk | null {
  const chunk = useSyncExternalStore(subscribeChunk, chunkNow, chunkNow);
  useEffect(() => {
    if (!chunk) requestChunk();
  }, [chunk]);
  return chunk;
}

/** The board's screen; an empty page until its code is here. */
export function TasksBoardScreen(props: PluginScreenProps) {
  const chunk = useTasksChunk();
  if (!chunk) return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
  return <chunk.TasksBoardScreen {...props} />;
}

/** The sidebar's Tasks row; no row until its code is here. */
export function TasksSidebarEntry(props: PluginSidebarItemProps) {
  const chunk = useTasksChunk();
  return chunk ? <chunk.TasksSidebarEntry {...props} /> : null;
}

export function TasksSettingsPanel(props: ComponentProps<TasksChunk["TasksSettingsPanel"]>) {
  const chunk = useTasksChunk();
  return chunk ? <chunk.TasksSettingsPanel {...props} /> : null;
}
