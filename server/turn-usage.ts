import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { pluginDataDir } from "./plugin-data";
import { lastTurnsRpc, recordedTurnSchema, turnUsageRpc, turnUsageSchema, type LastTurn, type RecordedTurn } from "../shared/turn-usage-rpc";

/** A file-name safe agent ID; anything else is neither read nor written. */
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** The turns kept per agent; the oldest go first. */
const TURNS_KEPT = 500;

const ledgerSchema = z.array(recordedTurnSchema);

export function turnUsageDir(): string {
  return join(pluginDataDir(), "turn-usage");
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
        // place. The same figure again is that stale reading, not this turn's.
        let entry = turn;
        if (turn.usage) {
          const counted = turns.findLast((recorded) => recorded.usage);
          if (counted && JSON.stringify(counted.usage) === JSON.stringify(turn.usage)) {
            const { usage: _stale, ...timing } = turn;
            entry = timing;
          }
        }
        // A turn with neither a figure nor a start adds nothing to the record.
        if (!entry.usage && entry.startedAt === undefined) return;
        turns.push(entry);
        await mkdir(dir, { recursive: true });
        const path = join(dir, `${agentId}.json`);
        const temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(turns.slice(-TURNS_KEPT)));
        await rename(temp, path);
      });
    },
  };
}

/** Turn starts kept in memory until their end; more than this means ends were missed. */
const STARTS_KEPT = 1_000;

/**
 * Records each turn's start and end as the daemon announces them, the usage of
 * each completed turn, and answers `turns.usage`. The daemon updates the
 * agent's `lastUsage` before it announces the end, so the refreshed agent
 * carries this turn's figure.
 */
export function registerTurnUsageServer(
  server: PluginServerContext,
  ledger = createTurnUsageLedger(turnUsageDir()),
  now = () => Date.now(),
): void {
  const starts = new Map<string, number>();
  const key = (agentId: string, turnId: string) => `${agentId}\n${turnId}`;

  server.on("agent.turn_started", ({ agent, turnId }) => {
    if (!turnId) return;
    starts.set(key(agent.id, turnId), now());
    if (starts.size > STARTS_KEPT) starts.delete(starts.keys().next().value!);
  });

  server.on("agent.turn_ended", async ({ agent, turnId, outcome }, { paseo }) => {
    if (!turnId) return;
    const endedAt = now();
    const startedAt = starts.get(key(agent.id, turnId));
    starts.delete(key(agent.id, turnId));
    const timing = { turnId, ...(startedAt !== undefined && startedAt <= endedAt ? { startedAt } : {}), endedAt };
    let usage: RecordedTurn["usage"];
    if (outcome.kind === "completed") {
      try {
        const parsed = turnUsageSchema.safeParse((await paseo.agents.ref(agent.id).refresh())?.agent.lastUsage);
        if (parsed.success && Object.keys(parsed.data).length) usage = parsed.data;
      } catch {
        // A missed reading costs one turn's figures, never its timing.
      }
    }
    try { await ledger.record(agent.id, usage ? { ...timing, usage } : timing); }
    catch { /* A full disk costs the record, never the turn. */ }
  });

  server.handle(turnUsageRpc, async ({ agentId, since }) => ({
    turns: (await ledger.read(agentId)).filter((turn) => since === undefined || turn.endedAt >= since),
  }));

  server.handle(lastTurnsRpc, async ({ agentIds }) => {
    const turns = await Promise.all([...new Set(agentIds)].map(async (agentId): Promise<LastTurn | null> => {
      const last = (await ledger.read(agentId)).at(-1);
      return last ? { agentId, ...(last.startedAt !== undefined ? { startedAt: last.startedAt } : {}), endedAt: last.endedAt } : null;
    }));
    return { turns: turns.filter((turn): turn is LastTurn => turn !== null) };
  });
}
