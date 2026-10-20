import type { PaseoAgentOperationData } from "../../shared/contracts";
import { readPaseoResult } from "./paseo-result";

export const AGENT_OPERATIONS = {
  get_agent_status: "Agent status",
  get_agent_activity: "Agent activity",
  list_agents: "Agents",
  cancel_agent: "Cancel agent run",
  archive_agent: "Archive agent",
  kill_agent: "Close agent",
  update_agent: "Update agent",
  set_agent_mode: "Agent mode",
  list_pending_permissions: "Pending permissions",
  respond_to_permission: "Permission response",
} as const;

export function readAgentOperation(tool: keyof typeof AGENT_OPERATIONS, input: Record<string, unknown>, output: unknown,
  outputText: string | undefined, status: string): PaseoAgentOperationData {
  const result = readPaseoResult(output, outputText);
  const snapshot = record(result?.snapshot);
  const error = status === "failed" || record(output)?.isError === true;
  const canceled = status === "canceled";
  const running = status === "running";
  const success = result?.success;
  const label = error ? "Request failed" : canceled ? "Request canceled" : running ? "Request in progress" :
    success === false ? tool === "cancel_agent" ? "No run canceled" : "Not applied" :
    success === true ? "Request acknowledged" : text(result?.status) ?? (result ? "Result received" : "No result reported");
  const facts: PaseoAgentOperationData["facts"] = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value || typeof value === "number") facts.push({ label, value: String(value) });
  };
  add("Provider", snapshot?.provider);
  add("Model", snapshot?.model);
  add("Directory", snapshot?.cwd);
  add("Mode", result?.newMode ?? result?.currentModeId ?? snapshot?.currentModeId);
  add("Updates", result?.updateCount);
  add("Request", input.requestId);
  add("Decision", record(input.response)?.behavior);
  const agents = Array.isArray(result?.agents) ? result.agents.flatMap((value) => {
    const agent = record(value);
    const id = text(agent?.id);
    return id ? [{ id, title: text(agent?.title) ?? id, status: text(agent?.status), provider: text(agent?.provider), cwd: text(agent?.cwd) }] : [];
  }) : undefined;
  const permissions = Array.isArray(result?.permissions) ? result.permissions.flatMap((value) => {
    const item = record(value);
    const request = record(item?.request);
    const agentId = text(item?.agentId);
    const requestId = text(request?.id);
    return agentId && requestId ? [{ agentId, requestId, title: text(request?.title) ?? text(request?.name) ?? requestId,
      description: text(request?.description), status: text(item?.status) }] : [];
  }) : undefined;
  return {
    title: text(snapshot?.title) ?? AGENT_OPERATIONS[tool], agentId: text(input.agentId), label,
    agentTitle: text(snapshot?.title), agentStatus: text(result?.status) ?? text(snapshot?.status),
    tone: error ? "danger" : canceled ? "neutral" : running ? "active" : success === false ? "warning" : success === true ? "success" : "neutral",
    facts, agents, permissions, content: text(result?.content), arguments: input, result: output,
  };
}

function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
