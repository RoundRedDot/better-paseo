import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnUsageLedger, registerTurnUsageServer } from "../../server/turn-usage";

type TurnEnded = (event: unknown, context: unknown) => Promise<void>;
type TurnStarted = (event: unknown, context: unknown) => void;

let dir = "";

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "turn-usage-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function register(lastUsage: () => unknown) {
  const ledger = createTurnUsageLedger(dir);
  let ended: TurnEnded | null = null;
  let started: TurnStarted | null = null;
  let read: ((input: unknown) => Promise<unknown>) | null = null;
  const server = {
    on(name: string, handler: TurnEnded & TurnStarted) {
      if (name === "agent.turn_ended") ended = handler;
      if (name === "agent.turn_started") started = handler;
      return () => {};
    },
    handle(_contract: unknown, handler: (input: unknown) => Promise<unknown>) { read = handler; },
  } as unknown as PluginServerContext;
  let clock = 1000;
  registerTurnUsageServer(server, ledger, () => clock);
  const refresh = vi.fn(async () => ({ agent: { lastUsage: lastUsage() } }));
  const paseo = { agents: { ref: () => ({ refresh }) } };
  return {
    refresh,
    start: (turnId: string | null, at: number, agentId = "agent-a") => {
      clock = at;
      started!({ agent: { id: agentId }, turnId }, { paseo });
    },
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

describe("turn timing ledger", () => {
  it("records when each turn started, including turns no prompt started", async () => {
    let usage: unknown = { outputTokens: 2 };
    const server = register(() => usage);
    server.start("foreground-turn-1", 1000);
    await server.end("foreground-turn-1", "completed", 4000);
    // A background task notification wakes the agent; its usage did not change.
    server.start("autonomous-turn-2", 9000);
    server.start("other-turn", 9100, "agent-b");
    await server.end("autonomous-turn-2", "completed", 15000);
    usage = { outputTokens: 5 };
    server.start("foreground-turn-3", 20000);
    await server.end("foreground-turn-3", "canceled", 21000);
    expect((await server.read({ agentId: "agent-a" })).turns).toEqual([
      { turnId: "foreground-turn-1", startedAt: 1000, endedAt: 4000, usage: { outputTokens: 2 } },
      { turnId: "autonomous-turn-2", startedAt: 9000, endedAt: 15000 },
      { turnId: "foreground-turn-3", startedAt: 20000, endedAt: 21000 },
    ]);
    // The canceled turn's figure was never read, so a later turn's still counts.
    await server.end("foreground-turn-4", "completed", 30000);
    expect((await server.read({ agentId: "agent-a" })).turns.at(-1)).toEqual(
      { turnId: "foreground-turn-4", endedAt: 30000, usage: { outputTokens: 5 } });
  });

  it("keeps the timing when the usage read fails", async () => {
    const server = register(() => ({ outputTokens: 1 }));
    server.refresh.mockRejectedValueOnce(new Error("disconnected"));
    server.start("t1", 500);
    await server.end("t1", "completed", 800);
    expect((await server.read({ agentId: "agent-a" })).turns).toEqual([{ turnId: "t1", startedAt: 500, endedAt: 800 }]);
  });
});
