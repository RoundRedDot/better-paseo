import type { PaseoToolKind } from "../../shared/contracts";
import type { ToolCallView } from "./classify";
import { AGENT_STATUS_ICON, AGENT_STATUS_LABEL, type AgentStatus } from "./agent-status";

/**
 * One grammar for every agent row (agent cards design 5.1): what happened,
 * to which agent, and the outcome. The target is always an agent's title;
 * when only an ID is known the row resolves the title from the host and
 * falls back to a short ID.
 */
export interface AgentRow {
  verb: string;
  /** The agent the row is about, when it names one. */
  agentId?: string;
  /** The agent's title as the call reported it. */
  agentTitle?: string;
  /** A target that is not an agent: "3 agents", a subtask's description. */
  target?: string;
  meta: string[];
  tone: "default" | "warning" | "danger";
  /** A lucide name for the settled row; running rows draw the accent dot. */
  icon: string;
  /** Colour of the settled icon beyond the tone: a finished agent's success. */
  iconTone?: "success";
  /** A created agent's harness, also the row's only meta; a phone draws its mark instead. */
  provider?: string;
}

/** Running, done, and the base form for "not applied" and failures. */
const OPERATIONS: Partial<Record<PaseoToolKind, { running: string; done: string; base: string; icon: string }>> = {
  get_agent_status: { running: "Checking status", done: "Status", base: "Status", icon: "Activity" },
  get_agent_activity: { running: "Reading activity", done: "Activity", base: "Activity", icon: "History" },
  list_agents: { running: "Listing agents", done: "Listed agents", base: "List agents", icon: "Users" },
  list_pending_permissions: { running: "Checking permissions", done: "Pending permissions", base: "Pending permissions", icon: "Shield" },
  cancel_agent: { running: "Canceling turn", done: "Canceled turn", base: "Cancel turn", icon: "CircleStop" },
  kill_agent: { running: "Closing agent", done: "Closed agent", base: "Close agent", icon: "Power" },
  archive_agent: { running: "Archiving", done: "Archived", base: "Archive", icon: "Archive" },
  update_agent: { running: "Updating", done: "Updated", base: "Update", icon: "Pencil" },
  set_agent_mode: { running: "Setting mode", done: "Set mode", base: "Set mode", icon: "SlidersHorizontal" },
  respond_to_permission: { running: "Responding", done: "Responded", base: "Respond", icon: "ShieldCheck" },
};

const NOTIFICATION_TONE: Record<AgentStatus, { tone: AgentRow["tone"]; iconTone?: "success" }> = {
  finished: { tone: "default", iconTone: "success" },
  errored: { tone: "danger" },
  "needs permission": { tone: "warning" },
  "was closed": { tone: "default" },
  "was canceled": { tone: "default" },
  message: { tone: "default" },
};

const DISPOSITION: Record<string, string> = {
  turn_started: "turn started", steered: "steered running turn", out_of_band: "delivered out of band",
};

/** Agent rows only; every other tool keeps its own summary. */
export function summarizeAgentRow(view: ToolCallView): AgentRow | undefined {
  const failure = firstLine(view.error);
  if (view.agentStatus) {
    const status = view.agentStatus;
    const look = { verb: AGENT_STATUS_LABEL[status.status], icon: AGENT_STATUS_ICON[status.status], ...NOTIFICATION_TONE[status.status] };
    const meta = status.status === "errored" ? compact([firstLine(stripTags(status.body))]) :
      status.status === "needs permission" ? compact([permissionTool(status.body)]) : [];
    return { verb: look.verb, agentId: status.agentId, agentTitle: status.title, meta, tone: look.tone,
      icon: look.icon, iconTone: look.iconTone };
  }
  if (view.tool === "sub_agent" && view.subAgent) {
    const agent = view.subAgent;
    const actions = agent.actions?.length ?? 0;
    const failed = view.status === "failed";
    const type = agent.subAgentType ? agent.subAgentType[0]!.toUpperCase() + agent.subAgentType.slice(1) : undefined;
    return {
      verb: view.status === "running" ? "Running subtask" : failed ? "Subtask failed" : "Subtask",
      target: firstLine(agent.description) ?? agent.subAgentType ?? "Agent task",
      meta: failed ? compact([type, failure]) :
        compact([type, actions > 0 ? `${actions} action${actions === 1 ? "" : "s"}` : undefined]),
      tone: failed ? "danger" : "default", icon: "Workflow",
    };
  }
  const paseo = view.tool === "paseo" ? view.paseo : undefined;
  if (!paseo) return undefined;
  const create = paseo.createAgent;
  if (create) {
    const provider = providerName(create.provider);
    if (create.status === "failed") return { verb: "Create failed", agentId: create.agentId, agentTitle: create.title,
      meta: compact([failure]), tone: "danger", icon: "Bot" };
    return {
      verb: create.status === "running" && !create.agentId ? "Creating" : create.status === "canceled" ? "Create canceled" : "Created",
      agentId: create.agentId, agentTitle: create.title, meta: compact([provider]), tone: "default", icon: "Bot",
      provider: create.provider,
    };
  }
  const send = paseo.sendAgentPrompt;
  if (send) {
    const failed = send.state === "failed";
    return {
      verb: send.state === "sending" ? "Sending prompt" : failed ? "Prompt failed" : send.state === "canceled" ? "Prompt canceled" : "Sent prompt",
      agentId: send.agentId,
      meta: failed ? compact([failure]) : send.state === "unconfirmed" ? ["not confirmed"] :
        compact([send.disposition ? DISPOSITION[send.disposition] ?? send.disposition : undefined]),
      tone: failed ? "danger" : "default", icon: "Send",
    };
  }
  const op = paseo.agentOperation;
  const words = OPERATIONS[paseo.tool];
  if (!op || !words) return undefined;
  const running = view.status === "running";
  const failed = op.tone === "danger";
  const notApplied = op.tone === "warning";
  const row: AgentRow = {
    verb: running ? words.running : failed || notApplied ? words.base : words.done,
    agentId: op.agentId, agentTitle: op.agentTitle,
    meta: failed ? compact(["failed", failure]) : notApplied ? ["not applied"] : [],
    tone: failed ? "danger" : "default", icon: words.icon,
  };
  if (running || failed || notApplied) return row;
  switch (paseo.tool) {
    case "get_agent_status":
      return { ...row, meta: compact([op.agentStatus]) };
    case "get_agent_activity": {
      const updates = op.facts.find((fact) => fact.label === "Updates")?.value;
      return { ...row, meta: updates ? [`${updates} update${updates === "1" ? "" : "s"}`] : [] };
    }
    case "list_agents": {
      const agents = op.agents ?? [];
      return { ...row, target: count(agents.length, "agent"), meta: [statusCounts(agents.map((agent) => agent.status))] };
    }
    case "list_pending_permissions": {
      const requests = op.permissions ?? [];
      return { ...row, target: requests.length ? count(requests.length, "request") : "none",
        meta: compact([requests[0]?.title]) };
    }
    case "set_agent_mode": {
      const mode = op.facts.find((fact) => fact.label === "Mode")?.value;
      return { ...row, meta: mode ? [`→ ${mode}`] : [] };
    }
    case "respond_to_permission": {
      const decision = op.facts.find((fact) => fact.label === "Decision")?.value;
      const denied = decision === "deny";
      return { ...row, verb: decision ? denied ? "Denied" : "Allowed" : row.verb, icon: denied ? "ShieldX" : "ShieldCheck" };
    }
    default:
      return row;
  }
}

/** The first eight characters: enough to tell agents apart, never a full line. */
export function shortAgentId(id: string): string {
  const bare = id.includes("::") ? id.slice(id.lastIndexOf("::") + 2) : id;
  return bare.length > 8 ? bare.slice(0, 8) : bare;
}

const PROVIDER_NAMES: Record<string, string> = {
  claude: "Claude", codex: "Codex", cursor: "Cursor", grok: "Grok", gemini: "Gemini", copilot: "Copilot",
  opencode: "OpenCode", omp: "OMP", pi: "Pi", antigravity: "Antigravity", deepseek: "DeepSeek", ollama: "Ollama",
};

/** `cursor/grok-4.7` names its harness first. */
export function providerName(provider: string | undefined): string | undefined {
  if (!provider) return undefined;
  const head = provider.split(/[/:]/)[0]!.toLowerCase();
  return PROVIDER_NAMES[head] ?? provider;
}

function permissionTool(body: string): string | undefined {
  const match = /<permission-request>\s*([\s\S]*?)\s*<\/permission-request>/.exec(body);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]!) as { request?: { name?: unknown; title?: unknown } };
    const name = parsed.request?.name ?? parsed.request?.title;
    return typeof name === "string" && name ? name : undefined;
  } catch {
    return undefined;
  }
}

function statusCounts(statuses: Array<string | undefined>): string {
  const counts = new Map<string, number>();
  for (const status of statuses) if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts].map(([status, n]) => `${n} ${status}`).join(" · ");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function stripTags(text: string): string {
  return text.replace(/<\/?[\w-]+>/g, "");
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split("\n").map((part) => part.trim()).find(Boolean);
  return line ? line.length > 80 ? `${line.slice(0, 79)}…` : line : undefined;
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

/** Folded: more than this many source lines or characters (agent cards design 5.4). */
const FOLD_LINES = 12;
const FOLD_CHARS = 900;
/** The folded body shows about ten lines; hiding fewer than this many more is not worth a button. */
const FOLD_SHOWN = 10;
const FOLD_MIN_HIDDEN = 4;

/** Whether an inline card folds this Markdown under "Show all". Rendered height is unknown, so the source decides. */
export function shouldFold(text: string): boolean {
  const lines = text.split("\n").length;
  if (lines > FOLD_LINES) return lines - FOLD_SHOWN >= FOLD_MIN_HIDDEN;
  return text.length > FOLD_CHARS;
}
