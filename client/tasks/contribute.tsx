import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TasksBoardScreen } from "./board/board-screen";
import { TasksSidebarEntry } from "./board/sidebar-entry";
import { TasksSettingsPage } from "./settings/settings-page";

/** The board's screen id; `openScreen({ screenId: TASKS_SCREEN_ID })` opens it. */
export const TASKS_SCREEN_ID = "tasks";

/**
 * Registers the Tasks board: the screen, its sidebar entry with the counts,
 * a Command Center item, and the board's settings page. Returns the cleanup.
 */
export function contributeTasks(client: PluginClientContext): () => void {
  const cleanups = [
    client.addScreen({ id: TASKS_SCREEN_ID, title: "Tasks", Component: TasksBoardScreen }),
    client.addSidebarHeaderItem({ id: "tasks", title: "Tasks", Component: TasksSidebarEntry }),
    client.addCommandCenterItem({
      id: "open-tasks",
      title: "Open Tasks",
      icon: "SquareKanban",
      keywords: ["tasks", "board", "kanban", "agents", "看板", "任务"],
      context: "global",
      onSelect: (context) => context.openScreen({ screenId: TASKS_SCREEN_ID }),
    }),
    client.addSettingsScreen({ id: "tasks", title: "Tasks", icon: "SquareKanban", Component: TasksSettingsPage }),
  ];
  return () => {
    for (const cleanup of cleanups) void cleanup();
  };
}
