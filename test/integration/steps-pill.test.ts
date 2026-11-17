/**
 * The Agent steps pill goes up before its chat opens (`watchAgentPills`):
 * the daemon's list must take the request as sent (sort, page, background
 * workspaces, subscribe), and a new agent must reach it while its first turn
 * still runs, when this plugin has drawn no row for it yet.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, createPrivateDaemon, installDirectoryPlugin, listAllAgents, paseoBin, type Connection, type PrivateDaemon } from "./helpers/real-daemon";
import { watchAgentPills, type TimelineLevelControl } from "../../client/timeline-level-control";

vi.mock("react-native", () => import("../unit/helpers/rn-mock"));

const PROVIDER = "bp-lanes";
const providerDir = path.resolve(__dirname, "lane-provider");

describe.skipIf(!paseoBin())("agent steps pills from the daemon's agent list", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let other: Connection;
  let cwd: string;

  beforeAll(async () => {
    daemon = await createPrivateDaemon();
    await daemon.start();
    await installDirectoryPlugin(daemon, providerDir, PROVIDER);
    cwd = path.join(daemon.home, "work");
    fs.mkdirSync(cwd, { recursive: true });
    connection = await connect(daemon.host, "better-paseo-integration-pills");
    // The agents come from another device, as a schedule or a phone would start them.
    other = await connect(daemon.host, "better-paseo-integration-other");
  }, 600_000);

  afterAll(async () => {
    await other?.close();
    await connection?.close();
    await daemon?.dispose();
  }, 120_000);

  function recorder() {
    const requests: [string, string][] = [];
    const control: TimelineLevelControl = { request: (agentId, workspaceId) => { requests.push([agentId, workspaceId]); }, remove() {} };
    return { requests, control };
  }

  async function workspaceOf(agentId: string): Promise<string> {
    const agent = (await listAllAgents(other.api, { includeBackground: true })).find((candidate) => candidate.id === agentId);
    expect(agent?.workspaceId).toBeTruthy();
    return agent!.workspaceId!;
  }

  it("gives an existing agent its pill from the first page, and a new one while its first turn runs", async () => {
    const existing = await other.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "pills: existing", prompt: "hold:200" });
    const { requests, control } = recorder();
    const stop = watchAgentPills(connection.api, control);
    try {
      const existingWorkspace = await workspaceOf(existing.id);
      await vi.waitFor(() => expect(requests).toContainEqual([existing.id, existingWorkspace]), { timeout: 15_000 });

      const fresh = await other.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "pills: fresh", prompt: "hold:20000" });
      const freshWorkspace = await workspaceOf(fresh.id);
      await vi.waitFor(() => expect(requests).toContainEqual([fresh.id, freshWorkspace]), { timeout: 10_000 });
      // The turn has not ended: no assistant reply, so no plugin row could have asked.
      const live = (await listAllAgents(other.api, { includeBackground: true })).find((candidate) => candidate.id === fresh.id);
      expect(["initializing", "running"]).toContain(live?.status);
    } finally {
      stop();
    }
  });

  it("gives an agent in a background workspace its pill", async () => {
    const { requests, control } = recorder();
    const stop = watchAgentPills(connection.api, control);
    try {
      const background = await other.api.agents.create({ config: { provider: `${PROVIDER}/lanes` }, cwd, title: "pills: background", prompt: "hold:20000", background: true });
      const workspace = await workspaceOf(background.id);
      await vi.waitFor(() => expect(requests).toContainEqual([background.id, workspace]), { timeout: 10_000 });
    } finally {
      stop();
    }
  });
});
