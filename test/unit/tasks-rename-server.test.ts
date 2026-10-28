import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import { tasksRenameRpc } from "../../shared/tasks-rpc";
import { registerTasksServer, type HostDaemonAccess } from "../../server/tasks/register";

vi.mock("@getpaseo/plugin/server", () => ({ execCommand: vi.fn() }));

function renameHandler(updateAgent: (agentId: string, updates: { name: string }) => Promise<void>, reachable = true, cwd = process.cwd()) {
  const close = vi.fn(async () => {});
  const connect: HostDaemonAccess["connect"] = vi.fn(async () => reachable ? {
    updateAgent, close,
    fetchAgent: async () => null,
    clearAgentAttention: async () => {},
    fetchAgents: async () => ({ entries: [] }),
    listProviderSubagents: async () => ({ subagents: [] }),
  } : null);
  const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: { cwd, workspaceId: "workspace-a" } }) }) }, workspaces: { ref: () => ({ refresh: async () => ({ id: "workspace-a" }) }) } } as unknown as PaseoApi;
  const handlers = new Map<string, (input: { agentId: string; title: string }, context: { paseo: PaseoApi }) => Promise<unknown>>();
  registerTasksServer({
    registerSettings() {}, on() {}, before() {},
    handle(contract: { name: string }, handler: (input: { agentId: string; title: string }, context: { paseo: PaseoApi }) => Promise<unknown>) {
      handlers.set(contract.name, handler);
    },
  } as unknown as PluginServerContext, undefined, undefined, { available: () => reachable, connect });
  return {
    call: (input = { agentId: "agent-a", title: "Updated title" }) => handlers.get(tasksRenameRpc.name)!(tasksRenameRpc.input.parse(input), { paseo }),
    close, connect,
  };
}

afterEach(() => vi.useRealTimers());

describe("Tasks rename RPC", () => {
  it("rejects a stale write when the original working directory no longer exists", async () => {
    const update = vi.fn(async () => {});
    const handler = renameHandler(update, true, "/nonexistent-better-paseo-test-worktree");
    await expect(handler.call()).resolves.toEqual({ ok: false, error: "Task operation unavailable (directory_missing): /nonexistent-better-paseo-test-worktree" });
    expect(handler.connect).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("persists the trimmed title on the selected host and closes the connection", async () => {
    const update = vi.fn(async () => {});
    const handler = renameHandler(update);
    await expect(handler.call({ agentId: "agent-a", title: "  Updated 中文  " })).resolves.toEqual({ ok: true, error: null });
    expect(update).toHaveBeenCalledExactlyOnceWith("agent-a", { name: "Updated 中文" });
    expect(handler.close).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty title at the RPC boundary", () => {
    expect(tasksRenameRpc.input.safeParse({ agentId: "agent-a", title: " \n " }).success).toBe(false);
  });

  it("reports an unreachable host and a rejected update", async () => {
    const update = vi.fn(async () => { throw new Error("Agent not found"); });
    const missing = renameHandler(update, false);
    await expect(missing.call()).resolves.toEqual({ ok: false, error: "Could not reach the Paseo daemon." });
    expect(update).not.toHaveBeenCalled();
    const rejected = renameHandler(update);
    await expect(rejected.call()).resolves.toEqual({ ok: false, error: "Agent not found" });
    expect(rejected.close).toHaveBeenCalledTimes(1);
  });

  it("bounds a request that never answers and closes the connection", async () => {
    vi.useFakeTimers();
    const update = vi.fn<() => Promise<void>>(() => new Promise(() => {}));
    const handler = renameHandler(update);
    const result = handler.call();
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toEqual({ ok: false, error: "The Paseo daemon did not answer." });
    expect(handler.close).toHaveBeenCalledTimes(1);
  });
});
