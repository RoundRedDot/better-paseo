import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTaskAvailability, taskUpdateIssue, taskUpdateState } from "../../server/tasks/availability";
import { type TaskAvailability, unavailableTask } from "../../shared/task-availability";
import { availabilityBatchFixture } from "./helpers/availability-batch-fixture";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(workspaces: number, cards?: number) {
  const f = await availabilityBatchFixture({ workspaces, cards });
  cleanups.push(f.cleanup);
  return { ...f, read: createTaskAvailability(f.settings, () => true, async () => true, f.connect) };
}

/** The whole answer, with normal archived history distinguished from missing records. */
function expectedEntries(f: Awaited<ReturnType<typeof fixture>>) {
  const workspace = unavailableTask({ code: "workspace_unavailable", detail: f.root });
  const { unarchive: _, ...restorable } = unavailableTask({ code: "workspace_archived", detail: f.root }).blocked;
  const provider = { code: "provider_unavailable" as const, detail: "gemini" };
  const special: Record<string, TaskAvailability> = {
    "agent-1": { issue: null, blocked: restorable },
    "agent-2": workspace,
    "agent-4": workspace,
    "agent-5": unavailableTask({ code: "directory_missing", detail: join(f.root, "removed-worktree") }),
    "agent-6": unavailableTask({ code: "workspace_unavailable", detail: null }),
    "agent-7": unavailableTask({ code: "agent_missing", detail: null }),
    "agent-8": { issue: provider, blocked: { unarchive: provider, autoTitle: provider } },
  };
  return f.ids.map((agentId) => ({ agentId, availability: special[agentId] ?? { issue: null, blocked: {} } }));
}

describe("availability batch daemon reads", () => {
  // Per card: the per-id path the batch used before and operations still use.
  // 40 and 100 workspaces fit one page; with 250, cards on the second page and
  // missing workspaces scan both.
  it.each([
    { workspaces: 40, perCard: 97, batch: 1 },
    { workspaces: 100, perCard: 97, batch: 1 },
    { workspaces: 250, perCard: 114, batch: 2 },
  ])("lists $workspaces workspaces once per batch and inspects only unlisted ids", async ({ workspaces, perCard, batch }) => {
    const f = await fixture(workspaces);
    const expected = new Map<string, Awaited<ReturnType<typeof taskUpdateState>>>();
    for (const id of f.ids) expected.set(id, await taskUpdateState(await f.api.agents.ref(id).refresh(), f.api));
    expect(f.counts()).toMatchObject({ fetchAgent: 100, fetchWorkspaces: perCard });

    f.reset();
    const { entries } = await f.read(f.api, f.ids);
    expect(f.counts()).toEqual({ fetchAgent: 100, fetchWorkspaces: batch, listModels: 1, providersSnapshot: 1 });
    expect(entries.map((entry) => entry.agentId)).toEqual(f.ids);
    for (const { agentId, availability } of entries) {
      const state = expected.get(agentId)!;
      if (state.issue && agentId !== "agent-1") expect(availability.issue).toEqual(state.issue);
      // A miss in the active list is not enough: only a confirmed archived record is restorable.
      if (state.issue) expect(availability.blocked.unarchive === undefined).toBe(agentId === "agent-1");
      else expect(availability.issue?.code ?? "none").not.toMatch(/^(agent|directory|workspace)_/);
    }
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.daemon.inspectWorkspaceRecovery.mock.calls.map(([id]) => id)).toEqual(["ws-1", "ws-never"]);
    expect(f.daemon.close).toHaveBeenCalledTimes(1);
  });

  it("distinguishes archived, missing, archiving and background workspaces", async () => {
    const f = await fixture(250);
    const byId = new Map((await f.read(f.api, f.ids)).entries.map((entry) => [entry.agentId, entry.availability]));
    const cwd = f.sources.get("agent-1")!.agent.cwd;
    // Archived: restorable. Archiving: not yet. Background: listed and healthy.
    expect(byId.get("agent-1")).toMatchObject({ issue: null, blocked: { rename: { code: "workspace_archived", detail: cwd } } });
    expect(byId.get("agent-1")!.blocked.unarchive).toBeUndefined();
    expect(byId.get("agent-2")!.blocked.unarchive).toEqual({ code: "workspace_unavailable", detail: cwd });
    expect(byId.get("agent-3")).toEqual({ issue: null, blocked: {} });
    expect(byId.get("agent-4")!.blocked.unarchive?.code).toBe("workspace_unavailable");
    expect(byId.get("agent-5")!.issue?.code).toBe("directory_missing");
    expect(byId.get("agent-6")!.issue).toEqual({ code: "workspace_unavailable", detail: null });
    expect(byId.get("agent-7")!.issue?.code).toBe("agent_missing");
    expect(byId.get("agent-8")!.blocked).toEqual({ unarchive: { code: "provider_unavailable", detail: "gemini" }, autoTitle: { code: "provider_unavailable", detail: "gemini" } });
    // A card on the second page.
    expect(byId.get("agent-0")).toEqual({ issue: null, blocked: {} });
  });

  it("reads no workspace page when no card needs one", async () => {
    const f = await fixture(40);
    await f.read(f.api, ["agent-5", "agent-6", "agent-7"]);
    expect(f.counts().fetchWorkspaces).toBe(0);
  });

  it("lists after every agent read, so a workspace an agent just moved to is found", async () => {
    const f = await fixture(40);
    const read = f.fetchAgent.getMockImplementation()!;
    f.fetchAgent.mockImplementation(async (id: string) => {
      if (id === "agent-2") {
        f.records.push({ id: "ws-new", activityAt: "2026-11-01T00:00:00Z", archivingAt: null });
        f.sources.get(id)!.agent.workspaceId = "ws-new";
      }
      return read(id);
    });
    const { entries } = await f.read(f.api, ["agent-0", "agent-2"]);
    expect(entries.find((entry) => entry.agentId === "agent-2")!.availability).toEqual({ issue: null, blocked: {} });
  });

  it("keeps nothing between batches, and operations still read the workspace themselves", async () => {
    const f = await fixture(40);
    expect((await f.read(f.api, ["agent-0"])).entries[0]!.availability).toEqual({ issue: null, blocked: {} });
    f.records[0]!.archivingAt = "2026-11-01T00:00:00Z";
    expect(await taskUpdateIssue(await f.api.agents.ref("agent-0").refresh(), f.api)).toMatchObject({ code: "workspace_unavailable" });
    expect((await f.read(f.api, ["agent-0"])).entries[0]!.availability.issue?.code).toBe("workspace_unavailable");
    expect(f.counts().fetchWorkspaces).toBe(3);
  });

  it.each([40, 100, 250])("answers every field of every card the same with %i workspaces", async (workspaces) => {
    const f = await fixture(workspaces);
    expect(await f.read(f.api, f.ids)).toEqual({ entries: expectedEntries(f) });
  });

  it("fails the batch when a workspace page fails, as the per-card read did, and the next batch recovers", async () => {
    const f = await fixture(250);
    const page = f.fetchWorkspaces.getMockImplementation()!;
    const failSecondPage = async (options?: Parameters<typeof page>[0]) => {
      if (options?.page?.cursor) throw new Error("fetch_workspaces_failed");
      return page(options);
    };
    f.fetchWorkspaces.mockImplementation(failSecondPage);
    // agent-0 sits on the second page, so the per-card read reaches the failing page too.
    await expect(taskUpdateState(await f.api.agents.ref("agent-0").refresh(), f.api)).rejects.toThrow("fetch_workspaces_failed");
    await expect(f.read(f.api, f.ids)).rejects.toThrow("fetch_workspaces_failed");
    f.fetchWorkspaces.mockImplementation(page);
    f.reset();
    expect(await f.read(f.api, f.ids)).toEqual({ entries: expectedEntries(f) });
    expect(f.counts().fetchWorkspaces).toBe(2);
  });

  it("keeps concurrent batches on different hosts apart and shares no read between them", async () => {
    const a = await fixture(40);
    const b = await fixture(250);
    b.records[0]!.archivedAt = "2026-11-01T00:00:00Z";
    // Each host's server owns its recovery connection; concurrent calls share no batch state.
    const read = a.read;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const page = a.fetchWorkspaces.getMockImplementation()!;
    a.fetchWorkspaces.mockImplementationOnce(async (options) => { await gate; return page(options); });
    const first = read(a.api, a.ids);
    const second = read(a.api, a.ids);
    const other = b.read(b.api, b.ids);
    const otherResult = await other;
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ entries: expectedEntries(a) });
    expect(secondResult).toEqual({ entries: expectedEntries(a) });
    const archived = unavailableTask({ code: "workspace_archived", detail: b.root });
    delete archived.blocked.unarchive;
    archived.issue = null;
    expect(otherResult.entries[0]).toEqual({ agentId: "agent-0", availability: archived });
    expect(otherResult.entries.slice(1)).toEqual(expectedEntries(b).slice(1));
    expect(a.counts()).toMatchObject({ fetchAgent: 200, fetchWorkspaces: 2 });
    expect(b.counts()).toMatchObject({ fetchAgent: 100, fetchWorkspaces: 2 });
  });

  describe("stops paging once every workspace of the batch is found", () => {
    // With 250 workspaces the first page holds ws-249 down to ws-50 (newest
    // first): agent-20 and later sit there, agent-0 sits on the second page.
    async function failingSecondPage() {
      const f = await fixture(250);
      const page = f.fetchWorkspaces.getMockImplementation()!;
      f.fetchWorkspaces.mockImplementation(async (options) => {
        if (options?.page?.cursor) throw new Error("fetch_workspaces_failed");
        return page(options);
      });
      return f;
    }

    it("reads only the first page when every target is on it, even when the second page fails", async () => {
      const f = await failingSecondPage();
      const ids = f.ids.slice(20);
      // The per-card read stops at the first page too.
      for (const id of ids) await taskUpdateState(await f.api.agents.ref(id).refresh(), f.api);
      f.reset();
      expect(await f.read(f.api, ids)).toEqual({ entries: expectedEntries(f).slice(20) });
      expect(f.counts().fetchWorkspaces).toBe(1);
    });

    it("reads both pages when the targets span them", async () => {
      const f = await fixture(250);
      expect((await f.read(f.api, ["agent-0", "agent-50"])).entries).toEqual(expectedEntries(f).filter((entry) => ["agent-0", "agent-50"].includes(entry.agentId)));
      expect(f.counts().fetchWorkspaces).toBe(2);
    });

    it.each(["agent-1", "agent-4"])("scans to the last page for %s before checking recovery", async (missing) => {
      const f = await fixture(250);
      const { entries } = await f.read(f.api, [missing, "agent-50"]);
      expect(entries).toEqual(expectedEntries(f).filter((entry) => [missing, "agent-50"].includes(entry.agentId)));
      expect(entries[0]!.availability.blocked.unarchive === undefined).toBe(missing === "agent-1");
      expect(f.counts().fetchWorkspaces).toBe(2);
      const failing = await failingSecondPage();
      await expect(failing.read(failing.api, [missing, "agent-50"])).rejects.toThrow("fetch_workspaces_failed");
      await expect(taskUpdateState(await failing.api.agents.ref(missing).refresh(), failing.api)).rejects.toThrow("fetch_workspaces_failed");
    });
  });
});
