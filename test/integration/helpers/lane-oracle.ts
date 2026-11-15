/**
 * The lane each agent belongs in, worked out from the daemon's raw records
 * alone: every page of the agent and workspace lists, nothing the board
 * keeps. It is written apart from `client/tasks/data` on purpose, so an
 * integration test can compare the board's lanes against it card by card.
 *
 * Plugin-server state (read and unread marks, the turn ledger, provider
 * subagents) is left out: the integration daemons run without the plugin.
 */
import type { PaseoAgent, PaseoWorkspace } from "@getpaseo/client";

export type OracleLane = "needs_input" | "running" | "review" | "done" | "archived";

export interface OracleCard {
  id: string;
  lane: OracleLane;
  failed: boolean;
  /** Why: the rule that decided the lane, for a readable mismatch report. */
  reason: string;
  /** The done lane's time: latest prompt, else creation (no turn ledger here). */
  settledAt: string;
  /**
   * The time a history lane windows and orders it by: `settledAt` in done;
   * in archived, when it was archived (the agent's `archivedAt`, else its
   * workspace's `archivingAt`), else `updatedAt` when no archive time is known.
   */
  historyAt: string;
  /** No card of its own (a background workspace's agent), though it still keeps its parent running. */
  hidden: boolean;
}

const PARENT_LABEL = "paseo.parent-agent-id";
const TITLE_HELPER_LABEL = "better-paseo.purpose";

type RawAgent = PaseoAgent & { lastError?: string | null; activeTurn?: unknown };

function ownLane(agent: RawAgent, workspaces: Map<string, PaseoWorkspace>): Omit<OracleCard, "id" | "settledAt" | "historyAt" | "hidden"> {
  const workspace = agent.workspaceId ? workspaces.get(agent.workspaceId) : undefined;
  if (agent.archivedAt) return { lane: "archived", failed: false, reason: "agent archivedAt" };
  if (agent.workspaceId && !workspace) return { lane: "archived", failed: false, reason: "workspace on no page of the list" };
  if (workspace?.archivingAt) return { lane: "archived", failed: false, reason: "workspace archivingAt" };
  if ((agent.pendingPermissions?.length ?? 0) > 0 || agent.attentionReason === "permission") {
    return { lane: "needs_input", failed: false, reason: "pending permission" };
  }
  if (agent.status === "error" || agent.attentionReason === "error") return { lane: "review", failed: true, reason: "error status" };
  if (agent.status === "running") return { lane: "running", failed: false, reason: "running" };
  if (agent.status === "initializing") {
    const restoring = Boolean(agent.lastUserMessageAt) && !agent.activeTurn;
    if (!restoring) return { lane: "running", failed: false, reason: "initializing a new agent" };
  }
  if (agent.lastError && (agent.status === "idle" || agent.status === "closed" || agent.status === "initializing")) {
    return { lane: "review", failed: true, reason: "settled with lastError" };
  }
  if (agent.requiresAttention) return { lane: "review", failed: false, reason: "requiresAttention" };
  return { lane: "done", failed: false, reason: "settled, read" };
}

/**
 * Cards by agent id. Agents of background workspaces and the plugin's
 * title helpers get none. A parent that settled while a child still runs
 * or waits for input stays running (`withActiveSubtasks`).
 */
export function oracleLanes(agents: readonly PaseoAgent[], workspaceList: readonly PaseoWorkspace[]): Map<string, OracleCard> {
  const workspaces = new Map(workspaceList.map((workspace) => [workspace.id, workspace]));
  const cards = new Map<string, OracleCard>();
  for (const raw of agents as RawAgent[]) {
    const workspace = raw.workspaceId ? workspaces.get(raw.workspaceId) : undefined;
    if (raw.labels?.[TITLE_HELPER_LABEL]) continue;
    const own = ownLane(raw, workspaces);
    const settledAt = raw.lastUserMessageAt ?? raw.createdAt;
    const historyAt = own.lane === "archived" ? raw.archivedAt ?? workspace?.archivingAt ?? raw.updatedAt : settledAt;
    cards.set(raw.id, { id: raw.id, ...own, settledAt, historyAt, hidden: Boolean(workspace?.background) });
  }
  for (const raw of agents) {
    const parentId = raw.labels?.[PARENT_LABEL];
    const child = cards.get(raw.id);
    const parent = parentId ? cards.get(parentId) : undefined;
    if (!child || !parent || child.lane === "archived") continue;
    if ((child.lane === "running" || child.lane === "needs_input") && (parent.lane === "review" || parent.lane === "done") && !parent.failed) {
      cards.set(parent.id, { ...parent, lane: "running", reason: `child ${raw.id.slice(0, 8)} still ${child.lane}` });
    }
  }
  return cards;
}
