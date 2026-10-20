import type { PluginClientContext } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { TASKS_SETTINGS, tasksSettingsSchema } from "../../shared/tasks-settings";
import { TasksBoardScreen } from "./board/board-screen";
import { setTasksEnabled, subscribeTasksEnabled, tasksEnabled } from "./board/enabled";
import { encodeBoardParams, lastBoardParams } from "./board/params";
import { TasksSidebarEntry } from "./board/sidebar-entry";
import { BOARD_STRINGS } from "./board/strings";
import { onTasksLanguageChange, resolveTasksLanguage } from "./i18n";
import { TasksSettingsPage } from "./settings/settings-page";

/** The board's screen id; `openScreen({ screenId: TASKS_SCREEN_ID })` opens it. */
export const TASKS_SCREEN_ID = "tasks";

const KEYWORDS = ["tasks", "board", "kanban", "agents", "看板", "任务"];

/**
 * Registers the Tasks board. The board is opt-in (`enabled` in its
 * settings): while it is off only the settings page is registered, and the
 * only work is one settings read at startup. Turning it on registers the
 * screen, the sidebar entry and the Command Center item; turning it off
 * calls their cleanups, so nothing of the board stays mounted. The titles
 * follow the host's language and are registered again when it changes.
 * Returns the cleanup.
 */
export function contributeTasks(client: PluginClientContext): () => void {
  let live = true;
  let language = resolveTasksLanguage();

  const registerSettings = () => {
    const remove = client.addSettingsScreen({ id: "tasks", title: BOARD_STRINGS[language].name, icon: "SquareKanban", Component: TasksSettingsPage });
    return () => void remove();
  };
  const registerBoard = () => {
    const titles = BOARD_STRINGS[language];
    const cleanups = [
      client.addScreen({ id: TASKS_SCREEN_ID, title: titles.name, Component: TasksBoardScreen }),
      client.addSidebarHeaderItem({ id: "tasks", title: titles.name, Component: TasksSidebarEntry }),
      client.addCommandCenterItem({
        id: "open-tasks",
        title: titles.openBoard,
        icon: "SquareKanban",
        keywords: KEYWORDS,
        context: "global",
        // The context names no host; this bundle runs per host, so the last board shown is this host's.
        onSelect: (context) => context.openScreen({ screenId: TASKS_SCREEN_ID, params: encodeBoardParams(lastBoardParams()) }),
      }),
    ];
    return () => {
      for (const cleanup of cleanups) void cleanup();
    };
  };

  let removeSettings = registerSettings();
  let removeBoard: (() => void) | null = null;
  const applyEnabled = () => {
    const on = live && tasksEnabled() === true;
    if (on && !removeBoard) removeBoard = registerBoard();
    else if (!on && removeBoard) {
      removeBoard();
      removeBoard = null;
    }
  };
  const relabel = () => {
    const next = resolveTasksLanguage();
    if (!live || next === language) return;
    language = next;
    removeSettings();
    removeSettings = registerSettings();
    if (removeBoard) {
      removeBoard();
      removeBoard = registerBoard();
    }
  };
  const unsubscribeEnabled = subscribeTasksEnabled(applyEnabled);
  const unsubscribeLanguage = onTasksLanguageChange(relabel);
  applyEnabled();

  // One read at startup; afterwards the settings page and the board's own
  // settings readers keep the store in step.
  void Promise.resolve()
    .then(() => client.rpc(settingsRpc(TASKS_SETTINGS.id).read, {}))
    .then((result) => {
      if (!live || result?.status !== "ready" || tasksEnabled() !== null) return;
      const parsed = tasksSettingsSchema.safeParse(result.values);
      setTasksEnabled(parsed.success && parsed.data.enabled);
    })
    .catch(() => {});

  return () => {
    live = false;
    unsubscribeEnabled();
    unsubscribeLanguage();
    removeBoard?.();
    removeBoard = null;
    removeSettings();
  };
}
