import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { recordedTurnSchema, turnUsageRpc, turnUsageSchema, type RecordedTurn } from "../shared/turn-usage-rpc";

/** A file-name safe agent ID; anything else is neither read nor written. */
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** The turns kept per agent; the oldest go first. */
const TURNS_KEPT = 500;

const ledgerSchema = z.array(recordedTurnSchema);

export function turnUsageDir(): string {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(home, "plugin-data", "better-paseo", "turn-usage");
}

/** One JSON file per agent. Writes to an agent run one at a time. */
export function createTurnUsageLedger(dir: string) {
  const queues = new Map<string, Promise<unknown>>();

  async function load(agentId: string): Promise<RecordedTurn[]> {
    try {
      const parsed = ledgerSchema.safeParse(JSON.parse(await readFile(join(dir, `${agentId}.json`), "utf8")));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  function queued<T>(agentId: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(agentId) ?? Promise.resolve()).catch(() => {}).then(task);
    queues.set(agentId, run);
    void run.finally(() => { if (queues.get(agentId) === run) queues.delete(agentId); }).catch(() => {});
    return run;
  }

  return {
    read(agentId: string): Promise<RecordedTurn[]> {
      if (!AGENT_ID_PATTERN.test(agentId)) return Promise.resolve([]);
      return queued(agentId, () => load(agentId));
    },
    record(agentId: string, turn: RecordedTurn): Promise<void> {
      if (!AGENT_ID_PATTERN.test(agentId)) return Promise.resolve();
      return queued(agentId, async () => {
        const turns = await load(agentId);
        // A completion without usage leaves the agent's previous figure in
        // place. The same figure again is that stale reading, not a new turn.
        const last = turns[turns.length - 1];
        if (last && JSON.stringify(last.usage) === JSON.stringify(turn.usage)) return;
        turns.push(turn);
        await mkdir(dir, { recursive: true });
        const path = join(dir, `${agentId}.json`);
        const temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(turns.slice(-TURNS_KEPT)));
        await rename(temp, path);
      });
    },
  };
}

/**
 * Records each completed turn's usage as it ends, and answers `turns.usage`.
 * The daemon updates the agent's `lastUsage` before it announces the end, so
 * the refreshed agent carries this turn's figure.
 */
export function registerTurnUsageServer(
  server: PluginServerContext,
  ledger = createTurnUsageLedger(turnUsageDir()),
  now = () => Date.now(),
): void {
  server.on("agent.turn_ended", async ({ agent, turnId, outcome }, { paseo }) => {
    if (outcome.kind !== "completed" || !turnId) return;
    const endedAt = now();
    try {
      const usage = turnUsageSchema.safeParse((await paseo.agents.ref(agent.id).refresh())?.agent.lastUsage);
      if (usage.success && Object.keys(usage.data).length) await ledger.record(agent.id, { turnId, endedAt, usage: usage.data });
    } catch {
      // A missed reading costs one turn's figures, never the turn itself.
    }
  });

  server.handle(turnUsageRpc, async ({ agentId, since }) => ({
    turns: (await ledger.read(agentId)).filter((turn) => since === undefined || turn.endedAt >= since),
  }));
}
