import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Per-turn token usage and timing, recorded by the plugin server as each turn
 * ends.
 *
 * The daemon reports usage only on the live `turn_completed` event and keeps
 * just the latest figure on the agent, so a client that reloads loses every
 * earlier turn's counts. A turn the agent starts itself, for a background task
 * notification, has no prompt to time it from, and history the daemon reloads
 * from the provider has no turn IDs to tell such a turn from the one before.
 * The server sees every turn start and end, whether or not a client is open,
 * and keeps them on disk.
 */
export const turnUsageSchema = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  contextWindowMaxTokens: z.number().optional(),
  contextWindowUsedTokens: z.number().optional(),
});

export const recordedTurnSchema = z.object({
  turnId: z.string(),
  /** When the server saw the turn start, in epoch milliseconds, if it did. */
  startedAt: z.number().optional(),
  /** When the server saw the turn end, in epoch milliseconds. */
  endedAt: z.number(),
  /** Absent when the turn reported no new figure. */
  usage: turnUsageSchema.optional(),
  /**
   * Why the turn stopped short: the daemon's failure, or the provider's own
   * error that the daemon passed off as the turn's reply (Claude's "You've
   * hit your session limit"). Absent when the turn finished its work.
   */
  error: z.string().optional(),
});
export type RecordedTurn = z.output<typeof recordedTurnSchema>;

/** The agent's turns recorded since `since` (epoch ms), oldest first. */
export const turnUsageRpc = defineRpc({
  name: "turns.usage",
  input: z.object({ agentId: z.string().min(1), since: z.number().optional() }),
  output: z.object({ turns: z.array(recordedTurnSchema) }),
});

export const lastTurnSchema = z.object({
  agentId: z.string(),
  startedAt: z.number().optional(),
  endedAt: z.number(),
  /** The recorded turn's `error`. */
  error: z.string().optional(),
});
export type LastTurn = z.output<typeof lastTurnSchema>;

/**
 * Each agent's latest recorded turn, for the Tasks board's "last turn" time.
 * The agent's `updatedAt` moves whenever the daemon touches it (a resume, a
 * mode change), so it cannot say when a turn ended. Agents without a record
 * are left out.
 */
export const lastTurnsRpc = defineRpc({
  name: "turns.last",
  input: z.object({ agentIds: z.array(z.string().min(1)).max(200) }),
  output: z.object({ turns: z.array(lastTurnSchema) }),
});
