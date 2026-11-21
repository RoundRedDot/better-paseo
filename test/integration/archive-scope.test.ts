import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveScope } from "../../client/tasks/actions/archive-scope";
import { connect, createPrivateDaemon, installDirectoryPlugin, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";

describe.skipIf(!paseoBin())("scoped archive with the installed private daemon", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let cwd: string;
  const ids = Object.fromEntries(["self", "selfChild", "selfGrandchild", "tree", "treeChild", "treeGrandchild"].map((name) => [name, randomUUID()]));

  beforeAll(async () => {
    daemon = await createPrivateDaemon();
    await daemon.start();
    const setup = await connect(daemon.host);
    const cwdA = path.join(daemon.home, "workspace-a");
    cwd = cwdA;
    const cwdB = path.join(daemon.home, "workspace-b");
    fs.mkdirSync(cwdA);
    fs.mkdirSync(cwdB);
    const a = await setup.api.workspaces.open({ cwd: cwdA });
    const b = await setup.api.workspaces.open({ cwd: cwdB });
    await setup.close();
    await daemon.stop();
    let order = 0;
    const seed = (id: string, parent: string | undefined, workspace: typeof a, cwd: string, open = false) => {
      const createdAt = new Date(Date.UTC(2025, 0, 1, 0, 0, order++)).toISOString();
      daemon.writeAgentRecord({ id, cwd, workspaceId: workspace.id, provider: "claude", title: id, createdAt, updatedAt: createdAt, lastStatus: "closed",
        labels: { ...(parent ? { "paseo.parent-agent-id": parent } : {}), ...(open ? { "paseo.open-agent-tab.test": "true" } : {}) } });
    };
    seed(ids.self!, undefined, a, cwdA);
    seed(ids.tree!, undefined, a, cwdA);
    for (let i = 0; i < 205; i++) seed(randomUUID(), undefined, a, cwdA);
    seed(ids.selfChild!, ids.self!, b, cwdB, true);
    seed(ids.selfGrandchild!, ids.selfChild!, b, cwdB);
    seed(ids.treeChild!, ids.tree!, b, cwdB, true);
    seed(ids.treeGrandchild!, ids.treeChild!, b, cwdB);
    await daemon.start();
    await installDirectoryPlugin(daemon, path.resolve(__dirname, "lane-provider"), "bp-lanes");
    connection = await connect(daemon.host, "better-paseo-integration-archive");
  }, 600_000);

  afterAll(async () => {
    await connection?.close();
    await daemon?.dispose();
  }, 120_000);

  it("detaches direct children and preserves grandchildren when archiving only the parent", async () => {
    const first = await connection.api.agents.list({ filter: { includeBackground: true }, sort: [{ key: "created_at", direction: "asc" }], page: { limit: 200 } });
    expect(first.pageInfo.hasMore).toBe(true);
    const progress = { detached: 0, archived: 0 };
    await archiveScope(connection.api, ids.self!, "self", progress);
    const parent = await connection.daemon.fetchAgent({ agentId: ids.self! });
    const child = await connection.daemon.fetchAgent({ agentId: ids.selfChild! });
    const grandchild = await connection.daemon.fetchAgent({ agentId: ids.selfGrandchild! });
    expect(parent?.agent.archivedAt).toBeTruthy();
    expect(child?.agent.archivedAt).toBeNull();
    expect(child?.agent.labels["paseo.parent-agent-id"]).toBeUndefined();
    expect(grandchild?.agent.archivedAt).toBeNull();
    expect(grandchild?.agent.labels["paseo.parent-agent-id"]).toBe(ids.selfChild);
    expect(progress).toEqual({ detached: 1, archived: 1 });
  });

  it("archives descendants before the parent across workspace and open-tab boundaries", async () => {
    const progress = { detached: 0, archived: 0 };
    await archiveScope(connection.api, ids.tree!, "tree", progress);
    for (const id of [ids.tree!, ids.treeChild!, ids.treeGrandchild!]) {
      expect((await connection.daemon.fetchAgent({ agentId: id }))?.agent.archivedAt).toBeTruthy();
    }
    expect(progress).toEqual({ detached: 0, archived: 3 });
  });

  it.each(["self", "tree"] as const)("handles a running subtask in %s mode", async (scope) => {
    const parent = await connection.api.agents.create({ config: { provider: "bp-lanes/lanes" }, cwd, title: `parent ${scope}` });
    const child = await connection.api.agents.create({ config: { provider: "bp-lanes/lanes" }, cwd, title: `child ${scope}`, parent, prompt: "wait" });
    await connection.daemon.waitForAgentUpsert(child.id, (agent) => agent.status === "running", 30_000);
    await archiveScope(connection.api, parent.id, scope, { detached: 0, archived: 0 });
    const actual = (await connection.daemon.fetchAgent({ agentId: child.id }))!.agent;
    if (scope === "self") {
      expect(actual.archivedAt).toBeNull();
      expect(actual.status).toBe("running");
      expect(actual.labels["paseo.parent-agent-id"]).toBeUndefined();
      await connection.daemon.cancelAgent(child.id);
    } else {
      expect(actual.archivedAt).toBeTruthy();
      expect(actual.status).not.toBe("running");
    }
  }, 120_000);
});
