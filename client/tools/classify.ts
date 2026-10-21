/**
 * Tool call classification (plan §3.3, BC-01).
 *
 * Turns the host's `tool_call` item into the record a callout draws. Moved
 * out of `live-renderers.tsx` so it can be unit tested, and extended with the
 * protocol detail kinds that used to fall through to a terminal card:
 * `search`, `fetch`, `worktree_setup`, `sub_agent`, `plan`, `plain_text`,
 * plus `unknown` for any tool this plugin has no shape for.
 *
 * Pure: no React, no host hooks.
 */
import type {
  GitHubToolData,
  HubData,
  McpToolData,
  PaseoToolData,
  ToolCallKind,
  ToolCalloutData,
} from "../../shared/contracts";
import { buildHubData } from "../hub-details";
import { buildGitHubData, buildGitHubDataFromLabel } from "../github-request";
import { lineDiff } from "../components/diff-lines";
import type { AgentStatusData } from "./agent-status";
import { readAgentMessage, senderlessAgentMessage, type AgentMessage } from "./agent-message";
import { readSendAgentPrompt } from "./send-agent-prompt";
import { CATALOG_TOOLS, readPaseoCatalog, type CatalogTool } from "./paseo-catalog";
import { AGENT_OPERATIONS, readAgentOperation } from "./agent-operation";
import { readPaseoResult } from "./paseo-result";
import { readActivity, type ActivityData } from "./activity";
import { normalizeForeignTool } from "./normalize";

function extractStringProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const val = Reflect.get(obj, key);
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

/** A tool's human-readable text sits in the first text block of `content`. */
export function extractContentText(container: Record<string, unknown>): string | undefined {
  const content = container.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    if (block && typeof block === "object") {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string" && text.length > 0) return text;
    }
  }
  return undefined;
}

/** A tool that times its run reports it under the result's `details`. */
export function extractDetailsDuration(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const details = (output as Record<string, unknown>).details;

  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>).durationMs;
  return typeof value === "number" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** An MCP call's server and tool, as read from its name. */
export interface McpName {
  server: string;
  tool: string;
}

/** OMP's bridge labels a call `server / tool` (`omp/agent.ts`). */
const BRIDGED_MCP_NAME = /^([^\s/]+) \/ ([^\s/]+)$/;
/** Codex names a call `server.tool`; the tool's own name may carry dots. */
const DOTTED_MCP_NAME = /^([a-z0-9_-]+)\.([a-z0-9_.-]+)$/;
/** Extensions a dotted title can end in that the highlighter does not know. */
const FILE_EXTENSIONS = new Set(["txt", "lock", "toml", "log", "csv", "xml", "ini", "env", "pdf", "png", "jpg", "svg"]);

/** Paseo's own server, as Claude and Codex name it (`paseo`, `paseo_voice`). */
function isPaseoServer(server: string): boolean {
  return server === "paseo" || server.startsWith("paseo_");
}

/** An MCP answer: content blocks, or nothing yet while it runs or after it fails. */
function isMcpResult(output: unknown): boolean {
  return output === undefined || output === null || Array.isArray(asRecord(output)?.content);
}

/**
 * The server and tool an MCP call's name carries, or undefined for any other
 * call.
 *
 * Claude's `mcp__server__tool` says so in its prefix. The other two forms say
 * nothing by themselves, so they count only on an `unknown` detail, which is
 * what Codex and the OMP bridge send for every MCP call. A dotted name is
 * still looser: an ACP call is named by its title when it has no kind, and a
 * title can be a file name. So it also needs an MCP-shaped answer and must not
 * read as a file, unless it is one of Paseo's own tools, which the host
 * recognises by the `paseo.` prefix alone (`isPaseoToolName`).
 */
export function readMcpName(rawName: string, detailType: string, output: unknown): McpName | undefined {
  if (rawName.startsWith("mcp__")) {
    const parts = rawName.replace(/^mcp__/, "").split("__");
    return {
      server: parts.length > 1 ? (parts[0] ?? "mcp") : "mcp",
      tool: parts.length > 1 ? parts.slice(1).join(" / ") : (parts[0] ?? rawName),
    };
  }
  if (detailType !== "unknown") return undefined;
  const bridged = BRIDGED_MCP_NAME.exec(rawName);
  if (bridged) return { server: bridged[1]!, tool: bridged[2]! };
  const dotted = DOTTED_MCP_NAME.exec(rawName);
  if (!dotted) return undefined;
  const name = { server: dotted[1]!, tool: dotted[2]! };
  if (isPaseoServer(name.server) && PASEO_TOOLS.has(name.tool)) return name;
  const extension = rawName.split(".").pop() ?? "";
  const fileLike = languageFromPath(rawName) !== undefined || FILE_EXTENSIONS.has(extension);
  return isMcpResult(output) && !fileLike ? name : undefined;
}

/** Keeps an MCP call's own arguments and result under its server and tool. */
export function buildMcpData(
  name: McpName,
  input: Record<string, unknown>,
  output: unknown,
  durationMs: number | undefined,
): McpToolData {
  return {
    server: name.server,
    tool: name.tool,
    arguments: input,
    // An MCP server answers with content blocks. Keeping the envelope here put
    // `{"content":[{"type":"text",...}]}` in the response panel, so the prose is
    // unwrapped first and only a genuinely structured payload stays an object.
    result:
      (output && typeof output === "object"
        ? extractContentText(output as Record<string, unknown>)
        : undefined) ?? (output === "" ? undefined : output),
    durationMs,
  };
}

/** Paseo's creation and dispatch tools carry typed card records. */
export function buildPaseoData(
  rawName: string,
  input: Record<string, unknown>,
  outputText: string | undefined,
  durationMs: number | undefined,
  status: string = "completed",
  output?: unknown,
): PaseoToolData | undefined {
  if (Object.keys(AGENT_OPERATIONS).includes(rawName)) return {
    id: `paseo-${rawName}`, tool: rawName as keyof typeof AGENT_OPERATIONS, durationMs,
    agentOperation: readAgentOperation(rawName as keyof typeof AGENT_OPERATIONS, input, output, outputText, status),
  };
  if (rawName in CATALOG_TOOLS) return {
    id: `paseo-${rawName}`, tool: rawName as CatalogTool, durationMs,
    catalog: readPaseoCatalog(rawName as CatalogTool, input, output, outputText),
  };
  if (rawName === "send_agent_prompt") return {
    id: `paseo-${rawName}`, tool: rawName, durationMs,
    sendAgentPrompt: readSendAgentPrompt(input, output, outputText, status),
  };
  if (rawName !== "create_agent") return undefined;
  const provider = asString(input.provider) ?? "agent";
  const [providerId, ...modelParts] = provider.split("/");
  const model = modelParts.join("/");
  const settings = asRecord(input.settings);
  const result = readPaseoResult(output, outputText);
  return {
    id: `paseo-${rawName}`,
    tool: "create_agent",
    durationMs,
    createAgent: {
      title: asString(input.title) ?? "New agent",
      provider: providerId ?? provider,
      model: asString(model) ?? asString(input.model),
      modeId: asString(settings?.modeId),
      thinkingOptionId: asString(settings?.thinkingOptionId),
      initialPrompt: asString(input.initialPrompt) ?? "",
      agentId: status === "failed" || status === "canceled" ? undefined :
        asString(result?.agentId) ?? outputText?.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0],
      status: status === "failed" ? "failed" : status === "running" ? "running" : status === "canceled" ? "canceled" : "created",
    },
  };
}

/** Extension to the language ids the highlighter and the devicons share. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  sass: "css",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
};

/**
 * The language a file is written in, read from its path.
 *
 * Nothing upstream reports this, so the callout used to carry no language at
 * all: the header fell back to a letter monogram and the code block assumed
 * TypeScript, which mislabels every Python or Rust read it renders.
 */
export function languageFromPath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const base = (filePath.toLowerCase().split(/[/\\]/).pop() ?? "").split(/[\s:?#]/)[0] ?? "";
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "docker";
  if (!base.includes(".")) return undefined;
  const ext = base.split(".").pop() ?? "";
  return LANGUAGE_BY_EXTENSION[ext];
}

/* ------------------------------------------------------------- tool view */

/** Every kind a callout knows: the shared set plus the protocol's newer details. */
export type ToolKind =
  | ToolCallKind
  | "search"
  | "fetch"
  | "worktree_setup"
  | "sub_agent"
  | "plan"
  | "plain_text"
  | "activity"
  | "unknown";

/** What the transformer hands the renderer for one `tool_call` item. */
export interface ToolCallPayload {
  agentMessage?: AgentMessage;
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
  /** The host's `metadata.approved`: the verdict on a plan. */
  approved?: boolean;
  questionData?: Record<string, unknown>;
  /** The few metadata fields a row reads: a task notification's task, status and output file. */
  metadata?: Record<string, unknown>;
}

export interface SearchToolData {
  query: string;
  /** `search`, `grep`, `glob`, `web_search`, or the raw tool name. */
  toolName?: string;
  /** As the tool reported them; absolute or relative. */
  files?: string[];
  numFiles?: number;
  numMatches?: number;
  content?: string;
  webResults?: Array<{ title: string; url: string }>;
  /** A web search's text summary, one markdown passage per entry. */
  annotations?: string[];
  truncated?: boolean;
}

export interface FetchToolData {
  url: string;
  prompt?: string;
  result?: string;
  code?: number;
  codeText?: string;
  bytes?: number;
}

export interface WorktreeSetupData {
  worktreePath: string;
  branchName: string;
  log: string;
  commands: Array<{
    index: number;
    command: string;
    cwd: string;
    log: string;
    status: string;
    exitCode: number | null;
    durationMs?: number;
  }>;
  truncated?: boolean;
}

export interface SubAgentToolData {
  subAgentType?: string;
  description?: string;
  /**
   * What the parent asked the sub-agent (Claude's Task/Agent `prompt`).
   * Absent when blank or only repeating the description, and from hosts
   * that do not send it.
   */
  prompt?: string;
  log: string;
  actions?: Array<{ index: number; toolName: string; summary?: string }>;
}

/**
 * The record a callout draws. A superset of the shared `ToolCalloutData`, so
 * the showcase's hand-written cards still type-check.
 */
export interface ToolCallView extends Omit<ToolCalloutData, "tool"> {
  agentStatus?: AgentStatusData;
  /** A tool with no card of its own, read into row words and body sections. */
  activity?: ActivityData;
  /** The reader turned the call down: not a failure, so it is drawn without the danger colour. */
  rejected?: boolean;
  questionData?: Record<string, unknown>;
  tool: ToolKind;
  /** The tool's own name as the host reported it ("Read", "mcp__x__y"). */
  name?: string;
  callId?: string;
  /** The host's error text for a failed call. */
  error?: string;
  /** Where a shell command ran. */
  cwd?: string;
  /** A read's window, as the call asked for it. */
  offset?: number;
  limit?: number;
  oldString?: string;
  newString?: string;
  /**
   * `diff` was built here from `oldString` and `newString` because the
   * provider sent none. Its rows carry no file line numbers.
   */
  diffFromText?: boolean;
  search?: SearchToolData;
  fetch?: FetchToolData;
  worktree?: WorktreeSetupData;
  subAgent?: SubAgentToolData;
  /** Body of a `plan` or `plain_text` call. */
  text?: string;
  /** A `plain_text` call's own label. */
  label?: string;
  /** A plan's verdict, once it has one; the host titles its plan card with it. */
  planOutcome?: "approved" | "rejected" | "canceled";
  /** The call's arguments, for `unknown` bodies and "copy arguments". */
  input?: unknown;
}

/** Detail kinds the protocol names outright; the name is never consulted for them. */
const PROTOCOL_KINDS: Record<string, ToolKind> = {
  search: "search",
  fetch: "fetch",
  worktree_setup: "worktree_setup",
  sub_agent: "sub_agent",
  plan: "plan",
  plain_text: "plain_text",
};

const PASEO_TOOLS = new Set([
  ...Object.keys(AGENT_OPERATIONS),
  ...Object.keys(CATALOG_TOOLS),
  "create_agent",
  "get_agent_activity",
  "send_agent_prompt",
  "get_agent_status",
]);

/** Names of search tools that arrive without a protocol `search` detail. */
const SEARCH_NAMES = new Set(["grep", "glob", "search", "web_search"]);

/** Output that is not text is shown as JSON, capped so a huge record stays cheap. */
const MAX_JSON = 20000;

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  return out.length > 0 ? out : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function stringifyValue(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value, null, 2);
    if (!json) return undefined;
    return json.length > MAX_JSON ? `${json.slice(0, MAX_JSON)}\n…` : json;
  } catch {
    return undefined;
  }
}

function readSearch(
  detail: Record<string, unknown>,
  input: Record<string, unknown>,
  rawName: string,
  outputText: string | undefined,
): SearchToolData {
  const webResults = Array.isArray(detail.webResults)
    ? detail.webResults.flatMap((entry) => {
        const row = asRecord(entry);
        const url = asString(row?.url);
        return url ? [{ title: asString(row?.title) ?? url, url }] : [];
      })
    : [];
  return {
    query:
      asString(detail.query) ??
      asString(input.pattern) ??
      asString(input.query) ??
      asString(input.glob) ??
      "",
    toolName: asString(detail.toolName) ?? (rawName || undefined),
    files: asStringArray(detail.filePaths),
    numFiles: asNumber(detail.numFiles),
    numMatches: asNumber(detail.numMatches),
    content: asString(detail.content) ?? outputText,
    webResults: webResults.length > 0 ? webResults : undefined,
    annotations: asStringArray(detail.annotations),
    truncated: detail.truncated === true ? true : undefined,
  };
}

function readWorktree(detail: Record<string, unknown>): WorktreeSetupData {
  const commands = Array.isArray(detail.commands)
    ? detail.commands.flatMap((entry, position) => {
        const row = asRecord(entry);
        const command = asString(row?.command);
        if (!row || !command) return [];
        return [
          {
            index: asNumber(row.index) ?? position,
            command,
            cwd: asString(row.cwd) ?? "",
            log: typeof row.log === "string" ? row.log : "",
            status: asString(row.status) ?? "completed",
            exitCode: asNumber(row.exitCode) ?? null,
            durationMs: asNumber(row.durationMs),
          },
        ];
      })
    : [];
  return {
    worktreePath: asString(detail.worktreePath) ?? "",
    branchName: asString(detail.branchName) ?? "",
    log: typeof detail.log === "string" ? detail.log : "",
    commands,
    truncated: detail.truncated === true ? true : undefined,
  };
}

function readSubAgent(detail: Record<string, unknown>): SubAgentToolData {
  const actions = Array.isArray(detail.actions)
    ? detail.actions.flatMap((entry, position) => {
        const row = asRecord(entry);
        const toolName = asString(row?.toolName);
        if (!row || !toolName) return [];
        return [{ index: asNumber(row.index) ?? position, toolName, summary: asString(row.summary) }];
      })
    : undefined;
  const description = asString(detail.description);
  const prompt = asString(detail.prompt);
  return {
    subAgentType: asString(detail.subAgentType),
    description,
    prompt: prompt?.trim() && prompt.trim() !== description?.trim() ? prompt : undefined,
    log: typeof detail.log === "string" ? detail.log : "",
    actions: actions && actions.length > 0 ? actions : undefined,
  };
}

/**
 * The host's error text. The transformer reads an `{ message }` object's
 * message (`tools/error-text.ts`); "[object Object]" can still arrive from an
 * item a previous plugin version transformed, and says nothing, so it is
 * dropped here.
 */
/** Claude's answer for a call the reader turned down: an instruction to the model, not news to the reader. */
const REJECTED = /^The user doesn't want to proceed with this tool use\. The tool use was rejected/;

/** What a rejected call says instead. */
export const REJECTED_TEXT = "You rejected this call.";

function readError(error: string | null | undefined): string | undefined {
  if (!error || error === "[object Object]") return undefined;
  if (REJECTED.test(error)) return REJECTED_TEXT;
  // Claude wraps a refused call's reason in a tag the reader has no use for.
  return error.replace(/^\s*<tool_use_error>([\s\S]*)<\/tool_use_error>\s*$/, "$1");
}

/**
 * `running`, `failed`, or `completed` for anything else the host reports. A
 * `canceled` call is drawn as finished, as the host draws it; a plan says so
 * through its `planOutcome`.
 */
export function normalizeStatus(status: string): ToolCallView["status"] {
  return status === "running" ? "running" : status === "failed" ? "failed" : "completed";
}

/** As the host reads it: a cancel outranks the verdict; a plan still pending has none. */
function readPlanOutcome(payload: ToolCallPayload): ToolCallView["planOutcome"] {
  if (payload.status === "canceled") return "canceled";
  if (payload.approved === false) return "rejected";
  if (payload.approved === true) return "approved";
  return undefined;
}

/**
 * The view for one tool call.
 *
 * Precedence: a GitHub device call; then a protocol detail kind that names
 * itself (search, fetch, worktree setup, sub-agent, plan, plain text); then a
 * git command; then read/write/edit and shell by detail type or name; then
 * the tools this plugin knows by name; and `unknown` for everything else —
 * never a terminal card for a call that ran no command.
 */
export function classifyTool(reported: ToolCallPayload): ToolCallView {
  const payload = normalizeForeignTool(reported);
  const rawName = (payload.name || "").toLowerCase();
  const detail = asRecord(payload.detail) ?? {};
  const detailType = typeof detail.type === "string" ? detail.type.toLowerCase() : "";
  const agentMessage = rawName === "agent_message" ? payload.agentMessage ?? senderlessAgentMessage(payload.detail) : undefined;
  const agentStatus = agentMessage ? readAgentMessage(agentMessage) : undefined;
  if (agentStatus) return {
    id: `live-${rawName}`, tool: "plain_text", name: payload.name, callId: payload.callId,
    title: agentStatus.title, status: agentStatus.status === "errored" ? "failed" : "completed",
    text: agentStatus.body, agentStatus,
  };
  const input = (asRecord(detail.input) ??
    asRecord(detail.arguments) ??
    asRecord(detail.args) ??
    {}) as Record<string, unknown>;
  const activity = readActivity({ name: payload.name, status: payload.status, detail, input, metadata: payload.metadata });
  if (activity) return {
    id: `live-${rawName}`, tool: "activity", name: payload.name, callId: payload.callId, title: activity.verb,
    status: activity.failed ? "failed" : normalizeStatus(payload.status),
    error: activity.error === null ? undefined : activity.error ?? readError(payload.error),
    activity,
  };
  const output = detail.output ?? detail.result ?? detail.content ?? "";

  // Universal path extraction across OMP, Paseo, Claude, and Codex formats
  const filePath: string | undefined =
    asString(detail.filePath) ||
    asString(input.path) ||
    asString(input.filePath) ||
    asString(input.file_path) ||
    asString(detail.path);

  // Universal command extraction
  const command: string | undefined =
    asString(detail.command) || asString(input.command) || asString(detail.input);

  // Universal code / file content extraction
  const code: string | undefined =
    asString(detail.content) ||
    (typeof output === "string" ? output || undefined : undefined) ||
    asString(input.content);

  // Universal diff extraction
  const diff: string | undefined =
    asString(detail.unifiedDiff) || asString(detail.diff) || extractStringProp(output, "diff");

  // A tool that answers with content blocks carries its prose in
  // `content[0].text`. That text is allowed to be empty — a `hub wait` job
  // snapshot puts everything in `details` and nothing in the text — so there
  // is deliberately no stringify fallback here: a card renders from its typed
  // record instead. Stringifying the envelope is what printed raw JSON.
  const outputText: string | undefined =
    typeof output === "string"
      ? output
      : extractStringProp(output, "stdout") ||
        extractStringProp(output, "text") ||
        (asRecord(output) ? extractContentText(output as Record<string, unknown>) : undefined);
  // A web search times itself in seconds; every row draws milliseconds.
  const durationSeconds = asNumber(detail.durationSeconds);
  const durationMs =
    asNumber(detail.durationMs) ??
    extractDetailsDuration(output) ??
    (durationSeconds !== undefined ? durationSeconds * 1000 : undefined);

  let toolKind: ToolKind = "unknown";
  let hub: HubData | undefined;
  let mcp: McpToolData | undefined;
  let paseo: PaseoToolData | undefined;
  let github: GitHubToolData | undefined;
  let title = payload.name || "tool";
  const extra: Partial<ToolCallView> = {};

  const isGitHubTool =
    rawName === "github" ||
    detailType === "github" ||
    filePath === "xd://github" ||
    filePath?.startsWith("xd://github/") === true;
  const isGitCommand =
    rawName === "git" || detailType === "git" || /^\s*git(?:\.exe)?(?:\s|$)/i.test(command ?? "");
  // Claude's Agent (once Task) call arrives as `unknown` while its input streams
  // and again as its launch answers, before the host names it a sub-agent; the
  // input already says which subtask it is. A row the host left at that stage
  // otherwise reads a bare "Agent" for good.
  const subAgentInput = detailType === "unknown" && (rawName === "agent" || rawName === "task") &&
    (asString(input.description) || asString(input.prompt)) ? input : undefined;
  const protocolKind = PROTOCOL_KINDS[detailType] ?? (subAgentInput ? "sub_agent" : undefined);
  const mcpName = readMcpName(rawName, detailType, detail.output);
  // Paseo's own tools arrive bare from OMP and under its MCP server elsewhere.
  const paseoTool = PASEO_TOOLS.has(rawName)
    ? rawName
    : mcpName && isPaseoServer(mcpName.server) && PASEO_TOOLS.has(mcpName.tool)
      ? mcpName.tool
      : undefined;

  if (isGitHubTool) {
    toolKind = "github";
    // A device call is a write: `content` is the request, and the tool's own
    // result text is the reply. They are read separately here because the
    // generic `code` extraction prefers whichever it finds first, which drew
    // the request twice and the answer never.
    // OMP itself reports the call as `plain_text`: the op in `label`, the
    // reply in `text`, and no request.
    if (detailType === "plain_text") {
      github = buildGitHubDataFromLabel(asString(detail.label), asString(detail.text));
    } else {
      const request = asString(input.content) ?? asString(detail.content);
      const reply = outputText && outputText !== request ? outputText : undefined;
      github = buildGitHubData(request, reply);
    }
    title = github ? [github.op, github.repo, github.subject].filter(Boolean).join(" ") : "GitHub";
  } else if (protocolKind) {
    toolKind = protocolKind;
    title = payload.name || protocolKind;
    if (protocolKind === "search") {
      extra.search = readSearch(detail, input, rawName, undefined);
    } else if (protocolKind === "fetch") {
      extra.fetch = {
        url: asString(detail.url) ?? asString(input.url) ?? "",
        prompt: asString(detail.prompt),
        result: asString(detail.result),
        code: asNumber(detail.code),
        codeText: asString(detail.codeText),
        bytes: asNumber(detail.bytes),
      };
    } else if (protocolKind === "worktree_setup") {
      extra.worktree = readWorktree(detail);
    } else if (protocolKind === "sub_agent") {
      extra.subAgent = readSubAgent(subAgentInput
        ? { subAgentType: subAgentInput.subagent_type, description: subAgentInput.description, prompt: subAgentInput.prompt }
        : detail);
    } else if (protocolKind === "plan") {
      extra.text = asString(detail.text);
      extra.planOutcome = readPlanOutcome(payload);
    } else {
      extra.text = asString(detail.text);
      extra.label = asString(detail.label);
    }
  } else if (isGitCommand) {
    toolKind = "git";
    title = command ? `$ ${command.trim().slice(0, 55)}` : "Git command";
  } else if (rawName === "read" || detailType === "read") {
    toolKind = "read";
    title = filePath ? `Read ${filePath.split(/[/\\]/).pop() || filePath}` : "Read file";
    extra.offset = asNumber(detail.offset) ?? asNumber(input.offset);
    extra.limit = asNumber(detail.limit) ?? asNumber(input.limit);
  } else if (rawName === "write" || detailType === "write") {
    toolKind = "write";
    title = filePath ? `Write ${filePath.split(/[/\\]/).pop() || filePath}` : "Write file";
  } else if (rawName === "edit" || detailType === "edit") {
    toolKind = "edit";
    title = filePath ? `Edit ${filePath.split(/[/\\]/).pop() || filePath}` : "Edit file";
    extra.oldString = asString(detail.oldString) ?? asString(input.old_string);
    extra.newString = asString(detail.newString) ?? asString(input.new_string);
    if (!diff && (extra.oldString || extra.newString)) {
      extra.diff = lineDiff(extra.oldString ?? "", extra.newString ?? "");
      extra.diffFromText = true;
    }
  } else if (rawName === "bash" || rawName === "shell" || detailType === "shell") {
    toolKind = rawName === "shell" || detailType === "shell" ? "shell" : "bash";
    title = command ? `$ ${command.trim().slice(0, 55)}` : "Execute command";
  } else if (rawName === "thinking") {
    toolKind = "thinking";
    title = "Reasoning Process";
  } else if (paseoTool) {
    toolKind = "paseo";
    title = `Paseo: ${paseoTool}`;
    const resultFailed = asRecord(output)?.isError === true;
    const callStatus = resultFailed ? "failed" : payload.status;
    paseo = buildPaseoData(paseoTool, input, outputText, durationMs, callStatus, output);
    if (callStatus === "failed" || paseo?.sendAgentPrompt?.state === "failed") {
      extra.status = "failed";
      extra.error = readError(payload.error) ?? outputText;
    }
  } else if (mcpName || rawName === "mcp") {
    const name = mcpName ?? { server: "mcp", tool: rawName };
    toolKind = "mcp";
    title = name.server === "mcp" ? name.tool : `${name.server} / ${name.tool}`;
    mcp = buildMcpData(name, input, output, durationMs);
  } else if (rawName === "hub") {
    toolKind = "hub";
    title = `Hub: ${String(input.op || "operation")}`;
    hub = buildHubData(input, outputText, output);
  } else if (SEARCH_NAMES.has(rawName)) {
    toolKind = "search";
    extra.search = readSearch(detail, input, rawName, outputText);
  }

  const exitCodeCandidate = asNumber(detail.exitCode) ?? asNumber(detail.code);
  const isShell = toolKind === "bash" || toolKind === "shell" || toolKind === "git";
  const unknownInput = detail.input !== undefined ? detail.input : asRecord(payload.detail);

  return {
    id: `live-${rawName}`,
    tool: toolKind,
    title,
    name: payload.name || undefined,
    callId: payload.callId,
    error: readError(payload.error),
    ...(readError(payload.error) === REJECTED_TEXT ? { rejected: true } : {}),
    status: normalizeStatus(payload.status),
    filePath,
    language: isShell ? "bash" : languageFromPath(filePath),
    command: isShell ? command : undefined,
    cwd: isShell ? asString(detail.cwd) ?? asString(input.cwd) : undefined,
    // A github card reads its typed record; leaving `code` and `output` set
    // would draw the request and the reply a second time. The newer kinds
    // carry their own typed records too.
    code: toolKind === "github" || protocolKind ? undefined : code,
    diff,
    output:
      toolKind === "github" || protocolKind
        ? undefined
        : toolKind === "unknown"
          ? (outputText ?? stringifyValue(output))
          : outputText,
    // The protocol's fetch reports an HTTP status in `code`, not an exit code.
    exitCode: toolKind === "fetch" ? undefined : exitCodeCandidate,
    durationMs,
    hub,
    mcp,
    paseo,
    github,
    input: toolKind === "unknown" ? unknownInput : Object.keys(input).length > 0 ? input : undefined,
    questionData: payload.questionData,
    ...extra,
  };
}
