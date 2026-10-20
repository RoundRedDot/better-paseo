import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * The Tasks board's server RPCs.
 *
 * `PaseoApi` has no way to stop an agent (docs/plugin-sdk-limitations.md §15),
 * so the plugin server runs `paseo agent stop <id>` with the CLI the host hands
 * its process (`PASEO_CLI`, else `paseo` on PATH). The server runs on the
 * daemon's machine, so a remote host stops its own agent.
 */

/** Whether this host can stop agents at all; the board hides Stop when not. */
export const tasksCapabilitiesRpc = defineRpc({
  name: "tasks.capabilities",
  input: z.object({}),
  output: z.object({ stop: z.boolean() }),
});

export const tasksStopResultSchema = z.object({
  agentId: z.string(),
  ok: z.boolean(),
  /** Why the stop failed, for a toast; null on success. */
  error: z.string().nullable(),
});
export type TasksStopResult = z.output<typeof tasksStopResultSchema>;

/**
 * Interrupts the current turn of each agent, in order: the agent goes idle and
 * keeps its session. Stopping a parent with its children passes them all.
 * Never rejects for a single agent; each result says how it went.
 */
export const tasksStopRpc = defineRpc({
  name: "tasks.stop",
  input: z.object({ agentIds: z.array(z.string().min(1)).min(1).max(50) }),
  output: z.object({ results: z.array(tasksStopResultSchema) }),
});
