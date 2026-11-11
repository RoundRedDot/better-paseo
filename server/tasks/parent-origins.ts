import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { PaseoAgentListOptions, PaseoApi } from "../paseo-types";
import type { ParentOrigin } from "../../shared/tasks-rpc";
import { pluginDataDir } from "../plugin-data";

const PARENT_LABEL = "paseo.parent-agent-id";
/** A file-name safe agent ID, the same rule the other marks apply. */
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** The origins kept; the oldest go first. */
export const ORIGINS_KEPT = 1000;
/**
 * After a parent's archive, its children still linked are read again at
 * these delays: Paseo detaches the survivors once the parent's runtime has
 * closed, and Paseo 0.15 tells no one when the child it detaches is closed.
 */
export const ARCHIVE_REREADS_MS = [2_000, 10_000, 30_000] as const;
const PAGE = 200;
/** Every agent that is not archived, background ones too: a parent's archive detaches those as well. */
const LIST: PaseoAgentListOptions = { filter: { includeBackground: true }, sort: [{ key: "created_at", direction: "asc" }] };

export function parentOriginsPath(): string {
  return join(pluginDataDir(), "tasks-parent-origins.json");
}

const fileSchema = z.object({
  origins: z.array(z.object({ agentId: z.string().regex(AGENT_ID_PATTERN), parentAgentId: z.string().regex(AGENT_ID_PATTERN), archivedAt: z.string() })),
});

type OriginMap = Map<string, { parentAgentId: string; archivedAt: string }>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The inferred origins (`createParentOriginWatch`): the parent whose archive
 * is taken to have detached each agent, with when it was archived. Mirrored
 * to one JSON file, written atomically, one write at a time. No file yet
 * reads as none; a file that cannot be read or parsed is an error every call
 * reports, and is never written over. A change is held only once written.
 * `version` changes with the list.
 */
export function createParentOrigins(path: string) {
  let origins: OriginMap = new Map();
  const epoch = randomUUID().slice(0, 8);
  let revision = 0;
  let loaded: Promise<void> | null = null;
  let writes: Promise<unknown> = Promise.resolve();

  const load = () => {
    loaded ??= (async () => {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error(`Could not read parent origins ${path}: ${message(error)}`);
      }
      let parsed: z.output<typeof fileSchema>;
      try {
        parsed = fileSchema.parse(JSON.parse(text));
      } catch (error) {
        throw new Error(`Parent origins ${path} is not valid: ${message(error)}`);
      }
      for (const origin of parsed.origins) {
        origins.delete(origin.agentId);
        origins.set(origin.agentId, { parentAgentId: origin.parentAgentId, archivedAt: origin.archivedAt });
      }
    })();
    return loaded;
  };

  /** Applies `change` to a copy and writes it; the copy replaces the list once on disk. */
  const mutate = (change: (next: OriginMap) => boolean): Promise<void> => {
    const run = writes.then(async () => {
      await load();
      const next: OriginMap = new Map(origins);
      if (!change(next)) return;
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, JSON.stringify({ origins: [...next].map(([agentId, origin]) => ({ agentId, ...origin })) }));
        await rename(temp, path);
      } catch (error) {
        throw new Error(`Could not write parent origins ${path}: ${message(error)}`);
      }
      origins = next;
      revision += 1;
    });
    // The queue goes on after a failed write; the caller still gets the failure from `run`.
    writes = run.catch(() => {});
    return run;
  };

  return {
    set(agentId: string, parentAgentId: string, archivedAt: string): Promise<void> {
      return mutate((next) => {
        const known = next.get(agentId);
        if (known?.parentAgentId === parentAgentId && known.archivedAt === archivedAt) return false;
        next.delete(agentId);
        next.set(agentId, { parentAgentId, archivedAt });
        while (next.size > ORIGINS_KEPT) next.delete(next.keys().next().value as string);
        return true;
      });
    },
    /** The agent has a live parent again: its history no longer names it. */
    delete(agentId: string): Promise<void> {
      return mutate((next) => next.delete(agentId));
    },
    /** The list, or null while `since` is still its version. */
    async read(since?: string): Promise<{ version: string; origins: ParentOrigin[] | null }> {
      await load();
      const version = `${epoch}:${revision}`;
      if (since === version) return { version, origins: null };
      return { version, origins: [...origins].map(([agentId, { parentAgentId }]) => ({ agentId, parentAgentId })) };
    },
  };
}

export type ParentOrigins = ReturnType<typeof createParentOrigins>;

interface AgentSnapshot {
  id: string;
  labels?: Record<string, string> | null;
  archivedAt?: string | null;
  updatedAt: string;
}

interface Link {
  parentId: string;
  /** The child's `updatedAt` when this run first saw it linked, not archived, to this parent. */
  since: number;
}

interface UpdateEnvelope {
  type?: string;
  payload?: { kind?: string; agent?: AgentSnapshot; agentId?: string };
}

/** What the watch cannot do in the background goes to the plugin's log, as the server's other failures do. */
function report(error: unknown): void {
  console.error(`[better-paseo] parent origins: ${message(error)}`);
}

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function parentIdOf(agent: AgentSnapshot): string | null {
  const value = agent.labels?.[PARENT_LABEL];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Infers which parent's archive detached an agent, for the board to name
 * as history. Paseo detaches a child it does not archive with its parent (one
 * in another workspace, or open in a tab) by clearing its
 * `paseo.parent-agent-id`, leaving no trace of the parent. A detach by hand
 * runs the same code (`detachAgentUnlocked`) and every other client sees the
 * same `agent_update`; Paseo 0.15 has no detach hook. Nothing it sends says
 * which caused a detach, so this is an inference from timing, not proof.
 *
 * The watch follows every agent that is not archived over one subscription,
 * holding the links it sees in memory. An origin is inferred only within one
 * unbroken run of that subscription, when all hold:
 * - the child was seen linked, not archived, to the parent before the
 *   parent's archive (`since <= archivedAt`), so a child unarchived later
 *   and detached by hand is not taken for a survivor;
 * - the parent is archived;
 * - the child is then seen without the label, its `updatedAt` at or after
 *   the archive, so a closed child detached by hand before it (which Paseo
 *   does not announce) is not either.
 * A live child detached by hand is announced, so the run sees it go while
 * its parent is not archived and forgets the link. A restart or a broken
 * subscription starts a new run: what happened meanwhile is not judged, and
 * a child detached then gets no origin.
 *
 * Wrongly inferred, since a detach by hand looks the same, when the child is
 * detached by hand while still linked to an archived parent:
 * - during the cascade, before Paseo reaches it (the parent's runtime closes
 *   first, then each child in turn);
 * - after a cascade that stopped early: `cascadeArchiveChildren` has no
 *   per-child recovery, so one child failing to archive leaves the rest
 *   linked to the archived parent;
 * - by setting its `paseo.parent-agent-id` to "" through a metadata update.
 */
export function createParentOriginWatch(
  origins: ParentOrigins = createParentOrigins(parentOriginsPath()),
  rereads: readonly number[] = ARCHIVE_REREADS_MS,
) {
  let api: PaseoApi | null = null;
  let starting: Promise<void> | null = null;
  let runs = 0;
  /** The subscription's current unbroken run; null while it is broken or not open. */
  let run: number | null = null;
  const links = new Map<string, Link>();
  /** Newest `updatedAt` applied per agent, so an older snapshot cannot undo a newer one. */
  const latest = new Map<string, number>();
  /** Parents known archived in this run, by archive time. */
  const archivedParents = new Map<string, number>();
  const rereading = new Set<string>();

  const current = (expected: number) => run === expected;

  /** The agent as the daemon stores it; null only for one it does not know. A failed read throws. */
  async function read(id: string): Promise<AgentSnapshot | null> {
    const result = await api!.agents.ref(id).refresh();
    return (result?.agent as AgentSnapshot | undefined) ?? null;
  }

  function observe(agent: AgentSnapshot, expected: number): void {
    if (!current(expected)) return;
    const at = time(agent.updatedAt);
    if (at < (latest.get(agent.id) ?? Number.NEGATIVE_INFINITY)) return;
    latest.set(agent.id, at);
    if (agent.archivedAt) {
      // Archived itself: not a survivor, and a parent whose children may now be detached.
      links.delete(agent.id);
      archivedParents.set(agent.id, time(agent.archivedAt));
      return;
    }
    archivedParents.delete(agent.id);
    const parentId = parentIdOf(agent);
    if (parentId) {
      if (links.get(agent.id)?.parentId !== parentId) links.set(agent.id, { parentId, since: at });
      void origins.delete(agent.id).catch(report);
      return;
    }
    const link = links.get(agent.id);
    if (!link) return;
    links.delete(agent.id);
    void judge(agent.id, link, at, expected).catch(report);
  }

  async function judge(childId: string, link: Link, detachedAt: number, expected: number): Promise<void> {
    let archivedAt = archivedParents.get(link.parentId);
    if (archivedAt === undefined) {
      const parent = await read(link.parentId);
      // A parent that is not archived, or unknown here (another host's): nothing to infer.
      if (!current(expected) || !parent?.archivedAt) return;
      archivedAt = time(parent.archivedAt);
    }
    if (!current(expected)) return;
    if (link.since <= archivedAt && archivedAt <= detachedAt) {
      await origins.set(childId, link.parentId, new Date(archivedAt).toISOString());
    }
  }

  /** The parent was archived: read its linked children now, and again while any is still linked. */
  async function parentArchived(parentId: string, archivedAt: string, expected: number): Promise<void> {
    if (!current(expected)) return;
    archivedParents.set(parentId, time(archivedAt));
    links.delete(parentId);
    if (rereading.has(parentId)) return;
    rereading.add(parentId);
    try {
      for (let attempt = 0; ; attempt += 1) {
        const children = [...links].filter(([, link]) => link.parentId === parentId).map(([id]) => id);
        if (children.length === 0) return;
        for (const childId of children) {
          const child = await read(childId);
          if (!current(expected)) return;
          if (child) observe(child, expected);
          else links.delete(childId);
        }
        if (attempt >= rereads.length || ![...links.values()].some((link) => link.parentId === parentId)) return;
        await new Promise((resolve) => setTimeout(resolve, rereads[attempt]));
        if (!current(expected)) return;
      }
    } finally {
      rereading.delete(parentId);
    }
  }

  async function removed(agentId: string, expected: number): Promise<void> {
    // Gone from the list: archived (or deleted). A linked child is no survivor; a parent may be one's.
    links.delete(agentId);
    if (![...links.values()].some((link) => link.parentId === agentId)) return;
    const agent = await read(agentId);
    if (current(expected) && agent?.archivedAt) await parentArchived(agentId, agent.archivedAt, expected);
  }

  function apply(message: unknown): void {
    if (run === null) return;
    const envelope = message as UpdateEnvelope;
    if (envelope?.type !== "agent_update" || !envelope.payload) return;
    const payload = envelope.payload;
    if (payload.kind === "upsert" && payload.agent) observe(payload.agent, run);
    else if (payload.kind === "remove" && payload.agentId) void removed(payload.agentId, run).catch(report);
  }

  /** A run's first list, and its other pages: the links it starts from. */
  async function load(entries: Array<{ agent: AgentSnapshot }>, cursor: string | null | undefined, expected: number): Promise<void> {
    for (const { agent } of entries) observe(agent, expected);
    while (cursor && current(expected)) {
      const page = await api!.agents.list({ ...LIST, page: { limit: PAGE, cursor } });
      if (!current(expected)) return;
      for (const { agent } of page.entries) observe(agent as AgentSnapshot, expected);
      cursor = page.pageInfo?.nextCursor;
    }
  }

  function beginRun(): number {
    runs += 1;
    run = runs;
    links.clear();
    archivedParents.clear();
    return run;
  }

  async function start(paseo: PaseoApi): Promise<void> {
    api = paseo;
    const result = await paseo.agents.list({ ...LIST, page: { limit: PAGE }, subscribe: {} });
    const first = beginRun();
    result.subscription.subscribe({
      // A snapshot after the first is a resubscription: a new run, from its list.
      snapshot: (snapshot) => {
        const list = snapshot as { entries: Array<{ agent: AgentSnapshot }>; pageInfo?: { nextCursor?: string | null } };
        const next = beginRun();
        void load(list.entries, list.pageInfo?.nextCursor, next).catch((error: unknown) => {
          if (current(next)) run = null;
          report(error);
        });
      },
      update: apply,
      error: (error: unknown) => {
        run = null;
        report(error);
      },
    });
    await load(result.entries as Array<{ agent: AgentSnapshot }>, result.pageInfo?.nextCursor, first);
  }

  return {
    /** Opens the subscription with the first `PaseoApi` the server is handed; a failed open is tried again on the next. */
    ensure(paseo: PaseoApi | undefined): Promise<void> {
      if (!paseo) return starting ?? Promise.resolve();
      starting ??= start(paseo).catch((error: unknown) => {
        run = null;
        starting = null;
        report(error);
      });
      return starting;
    },
    /** `agent.archived`: Paseo archives the parent before it detaches the survivors. */
    async archived(paseo: PaseoApi | undefined, agentId: string, archivedAt: string): Promise<void> {
      await this.ensure(paseo);
      if (run !== null) await parentArchived(agentId, archivedAt, run);
    },
    async read(paseo: PaseoApi | undefined, since?: string) {
      void this.ensure(paseo);
      return origins.read(since);
    },
  };
}

export type ParentOriginWatch = ReturnType<typeof createParentOriginWatch>;
