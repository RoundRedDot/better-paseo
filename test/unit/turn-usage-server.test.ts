import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTurnUsageLedger, registerTurnUsageServer, turnError } from "../../server/turn-usage";

type TurnEnded = (event: unknown, context: unknown) => Promise<void>;
type TurnStarted = (event: unknown, context: unknown) => void;

let dir = "";

beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "turn-usage-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

function register(lastUsage: () => unknown) {
  const ledger = createTurnUsageLedger(dir);
  let ended: TurnEnded | null = null;
  let started: TurnStarted | null = null;
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const server = {
    on(name: string, handler: TurnEnded & TurnStarted) {
      if (name === "agent.turn_ended") ended = handler;
      if (name === "agent.turn_started") started = handler;
      return () => {};
    },
    handle(contract: { name: string }, handler: (input: unknown) => Promise<unknown>) { handlers.set(contract.name, handler); },
  } as unknown as PluginServerContext;
  let clock = 1000;
  registerTurnUsageServer(server, ledger, () => clock);
  const refresh = vi.fn(async (): Promise<unknown> => ({ agent: { lastUsage: lastUsage() } }));
  const paseo = { agents: { ref: () => ({ refresh }) } };
  return {
    refresh,
    start: (turnId: string | null, at: number, agentId = "agent-a") => {
      clock = at;
      started!({ agent: { id: agentId }, turnId }, { paseo });
    },
    end: (turnId: string | null, kind = "completed", at = clock, agentId = "agent-a", extra: { provider?: string; timeline?: unknown[]; error?: string } = {}) => {
      clock = at;
      const outcome = extra.error ? { kind, error: { message: extra.error } } : { kind };
      return ended!({ agent: { id: agentId, provider: extra.provider ?? "claude" }, turnId, outcome, timeline: extra.timeline ?? [] }, { paseo });
    },
    read: (input: unknown) => handlers.get("turns.usage")!(input) as Promise<{ turns: unknown[] }>,
    last: (agentIds: string[]) => handlers.get("turns.last")!({ agentIds }) as Promise<{ turns: unknown[] }>,
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

  it("answers each agent's latest turn, leaving out agents without one", async () => {
    const server = register(() => undefined);
    server.start("turn-1", 1000);
    await server.end("turn-1", "completed", 4000);
    server.start("turn-2", 9000);
    await server.end("turn-2", "completed", 12_000);
    server.start("turn-b", 2000, "agent-b");
    await server.end("turn-b", "completed", 2500, "agent-b");
    expect((await server.last(["agent-a", "agent-b", "agent-none", "agent-a"])).turns).toEqual([
      { agentId: "agent-a", startedAt: 9000, endedAt: 12_000 },
      { agentId: "agent-b", startedAt: 2000, endedAt: 2500 },
    ]);
  });
});

describe("turn errors", () => {
  const limit = "You've hit your session limit · resets 5:20pm (Asia/Singapore)";
  const reply = (text: string) => ({ type: "assistant_message", text });

  it("reads Claude's error reply and the daemon's failure, and nothing else", () => {
    const completed = { kind: "completed" } as const;
    expect(turnError("claude", completed, [{ type: "tool_call" }, reply(limit)])).toBe(limit);
    expect(turnError("claude", completed, [reply("API Error: 529 Overloaded")])).toBe("API Error: 529 Overloaded");
    expect(turnError("claude", completed, [reply("Claude AI usage limit reached|1792660800")])).toBe("Claude AI usage limit reached|1792660800");
    // A real answer that quotes the error, an error the turn moved past, another provider.
    expect(turnError("claude", completed, [reply(`The banner said: ${limit}`)])).toBeUndefined();
    expect(turnError("claude", completed, [reply(limit), { type: "tool_call" }])).toBeUndefined();
    expect(turnError("codex", completed, [reply(limit)])).toBeUndefined();
    expect(turnError("claude", completed, [])).toBeUndefined();
    expect(turnError("codex", { kind: "failed", error: { message: " You've hit your usage limit. " } }, [])).toBe("You've hit your usage limit.");
  });

  it("records the error with the turn and answers it as the latest turn's", async () => {
    // The limit reply arrives with zero usage, so the turn has no new figure.
    const server = register(() => ({ inputTokens: 0, outputTokens: 0 }));
    await server.end("turn-1", "completed", 1000, "agent-a", { timeline: [reply("Done.")] });
    server.start("turn-2", 2000);
    await server.end("turn-2", "completed", 2500, "agent-a", { timeline: [reply(limit)] });
    await server.end("turn-b", "failed", 3000, "agent-b", { provider: "codex", error: "You've hit your usage limit." });
    expect((await server.read({ agentId: "agent-a" })).turns.at(-1)).toEqual({ turnId: "turn-2", startedAt: 2000, endedAt: 2500, error: limit });
    expect((await server.last(["agent-a", "agent-b"])).turns).toEqual([
      { agentId: "agent-a", startedAt: 2000, endedAt: 2500, error: limit },
      { agentId: "agent-b", endedAt: 3000, error: "You've hit your usage limit." },
    ]);
  });

  it("answers a turn end that is still being recorded", async () => {
    const server = register(() => ({ outputTokens: 0 }));
    let release!: () => void;
    server.refresh.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ agent: {} }); }));
    const ending = server.end("turn-1", "completed", 1000, "agent-a", { timeline: [reply(limit)] });
    const asked = server.last(["agent-a"]);
    release();
    await ending;
    expect((await asked).turns).toEqual([{ agentId: "agent-a", endedAt: 1000, error: limit }]);
  });
});
