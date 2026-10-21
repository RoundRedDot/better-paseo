import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnUsageLedger, registerTurnUsageServer } from "../../server/turn-usage";

type TurnEnded = (event: unknown, context: unknown) => Promise<void>;

let dir = "";

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "turn-usage-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function register(lastUsage: () => unknown) {
  const ledger = createTurnUsageLedger(dir);
  let ended: TurnEnded | null = null;
  let read: ((input: unknown) => Promise<unknown>) | null = null;
  const server = {
    on(name: string, handler: TurnEnded) { if (name === "agent.turn_ended") ended = handler; return () => {}; },
    handle(_contract: unknown, handler: (input: unknown) => Promise<unknown>) { read = handler; },
  } as unknown as PluginServerContext;
  let clock = 1000;
  registerTurnUsageServer(server, ledger, () => clock);
  const refresh = vi.fn(async () => ({ agent: { lastUsage: lastUsage() } }));
  const paseo = { agents: { ref: () => ({ refresh }) } };
  return {
    refresh,
    end: (turnId: string | null, kind = "completed", at = clock) => {
      clock = at;
      return ended!({ agent: { id: "agent-a" }, turnId, outcome: { kind } }, { paseo });
    },
    read: (input: unknown) => read!(input) as Promise<{ turns: unknown[] }>,
  };
}

describe("turn usage ledger", () => {
  it("records each completed turn's usage and survives a fresh ledger", async () => {
    let usage: unknown = { inputTokens: 10, outputTokens: 2, extra: "dropped" };
    const server = register(() => usage);
    await server.end("foreground-turn-1", "completed", 1000);
    usage = { inputTokens: 30, outputTokens: 5 };
    await server.end("foreground-turn-2", "completed", 2000);
    expect((await server.read({ agentId: "agent-a" })).turns).toEqual([
      { turnId: "foreground-turn-1", endedAt: 1000, usage: { inputTokens: 10, outputTokens: 2 } },
      { turnId: "foreground-turn-2", endedAt: 2000, usage: { inputTokens: 30, outputTokens: 5 } },
    ]);
    expect(await createTurnUsageLedger(dir).read("agent-a")).toHaveLength(2);
    expect((await server.read({ agentId: "agent-a", since: 1500 })).turns).toHaveLength(1);
  });

  it("skips failed, canceled and unnamed turns, a stale repeat, and missing usage", async () => {
    let usage: unknown = { outputTokens: 2 };
    const server = register(() => usage);
    await server.end("t1", "failed");
    await server.end("t2", "canceled");
    await server.end(null);
    await server.end("t3");
    await server.end("t4");
    usage = undefined;
    await server.end("t5");
    expect((await server.read({ agentId: "agent-a" })).turns).toEqual([
      { turnId: "t3", endedAt: 1000, usage: { outputTokens: 2 } },
    ]);
  });

  it("never throws from the hook, and reads nothing for an unsafe or unreadable agent", async () => {
    const server = register(() => ({ outputTokens: 1 }));
    server.refresh.mockRejectedValueOnce(new Error("disconnected"));
    await expect(server.end("t1")).resolves.toBeUndefined();
    expect((await server.read({ agentId: "../agent-a" })).turns).toEqual([]);
    await writeFile(join(dir, "agent-b.json"), "{not json");
    expect((await server.read({ agentId: "agent-b" })).turns).toEqual([]);
  });

  it("keeps the newest turns and writes concurrent turns in order", async () => {
    const ledger = createTurnUsageLedger(dir);
    await Promise.all(Array.from({ length: 510 }, (_, index) =>
      ledger.record("agent-a", { turnId: `t${index}`, endedAt: index, usage: { outputTokens: index } })));
    const turns = JSON.parse(await readFile(join(dir, "agent-a.json"), "utf8"));
    expect(turns).toHaveLength(500);
    expect(turns[0].turnId).toBe("t10");
    expect(turns[499].turnId).toBe("t509");
  });
});
