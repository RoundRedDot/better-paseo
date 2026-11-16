import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onHookEvent, onSessionOpen } from "../../server/hooks";
import { createTurnUsageLedger, registerTurnUsageServer } from "../../server/turn-usage";

type Handler = (payload: unknown, context: unknown) => unknown;

/** Paseo 0.15+ (`addHook`) or 0.14 (`on` and `before` only). */
function host(withAddHook: boolean) {
  const added = new Map<string, Handler>();
  const legacy = new Map<string, Handler>();
  const server = {
    on: vi.fn((name: string, handler: Handler) => { legacy.set(name, handler); return () => {}; }),
    before: vi.fn((name: string, handler: Handler) => { legacy.set(name, handler); return () => {}; }),
    handle: vi.fn(),
    ...(withAddHook ? { addHook: vi.fn((name: string, handler: Handler) => { added.set(name, handler); return () => {}; }) } : {}),
  };
  return { server: server as unknown as PluginServerContext, raw: server, added, legacy };
}

describe("lifecycle hooks across Paseo versions", () => {
  it("uses addHook with the renamed hooks when the host has it", async () => {
    const { server, raw, added } = host(true);
    const turn = vi.fn();
    const open = vi.fn();
    onHookEvent(server, "agent.turn.before", turn);
    onHookEvent(server, "agent.turn.after", vi.fn());
    onHookEvent(server, "agent.create.after", vi.fn());
    onHookEvent(server, "agent.archive.after", vi.fn());
    onSessionOpen(server, open);
    expect([...added.keys()]).toEqual(["agent.turn.before", "agent.turn.after", "agent.create.after", "agent.archive.after", "agent.open.before"]);
    expect(raw.on).not.toHaveBeenCalled();
    expect(raw.before).not.toHaveBeenCalled();

    const context = { paseo: {}, signal: new AbortController().signal };
    // addHook handlers must return a promise, and an open hook leaves the request alone.
    await expect(added.get("agent.turn.before")!({ agent: { id: "a" }, turnId: "t" }, context)).resolves.toBeUndefined();
    expect(turn).toHaveBeenCalledWith({ agent: { id: "a" }, turnId: "t" }, context);
    const request = { agentId: "a", purpose: "interactive", reason: "resume" };
    await expect(added.get("agent.open.before")!({ request }, context)).resolves.toBeUndefined();
    expect(open).toHaveBeenCalledWith(request, context);
  });

  it("falls back to on and before on Paseo 0.14", () => {
    const { server, legacy } = host(false);
    onHookEvent(server, "agent.turn.before", vi.fn());
    onHookEvent(server, "agent.turn.after", vi.fn());
    onHookEvent(server, "agent.create.after", vi.fn());
    onHookEvent(server, "agent.archive.after", vi.fn());
    onSessionOpen(server, vi.fn());
    expect([...legacy.keys()]).toEqual(["agent.turn_started", "agent.turn_ended", "agent.created", "agent.archived", "agent.session_open"]);
  });
});

describe("turn end on Paseo 0.16", () => {
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "server-hooks-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads the turn from the timeline when the payload carries none", async () => {
    const { server, added } = host(true);
    const ledger = createTurnUsageLedger(dir);
    registerTurnUsageServer(server, ledger, () => 1000);
    const limit = "You've hit your session limit · resets 5:20pm (Asia/Singapore)";
    const refetch = vi.fn(async () => ({ entries: [{ turnId: "turn-1", item: { type: "assistant_message", text: limit } }], error: null }));
    const refresh = vi.fn(async () => ({ agent: { lastUsage: undefined } }));
    const paseo = { agents: { ref: () => ({ refresh, timeline: { refetch } }) } };
    // 0.16's `agent.turn.after` payload has no `timeline` key at all.
    await added.get("agent.turn.after")!(
      { agent: { id: "agent-a", provider: "claude" }, turnId: "turn-1", outcome: { kind: "completed" } },
      { paseo, signal: new AbortController().signal },
    );
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(await ledger.read("agent-a")).toEqual([{ turnId: "turn-1", endedAt: 1000, error: limit }]);
  });
});
