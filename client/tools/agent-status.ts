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

/** The row's verb for each notification (agent cards design 5.1). */
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  message: "Message",
  finished: "Finished",
  errored: "Errored",
  "needs permission": "Needs permission",
  "was closed": "Closed",
  "was canceled": "Canceled",
};

export const AGENT_STATUS_ICON: Record<AgentStatus, string> = {
  message: "MessageSquare",
  finished: "CircleCheck",
  errored: "CircleX",
  "needs permission": "ShieldAlert",
  "was closed": "CircleMinus",
  "was canceled": "CircleSlash",
};

export interface PermissionRequestView {
  requestId?: string;
  title?: string;
  description?: string;
  /** A shell command, or the request's input as JSON. */
  command?: string;
  /** What the notification says besides the request and its instruction line. */
  rest: string;
}

/**
 * The `<permission-request>` JSON a needs-permission notification carries.
 * The line telling the model to call `respond_to_permission` is for the
 * model, not the reader, and is dropped.
 */
export function readPermissionRequest(body: string): PermissionRequestView | undefined {
  const match = /<permission-request>\s*([\s\S]*?)\s*<\/permission-request>/.exec(body);
  if (!match) return undefined;
  let parsed: { requestId?: unknown; request?: Record<string, unknown> };
  try {
    parsed = JSON.parse(match[1]!) as typeof parsed;
  } catch {
    return undefined;
  }
  const request = parsed.request ?? {};
  const text = (value: unknown) => typeof value === "string" && value ? value : undefined;
  const input = request.input && typeof request.input === "object" ? request.input as Record<string, unknown> : undefined;
  const command = text(input?.command) ?? (input && Object.keys(input).length ? JSON.stringify(input, null, 2) : undefined);
  const rest = body.replace(match[0], "").split("\n")
    .filter((line) => !/^Respond with `respond_to_permission`/.test(line.trim())).join("\n").trim();
  return { requestId: text(parsed.requestId) ?? text(request.id), title: text(request.title) ?? text(request.name),
    description: text(request.description), command, rest };
}
