import React, { useEffect, useSyncExternalStore, type ComponentProps } from "react";
import { View } from "react-native";
import type { PluginScreenProps, PluginSidebarItemProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { chunkNow, requestChunk, requestChunkLater, subscribeChunk } from "./source";
import { TasksSidebarPlaceholder } from "./sidebar-placeholder";
import type { TasksChunk } from "./types";

/**
 * The Tasks chunk for the rest of the bundle: the board, its sidebar entry,
 * its settings and Better Paseo's settings page, as stand-ins that draw the
 * chunk's components once it is here (at once in a checkout; see
 * `entry.ts`) and ask for it when it is not. `source.ts` is the one place
 * that says how it arrives.
 *
 * A screen someone opened asks `now`; the sidebar row, which a phone keeps
 * mounted while hidden, asks `later`, once startup has settled.
 */
export { cancelChunkLater, chunkNow, requestChunk, requestChunkLater, setChunkClient, subscribeChunk } from "./source";

export function useTasksChunk(when: "now" | "later" = "now"): TasksChunk | null {
  const chunk = useSyncExternalStore(subscribeChunk, chunkNow, chunkNow);
  useEffect(() => {
    if (chunk) return;
    if (when === "now") requestChunk();
    else requestChunkLater();
  }, [chunk, when]);
  return chunk;
}

/** Better Paseo's settings page (`settings-page.tsx`); an empty page until its code is here, asked for at once. */
export function BetterPaseoSettingsPage(props: PluginSurfaceProps) {
  const chunk = useTasksChunk();
  if (!chunk) return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
  return <chunk.BetterPaseoSettingsPage {...props} />;
}

/** The board's screen; an empty page until its code is here. */
export function TasksBoardScreen(props: PluginScreenProps) {
  const chunk = useTasksChunk();
  if (!chunk) return <View style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }} />;
  return <chunk.TasksBoardScreen {...props} />;
}

/** The sidebar's Tasks row: a plain row until the chunk's row, with its counts, can draw. */
export function TasksSidebarEntry(props: PluginSidebarItemProps) {
  const chunk = useTasksChunk("later");
  const placeholder = <TasksSidebarPlaceholder {...props} />;
  return chunk ? <chunk.TasksSidebarEntry {...props} placeholder={placeholder} /> : placeholder;
}

export function TasksSettingsPanel(props: ComponentProps<TasksChunk["TasksSettingsPanel"]>) {
  const chunk = useTasksChunk();
  return chunk ? <chunk.TasksSettingsPanel {...props} /> : null;
}
