/**
 * A private Paseo daemon for the integration tests: the installed Paseo's
 * own CLI and server, run on a throwaway home and port, never the daily
 * daemon (`~/.paseo`, 6767). The tests talk to it through the real
 * `@getpaseo/client`, so the daemon's paging, filters and update order are
 * the ones the board meets in Paseo, not a fake's.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createPaseoApi, type PaseoApi, type PaseoAgent, type PaseoAgentListResult, type PaseoWorkspace, type PaseoWorkspaceListResult } from "@getpaseo/client";
import { createHostClient } from "@getpaseo/client/node";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const run = promisify(execFile);

/** The Paseo CLI the private daemons run: `PASEO_BIN`, else the installed app's. */
export function paseoBin(): string | null {
  const candidates = [process.env.PASEO_BIN, "/Applications/Paseo.app/Contents/Resources/bin/paseo"].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** The environment of a CLI call: without this session's agent, so the CLI acts as itself. */
function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.PASEO_AGENT_ID;
  delete env.PASEO_AGENT_CWD;
  delete env.PASEO_HOME;
  return env;
}

/** The only variables a clean CLI call keeps from this process; `HOME` passes through unchanged. */
export const CLEAN_ENV_KEYS = ["PATH", "USER", "TMPDIR", "LANG", "HOME"] as const;

/**
 * A clean CLI environment: `CLEAN_ENV_KEYS` as `source` (this process) has
 * them, plus `extra`. Nothing else is inherited, so no provider key, token, proxy or
 * Paseo variable reaches the CLI or the daemon it starts.
 */
export function cleanCliEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CLEAN_ENV_KEYS) if (source[key] !== undefined) env[key] = source[key];
  return { ...env, ...extra };
}

/**
 * `env` adds variables for this call only and may not replace `HOME`.
 * `clean` starts from `cleanCliEnv` instead of this process's environment.
 */
export async function paseo(args: string[], timeoutMs = 120_000, env: Record<string, string> = {}, clean = false): Promise<string> {
  if ("HOME" in env) throw new Error("A private daemon keeps the real HOME; isolate tools with their own variables");
  const bin = paseoBin();
  if (!bin) throw new Error("No Paseo CLI: install Paseo.app or set PASEO_BIN");
  const { stdout } = await run(bin, args, { env: clean ? cleanCliEnv(env) : { ...cliEnv(), ...env }, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

export interface PrivateDaemon {
  home: string;
  host: string;
  /** Agent records to load at the next start: `home/agents/<cwd slug>/<id>.json`, as Paseo stores them. */
  writeAgentRecord(record: StoredAgentRecord): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  /** Stop it and delete its home. */
  dispose(): Promise<void>;
}

/** The stored agent record Paseo 0.15 loads from its home (`agent-storage`). */
export interface StoredAgentRecord {
  id: string;
  provider: string;
  cwd: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt?: string;
  lastUserMessageAt?: string | null;
  lastStatus: "idle" | "closed" | "error" | "running";
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: string | null;
  archivedAt?: string | null;
  lastError?: string | null;
  labels?: Record<string, string>;
}

/**
 * Load a directory plugin on the daemon (the lane provider): plugins on, then
 * installed in place. Restarts the daemon so the provider registers.
 */
export async function installDirectoryPlugin(daemon: PrivateDaemon, dir: string, providerId?: string): Promise<void> {
  const configPath = path.join(daemon.home, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.pluginsEnabled = true;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  await daemon.restart();
  await paseo(["plugin", "install", dir, "--home", daemon.home], 180_000);
  if (!providerId) return;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const listed = await paseo(["provider", "ls", "--home", daemon.home, "--json"]).catch(() => "[]");
    const providers = JSON.parse(listed) as Array<{ provider?: string; id?: string; status?: string }>;
    if (providers.some((provider) => (provider.provider ?? provider.id) === providerId && provider.status === "available")) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`provider ${providerId} never became available`);
}

/**
 * `config` adds top-level keys to the new home's `config.json` (its `daemon`
 * merges into the listen settings); `env` is passed to `daemon start`, so the
 * daemon and its providers run with it; `cleanEnv` starts the daemon from
 * `cleanCliEnv` plus `env` instead of this process's environment. All are
 * opt-in: without them the daemon starts as before.
 */
export async function createPrivateDaemon(options: { home?: string; port?: number; config?: Record<string, unknown>; env?: Record<string, string>; cleanEnv?: boolean } = {}): Promise<PrivateDaemon> {
  const home = options.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "bp-it-home-"));
  const port = options.port ?? (await freePort());
  const host = `127.0.0.1:${port}`;
  fs.mkdirSync(home, { recursive: true });
  const configPath = path.join(home, "config.json");
  if (!fs.existsSync(configPath)) {
    const { daemon: daemonConfig, ...rest } = options.config ?? {};
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      ...rest,
      daemon: { listen: host, mcp: { injectIntoAgents: false }, ...(daemonConfig as Record<string, unknown> | undefined) },
    }, null, 2));
  }
  let running = false;
  const daemon: PrivateDaemon = {
    home,
    host,
    writeAgentRecord(record) {
      const dir = path.join(home, "agents", record.cwd.replace(/^\/+/, "").replace(/\//g, "-"));
      fs.mkdirSync(dir, { recursive: true });
      const full = {
        labels: {},
        lastModeId: "default",
        config: { modeId: "default" },
        features: [],
        resumeOnStartup: false,
        internal: false,
        lastActivityAt: record.updatedAt,
        requiresAttention: false,
        attentionReason: null,
        attentionTimestamp: null,
        archivedAt: null,
        ...record,
      };
      fs.writeFileSync(path.join(dir, `${record.id}.json`), JSON.stringify(full));
    },
    async start() {
      await paseo(["daemon", "start", "--home", home, "--timeout", "120"], 180_000, options.env, options.cleanEnv);
      running = true;
    },
    async stop() {
      if (!running) return;
      await paseo(["daemon", "stop", "--home", home], 60_000, {}, options.cleanEnv).catch(() => "");
      running = false;
    },
    async restart() {
      await daemon.stop();
      await daemon.start();
    },
    async dispose() {
      await daemon.stop();
      if (!options.home) fs.rmSync(home, { recursive: true, force: true });
    },
  };
  return daemon;
}

export interface Connection {
  api: PaseoApi;
  /** The driver under `api`, for what the SDK has no call for (attention, stop). */
  daemon: DaemonClient;
  close(): Promise<void>;
}

/** `reconnect`: come back after the daemon restarts, as Paseo's clients do. */
export async function connect(host: string, clientId = "better-paseo-integration", options: { reconnect?: boolean } = {}): Promise<Connection> {
  const client = createHostClient(host, { clientId, reconnect: options.reconnect ? { enabled: true, baseDelayMs: 200, maxDelayMs: 1_000 } : { enabled: false } });
  await client.connect();
  const api = createPaseoApi(client);
  return {
    api,
    daemon: client,
    async close() {
      await api.dispose().catch(() => {});
      await client.close().catch(() => {});
    },
  };
}

/** Every page of the agent list. */
export async function listAllAgents(api: PaseoApi, filter: Record<string, unknown>): Promise<PaseoAgent[]> {
  const all: PaseoAgent[] = [];
  let cursor: string | null = null;
  do {
    const page: PaseoAgentListResult = await api.agents.list({ filter, page: { limit: 200, ...(cursor ? { cursor } : {}) } } as never);
    all.push(...page.entries.map((entry) => entry.agent));
    cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? null : null;
  } while (cursor);
  return all;
}

/** Every page of the workspace list. */
export async function listAllWorkspaces(api: PaseoApi): Promise<PaseoWorkspace[]> {
  const all: PaseoWorkspace[] = [];
  let cursor: string | null = null;
  do {
    const page: PaseoWorkspaceListResult = await api.workspaces.list({ filter: { includeBackground: true }, page: { limit: 200, ...(cursor ? { cursor } : {}) } } as never);
    all.push(...page.entries);
    cursor = page.pageInfo?.hasMore ? page.pageInfo.nextCursor ?? null : null;
  } while (cursor);
  return all;
}
