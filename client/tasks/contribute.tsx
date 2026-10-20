import type { PluginClientContext, PluginCommandCenterItemContribution } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { TASKS_SETTINGS, tasksSettingsSchema } from "../../shared/tasks-settings";
import { TasksBoardScreen } from "./board/board-screen";
import { setTasksEnabled, setTasksSettingsOpener, subscribeTasksEnabled, tasksEnabled } from "./board/enabled";
import { encodeBoardParams, lastBoardParams } from "./board/params";
import { TasksSidebarEntry } from "./board/sidebar-entry";
import { TasksSettingsPage } from "./settings/settings-page";

/** The board's screen id; `openScreen({ screenId: TASKS_SCREEN_ID })` opens it. */
export const TASKS_SCREEN_ID = "tasks";

const OPEN_TASKS: PluginCommandCenterItemContribution = {
  id: "open-tasks",
  title: "Open Tasks",
  icon: "SquareKanban",
  keywords: ["tasks", "board", "kanban", "agents", "看板", "任务"],
  context: "global",
  // The context names no host; this bundle runs per host, so the last board shown is this host's.
  onSelect: (context) => context.openScreen({ screenId: TASKS_SCREEN_ID, params: encodeBoardParams(lastBoardParams()) }),
};

/**
 * Registers the Tasks board: the screen, its sidebar entry with the counts,
 * the board's settings page, and, while the board is enabled in its
 * settings, a Command Center item. The screen, sidebar entry and settings
 * page stay registered: the entry draws nothing while the board is off, and
 * the screen says it is off. Returns the cleanup.
 */
export function contributeTasks(client: PluginClientContext): () => void {
  let live = true;
  let removeCommand: (() => void) | null = null;
  const applyEnabled = () => {
    const on = live && tasksEnabled() === true;
    if (on && !removeCommand) {
      const remove = client.addCommandCenterItem(OPEN_TASKS);
      removeCommand = () => void remove();
    } else if (!on && removeCommand) {
      removeCommand();
      removeCommand = null;
    }
  };
  const unsubscribe = subscribeTasksEnabled(applyEnabled);
  applyEnabled();
  setTasksSettingsOpener(() => client.openSettings("tasks"));
  // One read at startup, so the Command Center knows before any Tasks component mounts.
  void Promise.resolve()
    .then(() => client.rpc(settingsRpc(TASKS_SETTINGS.id).read, {}))
    .then((result) => {
      if (!live || result?.status !== "ready" || tasksEnabled() !== null) return;
      const parsed = tasksSettingsSchema.safeParse(result.values);
      setTasksEnabled(parsed.success && parsed.data.enabled);
    })
    .catch(() => {});

  const cleanups = [
    client.addScreen({ id: TASKS_SCREEN_ID, title: "Tasks", Component: TasksBoardScreen }),
    client.addSidebarHeaderItem({ id: "tasks", title: "Tasks", Component: TasksSidebarEntry }),
    client.addSettingsScreen({ id: "tasks", title: "Tasks", icon: "SquareKanban", Component: TasksSettingsPage }),
  ];
  return () => {
    live = false;
    unsubscribe();
    removeCommand?.();
    removeCommand = null;
    setTasksSettingsOpener(null);
    for (const cleanup of cleanups) void cleanup();
  };
}
