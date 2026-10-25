import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subagentTimelineRowSchema } from "../../shared/tasks-rpc";

const { execCommand } = vi.hoisted(() => ({ execCommand: vi.fn() }));
vi.mock("@getpaseo/plugin/server", () => ({ execCommand }));

type Handler = (input: unknown) => Promise<unknown>;

let tempRoot = "";
let originalPaseoCli: string | undefined;
let originalPath: string | undefined;

async function executable(directory: string, name = "paseo", mode = 0o755): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, name);
  await writeFile(path, "test executable\n");
  await chmod(path, mode);
  return path;
}

type HostAccess = import("../../server/tasks/register").HostDaemonAccess;

const noHost: HostAccess = { available: () => false, connect: async () => null };

async function registerHandlers(host: HostAccess = noHost): Promise<Map<string, Handler>> {
  vi.resetModules();
  const { registerTasksServer } = await import("../../server/tasks/register");
  const { createStopMarks } = await import("../../server/tasks/stop-marks");
  const handlers = new Map<string, Handler>();
  const server = {
    registerSettings() {},
    on() {
      return () => {};
    },
    before() {
      return () => {};
    },
    handle(contract: { name: string }, handler: Handler) {
      handlers.set(contract.name, handler);
    },
  } as unknown as PluginServerContext;
  registerTasksServer(server, createStopMarks(join(tempRoot, "tasks-stops.json")), undefined, host, createStopMarks(join(tempRoot, "tasks-reads.json")));
  return handlers;
}

async function invoke<T>(handlers: Map<string, Handler>, name: string, input: unknown): Promise<T> {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing test handler: ${name}`);
  return await handler(input) as T;
}

const validJson = JSON.stringify({ stoppedCount: 1, agentIds: ["agent-a"] });

beforeEach(async () => {
  originalPaseoCli = process.env.PASEO_CLI;
  originalPath = process.env.PATH;
  delete process.env.PASEO_CLI;
  process.env.PATH = "";
  tempRoot = await mkdtemp(join(tmpdir(), "tasks-server-"));
  execCommand.mockReset();
});

afterEach(async () => {
  if (originalPaseoCli === undefined) delete process.env.PASEO_CLI;
  else process.env.PASEO_CLI = originalPaseoCli;
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("Tasks server stop RPC", () => {
  it("prefers an executable PASEO_CLI, reports capability, and passes the host environment", async () => {
    const configured = await executable(tempRoot, "configured paseo");
    const pathCandidate = await executable(join(tempRoot, "bin"));
    process.env.PASEO_CLI = configured;
    process.env.PATH = join(tempRoot, "bin");
    execCommand.mockResolvedValue({ stdout: validJson, stderr: "" });

    const handlers = await registerHandlers();
    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: true, read: false });
    await expect(invoke(handlers, "tasks.stop", { agentIds: ["agent-a"] })).resolves.toEqual({
      results: [{ agentId: "agent-a", ok: true, error: null }],
    });

    expect(execCommand).toHaveBeenCalledWith(configured, ["agent", "stop", "agent-a", "--json"], {
      timeout: 10_000,
      env: process.env,
    });
    expect(execCommand.mock.calls[0]?.[2]?.env).toBe(process.env);
    expect(configured).not.toBe(pathCandidate);
  });

  it("falls back from a non-executable PASEO_CLI and scans PATH in order", async () => {
    const notExecutable = await executable(tempRoot, "not-executable", 0o644);
    const firstCandidate = await executable(join(tempRoot, "first"));
    await executable(join(tempRoot, "second"));
    process.env.PASEO_CLI = notExecutable;
    process.env.PATH = [join(tempRoot, "first"), join(tempRoot, "second")].join(delimiter);
    execCommand.mockResolvedValue({ stdout: validJson, stderr: "" });

    const handlers = await registerHandlers();
    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: true, read: false });
    await invoke(handlers, "tasks.stop", { agentIds: ["agent-a"] });
    expect(execCommand).toHaveBeenCalledWith(firstCandidate, expect.any(Array), expect.any(Object));
  });

  it("uses PATH when PASEO_CLI is unset and caches the resolved executable", async () => {
    const pathCandidate = await executable(join(tempRoot, "bin"));
    process.env.PATH = join(tempRoot, "bin");
    execCommand.mockResolvedValue({ stdout: validJson, stderr: "" });
    const handlers = await registerHandlers();

    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: true, read: false });
    process.env.PASEO_CLI = await executable(join(tempRoot, "later"));
    process.env.PATH = "";
    await invoke(handlers, "tasks.stop", { agentIds: ["agent-a"] });

    expect(execCommand).toHaveBeenCalledWith(pathCandidate, expect.any(Array), expect.any(Object));
  });

  it("reports unavailable when neither PASEO_CLI nor PATH contains an executable", async () => {
    await executable(join(tempRoot, "bin"), "paseo", 0o644);
    process.env.PASEO_CLI = join(tempRoot, "missing");
    process.env.PATH = join(tempRoot, "bin");
    const handlers = await registerHandlers();

    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: false, read: false });
    await expect(invoke(handlers, "tasks.stop", { agentIds: ["agent-a", "agent-b"] })).resolves.toEqual({
      results: [
        { agentId: "agent-a", ok: false, error: "Paseo CLI is unavailable." },
        { agentId: "agent-b", ok: false, error: "Paseo CLI is unavailable." },
      ],
    });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("maps per-agent errors, validates ids, and stops ids sequentially", async () => {
    const cli = await executable(join(tempRoot, "bin"));
    process.env.PATH = join(tempRoot, "bin");
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    execCommand.mockImplementation(async (_command: string, args: string[]) => {
      const agentId = args[2]!;
      order.push(agentId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      if (agentId === "agent-exit") throw Object.assign(new Error("failed"), { code: 7 });
      if (agentId === "agent-timeout") throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
      if (agentId === "agent-json") return { stdout: "not json", stderr: "" };
      return { stdout: validJson, stderr: "" };
    });
    const handlers = await registerHandlers();

    const result = await invoke<{ results: Array<{ agentId: string; ok: boolean; error: string | null }> }>(
      handlers,
      "tasks.stop",
      { agentIds: ["agent-ok", "agent-exit", "agent-timeout", "agent-json", "-bad", "bad/id"] },
    );

    expect(result.results).toEqual([
      { agentId: "agent-ok", ok: true, error: null },
      { agentId: "agent-exit", ok: false, error: "Paseo CLI exited with code 7." },
      { agentId: "agent-timeout", ok: false, error: "Paseo CLI timed out while stopping the agent." },
      { agentId: "agent-json", ok: false, error: "Paseo CLI returned invalid JSON." },
      { agentId: "-bad", ok: false, error: "Invalid agent ID." },
      { agentId: "bad/id", ok: false, error: "Invalid agent ID." },
    ]);
    expect(order).toEqual(["agent-ok", "agent-exit", "agent-timeout", "agent-json"]);
    expect(maxInFlight).toBe(1);
    expect(execCommand).toHaveBeenCalledTimes(4);
    expect(execCommand.mock.calls.every((call) => call[0] === cli)).toBe(true);
  });
});

describe("Tasks server stopped record", () => {
  it("remembers successful stops with their time, newest last, and forgets nothing it did not stop", async () => {
    process.env.PASEO_CLI = await executable(tempRoot);
    execCommand.mockImplementation(async (_cli: string, args: string[]) =>
      args[2] === "agent-bad" ? Promise.reject(Object.assign(new Error("boom"), { code: 1 })) : { stdout: validJson, stderr: "" });
    const handlers = await registerHandlers();
    await expect(invoke(handlers, "tasks.stopped", {})).resolves.toEqual({ stops: [] });
    await invoke(handlers, "tasks.stop", { agentIds: ["agent-a", "agent-bad", "agent-b"] });
    await invoke(handlers, "tasks.stop", { agentIds: ["agent-a"] });
    const { stops } = await invoke<{ stops: Array<{ agentId: string; stoppedAt: string }> }>(handlers, "tasks.stopped", {});
    expect(stops.map((stop) => stop.agentId)).toEqual(["agent-b", "agent-a"]);
    for (const stop of stops) expect(Number.isFinite(Date.parse(stop.stoppedAt))).toBe(true);
  });
});

describe("Tasks server unarchive RPC", () => {
  it("reloads an archived agent, the way Paseo's own Unarchive does", async () => {
    const cli = await executable(tempRoot);
    process.env.PASEO_CLI = cli;
    execCommand.mockImplementation(async (_cli: string, args: string[]) =>
      args[1] === "inspect" ? { stdout: JSON.stringify({ Id: "agent-a", Archived: true }), stderr: "" } : { stdout: "{}", stderr: "" });
    const handlers = await registerHandlers();

    await expect(invoke(handlers, "tasks.unarchive", { agentId: "agent-a" })).resolves.toEqual({ ok: true, error: null });
    expect(execCommand.mock.calls.map((call) => call[1])).toEqual([
      ["agent", "inspect", "agent-a", "--json"],
      ["agent", "reload", "agent-a", "--json"],
    ]);
    expect(execCommand.mock.calls[1]?.[2]).toEqual({ timeout: 60_000, env: process.env });
  });

  it("leaves an agent that is not archived alone: a reload would interrupt it", async () => {
    process.env.PASEO_CLI = await executable(tempRoot);
    execCommand.mockResolvedValue({ stdout: JSON.stringify({ Id: "agent-a", Archived: false }), stderr: "" });
    const handlers = await registerHandlers();

    await expect(invoke(handlers, "tasks.unarchive", { agentId: "agent-a" })).resolves.toEqual({ ok: true, error: null });
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("reports a missing CLI, a bad id, an unexpected answer and a failed reload", async () => {
    let handlers = await registerHandlers();
    await expect(invoke(handlers, "tasks.unarchive", { agentId: "agent-a" })).resolves.toEqual({ ok: false, error: "Paseo CLI is unavailable." });

    process.env.PASEO_CLI = await executable(tempRoot);
    handlers = await registerHandlers();
    await expect(invoke(handlers, "tasks.unarchive", { agentId: "bad/id" })).resolves.toEqual({ ok: false, error: "Invalid agent ID." });

    execCommand.mockResolvedValueOnce({ stdout: JSON.stringify({ Id: "agent-a" }), stderr: "" });
    await expect(invoke(handlers, "tasks.unarchive", { agentId: "agent-a" })).resolves.toEqual({ ok: false, error: "Paseo CLI returned an unexpected response." });

    execCommand
      .mockResolvedValueOnce({ stdout: JSON.stringify({ Id: "agent-a", Archived: true }), stderr: "" })
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }));
    await expect(invoke(handlers, "tasks.unarchive", { agentId: "agent-a" })).resolves.toEqual({
      ok: false,
      error: "Paseo CLI timed out while unarchiving the agent.",
    });
  });
});

describe("Tasks server labels RPC", () => {
  function labelsHost(list?: () => Promise<{ labels: Array<{ name: string; color: string }> }>) {
    const close = vi.fn(async () => {});
    const host: HostAccess = {
      available: () => true,
      connect: async () => ({ close, ...(list ? { listWorkspaceLabels: vi.fn(list) } : {}) }) as unknown as Awaited<ReturnType<HostAccess["connect"]>>,
    };
    return { host, close };
  }

  it("lists the daemon's label definitions over a connection it closes", async () => {
    const { host, close } = labelsHost(async () => ({ labels: [{ name: "Bug", color: "pink" }, { name: "infra", color: "emerald" }] }));
    const handlers = await registerHandlers(host);

    await expect(invoke(handlers, "tasks.labels", {})).resolves.toEqual({ labels: [{ name: "Bug", color: "pink" }, { name: "infra", color: "emerald" }] });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("answers null without a daemon, without its labels API, or when the list fails", async () => {
    await expect(invoke(await registerHandlers(), "tasks.labels", {})).resolves.toEqual({ labels: null });
    const old = labelsHost();
    await expect(invoke(await registerHandlers(old.host), "tasks.labels", {})).resolves.toEqual({ labels: null });
    expect(old.close).toHaveBeenCalledTimes(1);
    const failing = labelsHost(async () => {
      throw new Error("unknown message");
    });
    await expect(invoke(await registerHandlers(failing.host), "tasks.labels", {})).resolves.toEqual({ labels: null });
    expect(failing.close).toHaveBeenCalledTimes(1);
  });
});

describe("Tasks server project icons RPC", () => {
  type Icon = { data: string; mimeType: string } | null;
  function iconsHost(get?: (projectId: string) => Promise<{ icon: Icon }>) {
    const close = vi.fn(async () => {});
    const connect = vi.fn(async () => ({ close, ...(get ? { getProjectIcon: vi.fn(get) } : {}) }) as unknown as Awaited<ReturnType<HostAccess["connect"]>>);
    return { host: { available: () => true, connect } as HostAccess, close, connect };
  }

  it("reads every project's icon over one connection it closes; a project the daemon fails to read has none", async () => {
    const { host, close, connect } = iconsHost(async (projectId) => {
      if (projectId === "broken") throw new Error("unreadable");
      return { icon: projectId === "plain" ? null : { data: "aW1n", mimeType: "image/png" } };
    });
    const handlers = await registerHandlers(host);

    await expect(invoke(handlers, "tasks.project-icons", { projectIds: ["app", "plain", "broken", "app"] })).resolves.toEqual({
      icons: [
        // "img" is no PNG: the icon passes through without a colour.
        { projectId: "app", icon: { data: "aW1n", mimeType: "image/png", color: null } },
        { projectId: "plain", icon: null },
        { projectId: "broken", icon: null },
      ],
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("answers null without a daemon or without its icon API", async () => {
    await expect(invoke(await registerHandlers(), "tasks.project-icons", { projectIds: ["app"] })).resolves.toEqual({ icons: null });
    const old = iconsHost();
    await expect(invoke(await registerHandlers(old.host), "tasks.project-icons", { projectIds: ["app"] })).resolves.toEqual({ icons: null });
    expect(old.close).toHaveBeenCalledTimes(1);
  });
});

describe("Tasks server read RPC", () => {
  function fakeHost(
    clear: (agentIds: string | string[]) => Promise<void>,
    agents: Record<string, { cwd: string; status: string }> = {},
  ) {
    const close = vi.fn(async () => {});
    const clearAgentAttention = vi.fn(clear);
    const fetchAgent = vi.fn(async (agentId: string) => ({ agent: agents[agentId] ?? { cwd: tempRoot, status: "idle" } }));
    const host: HostAccess = {
      available: () => true,
      connect: async () => ({ clearAgentAttention, fetchAgent, close }) as unknown as Awaited<ReturnType<HostAccess["connect"]>>,
    };
    return { host, clearAgentAttention, close };
  }

  it("reports the capability and clears the agents' attention over one connection", async () => {
    const { host, clearAgentAttention, close } = fakeHost(async () => {});
    const handlers = await registerHandlers(host);

    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: false, read: true });
    await expect(invoke(handlers, "tasks.read", { agentIds: ["agent-a", "agent-b"] })).resolves.toEqual({ ok: true, error: null });
    expect(clearAgentAttention).toHaveBeenCalledWith(["agent-a", "agent-b"]);
    expect(close).toHaveBeenCalledTimes(1);
    // Recorded, so a failure the attention does not carry moves too.
    const { reads } = await invoke<{ reads: Array<{ agentId: string; readAt: string }> }>(handlers, "tasks.reads", {});
    expect(reads.map((read) => read.agentId)).toEqual(["agent-a", "agent-b"]);
    expect(Number.isFinite(Date.parse(reads[0]!.readAt))).toBe(true);
  });

  it("marks a stored agent whose working directory is gone on the board only: the daemon cannot load it", async () => {
    const gone = join(tempRoot, "removed-worktree");
    const { host, clearAgentAttention, close } = fakeHost(async () => {}, {
      "agent-stored": { cwd: gone, status: "closed" },
      "agent-live": { cwd: gone, status: "idle" },
      "agent-kept": { cwd: tempRoot, status: "closed" },
    });
    const handlers = await registerHandlers(host);

    await expect(invoke(handlers, "tasks.read", { agentIds: ["agent-stored"] })).resolves.toEqual({ ok: true, error: null });
    expect(clearAgentAttention).not.toHaveBeenCalled();
    // A loaded agent, or a stored one with its directory, the daemon clears.
    await expect(invoke(handlers, "tasks.read", { agentIds: ["agent-stored", "agent-live", "agent-kept"] })).resolves.toEqual({ ok: true, error: null });
    expect(clearAgentAttention).toHaveBeenCalledWith(["agent-live", "agent-kept"]);
    expect(close).toHaveBeenCalledTimes(2);
    const { reads } = await invoke<{ reads: Array<{ agentId: string }> }>(handlers, "tasks.reads", {});
    expect(reads.map((read) => read.agentId).sort()).toEqual(["agent-kept", "agent-live", "agent-stored"]);
  });

  it("reports a bad id, an unreachable daemon, and a daemon that never answers", async () => {
    vi.useFakeTimers();
    try {
      const { host, clearAgentAttention, close } = fakeHost(() => new Promise<void>(() => {}));
      let handlers = await registerHandlers(host);
      await expect(invoke(handlers, "tasks.read", { agentIds: ["bad/id"] })).resolves.toEqual({ ok: false, error: "Invalid agent ID." });
      expect(clearAgentAttention).not.toHaveBeenCalled();

      // The daemon gives no answer for an agent it cannot find; the server stops waiting.
      const pending = invoke(handlers, "tasks.read", { agentIds: ["agent-gone"] });
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toEqual({ ok: false, error: "The Paseo daemon did not mark the agent read." });
      expect(close).toHaveBeenCalledTimes(1);

      handlers = await registerHandlers(noHost);
      await expect(invoke(handlers, "tasks.read", { agentIds: ["agent-a"] })).resolves.toEqual({ ok: false, error: "Could not reach the Paseo daemon." });
      // A read that did not take leaves no mark.
      await expect(invoke(handlers, "tasks.reads", {})).resolves.toEqual({ reads: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Tasks server subagent timeline RPC", () => {
  it("preserves a provider subagent's message times while dropping unrelated fields, and closes the connection", async () => {
    const fetchProviderSubagentTimeline = vi.fn(async () => ({
      rows: [
        { timestamp: "2026-10-25T08:13:00Z", item: { type: "user_message", text: "Check the build", messageId: "m1" }, seq: 1 },
        { item: { type: "tool_call", name: "Bash", callId: "c1" }, seq: 2 },
      ],
    }));
    const close = vi.fn(async () => {});
    const host: HostAccess = { available: () => true, connect: async () => ({ fetchProviderSubagentTimeline, close }) as never };
    const handlers = await registerHandlers(host);
    await expect(invoke(handlers, "tasks.subagent-timeline", { parentAgentId: "parent", subagentId: "toolu_1", direction: "after", limit: 8 })).resolves.toEqual({
      rows: [{ type: "user_message", text: "Check the build", timestamp: "2026-10-25T08:13:00Z" }, { type: "tool_call" }],
      error: null,
    });
    expect(fetchProviderSubagentTimeline).toHaveBeenCalledWith("parent", "toolu_1", { direction: "after", limit: 8 });
    expect(close).toHaveBeenCalledTimes(1);
    const row = { type: "user_message", text: "Check the build", timestamp: "2026-10-25T08:13:00Z" };
    expect(subagentTimelineRowSchema.parse(row)).toEqual(row);
  });

  it("says why when the daemon cannot be reached, has no subagent timelines, or refuses", async () => {
    await expect(invoke(await registerHandlers(), "tasks.subagent-timeline", { parentAgentId: "p", subagentId: "s", direction: "tail", limit: 40 })).resolves.toEqual({
      rows: [],
      error: "Could not reach the Paseo daemon.",
    });
    const old: HostAccess = { available: () => true, connect: async () => ({ close: async () => {} }) as never };
    await expect(invoke(await registerHandlers(old), "tasks.subagent-timeline", { parentAgentId: "p", subagentId: "s", direction: "tail", limit: 40 })).resolves.toMatchObject({
      rows: [],
      error: "This Paseo cannot read subagent timelines.",
    });
    const refusing: HostAccess = {
      available: () => true,
      connect: async () => ({ fetchProviderSubagentTimeline: async () => { throw new Error("Update the host to view subagent conversations."); }, close: async () => {} }) as never,
    };
    await expect(invoke(await registerHandlers(refusing), "tasks.subagent-timeline", { parentAgentId: "p", subagentId: "s", direction: "tail", limit: 40 })).resolves.toEqual({
      rows: [],
      error: "Update the host to view subagent conversations.",
    });
  });
});
