import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { PaseoApi } from "@getpaseo/client";
import type { ProviderSubagent } from "../../shared/tasks-rpc";

/** A provider subagent as the daemon sends it (`ProviderSubagentDescriptorPayload`). */
export interface SubagentDescriptor {
  id: string;
  parentAgentId: string;
  provider: string;
  title: string | null;
  description: string | null;
  status: "running" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  subtitle?: string | null;
}

/** The part of the daemon's own client the seed uses. */
export interface SeedDaemon {
  fetchAgents(options: { page: { limit: number; cursor?: string } }): Promise<{
    entries: Array<{ agent: { id: string; archivedAt?: string | null; capabilities?: { supportsStreaming?: boolean } | null } }>;
    pageInfo?: { nextCursor?: string | null } | null;
  }>;
  listProviderSubagents(parentAgentId: string): Promise<{ subagents: SubagentDescriptor[] }>;
  close(): Promise<void>;
}

/** The daemon's own client as the board's server uses it: the seed, and clearing attention. */
export interface HostDaemon extends SeedDaemon {
  /** The agent as the daemon lists it, live or from storage; null for an unknown one. */
  fetchAgent(agentId: string): Promise<{ agent: { cwd: string; status: string } } | null>;
  /** Resolves when the daemon cleared every agent's; it never answers a request naming an unknown agent. */
  clearAgentAttention(agentId: string | string[]): Promise<void>;
  /** The label definitions; a daemon from before workspace labels lacks it. */
  listWorkspaceLabels?(): Promise<{ labels: Array<{ name: string; color: string }> }>;
  /** A project's icon, uploaded or found in its repository; a daemon from before project icons lacks it. */
  getProjectIcon?(projectId: string): Promise<{ icon: { data: string; mimeType: string } | null; error?: string | null }>;
}

/** A failure stays on the board this long at most; a new prompt to the parent clears it sooner. */
const FAILED_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const SEED_PAGE = 200;
const SEED_CONCURRENCY = 8;
/** Without the live feed the list is read again, on a board's request, at most this often. */
const RESEED_WITHOUT_FEED_MS = 30_000;
/** An agent loaded from storage replays its subagents meanwhile; its list is read this long after. */
const LOADED_READ_DELAY_MS = 4_000;

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toWire(descriptor: SubagentDescriptor & { status: ProviderSubagent["status"] }): ProviderSubagent {
  return {
    id: descriptor.id,
    parentAgentId: descriptor.parentAgentId,
    provider: descriptor.provider,
    title: descriptor.title ?? null,
    description: descriptor.description ?? null,
    status: descriptor.status,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
    subtitle: descriptor.subtitle ?? null,
  };
}

/**
 * The running and failed provider subagents by parent. A finished or
 * cancelled one leaves, and the newer `updatedAt` wins, so a seed read
 * before an update cannot bring back what the update ended.
 */
export function createSubagentRegistry(now = () => Date.now()) {
  const byParent = new Map<string, Map<string, ProviderSubagent>>();
  /** Newest `updatedAt` seen per subagent, kept after it leaves, so an older copy cannot return. */
  const seen = new Map<string, number>();
  const epoch = randomUUID().slice(0, 8);
  let revision = 0;
  const key = (parentAgentId: string, id: string) => `${parentAgentId}\n${id}`;

  function upsert(descriptor: SubagentDescriptor): void {
    const at = time(descriptor.updatedAt);
    const id = key(descriptor.parentAgentId, descriptor.id);
    if ((seen.get(id) ?? -1) > at) return;
    seen.set(id, at);
    let parent = byParent.get(descriptor.parentAgentId);
    if (descriptor.status !== "running" && descriptor.status !== "failed") {
      if (parent?.delete(descriptor.id)) {
        if (parent.size === 0) byParent.delete(descriptor.parentAgentId);
        revision += 1;
      }
      return;
    }
    const next = toWire({ ...descriptor, status: descriptor.status });
    const previous = parent?.get(descriptor.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    if (!parent) byParent.set(descriptor.parentAgentId, parent = new Map());
    parent.set(descriptor.id, next);
    revision += 1;
  }

  function remove(parentAgentId: string, id: string): void {
    const parent = byParent.get(parentAgentId);
    if (!parent?.delete(id)) return;
    if (parent.size === 0) byParent.delete(parentAgentId);
    revision += 1;
  }

  /** A seed's whole list for one parent: what it lacks went before the seed began. */
  function replaceParent(parentAgentId: string, descriptors: SubagentDescriptor[], seedStartedAt: number): void {
    const listed = new Set(descriptors.map((descriptor) => descriptor.id));
    for (const descriptor of descriptors) upsert(descriptor);
    for (const [id, subagent] of byParent.get(parentAgentId) ?? []) {
      if (!listed.has(id) && time(subagent.updatedAt) <= seedStartedAt) remove(parentAgentId, id);
    }
  }

  function dropParent(parentAgentId: string): void {
    if (byParent.delete(parentAgentId)) revision += 1;
  }

  function read(since?: string): { version: string; subagents: ProviderSubagent[] | null } {
    const cutoff = now() - FAILED_KEPT_MS;
    for (const [parentAgentId, parent] of byParent) {
      for (const [id, subagent] of parent) if (subagent.status === "failed" && time(subagent.updatedAt) < cutoff) remove(parentAgentId, id);
    }
    const version = `${epoch}:${revision}`;
    if (since === version) return { version, subagents: null };
    return { version, subagents: [...byParent.values()].flatMap((parent) => [...parent.values()]) };
  }

  return { upsert, remove, replaceParent, dropParent, read };
}

export type SubagentRegistry = ReturnType<typeof createSubagentRegistry>;

const HOST_MODULES = ["@getpaseo/client/internal/daemon-client", "@getpaseo/server/daemon-control", "ws"] as const;

/** Whether `connectHostDaemon` can build a client here: the host's packages resolve from the plugin process. */
export function hasHostDaemon(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const require = createRequire(entry);
    for (const id of HOST_MODULES) require.resolve(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * A short-lived client of this host's daemon, built from the host's own
 * packages so it speaks the daemon's protocol version. The plugin process
 * runs from `@getpaseo/server`'s `plugin-process.js`, so its dependencies
 * resolve from there; the daemon's address and local credential come from
 * `PASEO_HOME`, as the CLI finds them. Null where any of it is missing.
 */
export async function connectHostDaemon(): Promise<HostDaemon | null> {
  const entry = process.argv[1];
  if (!entry) return null;
  try {
    const require = createRequire(entry);
    const load = (id: string) => import(pathToFileURL(require.resolve(id)).href);
    const [clientModule, control, ws] = await Promise.all(HOST_MODULES.map(load));
    const home: string = process.env.PASEO_HOME || control.resolvePaseoHome(process.env);
    const listen = (await control.readDaemonInstance(home))?.listen;
    if (typeof listen !== "string" || !listen.trim()) return null;
    const target = socketTarget(listen.trim());
    if (!target) return null;
    const WebSocket = ws.default ?? ws.WebSocket;
    const client = new clientModule.DaemonClient({
      url: target.url,
      clientId: "cid_better_paseo_tasks",
      clientType: "cli",
      localCredential: () => control.readLocalCredentialForTarget(home, listen) ?? undefined,
      connectTimeoutMs: 10_000,
      webSocketFactory: (url: string, config?: { headers?: Record<string, string>; protocols?: string | string[] }) =>
        new WebSocket(url, config?.protocols, {
          headers: config?.headers,
          ...(target.socketPath ? { socketPath: target.socketPath } : {}),
        }),
      reconnect: { enabled: false },
    });
    try {
      await client.connect();
    } catch {
      await client.close().catch(() => {});
      return null;
    }
    return client as HostDaemon;
  } catch {
    return null;
  }
}

/** The daemon's `listen` as a WebSocket URL: "127.0.0.1:6767" or a unix socket path. */
function socketTarget(listen: string): { url: string; socketPath?: string } | null {
  if (listen.startsWith("unix://") || listen.startsWith("/")) {
    const socketPath = listen.replace(/^unix:\/\//, "");
    return { url: `ws+unix://${socketPath}:/ws`, socketPath };
  }
  if (/^[^/\s]+:\d+$/.test(listen)) return { url: `ws://${listen}/ws` };
  return null;
}

async function eachLimited<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Reads every loaded agent's provider subagents once. Only loaded agents:
 * the daemon's list request loads an unloaded agent from storage, which
 * resumes it and moves its `updatedAt`. A stored agent's record carries the
 * default capabilities, so a streaming one is live.
 */
export async function seedSubagents(registry: SubagentRegistry, daemon: SeedDaemon, now = () => Date.now()): Promise<void> {
  const startedAt = now();
  const parents: string[] = [];
  let cursor: string | null | undefined;
  do {
    const page = await daemon.fetchAgents({ page: { limit: SEED_PAGE, ...(cursor ? { cursor } : {}) } });
    for (const { agent } of page.entries) {
      if (!agent.archivedAt && agent.capabilities?.supportsStreaming === true) parents.push(agent.id);
    }
    cursor = page.pageInfo?.nextCursor;
  } while (cursor);
  await listParents(registry, daemon, parents, startedAt);
}

/** Each parent's whole list, read off the daemon into the registry. */
export async function listParents(registry: SubagentRegistry, daemon: SeedDaemon, parents: string[], startedAt: number): Promise<void> {
  await eachLimited(parents, SEED_CONCURRENCY, async (parentAgentId) => {
    try {
      const { subagents } = await daemon.listProviderSubagents(parentAgentId);
      registry.replaceParent(parentAgentId, subagents, startedAt);
    } catch {
      // Archived or internal meanwhile: nothing to show for it.
    }
  });
}

interface UpdateEnvelope {
  type?: string;
  payload?: { kind?: string; subagent?: SubagentDescriptor; parentAgentId?: string; subagentId?: string };
}

/** One `agent.provider_subagents.update` into the registry; timeline items carry no status. */
export function applySubagentUpdate(registry: SubagentRegistry, message: unknown): void {
  const envelope = message as UpdateEnvelope;
  if (envelope?.type !== "agent.provider_subagents.update" || !envelope.payload) return;
  const payload = envelope.payload;
  if (payload.kind === "upsert" && payload.subagent) registry.upsert(payload.subagent);
  else if (payload.kind === "remove" && payload.parentAgentId && payload.subagentId) registry.remove(payload.parentAgentId, payload.subagentId);
}

/**
 * The registry, filled once the server has a `PaseoApi`: a plugin server
 * gets one only in a handler or a hook, so the first of them starts the
 * daemon's update feed, then a seed. Each resubscription seeds again, since
 * the feed does not replay what it missed. Without the feed a board's
 * request seeds again, at most every 30 seconds.
 */
export function createSubagentWatch(
  registry = createSubagentRegistry(),
  connect: () => Promise<SeedDaemon | null> = connectHostDaemon,
  now = () => Date.now(),
) {
  let started = false;
  let feed = false;
  let seeding: Promise<void> | null = null;
  let seedAgain = false;
  let lastSeedAt = Number.NEGATIVE_INFINITY;
  const loadedQueue = new Set<string>();
  let loadedTimer: ReturnType<typeof setTimeout> | null = null;

  /** The agents loaded since the last read, in one connection. */
  async function readLoaded(): Promise<void> {
    loadedTimer = null;
    const parents = [...loadedQueue];
    loadedQueue.clear();
    if (parents.length === 0) return;
    const daemon = await connect();
    if (!daemon) return;
    try {
      await listParents(registry, daemon, parents, now());
    } finally {
      await daemon.close().catch(() => {});
    }
  }

  function seed(): Promise<void> {
    if (seeding) {
      seedAgain = true;
      return seeding;
    }
    lastSeedAt = now();
    seeding = (async () => {
      do {
        seedAgain = false;
        const daemon = await connect();
        if (!daemon) return;
        try {
          await seedSubagents(registry, daemon, now);
        } catch {
          // The next resubscription or request tries again.
        } finally {
          await daemon.close().catch(() => {});
        }
      } while (seedAgain);
    })().finally(() => {
      seeding = null;
    });
    return seeding;
  }

  async function start(paseo: PaseoApi): Promise<void> {
    let ready = false;
    try {
      const subscription = paseo.observeEvents(["agent.provider_subagents.update"]);
      subscription.subscribe({
        // A snapshot after the first is a resubscription: what the feed missed meanwhile is read again.
        snapshot: () => {
          if (ready) void seed();
        },
        update: (message) => applySubagentUpdate(registry, message),
        error: () => {
          feed = false;
        },
      });
      await subscription.ready;
      ready = true;
      feed = true;
    } catch {
      feed = false;
    }
    await seed();
  }

  return {
    registry,
    /** Starts the feed and the first seed with the first `PaseoApi` the server is handed. */
    ensure(paseo: PaseoApi | undefined): Promise<void> {
      if (started || !paseo) return seeding ?? Promise.resolve();
      started = true;
      return start(paseo);
    },
    /**
     * An agent's session opened from storage: the daemon replays its
     * subagents from the transcript without telling the update feed, so its
     * list is read once the replay is done. Agents opened together share one
     * connection.
     */
    loaded(paseo: PaseoApi | undefined, agentId: string): void {
      void this.ensure(paseo);
      loadedQueue.add(agentId);
      if (loadedTimer === null) loadedTimer = setTimeout(() => void readLoaded().catch(() => {}), LOADED_READ_DELAY_MS);
    },
    /** The registry for a board; the first request waits for the first seed. */
    async read(paseo: PaseoApi | undefined, since?: string) {
      const first = !started;
      const pending = this.ensure(paseo);
      if (first) await pending;
      else if (!feed && now() - lastSeedAt >= RESEED_WITHOUT_FEED_MS) await seed();
      return registry.read(since);
    },
    dropParent: registry.dropParent,
  };
}

export type SubagentWatch = ReturnType<typeof createSubagentWatch>;
