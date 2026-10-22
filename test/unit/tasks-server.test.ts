import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function registerHandlers(): Promise<Map<string, Handler>> {
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
  registerTasksServer(server, createStopMarks(join(tempRoot, "tasks-stops.json")));
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
    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: true });
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
    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: true });
    await invoke(handlers, "tasks.stop", { agentIds: ["agent-a"] });
    expect(execCommand).toHaveBeenCalledWith(firstCandidate, expect.any(Array), expect.any(Object));
  });

  it("uses PATH when PASEO_CLI is unset and caches the resolved executable", async () => {
    const pathCandidate = await executable(join(tempRoot, "bin"));
    process.env.PATH = join(tempRoot, "bin");
    execCommand.mockResolvedValue({ stdout: validJson, stderr: "" });
    const handlers = await registerHandlers();

    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: true });
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

    await expect(invoke(handlers, "tasks.capabilities", {})).resolves.toEqual({ stop: false });
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
