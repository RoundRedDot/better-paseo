import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createParentOrigins, createParentOriginWatch, ORIGINS_KEPT } from "../../server/tasks/parent-origins";
import { at, createFakePaseo, makeAgent, makeWorkspace } from "./helpers/fake-paseo";

const PARENT = "paseo.parent-agent-id";
/** Short re-reads, so a test waits milliseconds for what the server waits seconds for. */
const REREADS = [5, 5, 5];

let root = "";
let path = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tasks-parent-origins-"));
  path = join(root, "tasks-parent-origins.json");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function child(id: string, parentId: string | null, overrides: Partial<Parameters<typeof makeAgent>[0]> = {}) {
  return makeAgent({ id, status: "running", updatedAt: at(1), labels: parentId ? { [PARENT]: parentId } : {}, ...overrides });
}

async function setup(agents: ReturnType<typeof makeAgent>[], options: { workspaces?: ReturnType<typeof makeWorkspace>[] } = {}) {
  const fake = createFakePaseo({ agents, ...(options.workspaces ? { workspaces: options.workspaces } : null) });
  const watch = createParentOriginWatch(createParentOrigins(path), REREADS);
  const paseo = fake.paseo as unknown as PaseoApi;
  await watch.ensure(paseo);
  const origins = async () => (await watch.read(paseo)).origins;
  return { fake, watch, paseo, origins };
}

/** Lets the watch's reads and timers run. */
async function settle(ms = 40) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Paseo's order: the parent's archive (its hook and its list update), then the survivor's detach. */
async function archiveParent(env: Awaited<ReturnType<typeof setup>>, parentId: string, archivedAt: string) {
  env.fake.upsertAgent(makeAgent({ id: parentId, status: "closed", updatedAt: archivedAt, archivedAt }));
  await env.watch.archived(env.paseo, parentId, archivedAt);
}

describe("parent origins", () => {
  it("records the parent whose archive detached a running child, and nothing for its archived siblings", async () => {
    const env = await setup([
      makeAgent({ id: "parent", status: "running", updatedAt: at(0) }),
      child("survivor", "parent"),
      child("sibling", "parent"),
    ]);
    const archiving = archiveParent(env, "parent", at(5));
    // The cascade: one child archived with the parent, the other detached.
    env.fake.upsertAgent(child("sibling", "parent", { updatedAt: at(5), archivedAt: at(5), status: "closed" }));
    env.fake.upsertAgent(child("survivor", null, { updatedAt: at(5) }));
    await archiving;
    await vi.waitFor(async () => {
      expect(await env.origins()).toEqual([{ agentId: "survivor", parentAgentId: "parent" }]);
    });
    // Kept in the file for the next process.
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ origins: [{ agentId: "survivor", parentAgentId: "parent", archivedAt: at(5) }] });
  });

  it("infers a closed survivor Paseo detaches without telling anyone, by reading it again after the archive", async () => {
    const env = await setup([
      makeAgent({ id: "parent", status: "idle", updatedAt: at(0) }),
      child("closed", "parent", { status: "closed" }),
    ]);
    // The hook comes before the cascade: the first read still finds the link.
    const archiving = archiveParent(env, "parent", at(5));
    await settle(1);
    env.fake.setAgentSilently(child("closed", null, { status: "closed", updatedAt: at(5) }));
    await archiving;
    await settle();
    expect(await env.origins()).toEqual([{ agentId: "closed", parentAgentId: "parent" }]);
  });

  it("infers from a detach that arrives before the parent's archive is known, by reading the parent", async () => {
    const env = await setup([
      makeAgent({ id: "parent", status: "running", updatedAt: at(0) }),
      child("survivor", "parent", { workspaceId: "ws-hidden" }),
    ], { workspaces: [makeWorkspace({ id: "ws-hidden", background: true }), makeWorkspace({ id: "ws-parent" })] });
    // Out of order: the parent's record is archived, but its update and hook come later.
    env.fake.setAgentSilently(makeAgent({ id: "parent", status: "closed", updatedAt: at(5), archivedAt: at(5) }));
    env.fake.upsertAgent(child("survivor", null, { workspaceId: "ws-hidden", updatedAt: at(6) }));
    await settle();
    // A background child is followed like any other.
    expect(await env.origins()).toEqual([{ agentId: "survivor", parentAgentId: "parent" }]);
  });

  it("records nothing for a child detached by hand before its parent's archive, live or closed, or after being archived with it and unarchived", async () => {
    const env = await setup([
      // Running, so updated after its children were linked and before one is detached.
      makeAgent({ id: "parent", status: "running", updatedAt: at(1.5) }),
      child("live", "parent"),
      child("closed", "parent", { status: "closed" }),
      child("archived-with-it", "parent", { status: "closed" }),
    ]);
    // By hand while the parent runs: the live one is announced, the closed one is not.
    env.fake.upsertAgent(child("live", null, { updatedAt: at(2) }));
    env.fake.setAgentSilently(child("closed", null, { status: "closed", updatedAt: at(2) }));
    await settle();
    const archiving = archiveParent(env, "parent", at(5));
    env.fake.upsertAgent(child("archived-with-it", "parent", { status: "closed", updatedAt: at(5), archivedAt: at(5) }));
    await archiving;
    await settle();
    // Unarchived later, then detached by hand: linked after the archive, so no survivor of it.
    env.fake.upsertAgent(child("archived-with-it", "parent", { status: "idle", updatedAt: at(8) }));
    await settle();
    env.fake.upsertAgent(child("archived-with-it", null, { status: "idle", updatedAt: at(9) }));
    await settle();
    expect(await env.origins()).toEqual([]);
  });

  it("keeps the origin when the parent is restored, and drops it once the child has a live parent again", async () => {
    const env = await setup([
      makeAgent({ id: "parent", status: "running", updatedAt: at(0) }),
      makeAgent({ id: "other", status: "running", updatedAt: at(0) }),
      child("survivor", "parent"),
    ]);
    const archiving = archiveParent(env, "parent", at(5));
    env.fake.upsertAgent(child("survivor", null, { updatedAt: at(5) }));
    await archiving;
    await settle();
    env.fake.upsertAgent(makeAgent({ id: "parent", status: "idle", updatedAt: at(6), archivedAt: null }));
    await settle();
    expect(await env.origins()).toEqual([{ agentId: "survivor", parentAgentId: "parent" }]);
    env.fake.upsertAgent(child("survivor", "other", { updatedAt: at(7) }));
    await settle();
    expect(await env.origins()).toEqual([]);
  });

  it("judges nothing it did not see: a detach during a broken subscription or before a restart, or of a parent on another host", async () => {
    const env = await setup([
      makeAgent({ id: "parent", status: "running", updatedAt: at(0) }),
      child("gap", "parent"),
      child("remote-child", "remote-parent"),
    ]);
    // While the subscription was down: the parent archived, the child detached.
    env.fake.setAgentSilently(makeAgent({ id: "parent", status: "closed", updatedAt: at(5), archivedAt: at(5) }));
    env.fake.setAgentSilently(child("gap", null, { updatedAt: at(5) }));
    env.fake.reconnectAgentSubscription();
    await settle();
    // Its parent lives on another host: this one cannot read it.
    env.fake.upsertAgent(child("remote-child", null, { updatedAt: at(6) }));
    await settle();
    expect(await env.origins()).toEqual([]);

    // A new process: a child detached meanwhile is not judged, and the file's origins stay.
    await writeFile(path, JSON.stringify({ origins: [{ agentId: "kept", parentAgentId: "parent", archivedAt: at(5) }] }));
    const restarted = createFakePaseo({ agents: [makeAgent({ id: "parent", status: "closed", updatedAt: at(5), archivedAt: at(5) }), child("missed", null, { updatedAt: at(5) })] });
    const watch = createParentOriginWatch(createParentOrigins(path), REREADS);
    await watch.ensure(restarted.paseo as unknown as PaseoApi);
    await watch.archived(restarted.paseo as unknown as PaseoApi, "parent", at(5));
    await settle();
    expect((await watch.read(restarted.paseo as unknown as PaseoApi)).origins).toEqual([{ agentId: "kept", parentAgentId: "parent" }]);
  });

  it("answers null while nothing changed, and keeps the newest origins", async () => {
    const store = createParentOrigins(path);
    const first = await store.read();
    expect(first.origins).toEqual([]);
    expect((await store.read(first.version)).origins).toBeNull();
    for (let index = 0; index <= ORIGINS_KEPT; index += 1) await store.set(`child-${index}`, "parent", at(1));
    const all = (await store.read(first.version)).origins!;
    expect(all).toHaveLength(ORIGINS_KEPT);
    expect(all[0]).toEqual({ agentId: "child-1", parentAgentId: "parent" });
  });

  it("fails every call on a file it cannot parse, and never writes over it", async () => {
    await writeFile(path, "{ not json");
    const store = createParentOrigins(path);
    await expect(store.read()).rejects.toThrow(`Parent origins ${path} is not valid`);
    await expect(store.set("child", "parent", at(1))).rejects.toThrow("is not valid");
    expect(await readFile(path, "utf8")).toBe("{ not json");
    // A well-formed file with an entry it cannot trust is no better.
    await writeFile(path, JSON.stringify({ origins: [{ agentId: "../escape", parentAgentId: "parent", archivedAt: at(1) }] }));
    await expect(createParentOrigins(path).read()).rejects.toThrow("is not valid");
  });

  it("holds no origin it could not write, and says why", async () => {
    const store = createParentOrigins(path);
    expect((await store.read()).origins).toEqual([]);
    // The data directory turns read-only: the file can still be missing, but not be written.
    await chmod(root, 0o555);
    try {
      await expect(store.set("child", "parent", at(1))).rejects.toThrow("Could not write parent origins");
      expect((await store.read()).origins).toEqual([]);
    } finally {
      await chmod(root, 0o755);
    }
  });

  it("reports a failed daemon read instead of taking it for an agent that is gone", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fake = createFakePaseo({ agents: [makeAgent({ id: "parent", status: "idle", updatedAt: at(0) }), child("closed", "parent", { status: "closed" })] });
      const base = fake.paseo as unknown as PaseoApi;
      let failing = false;
      const paseo = {
        ...base,
        agents: {
          ...base.agents,
          ref: (id: string) => ({ ...base.agents.ref(id), refresh: () => (failing ? Promise.reject(new Error("daemon went away")) : base.agents.ref(id).refresh()) }),
        },
      } as unknown as PaseoApi;
      const watch = createParentOriginWatch(createParentOrigins(path), REREADS);
      await watch.ensure(paseo);
      // The archive's hook and update never came: the parent has to be read, and the read fails.
      fake.setAgentSilently(makeAgent({ id: "parent", status: "closed", updatedAt: at(5), archivedAt: at(5) }));
      failing = true;
      fake.upsertAgent(child("closed", null, { status: "closed", updatedAt: at(5) }));
      await settle();
      // After the archive's hook, a failed read of a child fails the call that reads it.
      fake.upsertAgent(child("other", "parent", { updatedAt: at(6) }));
      await expect(watch.archived(paseo, "parent", at(5))).rejects.toThrow("daemon went away");
      // The detach is seen, but the parent cannot be read: nothing inferred, and the log says why.
      expect(errors).toHaveBeenCalledWith("[better-paseo] parent origins: daemon went away");
      expect((await watch.read(paseo)).origins).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  // Paseo 0.15 sends the same update for a detach by hand as for the cascade's, and has no detach hook:
  // a child detached by hand while still linked to an archived parent is taken for a survivor.
  it("cannot tell a detach by hand from the cascade's while the child is still linked to its archived parent", async () => {
    const env = await setup([
      makeAgent({ id: "parent", status: "running", updatedAt: at(0) }),
      child("before-cascade", "parent"),
      child("left-by-failed-cascade", "parent"),
    ]);
    // The hook comes before the cascade; one child is detached by hand before the cascade reaches it.
    const archiving = archiveParent(env, "parent", at(5));
    env.fake.upsertAgent(child("before-cascade", null, { updatedAt: at(5) }));
    await archiving;
    await settle();
    // Another stayed linked (a cascade that stopped at an earlier child), and is detached by hand later.
    env.fake.upsertAgent(child("left-by-failed-cascade", null, { updatedAt: at(60) }));
    await settle();
    expect(await env.origins()).toEqual([
      { agentId: "before-cascade", parentAgentId: "parent" },
      { agentId: "left-by-failed-cascade", parentAgentId: "parent" },
    ]);
  });

  it("opens one subscription, and opens it again after a failed attempt", async () => {
    const fake = createFakePaseo({ agents: [] });
    const watch = createParentOriginWatch(createParentOrigins(path), REREADS);
    const paseo = fake.paseo as unknown as PaseoApi;
    fake.failNextAgentList();
    await watch.ensure(paseo);
    await watch.ensure(paseo);
    await watch.ensure(paseo);
    expect(fake.calls.filter((call) => call.method === "agents.list" && (call.input as { subscribe?: object }).subscribe)).toHaveLength(2);
    expect(fake.openSubscriptions()).toBe(1);
  });
});
