import type { TaskCard, TaskPermission } from "../../../client/tasks/model";

/**
 * A plan approval as the daemon hands it over, from the providers' own
 * builders: Claude's `ExitPlanMode` (no title, `buildClaudePlanPermissionActions`,
 * a third "Implement with <mode>" when the session resumes in Bypass or Auto
 * mode) and Codex's synthetic `CodexPlanApproval` (`buildPlanPermissionActions`).
 */
export function claudeExitPlanRequest(options: { id?: string; resume?: boolean } = {}) {
  return {
    id: options.id ?? "permission-exit-plan",
    provider: "claude",
    name: "ExitPlanMode",
    kind: "plan" as const,
    input: { plan: "# Ship the request layout\n1. Section every request\n2. Test it" },
    actions: [
      { id: "reject", label: "Reject", behavior: "deny" as const, variant: "danger" as const, intent: "dismiss" },
      { id: "implement", label: "Implement", behavior: "allow" as const, variant: "primary" as const, intent: "implement" },
      ...(options.resume ? [{ id: "implement_resume", label: "Implement with Bypass", behavior: "allow" as const, variant: "secondary" as const, intent: "implement_resume" }] : []),
    ],
    metadata: { toolUseId: "toolu_exit_plan", planText: "# Ship the request layout\n1. Section every request\n2. Test it" },
  };
}

export function codexPlanRequest(id = "permission-codex-plan") {
  return {
    id,
    provider: "codex",
    name: "CodexPlanApproval",
    kind: "plan" as const,
    title: "Plan",
    description: "Review the proposed plan before implementation starts.",
    input: { plan: "1. Section every request" },
    actions: [
      { id: "dismiss", label: "Dismiss", behavior: "deny" as const, variant: "danger" as const, intent: "dismiss" },
      { id: "implement", label: "Implement", behavior: "allow" as const, variant: "primary" as const, intent: "implement" },
    ],
    metadata: { planText: "1. Section every request", source: "codex_plan_approval" },
  };
}

/** What the board's data layer makes of `claudeExitPlanRequest` (asserted in tasks-data.test.ts). */
export function exitPlanPermission(options: { id?: string; resume?: boolean } = {}): TaskPermission {
  const request = claudeExitPlanRequest(options);
  return {
    requestId: request.id,
    kind: "plan",
    title: "ExitPlanMode",
    summary: null,
    actions: request.actions.map(({ id, label, behavior, variant }) => ({ id, label, behavior, variant })),
    remaining: 0,
  };
}

/** `card`, waiting on a real Claude ExitPlanMode request instead of its own. */
export function asExitPlan(card: TaskCard, options: { id?: string; resume?: boolean } = {}): TaskCard {
  return { ...card, lane: "needs_input", status: "needs_input", permission: exitPlanPermission(options) };
}
