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
   * The time a history lane windows it by: `settledAt` in done; in archived,
   * the agent's `archivedAt`, or its `updatedAt` when only its workspace was
   * archived (the done list pages by agent `updatedAt`).
   */
  historyAt: string;
  /** No card of its own (a background workspace's agent), though it still keeps its parent running. */
  hidden: boolean;
  /** Its parent task, if any: a hidden agent may be on the board only as a shown parent's child. */
  parentId: string | null;
}

const PARENT_LABEL = "paseo.parent-agent-id";
const TITLE_HELPER_LABEL = "better-paseo.purpose";

type RawAgent = PaseoAgent & { lastError?: string | null; activeTurn?: unknown };

function ownLane(agent: RawAgent, workspaces: Map<string, PaseoWorkspace>): Omit<OracleCard, "id" | "settledAt" | "historyAt" | "hidden" | "parentId"> {
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
    // Archived with its workspace, a task is windowed by its own updatedAt: the key the done list pages by.
    const historyAt = own.lane === "archived" ? raw.archivedAt ?? raw.updatedAt : settledAt;
    cards.set(raw.id, { id: raw.id, ...own, settledAt, historyAt, hidden: Boolean(workspace?.background), parentId: raw.labels?.[PARENT_LABEL] ?? null });
  }
  // A running grandchild keeps its parent running, and so its grandparent:
  // spread until nothing changes, so the result does not depend on the order
  // the records came in.
  for (let changed = true; changed;) {
    changed = false;
    for (const raw of agents) {
      const parentId = raw.labels?.[PARENT_LABEL];
      const child = cards.get(raw.id);
      const parent = parentId ? cards.get(parentId) : undefined;
      if (!child || !parent || child.lane === "archived") continue;
      if ((child.lane === "running" || child.lane === "needs_input") && (parent.lane === "review" || parent.lane === "done") && !parent.failed) {
        cards.set(parent.id, { ...parent, lane: "running", reason: `child ${raw.id.slice(0, 8)} still ${child.lane}` });
        changed = true;
      }
    }
  }
  return cards;
}

/**
 * Every difference between the board's cards and the oracle, both ways: a
 * card the oracle shows that is missing or in another lane, and a card the
 * board shows that the oracle does not (outside the window, or no record).
 * A background agent the board keeps as a shown parent's child, and provider
 * subagent cards, are not cards of their own here; a background agent shown
 * any other way is a difference.
 */
export function compareWithOracle(
  shown: ReadonlyMap<string, { lane: string; title: string; subagent?: unknown; children?: ReadonlyArray<{ id: string; lane?: string }> }>,
  expected: ReadonlyMap<string, OracleCard>,
  windowMs: number,
  now = Date.now(),
): string[] {
  const visible = new Map<string, OracleCard>();
  for (const card of expected.values()) {
    if (card.hidden) continue;
    const history = card.lane === "done" || card.lane === "archived";
    if (history && now - Date.parse(card.historyAt) > windowMs) continue;
    visible.set(card.id, card);
  }
  const mismatches: string[] = [];
  for (const card of visible.values()) {
    const actual = shown.get(card.id);
    if (!actual) mismatches.push(`${card.id} missing, expected ${card.lane} (${card.reason})`);
    else if (actual.lane !== card.lane) mismatches.push(`${card.id} "${actual.title}" in ${actual.lane}, expected ${card.lane} (${card.reason})`);
  }
  // A live background agent of a shown parent must be on the board as that
  // parent's child (its row, and its own card for Stop), even with no card of its own.
  for (const card of expected.values()) {
    if (!card.hidden || !card.parentId || card.lane === "archived" || !visible.has(card.parentId)) continue;
    const parent = shown.get(card.parentId);
    if (!parent) continue; // Reported above as the parent missing.
    const listed = parent.children?.some((child) => child.id === card.id) ?? false;
    if (!listed) mismatches.push(`${card.id} (background child) missing from its parent ${card.parentId.slice(0, 8)}'s children, expected ${card.lane} (${card.reason})`);
    if (!shown.has(card.id)) mismatches.push(`${card.id} (background child) has no card for its parent's row, expected ${card.lane} (${card.reason})`);
  }
  for (const [id, actual] of shown) {
    if (actual.subagent || visible.has(id)) continue;
    // A background agent is on the board only as the child of a card it shows
    // (for its Stop): that card must list it, and it must be in its lane.
    const hidden = expected.get(id);
    if (hidden?.hidden && hidden.parentId) {
      const listed = shown.get(hidden.parentId)?.children?.find((child) => child.id === id);
      if (listed) {
        // Both its own card and its row on the parent's card.
        if (actual.lane !== hidden.lane) mismatches.push(`${id} "${actual.title}" (background child) in ${actual.lane}, expected ${hidden.lane} (${hidden.reason})`);
        else if (listed.lane !== undefined && listed.lane !== hidden.lane) mismatches.push(`${id} "${actual.title}" row on its parent in ${listed.lane}, expected ${hidden.lane} (${hidden.reason})`);
        continue;
      }
    }
    const card = expected.get(id);
    mismatches.push(card
      ? `${id} "${actual.title}" in ${actual.lane}, but the oracle keeps it off the board (${card.lane}, ${card.reason}, at ${card.historyAt})`
      : `${id} "${actual.title}" in ${actual.lane} with no record`);
  }
  return mismatches;
}
