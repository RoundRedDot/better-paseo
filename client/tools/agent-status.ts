/** The supervisor's fixed notification format, not free-form response prose. */
export type AgentStatus = "message" | "finished" | "errored" | "needs permission" | "was closed" | "was canceled";

export interface AgentStatusData {
  agentId: string;
  title: string;
  status: AgentStatus;
  body: string;
}

export function readAgentStatus(detail: unknown): AgentStatusData | undefined {
  if (!detail || typeof detail !== "object" || !("type" in detail) || detail.type !== "plain_text" ||
    !("text" in detail) || typeof detail.text !== "string") return undefined;
  const match = /^Agent ([^\s]+) \(([^\n]+)\) (finished|errored|needs permission|was closed|was canceled)\.(?:\r?\n\r?\n([\s\S]*))?$/.exec(detail.text);
  if (!match) return undefined;
  const payload = match[4] ?? "";
  // Remove only the supervisor's outer response wrapper. Keep permission
  // requests, nested tags, code and server-side truncation notices intact.
  const response = /(?:^|\r?\n\r?\n)<agent-response>\r?\n([\s\S]*?)\r?\n<\/agent-response>$/.exec(payload);
  const body = response
    ? payload.slice(0, response.index) + (response.index > 0 ? "\n\n" : "") + response[1]
    : payload;
  return { agentId: match[1]!, title: match[2]!, status: match[3] as AgentStatus, body };
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  message: "Message received",
  finished: "Agent finished",
  errored: "Agent errored",
  "needs permission": "Agent needs permission",
  "was closed": "Agent closed",
  "was canceled": "Agent canceled",
};

export const AGENT_STATUS_ICON: Record<AgentStatus, string> = {
  message: "MessageSquare",
  finished: "CircleCheck",
  errored: "CircleX",
  "needs permission": "Shield",
  "was closed": "CircleStop",
  "was canceled": "CircleX",
};
