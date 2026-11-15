import { describe, expect, it } from "vitest";
import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import { compareWithOracle, oracleLanes } from "../integration/helpers/lane-oracle";

const now = new Date().toISOString();
function agent(id: string, overrides: Partial<PaseoAgent> & { parent?: string } = {}): PaseoAgent {
  const { parent, ...rest } = overrides;
  return {
    id, provider: "claude", cwd: "/tmp", workspaceId: "ws", createdAt: now, updatedAt: now, lastUserMessageAt: now,
    status: "idle", pendingPermissions: [], requiresAttention: false, attentionReason: null, archivedAt: null,
    labels: parent ? { "paseo.parent-agent-id": parent } : {},
    ...rest,
  } as unknown as PaseoAgent;
}
const workspaces = [{ id: "ws", background: false, archivingAt: null } as unknown as PaseoWorkspace];

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe("lane oracle (test helper for the integration suites)", () => {
  it("keeps every ancestor of a running task running, whatever order the records come in", () => {
    const records = [agent("P"), agent("C", { parent: "P" }), agent("G", { parent: "C", status: "running" })];
    for (const order of permutations(records)) {
      const lanes = oracleLanes(order, workspaces);
      expect([lanes.get("P")?.lane, lanes.get("C")?.lane, lanes.get("G")?.lane]).toEqual(["running", "running", "running"]);
    }
  });

  it("reports a board that leaves the grandparent of a running task in done", () => {
    const expected = oracleLanes([agent("P"), agent("C", { parent: "P" }), agent("G", { parent: "C", status: "running" })], workspaces);
    const board = new Map([
      ["P", { lane: "done", title: "P" }],
      ["C", { lane: "running", title: "C" }],
      ["G", { lane: "running", title: "G" }],
    ]);
    expect(compareWithOracle(board, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
  });

  it("reports a card the board shows that the oracle keeps off it", () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const expected = oracleLanes([agent("old", { updatedAt: old, lastUserMessageAt: old, createdAt: old })], workspaces);
    expect(compareWithOracle(new Map([["old", { lane: "review", title: "old" }]]), expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
  });
});
