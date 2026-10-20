import type { PluginServerContext } from "@getpaseo/plugin/server";
import { TASKS_SETTINGS } from "../../shared/tasks-settings";
import { tasksCapabilitiesRpc, tasksStopRpc } from "../../shared/tasks-rpc";

/**
 * The Tasks board's server half: its settings record and the stop RPCs.
 * Placeholder handlers until the server slice lands: Stop reports itself
 * unavailable, so the board hides the button.
 */
export function registerTasksServer(server: PluginServerContext): void {
  server.registerSettings(TASKS_SETTINGS);
  server.handle(tasksCapabilitiesRpc, async () => ({ stop: false }));
  server.handle(tasksStopRpc, async ({ agentIds }) => ({
    results: agentIds.map((agentId) => ({ agentId, ok: false, error: "Stopping agents is not available yet." })),
  }));
}
