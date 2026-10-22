import type { PaseoApi } from "@getpaseo/client";
import { describe, expect, it, vi } from "vitest";
import {
  applySubagentUpdate,
  createSubagentRegistry,
  createSubagentWatch,
  seedSubagents,
  type SeedDaemon,
  type SubagentDescriptor,
} from "../../server/tasks/provider-subagents";

const BASE = Date.parse("2026-10-22T09:00:00.000Z");
const iso = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();

function descriptor(id: string, overrides: Partial<SubagentDescriptor> = {}): SubagentDescriptor {
  return {
    id,
    parentAgentId: "parent",
    provider: "claude",
    title: "general-purpose",
    description: `Task ${id}`,
    status: "running",
    createdAt: iso(0),
    updatedAt: iso(1),
    subtitle: "general-purpose · Opus 5.5",
    ...overrides,
  };
}

function upsert(subagent: SubagentDescriptor) {
  return { type: "agent.provider_subagents.update", payload: { kind: "upsert", subagent } };
}

type Agent = { id: string; archivedAt?: string | null; capabilities?: { supportsStreaming?: boolean } };

function fakeDaemon(agents: Agent[], lists: Record<string, SubagentDescriptor[]>, pageSize = 200) {
  const daemon = {
    fetchAgents: vi.fn(async ({ page }: { page: { limit: number; cursor?: string } }) => {
      const start = page.cursor ? Number(page.cursor) : 0;
      const size = Math.min(page.limit, pageSize);
      const next = start + size < agents.length ? String(start + size) : null;
      return { entries: agents.slice(start, start + size).map((agent) => ({ agent })), pageInfo: { nextCursor: next } };
    }),
    listProviderSubagents: vi.fn(async (id: string) => {
      if (!(id in lists)) throw new Error(`Agent not found: ${id}`);
      return { subagents: lists[id]! };
    }),
    close: vi.fn(async () => {}),
  };
  return daemon satisfies SeedDaemon;
}

function fakeEvents() {
  const observers: Array<{ snapshot(value: unknown): void; update(message: unknown): void; error?(error: unknown): void }> = [];
  const observeEvents = vi.fn(() => ({
    subscriptionId: "events",
    ready: Promise.resolve({}),
    subscribe(observer: (typeof observers)[number]) {
      observers.push(observer);
      return () => {};
    },
    release: async () => {},
  }));
  return {
    paseo: { observeEvents } as unknown as PaseoApi,
    observeEvents,
    emit: (message: unknown) => observers.forEach((observer) => observer.update(message)),
    resubscribe: () => observers.forEach((observer) => observer.snapshot({})),
  };
}

const live = { capabilities: { supportsStreaming: true } };

describe("provider subagent registry", () => {
  it("keeps running and failed subagents and drops finished ones", () => {
    const registry = createSubagentRegistry(() => BASE);
    registry.upsert(descriptor("a"));
    registry.upsert(descriptor("b", { status: "failed", updatedAt: iso(2) }));
    registry.upsert(descriptor("c", { status: "completed" }));
    expect(registry.read().subagents?.map((subagent) => [subagent.id, subagent.status])).toEqual([["a", "running"], ["b", "failed"]]);

    registry.upsert(descriptor("a", { status: "completed", updatedAt: iso(3) }));
    expect(registry.read().subagents?.map((subagent) => subagent.id)).toEqual(["b"]);
  });

  it("answers null while the version holds, and a new version when the list moves", () => {
    const registry = createSubagentRegistry(() => BASE);
    registry.upsert(descriptor("a"));
    const first = registry.read();
    expect(registry.read(first.version)).toEqual({ version: first.version, subagents: null });
    // The same descriptor again is the same news.
    registry.upsert(descriptor("a"));
    expect(registry.read(first.version).subagents).toBeNull();
    registry.upsert(descriptor("a", { status: "failed", updatedAt: iso(2) }));
    const second = registry.read(first.version);
    expect(second.version).not.toBe(first.version);
    expect(second.subagents?.[0]?.status).toBe("failed");
  });

  it("never lets an older copy undo a newer one", () => {
    const registry = createSubagentRegistry(() => BASE);
    registry.upsert(descriptor("a", { status: "completed", updatedAt: iso(5) }));
    registry.upsert(descriptor("a", { status: "running", updatedAt: iso(1) }));
    expect(registry.read().subagents).toEqual([]);
  });

  it("forgets failures after a week, and a parent once it is archived", () => {
    let now = BASE;
    const registry = createSubagentRegistry(() => now);
    registry.upsert(descriptor("old", { status: "failed", updatedAt: iso(0) }));
    registry.upsert(descriptor("other", { parentAgentId: "archived", status: "failed", updatedAt: iso(0) }));
    registry.dropParent("archived");
    expect(registry.read().subagents?.map((subagent) => subagent.id)).toEqual(["old"]);
    now = BASE + 8 * 24 * 60 * 60_000;
    expect(registry.read().subagents).toEqual([]);
  });

  it("reads upserts and removes off the update feed, and ignores timeline items", () => {
    const registry = createSubagentRegistry(() => BASE);
    applySubagentUpdate(registry, upsert(descriptor("a")));
    applySubagentUpdate(registry, { type: "agent.provider_subagents.update", payload: { kind: "timeline", parentAgentId: "parent", subagentId: "a" } });
    expect(registry.read().subagents?.map((subagent) => subagent.id)).toEqual(["a"]);
    applySubagentUpdate(registry, { type: "agent.provider_subagents.update", payload: { kind: "remove", parentAgentId: "parent", subagentId: "a" } });
    expect(registry.read().subagents).toEqual([]);
  });
});

describe("provider subagent seed", () => {
  it("lists only loaded, unarchived agents, across pages", async () => {
    const registry = createSubagentRegistry(() => BASE);
    const daemon = fakeDaemon(
      [
        { id: "parent", ...live },
        // A stored record: listing it would load and resume the agent.
        { id: "stored", capabilities: { supportsStreaming: false } },
        { id: "archived", archivedAt: iso(0), ...live },
        { id: "second-page", ...live },
      ],
      {
        parent: [descriptor("a", { status: "failed" })],
        "second-page": [descriptor("b", { parentAgentId: "second-page" })],
      },
      2,
    );
    await seedSubagents(registry, daemon, () => BASE);
    expect(daemon.listProviderSubagents.mock.calls.map(([id]) => id).sort()).toEqual(["parent", "second-page"]);
    expect(registry.read().subagents?.map((subagent) => subagent.id).sort()).toEqual(["a", "b"]);
  });

  it("drops what a parent's list no longer has, but keeps what changed after the seed began", async () => {
    const registry = createSubagentRegistry(() => BASE);
    registry.upsert(descriptor("gone", { updatedAt: iso(1) }));
    registry.upsert(descriptor("newer", { updatedAt: iso(20) }));
    await seedSubagents(registry, fakeDaemon([{ id: "parent", ...live }], { parent: [] }), () => BASE + 10 * 60_000);
    expect(registry.read().subagents?.map((subagent) => subagent.id)).toEqual(["newer"]);
  });
});

describe("provider subagent watch", () => {
  it("starts the feed and a seed with the first request, and answers after the seed", async () => {
    const events = fakeEvents();
    const daemon = fakeDaemon([{ id: "parent", ...live }], { parent: [descriptor("a", { status: "failed" })] });
    const connect = vi.fn(async () => daemon);
    const watch = createSubagentWatch(createSubagentRegistry(() => BASE), connect, () => BASE);

    const first = await watch.read(events.paseo);
    expect(events.observeEvents).toHaveBeenCalledWith(["agent.provider_subagents.update"]);
    expect(first.subagents?.map((subagent) => subagent.id)).toEqual(["a"]);
    expect(daemon.close).toHaveBeenCalledTimes(1);

    // Live from then on: no second seed for the next request.
    events.emit(upsert(descriptor("b", { status: "running", updatedAt: iso(5) })));
    const second = await watch.read(events.paseo, first.version);
    expect(second.subagents?.map((subagent) => subagent.id)).toEqual(["a", "b"]);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("seeds again when the feed resubscribes", async () => {
    const events = fakeEvents();
    const connect = vi.fn(async () => fakeDaemon([{ id: "parent", ...live }], { parent: [] }));
    const watch = createSubagentWatch(createSubagentRegistry(() => BASE), connect, () => BASE);
    await watch.read(events.paseo);
    events.resubscribe();
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2));
  });

  it("without the feed, seeds again on request at most every 30 seconds", async () => {
    let now = BASE;
    const paseo = { observeEvents: () => { throw new Error("not allowed"); } } as unknown as PaseoApi;
    const connect = vi.fn(async () => fakeDaemon([{ id: "parent", ...live }], { parent: [] }));
    const watch = createSubagentWatch(createSubagentRegistry(() => now), connect, () => now);
    await watch.read(paseo);
    now += 10_000;
    await watch.read(paseo);
    expect(connect).toHaveBeenCalledTimes(1);
    now += 30_000;
    await watch.read(paseo);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("reads an agent opened from storage once its replay is done, several in one connection", async () => {
    vi.useFakeTimers();
    try {
      const events = fakeEvents();
      const daemon = fakeDaemon([], {
        first: [descriptor("a", { parentAgentId: "first", status: "failed" })],
        second: [descriptor("b", { parentAgentId: "second", status: "failed" })],
      });
      const connect = vi.fn(async () => daemon);
      const watch = createSubagentWatch(createSubagentRegistry(() => BASE), connect, () => BASE);
      watch.loaded(events.paseo, "first");
      watch.loaded(events.paseo, "second");
      await vi.advanceTimersByTimeAsync(0);
      // The first seed lists nothing: both were stored when it ran.
      expect(connect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(daemon.listProviderSubagents.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
      expect((await watch.read(events.paseo)).subagents?.map((subagent) => subagent.id)).toEqual(["a", "b"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers an empty list where the host's daemon cannot be reached", async () => {
    const events = fakeEvents();
    const watch = createSubagentWatch(createSubagentRegistry(() => BASE), async () => null, () => BASE);
    expect((await watch.read(events.paseo)).subagents).toEqual([]);
    // No API yet (a test harness, an older host): nothing starts.
    expect((await createSubagentWatch(undefined, async () => null).read(undefined)).subagents).toEqual([]);
  });
});
