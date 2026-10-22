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

/**
 * The agents stopped through `tasks.stop`, with when, newest last, so a board
 * opened later (another client, the app after a restart) can still say
 * "Stopped manually". The server keeps them in a file under its data
 * directory, so a daemon restart or a plugin reload keeps them; a mark goes
 * when the agent starts a new turn or is archived, or after 30 days. Older
 * servers lack it (or lose the marks on a restart); the board then keeps
 * only its own stops.
 */
export const tasksStoppedRpc = defineRpc({
  name: "tasks.stopped",
  input: z.object({}),
  output: z.object({ stops: z.array(z.object({ agentId: z.string(), stoppedAt: z.string() })) }),
});

/**
 * A subagent the provider runs inside its parent's session (Claude's Agent
 * tool, Codex's and Pi's own), as the daemon describes it
 * (`ProviderSubagentDescriptorPayload`). Not a Paseo agent: no card, no tab,
 * no `paseo.parent-agent-id` label.
 */
export const providerSubagentSchema = z.object({
  id: z.string(),
  parentAgentId: z.string(),
  provider: z.string(),
  /** The subagent type ("general-purpose"). */
  title: z.string().nullable(),
  /** The task it was given ("RRD-10161 desktop native fatal"); names a fan-out's siblings. */
  description: z.string().nullable(),
  status: z.enum(["running", "failed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** The provider's own facts line: the subagent type, model, effort and tokens, dot-separated. */
  subtitle: z.string().nullable(),
});
export type ProviderSubagent = z.output<typeof providerSubagentSchema>;

/**
 * The running and failed provider subagents of every agent, as the plugin
 * server last heard of them. `PaseoApi` cannot list them, so the server
 * reads the daemon once over its own connection and follows its updates
 * after that. `version` changes with the list: asked with the version it
 * last had, the board gets `subagents: null` while nothing changed.
 */
export const tasksSubagentsRpc = defineRpc({
  name: "tasks.subagents",
  input: z.object({ since: z.string().optional() }),
  output: z.object({ version: z.string(), subagents: z.array(providerSubagentSchema).nullable() }),
});
