/**
 * Shared types and data contracts for OMP Chat Enhancer plugin.
 * Used across client components and server handlers.
 */

export type StepStatus = "completed" | "active" | "pending" | "failed";

export interface ReasoningStep {
  id: string;
  number: number;
  /** Omitted when the source is a plain reasoning stream: the body is the step. */
  title?: string;
  summary?: string;
  durationMs?: number;
  tokenCount?: number;
  status: StepStatus;
  content: string;
  codeSnippet?: {
    language: "typescript" | "bash" | "diff" | "json" | "python";
    code: string;
    filename?: string;
  };
}

export interface ReasoningTraceData {
  id: string;
  agentModel: string;
  durationMs: number;
  totalTokens: number;
  isStreaming?: boolean;
  status: "thinking" | "completed" | "interrupted";
  steps: ReasoningStep[];
}

export type RiskLevel = "low" | "medium" | "high";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  title: string;
  riskLevel: RiskLevel;
  rationale: string;
  command?: string;
  targetPath?: string;
  diff?: string;
  cwd?: string;
  timeoutSeconds?: number;
  status: "pending" | "approved" | "denied";
  timestamp: string;
}

export type TaskStatus = "completed" | "in_progress" | "pending" | "blocked";

export interface TaskItemData {
  id: string;
  title: string;
  phase: string;
  status: TaskStatus;
  duration?: string;
  blockerReason?: string;
}

export interface TaskListData {
  id: string;
  phaseName: string;
  tasks: TaskItemData[];
}

export type ToolCallKind =
  | "bash"
  | "shell"
  | "git"
  | "github"
  | "thinking"
  | "mcp"
  | "read"
  | "edit"
  | "write"
  | "eval"
  | "task"
  | "ask"
  | "hub"
  | "paseo"
  | "ast_grep"
  | "lsp";

export interface HubMessageData {
  op: "send" | "wait" | "inbox" | "list";
  /** Absent on a live call: the tool reports the recipient, not the sender. */
  from?: string;
  to?: string;
  message?: string;
  delivered: boolean;
  replyTo?: string;
  awaitReply?: boolean;
  response?: string;
  /** Whatever the operation printed, for ops that answer with a listing. */
  output?: string;
}

export interface HubProcessData {
  op: "start" | "ps" | "logs" | "stop" | "restart" | "describe" | "wait";
  name: string;
  /** Absent for ops that address a process the daemon already launched. */
  application?: string;
  args?: string[];
  port?: number;
  readyLogPattern?: string;
  status: "starting" | "ready" | "running" | "stopped" | "failed" | "unknown";
  recentLogs?: string[];
  cursor?: number;
}

export interface HubJobData {
  op: "jobs" | "cancel";
  activeJobs: Array<{
    id: string;
    target: string;
    status: "running" | "completed" | "failed";
    elapsed: string;
  }>;
  /** The raw report, shown when the rows cannot be parsed. */
  output?: string;
}

export type HubData =
  | { kind: "message"; data: HubMessageData }
  | { kind: "process"; data: HubProcessData }
  | { kind: "jobs"; data: HubJobData };

export interface McpToolData {
  server: string;
  tool: string;
  transport?: "stdio" | "sse" | "websocket";
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ShellToolData {
  command: string;
  cwd?: string;
  pty?: boolean;
  timeoutSeconds?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

export interface ThinkingToolData {
  text: string;
  model?: string;
  durationMs?: number;
  tokenCount?: number;
  status: "thinking" | "completed";
  steps?: string[];
}

export type PaseoToolKind =
  | "create_agent"
  | "get_agent_activity"
  | "list_providers"
  | "list_models"
  | "send_agent_prompt"
  | "get_agent_status";

export interface PaseoCreateAgentData {
  title: string;
  provider: string;
  model?: string;
  modeId?: string;
  initialPrompt: string;
  agentId?: string;
  status: "created" | "running" | "failed";
}

export interface PaseoGetActivityData {
  agentId: string;
  provider: string;
  activities: Array<{
    kind: "tool" | "message" | "turn" | "thinking";
    title: string;
    elapsed?: string;
    timestamp?: string;
  }>;
}

export interface PaseoListProvidersData {
  providers: Array<{
    id: string;
    label: string;
    description: string;
    enabled: boolean;
    status: "available" | "unavailable";
    modes: string[];
  }>;
}

export interface PaseoListModelsData {
  provider: string;
  models: Array<{
    id: string;
    label: string;
    contextTokens: string;
    thinkingSupport: boolean;
  }>;
}

export interface PaseoToolData {
  id: string;
  tool: PaseoToolKind;
  durationMs?: number;
  createAgent?: PaseoCreateAgentData;
  activity?: PaseoGetActivityData;
  providers?: PaseoListProvidersData;
  models?: PaseoListModelsData;
}
/**
 * One cell of an eval run. The kernel is persistent, so a call carries the
 * source it ran and the text that source printed, and both belong on screen.
 */
export interface EvalCell {
  title?: string;
  code: string;
  language: string;
  output?: string;
}

export interface ToolCalloutData {
  id: string;
  tool: ToolCallKind;
  title: string;
  status: "running" | "completed" | "failed";
  durationMs?: number;
  exitCode?: number;
  filePath?: string;
  lineRange?: string;
  command?: string;
  code?: string;
  language?: string;
  diff?: string;
  output?: string;
  cells?: EvalCell[];
  askOptions?: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  /** Selected option labels, or the typed reply. Empty until answered. */
  askAnswer?: string[];
  subagent?: {
    name: string;
    agentType: string;
    model: string;
    task: string;
    status: string;
  };
  hub?: HubData;
  mcp?: McpToolData;
  shell?: ShellToolData;
  thinking?: ThinkingToolData;
  paseo?: PaseoToolData;
}

export interface MockChatMessage {
  id: string;
  sender: "user" | "assistant";
  timestamp: string;
  text?: string;
  reasoningTrace?: ReasoningTraceData;
  taskList?: TaskListData;
  toolCallouts?: ToolCalloutData[];
  approvalRequest?: ApprovalRequest;
}
