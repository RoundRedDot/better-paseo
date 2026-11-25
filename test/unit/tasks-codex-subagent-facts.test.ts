import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexSubtitle, createCodexSubagentFacts, resolveCodexLaunch } from "../../server/tasks/codex-subagent-facts";
import { CodexFactsFailure, createCodexThreadReader, type CodexLaunch, type CodexThreadReader, type CodexThreadSettings } from "../../server/tasks/codex-thread-reader";
import { createSubagentRegistry, createSubagentWatch, type SeedDaemon, type SubagentDescriptor } from "../../server/tasks/provider-subagents";
import { subagentModel, subagentType } from "../../client/tasks/subagent-type";

const BASE = Date.parse("2026-11-25T09:00:00.000Z");
const iso = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();
/** Well after every fixture's creation: none of them just started. */
const LATER = BASE + 60 * 60_000;

function descriptor(id: string, overrides: Partial<SubagentDescriptor> = {}): SubagentDescriptor {
  return {
    id,
    parentAgentId: "parent",
    provider: "codex",
    title: "Codex subagent",
    description: `Task ${id}`,
    status: "running",
    createdAt: iso(0),
    updatedAt: iso(1),
    subtitle: null,
    ...overrides,
  };
}

const LAUNCH: CodexLaunch = { command: "codex", args: ["app-server"], env: {}, key: "codex" };

/** A Codex app-server on stdio JSON lines, answering `initialize` and `thread/read` from `threads`. */
function fakeAppServer(threads: Record<string, Partial<CodexThreadSettings> | "error">, options: { hold?: boolean; silent?: boolean; exitOnEof?: boolean } = {}) {
  const children: Array<ChildProcessWithoutNullStreams & { requests: Array<{ id?: number; method: string; params?: unknown }>; release(): void }> = [];
  const spawn = vi.fn((_command: string, _args: string[], _env: Record<string, string>) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams & { requests: Array<{ id?: number; method: string; params?: unknown }>; release(): void };
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const held: Array<() => void> = [];
    Object.assign(child, { stdin, stdout, stderr, exitCode: null, signalCode: null, requests: [], pid: 1000 + children.length });
    const exit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      Object.assign(child, { exitCode: code, signalCode: signal });
      child.emit("exit", code, signal);
    };
    child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
      queueMicrotask(() => exit(null, (signal as NodeJS.Signals) ?? "SIGTERM"));
      return true;
    }) as never;
    child.release = () => held.splice(0).forEach((answer) => answer());
    let buffer = "";
    stdin.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        child.requests.push(line);
        if (options.silent || line.id === undefined) continue;
        const answer = () => {
          if (line.method === "initialize") stdout.write(`${JSON.stringify({ id: line.id, result: { codexHome: "/home/.codex" } })}\n`);
          else if (line.method === "thread/read") {
            const thread = threads[line.params.threadId];
            if (thread === "error") stdout.write(`${JSON.stringify({ id: line.id, error: { code: -32603, message: "database is locked" } })}\n`);
            else if (!thread) stdout.write(`${JSON.stringify({ id: line.id, error: { code: -32600, message: `thread not loaded: ${line.params.threadId}` } })}\n`);
            else stdout.write(`${JSON.stringify({ id: line.id, result: { thread: { id: line.params.threadId, ...thread, turns: [] } } })}\n`);
          }
        };
        if (options.hold && line.method === "thread/read") held.push(answer);
        else answer();
      }
    });
    stdin.on("finish", () => {
      if (options.exitOnEof !== false) queueMicrotask(() => exit(0, null));
    });
    children.push(child);
    return child;
  });
  return { spawn, children };
}

function fakeReader(answers: Record<string, CodexThreadSettings | null | Error> = {}) {
  const calls: Array<{ launch: CodexLaunch; threadId: string; resolve(value: CodexThreadSettings | null): void; reject(error: Error): void }> = [];
  let hold = false;
  const reader: CodexThreadReader & { hold(on: boolean): void; calls: typeof calls } = {
    calls,
    hold(on) {
      hold = on;
    },
    read: vi.fn((launch: CodexLaunch, threadId: string) => new Promise<CodexThreadSettings | null>((resolve, reject) => {
      calls.push({ launch, threadId, resolve, reject });
      if (hold) return;
      const answer = answers[threadId];
      if (answer instanceof Error) reject(answer);
      else resolve(answer === undefined ? { model: "gpt-6.2-sol", reasoningEffort: "medium" } : answer);
    })),
    close: vi.fn(async () => {}),
  };
  return reader;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Codex launch for a parent's provider", () => {
  it("runs Codex's own app-server with the daemon's environment, without Paseo's runtime keys", () => {
    const launch = resolveCodexLaunch("codex", {}, { PATH: "/bin", ELECTRON_RUN_AS_NODE: "1", CLAUDECODE: "1", HOME: "/home" });
    expect(launch).toMatchObject({ command: "codex", args: ["app-server"], env: { PATH: "/bin", HOME: "/home" } });
    expect(launch?.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(launch?.env).not.toHaveProperty("CLAUDECODE");
  });

  it("follows Codex's configured command and env, and a custom provider's over them", () => {
    const providers = {
      codex: { command: ["/opt/codex-wrapper", "--profile", "work"], env: { CODEX_HOME: "/work/.codex", OPENAI_API_KEY: "secret" } },
      "my-codex": { extends: "codex", label: "Mine", env: { CODEX_HOME: "/mine/.codex" } },
      "own-binary": { extends: "codex", label: "Own", command: ["/usr/local/bin/codex-next"] },
    };
    expect(resolveCodexLaunch("codex", providers, { PATH: "/bin" })).toMatchObject({ command: "/opt/codex-wrapper", args: ["--profile", "work", "app-server"], env: { CODEX_HOME: "/work/.codex" } });
    expect(resolveCodexLaunch("my-codex", providers, {})).toMatchObject({ command: "/opt/codex-wrapper", env: { CODEX_HOME: "/mine/.codex", OPENAI_API_KEY: "secret" } });
    expect(resolveCodexLaunch("own-binary", providers, {})).toMatchObject({ command: "/usr/local/bin/codex-next", args: ["app-server"], env: { CODEX_HOME: "/work/.codex" } });
    const keys = ["codex", "my-codex", "own-binary"].map((provider) => resolveCodexLaunch(provider, providers, {})!.key);
    expect(new Set(keys).size).toBe(3);
    // The key names the launch without carrying its secrets.
    expect(keys.join()).not.toContain("secret");
  });

  it("is null for any provider that is not Codex", () => {
    expect(resolveCodexLaunch("claude", {}, {})).toBeNull();
    expect(resolveCodexLaunch("acp-thing", { "acp-thing": { extends: "acp", command: ["x"] } }, {})).toBeNull();
  });
});

describe("Codex facts line", () => {
  it("is the host's line: the type, then the model and effort Codex reports", () => {
    expect(codexSubtitle("Codex subagent", { model: "gpt-6.2-sol", reasoningEffort: "medium" })).toBe("Codex subagent · gpt-6.2-sol · medium");
    expect(codexSubtitle(null, { model: null, reasoningEffort: "high" })).toBe("Codex subagent · high");
    expect(codexSubtitle("explore", { model: "gpt-6.2-sol", reasoningEffort: null })).toBe("explore · gpt-6.2-sol");
    // Neither reported: unknown, not a line naming only the type.
    expect(codexSubtitle("Codex subagent", { model: null, reasoningEffort: null })).toBeNull();
  });

  it("reads back on the board as the child's model and effort", () => {
    const line = codexSubtitle("Codex subagent", { model: "gpt-6.2-sol", reasoningEffort: "medium" });
    expect(subagentModel(line, subagentType("Codex subagent", line))).toEqual({ model: "gpt-6.2-sol", thinking: "medium" });
    const effortOnly = codexSubtitle("Codex subagent", { model: null, reasoningEffort: "xhigh" });
    expect(subagentModel(effortOnly, subagentType("Codex subagent", effortOnly))).toEqual({ model: null, thinking: "xhigh" });
  });
});

describe("Codex thread reader", () => {
  it("initializes one app-server, reads several threads on it without turns, and stops it once idle", async () => {
    vi.useFakeTimers();
    const server = fakeAppServer({ a: { model: "gpt-6.2-sol", reasoningEffort: "medium" }, b: { model: "gpt-6.2-sol" } });
    const reader = createCodexThreadReader({ spawn: server.spawn, idleMs: 1_000 });
    await expect(reader.read(LAUNCH, "a")).resolves.toEqual({ model: "gpt-6.2-sol", reasoningEffort: "medium" });
    await expect(reader.read(LAUNCH, "b")).resolves.toEqual({ model: "gpt-6.2-sol", reasoningEffort: null });
    expect(server.spawn).toHaveBeenCalledTimes(1);
    expect(server.spawn.mock.calls[0]!.slice(0, 2)).toEqual(["codex", ["app-server"]]);
    const child = server.children[0]!;
    expect(child.requests.map((request) => request.method)).toEqual(["initialize", "initialized", "thread/read", "thread/read"]);
    expect(child.requests[2]!.params).toEqual({ threadId: "a", includeTurns: false });

    await vi.advanceTimersByTimeAsync(999);
    expect(child.exitCode).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    // Stdin's end stops it; no signal was needed.
    expect(child.exitCode).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();
    await reader.read(LAUNCH, "a");
    expect(server.spawn).toHaveBeenCalledTimes(2);
    await reader.close();
  });

  it("answers null for a thread Codex has not stored, and fails on any other error", async () => {
    const server = fakeAppServer({ broken: "error" });
    const reader = createCodexThreadReader({ spawn: server.spawn });
    await expect(reader.read(LAUNCH, "missing")).resolves.toBeNull();
    await expect(reader.read(LAUNCH, "broken")).rejects.toThrow("Codex thread/read failed (JSON-RPC error -32603)");
    await reader.close();
    expect(server.children[0]!.exitCode).toBe(0);
  });

  it("fails reads in flight when the app-server exits, and starts a fresh one for the next", async () => {
    const server = fakeAppServer({ a: { model: "m" } }, { hold: true });
    const reader = createCodexThreadReader({ spawn: server.spawn });
    const read = reader.read(LAUNCH, "a");
    await vi.waitFor(() => expect(server.children[0]!.requests.some((request) => request.method === "thread/read")).toBe(true));
    (server.children[0]!.stderr as PassThrough).write("panic: state db\n");
    await flush();
    Object.assign(server.children[0]!, { exitCode: 101 });
    server.children[0]!.emit("exit", 101, null);
    await expect(read).rejects.toThrow("Codex app-server exited (101)");
    const next = reader.read(LAUNCH, "a");
    await vi.waitFor(() => expect(server.children[1]?.requests.some((request) => request.method === "thread/read")).toBe(true));
    server.children[1]!.release();
    await expect(next).resolves.toEqual({ model: "m", reasoningEffort: null });
    await reader.close();
  });

  it("reports a binary that cannot start, and does not spawn it again for a while", async () => {
    let now = BASE;
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as ChildProcessWithoutNullStreams;
      Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null, kill: vi.fn() });
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
      return child;
    });
    const reader = createCodexThreadReader({ spawn, startBackoffMs: 60_000, now: () => now });
    await expect(reader.read(LAUNCH, "a")).rejects.toThrow("Codex app-server could not be started (ENOENT)");
    await expect(reader.read(LAUNCH, "b")).rejects.toThrow("Codex app-server could not be started (ENOENT)");
    expect(spawn).toHaveBeenCalledTimes(1);
    now += 60_001;
    await expect(reader.read(LAUNCH, "c")).rejects.toThrow("ENOENT");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("gives up on an app-server that does not answer, and kills one that ignores stdin's end", async () => {
    vi.useFakeTimers();
    const server = fakeAppServer({}, { silent: true, exitOnEof: false });
    const reader = createCodexThreadReader({ spawn: server.spawn, startTimeoutMs: 500, stopGraceMs: 100 });
    const read = reader.read(LAUNCH, "a");
    const failed = expect(read).rejects.toThrow("did not answer initialize within 500 ms");
    await vi.advanceTimersByTimeAsync(500);
    await failed;
    const child = server.children[0]!;
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    expect(child.signalCode).toBe("SIGTERM");
  });

  it("hands a freed slot to the waiting read, so a read arriving meanwhile cannot go over the limit", async () => {
    const server = fakeAppServer({ a: { model: "m" }, b: { model: "m" }, c: { model: "m" } }, { hold: true });
    const reader = createCodexThreadReader({ spawn: server.spawn, maxInFlight: 1 });
    const a = reader.read(LAUNCH, "a");
    const b = reader.read(LAUNCH, "b");
    const child = () => server.children[0]!;
    const unanswered = () => child().requests.filter((request) => request.method === "thread/read").length - answered;
    let answered = 0;
    let most = 0;
    await vi.waitFor(() => expect(unanswered()).toBe(1));
    let c: Promise<unknown> | undefined;
    // Right after the answer for "a" lands, one microtask behind it, a third read arrives: after "a" frees
    // its slot, before the waiting "b" takes it.
    child().stdout.once("data", () => queueMicrotask(() => {
      c = reader.read(LAUNCH, "c");
    }));
    answered += 1;
    child().release();
    for (let round = 0; round < 20; round++) {
      await flush();
      most = Math.max(most, unanswered());
      if (unanswered() > 0) {
        answered += unanswered();
        child().release();
      }
    }
    await expect(Promise.all([a, b, c])).resolves.toHaveLength(3);
    expect(most).toBe(1);
    await reader.close();
  });

  it("keeps the app-server's output and the provider's error text out of its failures", async () => {
    const SECRET = "sk-SENTINEL-4f9a";
    // stderr, an RPC error's text and a spawn error's text can all echo configuration.
    const server = fakeAppServer({ a: { model: "m" } }, { hold: true });
    const reader = createCodexThreadReader({ spawn: server.spawn });
    const exited = reader.read(LAUNCH, "a");
    await vi.waitFor(() => expect(server.children[0]!.requests.some((request) => request.method === "thread/read")).toBe(true));
    (server.children[0]!.stderr as PassThrough).write(`error: invalid OPENAI_API_KEY=${SECRET}\n`);
    await flush();
    Object.assign(server.children[0]!, { exitCode: 101 });
    server.children[0]!.emit("exit", 101, null);
    const exitError = await exited.catch((error: Error) => error);
    expect(exitError).toBeInstanceOf(CodexFactsFailure);
    expect((exitError as CodexFactsFailure).message).toBe("Codex app-server exited (101)");

    // An RPC error whose text carries the secret.
    const leakyRpc = createCodexThreadReader({ spawn: (command, args, env) => {
      const child = fakeAppServer({}).spawn(command, args, env);
      const write = (child.stdout as PassThrough).write.bind(child.stdout);
      (child.stdout as PassThrough).write = ((chunk: string) => write(chunk.replace(/thread not loaded: [^"]*/, `config ${SECRET} rejected`))) as never;
      return child;
    } });
    const rpcError = await leakyRpc.read(LAUNCH, "x").catch((error: Error) => error);
    expect(rpcError).toBeInstanceOf(CodexFactsFailure);
    expect((rpcError as Error).message).toBe("Codex thread/read failed (JSON-RPC error -32600)");
    await leakyRpc.close();

    const spawnLeak = createCodexThreadReader({ spawn: () => {
      throw Object.assign(new Error(`spawn /opt/${SECRET}/codex EACCES`), { code: "EACCES" });
    } });
    const spawnError = await spawnLeak.read(LAUNCH, "a").catch((error: Error) => error);
    expect((spawnError as Error).message).toBe("Codex app-server could not be started (EACCES)");

    for (const error of [exitError, rpcError, spawnError]) expect(String((error as Error).message)).not.toContain(SECRET);
    await reader.close();
  });

  it("logs a failure's category but never a provider's raw text", async () => {
    const SECRET = "sk-SENTINEL-77c1";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const reader = fakeReader();
    (reader.read as ReturnType<typeof vi.fn>).mockImplementation(async (_launch: CodexLaunch, threadId: string) => {
      if (threadId === "raw") throw new Error(`upstream said ${SECRET}`);
      throw new CodexFactsFailure("exit", "Codex app-server exited (1)");
    });
    const facts = createCodexSubagentFacts({ reader, retryDelaysMs: [], now: () => LATER });
    const paseo = {
      agents: { ref: (id: string) => ({ refresh: async () => {
        if (id === "lost") throw new Error(`agent store ${SECRET}`);
        return { agent: { provider: "codex" } };
      } }) },
      config: { get: async () => ({ requestId: "r", config: { providers: { codex: { env: { OPENAI_API_KEY: SECRET } } } } }) },
    } as unknown as PaseoApi;
    facts.attach(paseo);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("raw"));
    registry.upsert(descriptor("exits"));
    registry.upsert(descriptor("orphan", { parentAgentId: "lost" }));
    await facts.settle(1_000);
    const lines = log.mock.calls.map((call) => call.join(" "));
    expect(lines).toEqual(expect.arrayContaining([
      "[better-paseo] codex subagent facts: could not read thread raw: could not resolve the Codex launch",
      "[better-paseo] codex subagent facts: could not read thread exits: Codex app-server exited (1)",
      "[better-paseo] codex subagent facts: could not read thread orphan: could not read the parent agent",
    ]));
    expect(lines.join("\n")).not.toContain(SECRET);
    // The env reached the launch, never the log.
    expect((reader.read as ReturnType<typeof vi.fn>).mock.calls[0]![0].env.OPENAI_API_KEY).toBe(SECRET);
  });

  it("answers at most a few reads at once on one app-server", async () => {
    const threads = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`t${index}`, { model: "m" }]));
    const server = fakeAppServer(threads, { hold: true });
    const reader = createCodexThreadReader({ spawn: server.spawn, maxInFlight: 2 });
    const reads = Object.keys(threads).map((id) => reader.read(LAUNCH, id));
    const sent = () => server.children[0]!.requests.filter((request) => request.method === "thread/read").length;
    await vi.waitFor(() => expect(sent()).toBe(2));
    await flush();
    expect(sent()).toBe(2);
    while (sent() < 6) {
      server.children[0]!.release();
      await flush();
    }
    server.children[0]!.release();
    await expect(Promise.all(reads)).resolves.toHaveLength(6);
    await reader.close();
  });
});

function codexFacts(reader: CodexThreadReader, extra: Partial<Parameters<typeof createCodexSubagentFacts>[0]> = {}) {
  const report = vi.fn();
  const launchFor = vi.fn(async (parentAgentId: string) => (parentAgentId.startsWith("claude") ? null : LAUNCH));
  const facts = createCodexSubagentFacts({ reader, report, launchFor, retryDelaysMs: [1_000, 2_000], now: () => LATER, ...extra });
  return { facts, report, launchFor };
}

describe("provider subagent registry with Codex facts", () => {
  it("fills a Codex child's missing line and leaves its status and times as the host sent them", async () => {
    const reader = fakeReader();
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    const before = registry.read();
    expect(before.subagents?.[0]?.subtitle).toBeNull();
    await facts.settle(1_000);
    const after = registry.read(before.version);
    expect(after.version).not.toBe(before.version);
    expect(after.subagents).toEqual([{ ...descriptor("child"), subtitle: "Codex subagent · gpt-6.2-sol · medium" }]);
    expect(reader.calls.map((call) => call.threadId)).toEqual(["child"]);
  });

  it("never reads for a line the host sends, nor for other providers", async () => {
    const reader = fakeReader();
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("hosted", { subtitle: "Codex subagent · gpt-6.1 · high" }));
    registry.upsert(descriptor("claude", { provider: "claude", title: "general-purpose" }));
    await facts.settle(1_000);
    expect(reader.read).not.toHaveBeenCalled();
    expect(registry.read().subagents?.map((subagent) => subagent.subtitle)).toEqual(["Codex subagent · gpt-6.1 · high", null]);
  });

  it("keeps the host's line once it arrives, even when a slower read answers after it", async () => {
    const reader = fakeReader();
    reader.hold(true);
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    await vi.waitFor(() => expect(reader.calls).toHaveLength(1));
    registry.upsert(descriptor("child", { updatedAt: iso(2), subtitle: "Codex subagent · host-model · low" }));
    reader.calls[0]!.resolve({ model: "stale", reasoningEffort: "medium" });
    await facts.settle(1_000);
    expect(registry.read().subagents?.[0]?.subtitle).toBe("Codex subagent · host-model · low");
    // An upsert that says nothing new about the line keeps it too.
    registry.upsert(descriptor("child", { updatedAt: iso(3), status: "completed", subtitle: "Codex subagent · host-model · low" }));
    expect(registry.read().subagents?.[0]).toMatchObject({ status: "completed", subtitle: "Codex subagent · host-model · low" });
    expect(reader.calls).toHaveLength(1);
  });

  it("leaves the line unknown where Codex reports neither field, without guessing from the parent", async () => {
    const reader = fakeReader({ bare: { model: null, reasoningEffort: null }, effort: { model: null, reasoningEffort: "high" } });
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("bare"));
    registry.upsert(descriptor("effort", { title: null }));
    await facts.settle(1_000);
    expect(registry.read().subagents?.map((subagent) => subagent.subtitle)).toEqual([null, "Codex subagent · high"]);
  });

  it("waits a moment before reading a child that just started, and never reads one the host fills in meanwhile", async () => {
    vi.useFakeTimers();
    const reader = fakeReader();
    const { facts } = codexFacts(reader, { now: () => BASE + 2_000, freshDelayMs: 3_000 });
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("hosted", { createdAt: iso(0) }));
    registry.upsert(descriptor("plain", { createdAt: iso(0) }));
    await vi.advanceTimersByTimeAsync(2_999);
    expect(reader.calls).toHaveLength(0);
    // A host with getpaseo/paseo#10770 sends its line right after the first upsert: no app-server is started for it.
    registry.upsert(descriptor("hosted", { createdAt: iso(0), updatedAt: iso(2), subtitle: "Codex subagent · gpt-6.2-sol · medium" }));
    await vi.advanceTimersByTimeAsync(1);
    expect(reader.calls.map((call) => call.threadId)).toEqual(["plain"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(registry.read().subagents?.map((subagent) => subagent.subtitle)).toEqual(["Codex subagent · gpt-6.2-sol · medium", "Codex subagent · gpt-6.2-sol · medium"]);
  });

  it("does not read a child whose parent is not a Codex agent", async () => {
    const reader = fakeReader();
    const { facts, launchFor } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child", { parentAgentId: "claude-parent" }));
    await facts.settle(1_000);
    registry.upsert(descriptor("child", { parentAgentId: "claude-parent", status: "completed", updatedAt: iso(2) }));
    await facts.settle(1_000);
    expect(launchFor).toHaveBeenCalledTimes(1);
    expect(reader.read).not.toHaveBeenCalled();
  });

  it("reads a thread Codex had not stored yet again, then reports it and leaves the line unknown", async () => {
    vi.useFakeTimers();
    const reader = fakeReader({ child: null });
    const { facts, report } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    await vi.advanceTimersByTimeAsync(0);
    expect(reader.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reader.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reader.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reader.calls).toHaveLength(3);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("Codex has no stored thread child"));
    expect(registry.read().subagents?.[0]?.subtitle).toBeNull();
  });

  it("reports a failed read and tries again later, then shows what the retry reads", async () => {
    vi.useFakeTimers();
    const reader = fakeReader();
    let fail = true;
    (reader.read as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (fail) throw new CodexFactsFailure("exit", "Codex app-server exited (1)");
      return { model: "gpt-6.2-sol", reasoningEffort: "medium" };
    });
    const { facts, report } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith("could not read thread child: Codex app-server exited (1)");
    fail = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(registry.read().subagents?.[0]?.subtitle).toBe("Codex subagent · gpt-6.2-sol · medium");
  });

  it("reads once more when a child finishes, shows the final read, and builds the line again for a new title", async () => {
    const reader = fakeReader();
    reader.hold(true);
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    await vi.waitFor(() => expect(reader.calls).toHaveLength(1));
    // It finishes while the first read runs: that read's answer stands until the final one, which reads again.
    registry.upsert(descriptor("child", { status: "completed", updatedAt: iso(2) }));
    reader.calls[0]!.resolve({ model: "first", reasoningEffort: "low" });
    await vi.waitFor(() => expect(reader.calls).toHaveLength(2));
    expect(registry.read().subagents?.[0]?.subtitle).toBe("Codex subagent · first · low");
    reader.calls[1]!.resolve({ model: "final", reasoningEffort: "high" });
    await facts.settle(1_000);
    expect(registry.read().subagents?.[0]).toMatchObject({ status: "completed", updatedAt: iso(2), subtitle: "Codex subagent · final · high" });
    // Finished and read: later upserts do not read again.
    registry.upsert(descriptor("child", { status: "completed", updatedAt: iso(3), description: "renamed" }));
    await facts.settle(1_000);
    expect(reader.calls).toHaveLength(2);

    // A new title rebuilds the line from what was read, without reading again.
    registry.upsert(descriptor("child", { status: "completed", updatedAt: iso(4), title: "explore" }));
    expect(registry.read().subagents?.[0]?.subtitle).toBe("explore · final · high");
    await facts.settle(1_000);
    expect(reader.calls).toHaveLength(2);
  });

  it("drops an answer for a subagent that left meanwhile", async () => {
    const reader = fakeReader();
    reader.hold(true);
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    registry.upsert(descriptor("sibling", { parentAgentId: "other-parent" }));
    await vi.waitFor(() => expect(reader.calls).toHaveLength(2));
    registry.remove("parent", "child");
    registry.dropParent("other-parent");
    const version = registry.read().version;
    reader.calls.forEach((call) => call.resolve({ model: "m", reasoningEffort: "e" }));
    await facts.settle(1_000);
    expect(registry.read(version)).toEqual({ version, subagents: null });
  });

  it("does not give a subagent that left and came back the answer read before it left", async () => {
    const reader = fakeReader();
    reader.hold(true);
    const { facts } = codexFacts(reader);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("child"));
    await vi.waitFor(() => expect(reader.calls).toHaveLength(1));
    registry.remove("parent", "child");
    registry.upsert(descriptor("child", { updatedAt: iso(5) }));
    await vi.waitFor(() => expect(reader.calls).toHaveLength(2));
    reader.calls[0]!.resolve({ model: "before", reasoningEffort: "low" });
    await flush();
    expect(registry.read().subagents?.[0]?.subtitle).toBeNull();
    reader.calls[1]!.resolve({ model: "after", reasoningEffort: "high" });
    await facts.settle(1_000);
    expect(registry.read().subagents?.[0]?.subtitle).toBe("Codex subagent · after · high");
  });

  it("reads at most a few children at once", async () => {
    const reader = fakeReader();
    reader.hold(true);
    const { facts } = codexFacts(reader, { concurrency: 2 });
    const registry = createSubagentRegistry(() => BASE, facts);
    for (let index = 0; index < 5; index++) registry.upsert(descriptor(`c${index}`, { status: "completed" }));
    await vi.waitFor(() => expect(reader.calls).toHaveLength(2));
    await flush();
    expect(reader.calls).toHaveLength(2);
    for (let answered = 0; answered < 5; answered++) {
      await vi.waitFor(() => expect(reader.calls.length).toBeGreaterThan(answered));
      reader.calls[answered]!.resolve({ model: "m", reasoningEffort: null });
      await flush();
    }
    await facts.settle(1_000);
    expect(reader.calls).toHaveLength(5);
    expect(registry.read().subagents?.every((subagent) => subagent.subtitle === "Codex subagent · m")).toBe(true);
  });
});

describe("Codex facts through the host's API", () => {
  function paseoFake(providers: Record<string, unknown>, agents: Record<string, string>) {
    const refresh = vi.fn(async (id: string) => (agents[id] ? { agent: { id, provider: agents[id] } } : null));
    const get = vi.fn(async () => ({ requestId: "r", config: { providers } }));
    const paseo = { agents: { ref: (id: string) => ({ refresh: () => refresh(id) }) }, config: { get } } as unknown as PaseoApi;
    return { paseo, refresh, get };
  }

  it("resolves each parent's provider once and the daemon's config, and launches what the host would", async () => {
    const reader = fakeReader();
    const facts = createCodexSubagentFacts({ reader, report: vi.fn(), now: () => LATER });
    const { paseo, refresh, get } = paseoFake({ "my-codex": { extends: "codex", label: "Mine", env: { CODEX_HOME: "/mine" } } }, { parent: "my-codex", plain: "codex", claude: "claude" });
    facts.attach(paseo);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("a"));
    registry.upsert(descriptor("b"));
    registry.upsert(descriptor("c", { parentAgentId: "plain" }));
    registry.upsert(descriptor("d", { parentAgentId: "claude" }));
    await facts.settle(1_000);
    expect(reader.calls.map((call) => [call.threadId, call.launch.env.CODEX_HOME ?? null])).toEqual([["a", "/mine"], ["b", "/mine"], ["c", process.env.CODEX_HOME ?? null]]);
    expect(refresh.mock.calls.map(([id]) => id).sort()).toEqual(["claude", "parent", "plain"]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reports a config it cannot read instead of guessing", async () => {
    const reader = fakeReader();
    const report = vi.fn();
    const facts = createCodexSubagentFacts({ reader, report, retryDelaysMs: [], now: () => LATER });
    const paseo = { agents: { ref: () => ({ refresh: async () => ({ agent: { provider: "codex" } }) }) }, config: { get: async () => { throw new Error("daemon.read denied"); } } } as unknown as PaseoApi;
    facts.attach(paseo);
    const registry = createSubagentRegistry(() => BASE, facts);
    registry.upsert(descriptor("a"));
    await facts.settle(1_000);
    expect(report).toHaveBeenCalledWith("could not read thread a: could not read the daemon config");
    expect(reader.read).not.toHaveBeenCalled();
  });
});

describe("provider subagent watch with Codex facts", () => {
  it("answers a board's first request with the seed's Codex lines once read", async () => {
    const reader = fakeReader();
    const { facts } = codexFacts(reader);
    const observeEvents = vi.fn(() => ({ subscriptionId: "events", ready: Promise.resolve({}), subscribe: () => () => {}, release: async () => {} }));
    const paseo = { observeEvents } as unknown as PaseoApi;
    const daemon: SeedDaemon = {
      fetchAgents: async () => ({ entries: [{ agent: { id: "parent", capabilities: { supportsStreaming: true } } }], pageInfo: { nextCursor: null } }),
      listProviderSubagents: async () => ({ subagents: [descriptor("child", { status: "completed" })] }),
      close: async () => {},
    };
    const watch = createSubagentWatch(createSubagentRegistry(() => BASE, facts), async () => daemon, () => BASE);
    const first = await watch.read(paseo);
    expect(first.subagents?.[0]?.subtitle).toBe("Codex subagent · gpt-6.2-sol · medium");
  });

  it("does not hold a board's first request long for a slow Codex", async () => {
    vi.useFakeTimers();
    const reader = fakeReader();
    reader.hold(true);
    const { facts } = codexFacts(reader);
    const paseo = { observeEvents: () => ({ subscriptionId: "events", ready: Promise.resolve({}), subscribe: () => () => {}, release: async () => {} }) } as unknown as PaseoApi;
    const daemon: SeedDaemon = {
      fetchAgents: async () => ({ entries: [{ agent: { id: "parent", capabilities: { supportsStreaming: true } } }], pageInfo: { nextCursor: null } }),
      listProviderSubagents: async () => ({ subagents: [descriptor("child")] }),
      close: async () => {},
    };
    const watch = createSubagentWatch(createSubagentRegistry(() => BASE, facts), async () => daemon, () => BASE);
    let answered: Awaited<ReturnType<typeof watch.read>> | null = null;
    void watch.read(paseo).then((result) => (answered = result));
    await vi.advanceTimersByTimeAsync(1_499);
    expect(answered).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(answered!.subagents?.[0]).toMatchObject({ id: "child", status: "running", subtitle: null });
  });
});
