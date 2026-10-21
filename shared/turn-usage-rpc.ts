import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Per-turn token usage, recorded by the plugin server as each turn ends.
 *
 * The daemon reports usage only on the live `turn_completed` event and keeps
 * just the latest figure on the agent, so a client that reloads loses every
 * earlier turn's counts. The server sees every turn end, whether or not a
 * client is open, and keeps them on disk.
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
  /** When the server saw the turn end, in epoch milliseconds. */
  endedAt: z.number(),
  usage: turnUsageSchema,
});
export type RecordedTurn = z.output<typeof recordedTurnSchema>;

/** The agent's turns recorded since `since` (epoch ms), oldest first. */
export const turnUsageRpc = defineRpc({
  name: "turns.usage",
  input: z.object({ agentId: z.string().min(1), since: z.number().optional() }),
  output: z.object({ turns: z.array(recordedTurnSchema) }),
});
