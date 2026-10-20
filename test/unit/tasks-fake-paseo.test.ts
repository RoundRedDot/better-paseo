import { describe, expect, it } from "vitest";
import { at, createFakePaseo, makeAgent } from "./helpers/fake-paseo";

describe("fake PaseoApi", () => {
  it("filters, sorts and pages agents", async () => {
    const fake = createFakePaseo({
      agents: [
        makeAgent({ id: "a", status: "idle", updatedAt: at(1) }),
        makeAgent({ id: "b", status: "idle", updatedAt: at(3) }),
        makeAgent({ id: "c", status: "running", updatedAt: at(2) }),
        makeAgent({ id: "d", status: "idle", updatedAt: at(4), archivedAt: at(5) }),
      ],
    });
    const first = await fake.paseo.agents.list({
      filter: { statuses: ["idle", "closed"] },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 1 },
    });
    expect(first.entries.map((entry) => entry.agent.id)).toEqual(["b"]);
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await fake.paseo.agents.list({
      filter: { statuses: ["idle", "closed"] },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 1, cursor: first.pageInfo.nextCursor! },
    });
    expect(second.entries.map((entry) => entry.agent.id)).toEqual(["a"]);
    expect(second.pageInfo.hasMore).toBe(false);
  });

  it("pushes upserts while an agent matches and a remove once it leaves", async () => {
    const fake = createFakePaseo({ agents: [makeAgent({ id: "a", status: "running" })] });
    const result = await fake.paseo.agents.list({ filter: { statuses: ["running"] }, subscribe: {} });
    const messages: unknown[] = [];
    result.subscription.subscribe({ snapshot() {}, update: (message) => messages.push(message) });
    fake.upsertAgent(makeAgent({ id: "b", status: "running" }));
    fake.upsertAgent(makeAgent({ id: "a", status: "idle" }));
    fake.upsertAgent(makeAgent({ id: "c", status: "idle" }));
    expect(messages).toEqual([
      expect.objectContaining({ type: "agent_update", payload: expect.objectContaining({ kind: "upsert", agent: expect.objectContaining({ id: "b" }) }) }),
      expect.objectContaining({ type: "agent_update", payload: expect.objectContaining({ kind: "remove", agentId: "a" }) }),
    ]);
    await result.subscription.release();
    expect(fake.openSubscriptions()).toBe(0);
  });

  it("offers label definitions and project icons only on new hosts", async () => {
    const old = createFakePaseo();
    expect("listLabels" in old.paseo.workspaces).toBe(false);
    expect("icon" in old.paseo.projects).toBe(false);
    const fresh = createFakePaseo({ withLabelsAndIcons: true, labels: [{ name: "bug", color: "red" }] });
    const workspaces = fresh.paseo.workspaces as unknown as { listLabels(): Promise<{ labels: unknown[] }> };
    expect((await workspaces.listLabels()).labels).toEqual([{ name: "bug", color: "red" }]);
  });

  it("records permission responses", async () => {
    const fake = createFakePaseo({ agents: [makeAgent({ id: "a" })] });
    await fake.paseo.agents.ref("a").respondToPermission({ requestId: "p1", response: { behavior: "allow" } });
    expect(fake.permissionResponses).toEqual([{ agentId: "a", requestId: "p1", response: { behavior: "allow" } }]);
  });
});
