import { spawn as spawnChild, type ChildProcessWithoutNullStreams } from "node:child_process";

/** How the host starts a Codex app-server for one provider, as `resolveCodexLaunch` reads it. */
export interface CodexLaunch {
  command: string;
  /** The arguments, `app-server` last. */
  args: string[];
  env: Record<string, string>;
  /** Launches with the same key share one app-server. */
  key: string;
}

/** A thread's current or last persisted settings; a field Codex does not report is null. */
export interface CodexThreadSettings {
  model: string | null;
  reasoningEffort: string | null;
}

export type CodexSpawn = (command: string, args: string[], env: Record<string, string>) => ChildProcessWithoutNullStreams;

export interface CodexThreadReaderOptions {
  spawn?: CodexSpawn;
  /** An app-server with nothing to read is stopped this long after its last answer. */
  idleMs?: number;
  /** Spawn and `initialize` together. */
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** Reads one app-server answers at once; the rest wait. */
  maxInFlight?: number;
  /** After a failed start the same launch fails at once for this long, so a broken binary is not spawned per subagent. */
  startBackoffMs?: number;
  /** From closing stdin to SIGTERM, and from SIGTERM to SIGKILL. */
  stopGraceMs?: number;
  now?: () => number;
}

/**
 * A failure whose message is safe for the plugin's log: it names what went
 * wrong (an errno, an exit code, a JSON-RPC code) and never carries the
 * app-server's output, the provider's raw error text or its configuration,
 * any of which can hold secrets.
 */
export class CodexFactsFailure extends Error {
  constructor(readonly category: "spawn" | "start" | "exit" | "timeout" | "rpc" | "protocol" | "stopped" | "parent" | "config" | "api", message: string) {
    super(message);
  }
}

/** Reads Codex threads' settings through `thread/read` on a short-lived app-server of the host's Codex. */
export interface CodexThreadReader {
  /** Null where this Codex has no such thread stored; throws where the app-server cannot answer. */
  read(launch: CodexLaunch, threadId: string): Promise<CodexThreadSettings | null>;
  /** Stops every app-server; reads in flight fail. */
  close(): Promise<void>;
}

/** The reserved client name Codex does not take as a model-request originator, as Paseo's own client uses. */
const CLIENT_INFO = { name: "codex_app_server_daemon", title: "Better Paseo", version: "0.0.0" };
const MAX_LINE = 1024 * 1024;
/** Codex answers a thread it has no rollout or state for with "thread not loaded: <id>". */
const MISSING_THREAD = /thread not (loaded|found)|no (rollout|thread) found|unknown thread/i;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface AppServer {
  child: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  pending: Map<number, Pending>;
  nextId: number;
  inFlight: number;
  waiting: Array<() => void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  exited: Promise<void>;
}

class CodexRpcError extends Error {
  constructor(readonly code: number | null, message: string) {
    super(message);
  }
}

const defaultSpawn: CodexSpawn = (command, args, env) =>
  spawnChild(command, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

/** A timer that does not hold the process open. */
export function unref(timer: unknown): void {
  (timer as { unref?: () => void } | null)?.unref?.();
}

/** An errno such as ENOENT or EACCES: says why without the path or text around it. */
function errno(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^E[A-Z0-9]+$/.test(code) ? code : "unknown error";
}

function safe(error: unknown, category: CodexFactsFailure["category"], text: string): CodexFactsFailure {
  return error instanceof CodexFactsFailure ? error : new CodexFactsFailure(category, text);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * One app-server per launch, started on the first read and stopped once idle.
 * It runs with stdin piped, so it also ends with this process: Codex exits on
 * stdin's end.
 */
export function createCodexThreadReader(options: CodexThreadReaderOptions = {}): CodexThreadReader {
  const spawn = options.spawn ?? defaultSpawn;
  const idleMs = options.idleMs ?? 20_000;
  const startTimeoutMs = options.startTimeoutMs ?? 15_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const maxInFlight = options.maxInFlight ?? 4;
  const startBackoffMs = options.startBackoffMs ?? 60_000;
  const stopGraceMs = options.stopGraceMs ?? 2_000;
  const now = options.now ?? (() => Date.now());
  const servers = new Map<string, AppServer>();
  const failedStarts = new Map<string, { until: number; error: CodexFactsFailure }>();

  function fail(key: string, server: AppServer, error: CodexFactsFailure): void {
    if (servers.get(key) === server) servers.delete(key);
    if (server.closed) return;
    server.closed = true;
    if (server.idleTimer) clearTimeout(server.idleTimer);
    for (const pending of server.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    server.pending.clear();
    for (const wake of server.waiting.splice(0)) wake();
    stop(server);
  }

  /** Ends stdin, then signals: the app-server exits on its own at stdin's end. */
  function stop(server: AppServer): void {
    const { child } = server;
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.stdin.end();
    } catch {
      // Already closed.
    }
    const term = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      const kill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, stopGraceMs);
      unref(kill);
    }, stopGraceMs);
    unref(term);
    void server.exited.then(() => clearTimeout(term));
  }

  function request(key: string, server: AppServer, method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (server.closed) return Promise.reject(new CodexFactsFailure("stopped", "Codex app-server stopped"));
    const id = server.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.pending.delete(id);
        // An app-server that stops answering is replaced on the next read.
        const timeout = new CodexFactsFailure("timeout", `Codex app-server did not answer ${method} within ${timeoutMs} ms`);
        fail(key, server, timeout);
        reject(timeout);
      }, timeoutMs);
      server.pending.set(id, { resolve, reject, timer });
      try {
        server.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        server.pending.delete(id);
        reject(new CodexFactsFailure("protocol", `Could not write to Codex app-server (${errno(error)})`));
      }
    });
  }

  function onLine(key: string, server: AppServer, line: string): void {
    if (!line.trim()) return;
    let parsed: { id?: unknown; method?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown } };
    try {
      parsed = JSON.parse(line);
    } catch {
      fail(key, server, new CodexFactsFailure("protocol", "Codex app-server wrote a line that is not JSON"));
      return;
    }
    // A request from the app-server (an approval, say) is never expected here; refuse it rather than leave it hanging.
    if (typeof parsed.method === "string" && parsed.id !== undefined) {
      try {
        server.child.stdin.write(`${JSON.stringify({ id: parsed.id, error: { code: -32601, message: "Not supported" } })}\n`);
      } catch {
        // The exit handler reports it.
      }
      return;
    }
    if (typeof parsed.id !== "number") return;
    const pending = server.pending.get(parsed.id);
    if (!pending) return;
    server.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    if (parsed.error) {
      const code = typeof parsed.error.code === "number" ? parsed.error.code : null;
      // The text stays here, to tell a missing thread apart; only the code may leave.
      pending.reject(new CodexRpcError(code, typeof parsed.error.message === "string" ? parsed.error.message : ""));
    } else pending.resolve(parsed.result);
  }

  function start(launch: CodexLaunch): AppServer {
    const failed = failedStarts.get(launch.key);
    if (failed && failed.until > now()) throw failed.error;
    failedStarts.delete(launch.key);
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(launch.command, launch.args, launch.env);
    } catch (error) {
      const failure = new CodexFactsFailure("spawn", `Codex app-server could not be started (${errno(error)})`);
      failedStarts.set(launch.key, { until: now() + startBackoffMs, error: failure });
      throw failure;
    }
    let exitedResolve!: () => void;
    const server: AppServer = {
      child,
      ready: Promise.resolve(),
      pending: new Map(),
      nextId: 1,
      inFlight: 0,
      waiting: [],
      idleTimer: null,
      closed: false,
      exited: new Promise<void>((resolve) => (exitedResolve = resolve)),
    };
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        onLine(launch.key, server, line);
      }
      if (buffer.length > MAX_LINE) {
        buffer = "";
        fail(launch.key, server, new CodexFactsFailure("protocol", "Codex app-server wrote a line over 1 MB"));
      }
    });
    // Its stderr can echo configuration and keys: drained, never kept or logged.
    child.stderr.resume();
    // Writing after the app-server went away raises EPIPE here; the exit handler reports it.
    child.stdin.on("error", () => {});
    child.once("error", (error) => {
      exitedResolve();
      fail(launch.key, server, new CodexFactsFailure("spawn", `Codex app-server could not be started (${errno(error)})`));
    });
    child.once("exit", (code, signal) => {
      exitedResolve();
      fail(launch.key, server, new CodexFactsFailure("exit", `Codex app-server exited (${signal ?? code ?? "unknown"})`));
    });
    server.ready = (async () => {
      await request(launch.key, server, "initialize", { clientInfo: CLIENT_INFO }, startTimeoutMs);
      server.child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    })();
    server.ready.catch((error: unknown) => {
      const failure = new CodexFactsFailure("start", `Codex app-server did not start: ${safe(error, "start", "initialize failed").message}`);
      failedStarts.set(launch.key, { until: now() + startBackoffMs, error: failure });
      fail(launch.key, server, failure);
    });
    servers.set(launch.key, server);
    return server;
  }

  function scheduleIdle(key: string, server: AppServer): void {
    if (server.closed || server.inFlight > 0 || server.waiting.length > 0) return;
    if (server.idleTimer) clearTimeout(server.idleTimer);
    server.idleTimer = setTimeout(() => {
      server.idleTimer = null;
      if (server.inFlight === 0 && server.waiting.length === 0) fail(key, server, new CodexFactsFailure("stopped", "Codex app-server stopped"));
    }, idleMs);
    unref(server.idleTimer);
  }

  async function read(launch: CodexLaunch, threadId: string): Promise<CodexThreadSettings | null> {
    const server = servers.get(launch.key) ?? start(launch);
    if (server.idleTimer) {
      clearTimeout(server.idleTimer);
      server.idleTimer = null;
    }
    // A freed slot passes straight to the read waiting longest, so a read arriving meanwhile queues behind it.
    if (server.inFlight < maxInFlight) server.inFlight += 1;
    else {
      await new Promise<void>((wake) => server.waiting.push(wake));
      // Stopped while this read waited: start over on a fresh one.
      if (server.closed) return read(launch, threadId);
    }
    try {
      await server.ready;
      const result = (await request(launch.key, server, "thread/read", { threadId, includeTurns: false }, requestTimeoutMs)) as { thread?: { model?: unknown; reasoningEffort?: unknown } } | null;
      if (!result?.thread || typeof result.thread !== "object") throw new CodexFactsFailure("protocol", "Codex app-server answered thread/read without a thread");
      return { model: text(result.thread.model), reasoningEffort: text(result.thread.reasoningEffort) };
    } catch (error) {
      if (error instanceof CodexRpcError && MISSING_THREAD.test(error.message)) return null;
      if (error instanceof CodexRpcError) throw new CodexFactsFailure("rpc", `Codex thread/read failed (JSON-RPC error ${error.code ?? "without a code"})`);
      throw safe(error, "protocol", "Codex thread/read failed");
    } finally {
      const next = server.waiting.shift();
      if (next) next();
      else server.inFlight -= 1;
      scheduleIdle(launch.key, server);
    }
  }

  return {
    read,
    async close() {
      const all = [...servers.entries()];
      for (const [key, server] of all) fail(key, server, new CodexFactsFailure("stopped", "Codex app-server stopped"));
      await Promise.all(all.map(([, server]) => server.exited));
    },
  };
}
