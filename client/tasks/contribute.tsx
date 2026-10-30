import type { PluginClientContext } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { TASKS_SETTINGS, tasksSettingsSchema } from "../../shared/tasks-settings";
import {
  setTasksBoardOpener,
  setTasksEnabled,
  setTasksSettingsOpener,
  setTasksStartupRead,
  subscribeTasksEnabled,
  tasksEnabled,
} from "./board/enabled";
import { encodeBoardParams, lastBoardParams } from "./board/params";
import { BOARD_STRINGS } from "./board/strings";
import { subscribeHostLanguage } from "../i18n/host-language";
import { onTasksLanguageChange, resolveTasksLanguage } from "./i18n";
import { SETTINGS_SCREEN_ID, setSettingsTab } from "../settings-tab";
import {
  TasksBoardScreen,
  TasksSidebarEntry,
  cancelChunkLater,
  chunkNow,
  requestChunk,
  requestChunkLater,
  setChunkClient,
  subscribeChunk,
} from "./chunk/load";
import { loadMark } from "../debug/load-marks";

/** The board's screen id; `openScreen({ screenId: TASKS_SCREEN_ID })` opens it. */
export const TASKS_SCREEN_ID = "tasks";

const KEYWORDS = ["tasks", "board", "kanban", "agents", "看板", "任务"];

/** The board with the filters it was last shown with. */
const boardRoute = () => ({ screenId: TASKS_SCREEN_ID, params: encodeBoardParams(lastBoardParams()) });

/**
 * Registers the Tasks board. The board can be turned off (`enabled` in its
 * settings, edited on the Tasks half of Better Paseo's settings page,
 * `settings-screen.ts`). Always registered: the board screen, which mounts
 * only when open and then says the board is off; the only work while off is
 * one settings read at startup. Turning the board on registers the sidebar
 * entry and the Command Center item; turning it off calls their cleanups, so
 * nothing of the board stays mounted. Titles follow the host's language: the
 * screen's in place, the others by registering again. Returns the cleanup.
 */
export function contributeTasks(client: PluginClientContext): () => void {
  let live = true;
  // The board's code comes in a chunk (`chunk/entry.ts`): here at once in a
  // checkout, or after a reconnect; otherwise fetched when someone opens the
  // board, or after startup for the sidebar row. Its data layer reads from
  // this host's plugin server once it is here.
  setChunkClient(client);
  let stopData: (() => void) | null = null;
  const startData = () => {
    const chunk = chunkNow();
    if (live && chunk && !stopData) stopData = chunk.startTasksData(client);
  };
  const unsubscribeChunk = subscribeChunk(startData);
  startData();
  let language = resolveTasksLanguage();

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
        // The board's requests leave before its screen mounts (`prefetch.ts`).
        onSelect: (context) => {
          // A cold chunk is fetched now: the board is on its way.
          const chunk = chunkNow();
          if (chunk) chunk.prefetchBoardFromCommand();
          else requestChunk();
          context.openScreen(boardRoute());
        },
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
  // The off board's "Open settings" lands on the Tasks half of the page.
  setTasksSettingsOpener(() => {
    setSettingsTab("tasks");
    client.openSettings(SETTINGS_SCREEN_ID);
  });
  // The settings page's "Open board", once the switch is on.
  setTasksBoardOpener(() => client.openScreen(boardRoute()));
  let removeBoard: (() => void) | null = null;
  const applyEnabled = () => {
    const on = live && tasksEnabled() === true;
    if (on && !removeBoard) {
      loadMark("tasks.enabled");
      removeBoard = registerBoard();
      // The sidebar row's counts draw with the chunk; it is fetched once
      // startup has settled, so it stays off the first chat rows.
      requestChunkLater();
    } else if (!on && removeBoard) {
      removeBoard();
      removeBoard = null;
      cancelChunkLater();
      // No warm subscription outlives the entry points.
      chunkNow()?.releaseBoardPrefetch();
    }
  };
  const relabel = () => {
    const next = resolveTasksLanguage();
    if (!live || next === language) return;
    language = next;
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
  // A board screen opened meanwhile (a link, a reload) waits for this one
  // instead of reading again.
  setTasksStartupRead("pending");
  void Promise.resolve()
    .then(() => client.rpc(settingsRpc(TASKS_SETTINGS.id).read, {}))
    .then((result) => {
      if (!live) return;
      if (result?.status !== "ready") return setTasksStartupRead("failed");
      if (tasksEnabled() === null) {
        const parsed = tasksSettingsSchema.safeParse(result.values);
        setTasksEnabled(parsed.success && parsed.data.enabled);
      }
      setTasksStartupRead("done");
    })
    .catch(() => {
      if (live) setTasksStartupRead("failed");
    });

  return () => {
    live = false;
    unsubscribeEnabled();
    unsubscribeLanguage();
    unsubscribeHostLanguage();
    removeBoard?.();
    removeBoard = null;
    chunkNow()?.releaseBoardPrefetch();
    void removeScreen();
    setTasksSettingsOpener(null);
    setTasksBoardOpener(null);
    unsubscribeChunk();
    stopData?.();
    stopData = null;
    setChunkClient(null);
  };
}
