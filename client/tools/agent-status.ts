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
  const response = /(?:^|\r?\n\r?\n)<agent-response>\r?\n([\s\S]*?)\r?\n<\/agent-response>\s*$/.exec(payload);
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

export interface PermissionQuestionOption { label: string; description?: string }

/** One question of a `question` request, read the way Paseo's own question form reads it. */
export interface PermissionQuestion {
  /** The answer's key: Paseo submits `answers[header]`. */
  header: string;
  question: string;
  options: PermissionQuestionOption[];
  multiSelect: boolean;
  /** A free-text answer is accepted beside, or instead of, the options. */
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
}

/** A provider's own buttons for a request, such as a plan's "Implement". */
export interface PermissionAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
  variant?: "primary" | "secondary" | "danger";
}

export interface PermissionRequestView {
  requestId?: string;
  /** `tool`, `plan`, `question`, `mode` or `other`. */
  kind?: string;
  /** The provider's tool name, e.g. `Bash` or `request_user_input_async`. */
  name?: string;
  title?: string;
  description?: string;
  /** A shell command, or the request's input as JSON when nothing better reads it. */
  command?: string;
  /** A plan request's markdown. */
  plan?: string;
  /** A question request's questions; the card draws them as a form. */
  questions?: PermissionQuestion[];
  actions?: PermissionAction[];
  /** The request's input, echoed back with the answers. */
  input?: Record<string, unknown>;
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
  const request = record(parsed.request) ?? {};
  const input = record(request.input);
  const detail = record(request.detail);
  const kind = text(request.kind);
  const questions = kind === "question" || text(request.name)?.startsWith("request_user_input") ? readQuestions(input) : undefined;
  const plan = kind === "plan" ? text(record(request.metadata)?.planText) ?? text(input?.plan) : undefined;
  const command = text(input?.command) ?? text(detail?.command) ??
    (questions || plan || !input || !Object.keys(input).length ? undefined : JSON.stringify(input, null, 2));
  const rest = body.replace(match[0], "").split("\n")
    .filter((line) => !/^Respond with `respond_to_permission`/.test(line.trim())).join("\n").trim();
  return { requestId: text(parsed.requestId) ?? text(request.id), kind, name: text(request.name),
    title: text(request.title) ?? text(request.name), description: text(request.description), command, plan, questions,
    actions: readActions(request.actions), input, rest };
}

function readQuestions(input: Record<string, unknown> | undefined): PermissionQuestion[] | undefined {
  if (!Array.isArray(input?.questions)) return undefined;
  const questions: PermissionQuestion[] = [];
  for (const [index, value] of input.questions.entries()) {
    const row = record(value);
    const question = text(row?.question) ?? text(row?.title);
    if (!row || !question) return undefined;
    const options: PermissionQuestionOption[] = [];
    for (const option of Array.isArray(row.options) ? row.options : []) {
      const label = text(option) ?? text(record(option)?.label);
      if (!label) return undefined;
      options.push({ label, description: text(record(option)?.description) });
    }
    questions.push({ header: text(row.header) ?? `Question ${index + 1}`, question, options,
      multiSelect: row.multiSelect === true, allowOther: row.allowOther === true || row.isOther === true,
      allowEmpty: row.allowEmpty === true, placeholder: text(row.placeholder) });
  }
  return questions.length ? questions : undefined;
}

function readActions(value: unknown): PermissionAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions = value.flatMap((item): PermissionAction[] => {
    const action = record(item);
    const id = text(action?.id);
    const label = text(action?.label);
    const behavior = action?.behavior;
    if (!id || !label || (behavior !== "allow" && behavior !== "deny")) return [];
    const variant = action?.variant;
    return [{ id, label, behavior, variant: variant === "primary" || variant === "secondary" || variant === "danger" ? variant : undefined }];
  });
  return actions.length ? actions : undefined;
}

function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Whether one question has an answer: a picked option, typed text, or an empty answer it allows. */
export function isQuestionAnswered(question: PermissionQuestion, selected: readonly number[] = [], other = ""): boolean {
  if (selected.length) return true;
  if (question.options.length && !question.allowOther) return false;
  return other.trim().length > 0 || question.allowEmpty;
}

/** Paseo's question-form answers: `header -> "label, label"`, typed text replacing a single pick. */
export function buildPermissionAnswers(questions: PermissionQuestion[], selections: Record<number, readonly number[]>,
  others: Record<number, string>): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const labels = (selections[index] ?? []).map((option) => question.options[option]!.label);
    const other = others[index]?.trim();
    const typed = question.options.length === 0 || question.allowOther;
    if (typed && other) answers[question.header] = question.multiSelect ? [...labels, other].join(", ") : other;
    else if (typed && question.allowEmpty && question.options.length === 0) answers[question.header] = "";
    else if (labels.length) answers[question.header] = labels.join(", ");
  });
  return answers;
}
