import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const agentUpdate = z.object({
  provider: z.string(), label: z.string(), executable: z.string().nullable(),
  current: z.string().nullable(), latest: z.string().nullable(),
  method: z.enum(["npm", "homebrew", "native", "unknown"]),
  status: z.enum(["available", "current", "unknown", "error"]),
  updateAvailable: z.boolean(),
  issue: z.enum(["diagnostic_failed", "executable_unknown", "version_unknown", "installation_unknown", "installation_unreadable", "release_source_unknown", "latest_fetch_failed", "npm_runtime_unverified", "homebrew_command_unverified"]).nullable(), command: z.string().nullable(),
});
export const agentUpdatesRpc = defineRpc({
  name: "settings.agent-updates",
  input: z.object({ action: z.enum(["check", "status"]) }),
  output: z.object({ state: z.enum(["idle", "checking", "done", "failed"]), entries: z.array(agentUpdate), error: z.enum(["snapshot_failed", "status_failed", "check_failed"]).nullable() }),
});
export type AgentUpdate = z.output<typeof agentUpdate>;
export type AgentUpdates = z.output<typeof agentUpdatesRpc.output>;
export function hasAgentUpdate(state: AgentUpdates): boolean {
  return state.entries.some((entry) => entry.updateAvailable);
}

/** Failed or incomplete checks cannot disprove an already confirmed update. */
export function retainAgentUpdates(previous: AgentUpdates, next: AgentUpdates): AgentUpdates {
  const entries = next.entries.map((entry) => {
    if (entry.status === "available" || entry.status === "current") return entry;
    const known = previous.entries.find((row) => row.provider === entry.provider);
    return known?.updateAvailable ? { ...entry, updateAvailable: true } : entry;
  });
  if (next.state !== "done") {
    entries.push(...previous.entries.filter((row) => !entries.some((entry) => entry.provider === row.provider)));
  }
  return { ...next, entries };
}
