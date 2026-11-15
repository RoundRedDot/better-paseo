/**
 * Every lane from stored records, on a private daemon with more workspaces
 * and unread agents than one page (200) holds. The board's cards are
 * compared with the oracle, then each case is checked by name.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PaseoWorkspace } from "@getpaseo/client";
import { connect, createPrivateDaemon, listAllAgents, listAllWorkspaces, paseo, paseoBin, type Connection, type PrivateDaemon, type StoredAgentRecord } from "./helpers/real-daemon";
import { mountBoard, type MountedBoard } from "./helpers/mount-board";
import { compareWithOracle, oracleLanes } from "./helpers/lane-oracle";

vi.mock("react-native", () => import("../unit/helpers/rn-mock"));

const WORKSPACES = 205;
const EXTRA_UNREAD = 230;
const HOUR = 60 * 60 * 1000;

function iso(agoMs: number): string {
  return new Date(Date.now() - agoMs).toISOString();
}

function uuid(n: number): string {
  return `7e57a9e0-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describe.skipIf(!paseoBin())("lanes on a private daemon, from stored records", () => {
  let daemon: PrivateDaemon;
  let connection: Connection;
  let board: MountedBoard;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    daemon = await createPrivateDaemon();
    await daemon.start();
    // Workspaces first: their ids are the daemon's.
    let setup = await connect(daemon.host);
    const dirs = path.join(daemon.home, "dirs");
    for (let index = 0; index < WORKSPACES; index += 1) {
      const cwd = path.join(dirs, `ws-${String(index).padStart(3, "0")}`);
      fs.mkdirSync(cwd, { recursive: true });
      await setup.api.workspaces.open({ cwd });
    }
    const first = await setup.api.workspaces.list({ filter: { includeBackground: true } });
    expect(first.pageInfo.hasMore).toBe(true);
    const all = await listAllWorkspaces(setup.api);
    const firstIds = new Set(first.entries.map((workspace) => workspace.id));
    const early = first.entries[0]!;
    const late = all.find((workspace) => !firstIds.has(workspace.id))!;
    // Archived with no agents yet: the agent seeded below outlives it, as Paseo allows.
    const archivedWorkspace = first.entries[1]!;
    await paseo(["workspace", "archive", archivedWorkspace.id, "--home", daemon.home]);
    await setup.close();
    await daemon.stop();

    let n = 0;
    const seed = (name: string, workspace: PaseoWorkspace, record: Partial<StoredAgentRecord>) => {
      const id = uuid(++n);
      ids[name] = id;
      daemon.writeAgentRecord({
        id,
        provider: "claude",
        cwd: workspace.workspaceDirectory ?? path.join(dirs, "missing"),
        workspaceId: workspace.id,
        title: name,
        createdAt: iso(2 * HOUR),
        updatedAt: iso(HOUR),
        lastUserMessageAt: iso(HOUR),
        lastStatus: "closed",
        ...record,
      });
    };
    seed("review", early, { requiresAttention: true, attentionReason: "finished", attentionTimestamp: iso(HOUR) });
    seed("review-late-workspace", late, { requiresAttention: true, attentionReason: "finished", attentionTimestamp: iso(HOUR) });
    seed("done", early, {});
    seed("done-late-workspace", late, {});
    seed("done-old", early, { createdAt: iso(80 * HOUR), updatedAt: iso(70 * HOUR), lastUserMessageAt: iso(72 * HOUR) });
    seed("failed", early, { lastError: "Usage limit reached" });
    seed("archived", early, { archivedAt: iso(HOUR / 2) });
    // Prompted days ago, archived just now: the archived lane windows it by its archive time.
    seed("archived-old-task", early, { createdAt: iso(80 * HOUR), lastUserMessageAt: iso(72 * HOUR), updatedAt: iso(HOUR / 4), archivedAt: iso(HOUR / 4) });
    seed("workspace-archived", archivedWorkspace, { requiresAttention: true, attentionReason: "finished" });
    seed("parent", early, {});
    seed("child", early, { requiresAttention: true, attentionReason: "finished", labels: { "paseo.parent-agent-id": ids.parent! } });
    for (let index = 0; index < EXTRA_UNREAD; index += 1) {
      // Older than the done window: only the attention list brings these to review, not a done page.
      const at = iso(50 * HOUR + index * 60_000);
      seed(`unread-${index}`, index % 2 ? late : early, { requiresAttention: true, attentionReason: "finished", createdAt: at, updatedAt: at, lastUserMessageAt: at, attentionTimestamp: at });
    }
    await daemon.start();
    connection = await connect(daemon.host, "better-paseo-integration", { reconnect: true });
    board = await mountBoard(connection.api);
    await board.loadAllDone();
  }, 600_000);

  afterAll(async () => {
    await board?.unmount();
    await connection?.close();
    await daemon?.dispose();
  }, 120_000);

  const laneOf = (name: string) => board.current.byId.get(ids[name]!)?.lane;

  async function oracleMismatches(): Promise<string[]> {
    const [agents, workspaces] = await Promise.all([
      listAllAgents(connection.api, { includeArchived: true, includeBackground: true }),
      listAllWorkspaces(connection.api),
    ]);
    return compareWithOracle(board.current.byId, oracleLanes(agents, workspaces), 24 * HOUR);
  }

  it("matches the oracle for every record", async () => {
    expect(await oracleMismatches()).toEqual([]);
  });

  it("reads past the first page of the workspace list", () => {
    expect(laneOf("review-late-workspace")).toBe("review");
    expect(laneOf("done-late-workspace")).toBe("done");
  });

  it("reads past the first page of the unread list", () => {
    expect(board.current.lanes.review.cards.filter((card) => card.title.startsWith("unread-"))).toHaveLength(EXTRA_UNREAD);
  });

  it("puts each stored state in its lane", () => {
    expect(laneOf("review")).toBe("review");
    expect(laneOf("done")).toBe("done");
    expect(board.current.byId.get(ids.failed!)).toMatchObject({ lane: "review", status: "failed" });
    expect(laneOf("archived")).toBe("archived");
    expect(laneOf("archived-old-task")).toBe("archived");
    expect(laneOf("child")).toBe("review");
    expect(laneOf("parent")).toBe("done");
  });

  it("keeps old and orphaned tasks off the active lanes", () => {
    // Outside the 24h done window.
    expect(board.current.byId.has(ids["done-old"]!)).toBe(false);
    // Its workspace was archived without it: unread, but not in review.
    expect(laneOf("workspace-archived")).toBe("archived");
  });

  it("keeps every lane once the board reconnects after a daemon restart", async () => {
    const before = new Map([...board.current.byId].map(([id, card]) => [id, card.lane]));
    const states: string[] = [];
    const stop = connection.daemon.subscribeConnectionStatus((state) => states.push(state.status));
    try {
      await daemon.restart();
      // Reconnected, and every list's snapshot read again.
      await board.until(() => expect(states.lastIndexOf("connected")).toBeGreaterThan(states.indexOf("disconnected")), 60_000);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await board.until((current) => {
        const changed = [...before].filter(([id, lane]) => current.byId.get(id)?.lane !== lane).map(([id, lane]) => `${current.byId.get(id)?.title ?? id}: ${lane} -> ${current.byId.get(id)?.lane}`);
        expect(changed).toEqual([]);
      }, 30_000);
      expect(await oracleMismatches()).toEqual([]);
    } finally {
      stop();
    }
  }, 180_000);

  it("keeps every lane after the board reads its lists again", async () => {
    const before = new Map([...board.current.byId].map(([id, card]) => [id, card.lane]));
    await board.until(() => {}, 0);
    const result = await board.current.refresh();
    expect(result).toBe("done");
    await board.until((current) => {
      const changed = [...before].filter(([id, lane]) => current.byId.get(id)?.lane !== lane);
      expect(changed).toEqual([]);
    }, 30_000);
  });
});
