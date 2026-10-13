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
  EvalCell,
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

function extractStringProp(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const val = Reflect.get(obj, key);
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

/** The eval result nests its cells under `details`, not under the call input. */
interface RawEvalCell {
  title?: unknown;
  code?: unknown;
  language?: unknown;
  output?: unknown;
}

/**
 * Eval reports the source it ran and the text that source printed. Both live
 * inside the result payload, so reading only the top level yields a JSON blob
 * where the cell should be.
 */
export function extractEvalCells(
  detail: Record<string, unknown>,
  input: Record<string, unknown>,
  output: unknown,
): EvalCell[] {
  const container =
    output && typeof output === "object" ? (output as Record<string, unknown>) : detail;
  const details =
    container.details && typeof container.details === "object"
      ? (container.details as Record<string, unknown>)
      : {};
  const fallbackLanguage =
    typeof details.language === "string"
      ? details.language
      : typeof input.language === "string"
        ? input.language
        : "js";

  const raw = Array.isArray(details.cells) ? (details.cells as RawEvalCell[]) : [];
  const cells = raw
    .map((cell): EvalCell | null => {
      const code = typeof cell.code === "string" ? cell.code : "";
      if (!code) return null;
      return {
        title: typeof cell.title === "string" ? cell.title : undefined,
        code,
        language: normalizeKernel(
          typeof cell.language === "string" ? cell.language : fallbackLanguage,
        ),
        output: typeof cell.output === "string" ? cell.output : undefined,
      };
    })
    .filter((cell): cell is EvalCell => cell !== null);

  if (cells.length > 0) return cells;

  // A provider that does not nest still supplies the source on the call input.
  const code = typeof input.code === "string" ? input.code : "";
  if (!code) return [];
  return [
    {
      title: typeof input.title === "string" ? input.title : undefined,
      code,
      language: normalizeKernel(fallbackLanguage),
      output: extractContentText(container),
    },
  ];
}

/** Kernel ids are short; the highlighter names dialects in full. */
function normalizeKernel(language: string): string {
  const id = language.toLowerCase();
  if (id === "py" || id === "python") return "python";
  return "typescript";
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

/** Eval times the whole run and reports it beside the cells. */
export function extractEvalDuration(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const details = (output as Record<string, unknown>).details;

  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>).durationMs;
  return typeof value === "number" ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One `task` call spawns a batch, so the card reads the call's own arguments:
 * the shared `context` and the `tasks` array. The result text only confirms
 * the ids, and it is absent while the call is still running, which is exactly
 * when the reader most wants to see what was sent.
 */
export function buildSubagentBatch(input: Record<string, unknown>): ToolCalloutData["subagent"] {
  const entries = Array.isArray(input.tasks) ? input.tasks : [];
  const agents = entries.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const brief = asString(row.task);
    if (!brief) return [];
    return [
      {
        name: asString(row.name) ?? `agent ${index + 1}`,
        agentType: asString(row.agent) ?? "task",
        task: brief,
      },
    ];
  });
  if (agents.length === 0) return undefined;
  const context = asString(input.context);
  return context ? { context, agents } : { agents };
}

/** Splits `mcp__server__tool` and keeps the call's own arguments and result. */
export function buildMcpData(
  rawName: string,
  input: Record<string, unknown>,
  output: unknown,
  durationMs: number | undefined,
): McpToolData {
  const parts = rawName.replace(/^mcp__/, "").split("__");
  return {
    server: parts.length > 1 ? (parts[0] ?? "mcp") : "mcp",
    tool: parts.length > 1 ? parts.slice(1).join(" / ") : (parts[0] ?? rawName),
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

/** Paseo's own agent tools. Only `create_agent` carries a record worth a card. */
export function buildPaseoData(
  rawName: string,
  input: Record<string, unknown>,
  outputText: string | undefined,
  durationMs: number | undefined,
): PaseoToolData | undefined {
  if (rawName !== "create_agent") return undefined;
  const provider = asString(input.provider) ?? "agent";
  const [providerId, model] = provider.split("/");
  return {
    id: `paseo-${rawName}`,
    tool: "create_agent",
    durationMs,
    createAgent: {
      title: asString(input.title) ?? "New agent",
      provider: providerId ?? provider,
      model: model ?? asString(input.model),
      initialPrompt: asString(input.initialPrompt) ?? "",
      agentId: outputText?.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0],
      status: "created",
    },
  };
}

interface AskOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

/**
 * The ask tool nests its prompt under `questions`, so reading `input.question`
 * finds nothing and the options never reach the callout.
 */
export function extractAskQuestion(input: Record<string, unknown>): {
  question: string;
  options: AskOption[];
} | null {
  const raw = Array.isArray(input.questions)
    ? (input.questions[0] as Record<string, unknown> | undefined)
    : typeof input.question === "string"
      ? input
      : undefined;
  if (!raw) return null;

  const question = typeof raw.question === "string" ? raw.question : "";
  const recommended = typeof raw.recommended === "number" ? raw.recommended : undefined;
  const options = Array.isArray(raw.options)
    ? raw.options.flatMap((entry, index): AskOption[] => {
        if (!entry || typeof entry !== "object") return [];
        const option = entry as Record<string, unknown>;
        const label = typeof option.label === "string" ? option.label : "";
        if (!label) return [];
        return [
          {
            id: typeof option.id === "string" ? option.id : `opt-${index}`,
            label,
            description: typeof option.description === "string" ? option.description : undefined,
            recommended: index === recommended,
          },
        ];
      })
    : [];

  if (!question && options.length === 0) return null;
  return { question, options };
}

/**
 * The chosen answer is reported as prose, so the prefix is stripped and the
 * remainder kept verbatim — it may be a typed reply rather than a label.
 */
export function extractAskAnswer(text?: string): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/^user\s+(?:selected|answered|chose)\s*:?\s*/i);
  const answer = match ? trimmed.slice(match[0].length).trim() : trimmed;
  return answer.length > 0 ? answer : undefined;
}

/**
 * The selected option labels.
 *
 * The ask result nests its answer, so reading the top level yields the whole
 * JSON object where the choice should be. `details.selectedOptions` is the
 * authoritative list and covers multi-select; the prose line is the fallback
 * for a host that does not report it. A typed reply arrives here too, and
 * matches no option label, which is exactly how free text should behave.
 */
export function extractAskSelections(output: unknown, outputText?: string): string[] {
  const container =
    output && typeof output === "object" ? (output as Record<string, unknown>) : undefined;

  const details = container?.details;
  if (details && typeof details === "object") {
    const selected = (details as Record<string, unknown>).selectedOptions;
    if (Array.isArray(selected)) {
      const labels = selected.filter(
        (entry): entry is string => typeof entry === "string" && entry.length > 0,
      );
      if (labels.length > 0) return labels;
    }
  }

  const prose = container ? extractContentText(container) : outputText;
  const single = extractAskAnswer(prose);
  return single ? [single] : [];
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
  | "unknown";

/** What the transformer hands the renderer for one `tool_call` item. */
export interface ToolCallPayload {
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
  /** The host's `metadata.approved`: the verdict on a plan. */
  approved?: boolean;
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
  askQuestion?: string;
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
  "create_agent",
  "list_providers",
  "list_models",
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
function readError(error: string | null | undefined): string | undefined {
  if (!error || error === "[object Object]") return undefined;
  return error;
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
export function classifyTool(payload: ToolCallPayload): ToolCallView {
  const rawName = (payload.name || "").toLowerCase();
  const detail = asRecord(payload.detail) ?? {};
  const detailType = typeof detail.type === "string" ? detail.type.toLowerCase() : "";
  const input = (asRecord(detail.input) ??
    asRecord(detail.arguments) ??
    asRecord(detail.args) ??
    {}) as Record<string, unknown>;
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
  const durationMs = asNumber(detail.durationMs) ?? extractEvalDuration(output);

  let toolKind: ToolKind = "unknown";
  let hub: HubData | undefined;
  let mcp: McpToolData | undefined;
  let subagent: ToolCalloutData["subagent"];
  let paseo: PaseoToolData | undefined;
  let github: GitHubToolData | undefined;
  let evalCells: EvalCell[] = [];
  let askOptions: AskOption[] = [];
  let askAnswer: string[] = [];
  let askQuestion: string | undefined;
  let title = payload.name || "tool";
  const extra: Partial<ToolCallView> = {};

  const isGitHubTool =
    rawName === "github" ||
    detailType === "github" ||
    filePath === "xd://github" ||
    filePath?.startsWith("xd://github/") === true;
  const isGitCommand =
    rawName === "git" || detailType === "git" || /^\s*git(?:\.exe)?(?:\s|$)/i.test(command ?? "");
  const protocolKind = PROTOCOL_KINDS[detailType];

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
      extra.subAgent = readSubAgent(detail);
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
  } else if (PASEO_TOOLS.has(rawName)) {
    toolKind = "paseo";
    title = `Paseo: ${rawName}`;
    paseo = buildPaseoData(rawName, input, outputText, durationMs);
  } else if (rawName.startsWith("mcp__") || rawName === "mcp") {
    toolKind = "mcp";
    title = rawName.replace(/^mcp__/, "").replace(/__/g, " / ");
    mcp = buildMcpData(rawName, input, output, durationMs);
  } else if (rawName === "ask") {
    toolKind = "ask";
    const asked = extractAskQuestion(input);
    title = asked?.question || "User Decision";
    askQuestion = asked?.question || undefined;
    askOptions = asked?.options ?? [];
    askAnswer = extractAskSelections(output, outputText);
  } else if (rawName === "hub") {
    toolKind = "hub";
    title = `Hub: ${String(input.op || "operation")}`;
    hub = buildHubData(input, outputText, output);
  } else if (rawName === "eval") {
    toolKind = "eval";
    evalCells = extractEvalCells(detail, input, output);
    const cellTitle = evalCells.find((cell) => cell.title)?.title;
    title = cellTitle ? `Eval: ${cellTitle}` : "Eval Kernel";
  } else if (rawName === "task") {
    toolKind = "task";
    subagent = buildSubagentBatch(input);
    const count = subagent?.agents.length ?? 0;
    title = count === 1 ? (subagent?.agents[0]?.name ?? "Subagent") : `${count || "No"} subagents`;
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
      toolKind === "github" || evalCells.length > 0 || protocolKind
        ? undefined
        : toolKind === "unknown"
          ? (outputText ?? stringifyValue(output))
          : outputText,
    cells: evalCells.length > 0 ? evalCells : undefined,
    askQuestion,
    askOptions: askOptions.length > 0 ? askOptions : undefined,
    askAnswer: askAnswer.length > 0 ? askAnswer : undefined,
    // The protocol's fetch reports an HTTP status in `code`, not an exit code.
    exitCode: toolKind === "fetch" ? undefined : exitCodeCandidate,
    durationMs,
    hub,
    subagent,
    mcp,
    paseo,
    github,
    input: toolKind === "unknown" ? unknownInput : Object.keys(input).length > 0 ? input : undefined,
    ...extra,
  };
}
