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

/**
 * Whether this host can stop agents at all, and mark them read; the board
 * hides Stop or Mark read when not. An older server leaves `read` out.
 */
export const tasksCapabilitiesRpc = defineRpc({
  name: "tasks.capabilities",
  input: z.object({}),
  output: z.object({ stop: z.boolean(), read: z.boolean().optional() }),
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
 * Clears the agents' attention, as opening one in Paseo does, and records
 * the read (`tasks.reads`): an unread or failed card leaves the review lane
 * for done. `PaseoApi` cannot, so the
 * server asks the daemon over its own connection (`connectHostDaemon`).
 * The daemon answers all or nothing.
 */
export const tasksReadRpc = defineRpc({
  name: "tasks.read",
  input: z.object({ agentIds: z.array(z.string().min(1)).min(1).max(50) }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
});

/**
 * The agents marked read through `tasks.read`, with when. A failure the board
 * reads from elsewhere (a turn that ended on an error, a failed provider
 * subagent, a kept `lastError`, an `error` status) survives clearing the
 * daemon's attention, so the board moves a card it marked read to done
 * until the next prompt, unless something failed after the mark. Kept like
 * the stops: in a file, until the agent's next turn or archive, 30 days at most.
 */
export const tasksReadsRpc = defineRpc({
  name: "tasks.reads",
  input: z.object({}),
  output: z.object({ reads: z.array(z.object({ agentId: z.string(), readAt: z.string() })) }),
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

/**
 * Brings an archived agent back, as Paseo's own "Unarchive" does
 * (`refreshAgent`): the server runs `paseo agent reload <id>`, but only
 * after `paseo agent inspect` says the agent is archived, since a reload
 * interrupts a live agent. One that is no longer archived is a success.
 */
export const tasksUnarchiveRpc = defineRpc({
  name: "tasks.unarchive",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
});

export const sessionTokensSchema = z.object({
  /** Every token the session used: input, cache writes and reads, output. */
  total: z.number(),
  /** The part read from the provider's prompt cache. */
  cached: z.number(),
});
export type SessionTokens = z.output<typeof sessionTokensSchema>;

/**
 * The tokens an agent's whole session has used so far, read from the
 * provider's own session files (Claude and Codex); null for another provider
 * or before the session has any usage.
 */
export const tasksSessionTokensRpc = defineRpc({
  name: "tasks.session-tokens",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ tokens: sessionTokensSchema.nullable() }),
});
