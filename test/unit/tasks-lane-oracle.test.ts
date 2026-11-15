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
      ["P", { lane: "done", title: "P", children: [{ id: "C", lane: "running" }] }],
      ["C", { lane: "running", title: "C", children: [{ id: "G", lane: "running" }] }],
      ["G", { lane: "running", title: "G" }],
    ]);
    expect(compareWithOracle(board, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
  });

  it("reports a background agent shown on its own, but not one shown as a shown parent's child", () => {
    const background = [{ id: "ws", background: false, archivingAt: null }, { id: "ws-bg", background: true, archivingAt: null }] as unknown as PaseoWorkspace[];
    const expected = oracleLanes([agent("P", { status: "running" }), agent("bg", { parent: "P", status: "running", workspaceId: "ws-bg" } as never), agent("bg-orphan", { status: "running", workspaceId: "ws-bg" } as never)], background);
    const withParent = new Map([["P", { lane: "running", title: "P", children: [{ id: "bg", lane: "running" }] }], ["bg", { lane: "running", title: "bg" }]]);
    expect(compareWithOracle(withParent, expected, 24 * 60 * 60 * 1000)).toEqual([]);
    // Its parent shown but not listing it, or it in the wrong lane: differences.
    const unlisted = new Map([["P", { lane: "running", title: "P", children: [] }], ["bg", { lane: "running", title: "bg" }]]);
    expect(compareWithOracle(unlisted, expected, 24 * 60 * 60 * 1000)).toHaveLength(2);
    const wrongLane = new Map([["P", { lane: "running", title: "P", children: [{ id: "bg", lane: "done" }] }], ["bg", { lane: "done", title: "bg" }]]);
    expect(compareWithOracle(wrongLane, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
    // Its own card right, its row on the parent's card wrong.
    const wrongRow = new Map([["P", { lane: "running", title: "P", children: [{ id: "bg", lane: "done" }] }], ["bg", { lane: "running", title: "bg" }]]);
    expect(compareWithOracle(wrongRow, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
    const alone = new Map([["P", { lane: "running", title: "P", children: [{ id: "bg", lane: "running" }] }], ["bg", { lane: "running", title: "bg" }], ["bg-orphan", { lane: "running", title: "bg-orphan" }]]);
    expect(compareWithOracle(alone, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
  });

  it("reports a live background child missing from both its shown parent and the board", () => {
    const background = [{ id: "ws", background: false, archivingAt: null }, { id: "ws-bg", background: true, archivingAt: null }] as unknown as PaseoWorkspace[];
    const expected = oracleLanes([agent("P", { status: "running" }), agent("bg", { parent: "P", status: "running", workspaceId: "ws-bg" } as never)], background);
    const neither = new Map([["P", { lane: "running", title: "P", children: [] }]]);
    expect(compareWithOracle(neither, expected, 24 * 60 * 60 * 1000)).toHaveLength(2);
    // An archived background child stays off a live parent's card.
    const archived = oracleLanes([agent("P", { status: "running" }), agent("bg", { parent: "P", status: "closed", workspaceId: "ws-bg", archivedAt: now } as never)], background);
    expect(compareWithOracle(neither, archived, 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it("reports a shown child missing from its shown parent's rows, or its row in the wrong lane", () => {
    const expected = oracleLanes([agent("P", { status: "running" }), agent("child", { parent: "P", requiresAttention: true })], workspaces);
    const right = new Map([["P", { lane: "running", title: "P", children: [{ id: "child", lane: "review" }] }], ["child", { lane: "review", title: "child" }]]);
    expect(compareWithOracle(right, expected, 24 * 60 * 60 * 1000)).toEqual([]);
    const unlisted = new Map([["P", { lane: "running", title: "P", children: [] }], ["child", { lane: "review", title: "child" }]]);
    expect(compareWithOracle(unlisted, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
    const wrongRow = new Map([["P", { lane: "running", title: "P", children: [{ id: "child", lane: "done" }] }], ["child", { lane: "review", title: "child" }]]);
    expect(compareWithOracle(wrongRow, expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
    // An archived child stays off a live parent.
    const archived = oracleLanes([agent("P", { status: "running" }), agent("child", { parent: "P", archivedAt: now } as never)], workspaces);
    const off = new Map([["P", { lane: "running", title: "P", children: [] }], ["child", { lane: "archived", title: "child" }]]);
    expect(compareWithOracle(off, archived, 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it("reports a card the board shows that the oracle keeps off it", () => {
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const expected = oracleLanes([agent("old", { updatedAt: old, lastUserMessageAt: old, createdAt: old })], workspaces);
    expect(compareWithOracle(new Map([["old", { lane: "review", title: "old" }]]), expected, 24 * 60 * 60 * 1000)).toHaveLength(1);
  });
});
