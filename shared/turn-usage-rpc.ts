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
});
export type RecordedTurn = z.output<typeof recordedTurnSchema>;

/** The agent's turns recorded since `since` (epoch ms), oldest first. */
export const turnUsageRpc = defineRpc({
  name: "turns.usage",
  input: z.object({ agentId: z.string().min(1), since: z.number().optional() }),
  output: z.object({ turns: z.array(recordedTurnSchema) }),
});
