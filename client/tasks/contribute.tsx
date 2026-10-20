import type { PluginClientContext } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { TASKS_SETTINGS, tasksSettingsSchema } from "../../shared/tasks-settings";
import { TasksBoardScreen } from "./board/board-screen";
import { setTasksEnabled, setTasksSettingsOpener, subscribeTasksEnabled, tasksEnabled } from "./board/enabled";
import { encodeBoardParams, lastBoardParams } from "./board/params";
import { TasksSidebarEntry } from "./board/sidebar-entry";
import { BOARD_STRINGS } from "./board/strings";
import { subscribeHostLanguage } from "../i18n/host-language";
import { onTasksLanguageChange, resolveTasksLanguage } from "./i18n";
import { TasksSettingsPage } from "./settings/settings-page";

/** The board's screen id; `openScreen({ screenId: TASKS_SCREEN_ID })` opens it. */
export const TASKS_SCREEN_ID = "tasks";

const KEYWORDS = ["tasks", "board", "kanban", "agents", "看板", "任务"];

/**
 * Registers the Tasks board. The board is opt-in (`enabled` in its
 * settings). Always registered: the settings page and the board screen,
 * which mounts only when open and then says the board is off; the only
 * work while off is one settings read at startup. Turning the board on
 * registers the sidebar entry and the Command Center item; turning it off
 * calls their cleanups, so nothing of the board stays mounted. Titles follow
 * the host's language: the screen's in place, the others by registering
 * again. Returns the cleanup.
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

  // The screen stays registered whatever the setting: the host resolves a
  // board route (a reload, a restored tab, a link) once, before the startup
  // read could register it, and a registration costs nothing until the screen
  // is open. Its title is a function, so it follows the language in place.
  const removeScreen = client.addScreen({
    id: TASKS_SCREEN_ID,
    title: () => BOARD_STRINGS[resolveTasksLanguage()].name,
    Component: TasksBoardScreen,
  });
  setTasksSettingsOpener(() => client.openSettings("tasks"));
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
  // On iOS and Android the host's language arrives from AsyncStorage after
  // this first look, with or without a Tasks component mounted.
  const unsubscribeHostLanguage = subscribeHostLanguage(relabel);
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
    unsubscribeHostLanguage();
    removeBoard?.();
    removeBoard = null;
    removeSettings();
    void removeScreen();
    setTasksSettingsOpener(null);
  };
}
