import type { PluginClientContext } from "@getpaseo/plugin/client";
import { lastTurnsRpc } from "../../../shared/turn-usage-rpc";
import { tasksLabelsRpc, tasksProjectIconsRpc, tasksReadsRpc, tasksSessionTokensRpc, tasksSubagentTimelineRpc, tasksSubagentsRpc } from "../../../shared/tasks-rpc";
import { setLabelDefinitionsLoader, setLastTurnLoader, setProjectIconsLoader, setReadMarksLoader, setSubagentLoader } from "../data";
import { setSessionTokensLoader } from "../data/session-tokens";
import { setSubagentTimelineLoader } from "../data/subagent-timeline";
import { conversationSearchRpc } from "../../../shared/conversation-search";
import { setConversationSearchLoader } from "../data/search-conversations";

/**
 * The Tasks code the board, its sidebar entry and its settings draw with:
 * everything `chunk/load.ts` hands out. In a checkout (and in tests) the
 * main bundle imports this file directly; an install builds it apart
 * (`scripts/build-client.mjs`), the plugin server sends it on request and
 * the client evaluates it (`chunk/remote.ts`), so the board's code stays out
 * of the catalog the app downloads on every reconnect.
 */
export { TasksBoardScreen } from "../board/board-screen";
export { TasksSidebarEntry } from "../board/sidebar-entry";
export { prefetchBoardFromCommand, releaseBoardPrefetch } from "../board/prefetch";
export { TasksSettingsPanel } from "../settings/tasks-panel";
// Better Paseo's settings page (chat options and the board's), opened from the host's settings.
export { BetterPaseoSettingsPage } from "../../settings-page";

/** Points the data layer at this host's plugin server; returns the cleanup. */
export function startTasksData(client: PluginClientContext): () => void {
  // Cards time the last turn from the server's record of it.
  setLastTurnLoader((agentIds) => client.rpc(lastTurnsRpc, { agentIds }).then((result) => result.turns));
  // Provider subagents (Claude's Agent tool) come from the server, which reads them off the daemon.
  setSubagentLoader((since) => client.rpc(tasksSubagentsRpc, since === undefined ? {} : { since }));
  // Cards marked read from a board, failures included: the server keeps the marks.
  setReadMarksLoader(() => client.rpc(tasksReadsRpc, {}).then((result) => result.reads));
  // Label colors as Paseo's sidebar draws them, for a host whose API lists no label definitions.
  setLabelDefinitionsLoader(() => client.rpc(tasksLabelsRpc, {}).then((result) => result.labels));
  // Project icons as Paseo's sidebar draws them, for a host whose API has no icon call.
  setProjectIconsLoader((projectIds) => client.rpc(tasksProjectIconsRpc, { projectIds }).then((result) => result.icons));
  // A running task's session tokens, read by the server from the provider's session files.
  setSessionTokensLoader((agentId) => client.rpc(tasksSessionTokensRpc, { agentId }).then((result) => result.tokens));
  // A provider subagent's prompt and reply for its details, which the server reads off the daemon.
  setSubagentTimelineLoader((input) => client.rpc(tasksSubagentTimelineRpc, input));
  setConversationSearchLoader((input) => client.rpc(conversationSearchRpc, input));
  return () => {
    setLastTurnLoader(null);
    setSubagentLoader(null);
    setReadMarksLoader(null);
    setLabelDefinitionsLoader(null);
    setProjectIconsLoader(null);
    setSessionTokensLoader(null);
    setSubagentTimelineLoader(null);
    setConversationSearchLoader(null);
  };
}
