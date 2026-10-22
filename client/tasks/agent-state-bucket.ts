import type { LaneId, StatusKind } from "./model";

/**
 * A copy of `deriveAgentStateBucket` from `@getpaseo/protocol`
 * (`packages/protocol/src/agent-state-bucket.ts`, getpaseo/paseo main at
 * 3081b99b0). The protocol package is not on the plugin client's module
 * allowlist, so the board carries its own; `test/unit/tasks-agent-state-bucket.test.ts`
 * repeats the upstream cases so a drift shows up as a failure.
 */

export type AgentLifecycleStatus = "initializing" | "idle" | "running" | "error" | "closed";
export type AgentAttentionReason = "finished" | "error" | "permission" | null | undefined;
export type WorkspaceStateBucket = "needs_input" | "failed" | "running" | "attention" | "done";

export interface AgentStateBucketInput {
  status: AgentLifecycleStatus;
  pendingPermissionCount?: number;
  requiresAttention?: boolean;
  attentionReason?: AgentAttentionReason;
}

export function deriveAgentStateBucket(input: AgentStateBucketInput): WorkspaceStateBucket {
  if ((input.pendingPermissionCount ?? 0) > 0 || input.attentionReason === "permission") {
    return "needs_input";
  }
  if (input.status === "error" || input.attentionReason === "error") {
    return "failed";
  }
  if (input.status === "running") {
    return "running";
  }
  if (input.requiresAttention) {
    return "attention";
  }
  return "done";
}

export interface TaskClassification {
  lane: LaneId;
  status: StatusKind;
}

const BY_BUCKET: Readonly<Record<WorkspaceStateBucket, TaskClassification>> = {
  needs_input: { lane: "needs_input", status: "needs_input" },
  failed: { lane: "review", status: "failed" },
  running: { lane: "running", status: "running" },
  attention: { lane: "review", status: "unread" },
  done: { lane: "done", status: "done" },
};

export interface TaskClassificationInput extends AgentStateBucketInput {
  lastError?: string | null;
}

/**
 * The lane and status icon of one agent. Follows the protocol bucket, with two
 * deliberate differences. The spec's rule 3 puts `initializing` in the running
 * lane, where upstream's workspace bucket counts it as done: an agent that is
 * starting up is work in flight, not a finished task. And a settled agent that
 * still carries `lastError` is failed even once its attention is cleared or the
 * daemon restarted: the daemon clears the error when a turn starts, completes
 * or is canceled, and restores it with the agent, but leaves it idle, not
 * `error` (a Codex usage limit, an Antigravity quota).
 */
export function classifyAgent(input: TaskClassificationInput): TaskClassification {
  const bucket = deriveAgentStateBucket(input);
  if (bucket === "done" && input.status === "initializing") return BY_BUCKET.running;
  if ((bucket === "done" || bucket === "attention") && input.lastError && (input.status === "idle" || input.status === "closed")) {
    return BY_BUCKET.failed;
  }
  return BY_BUCKET[bucket];
}
