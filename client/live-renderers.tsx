import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { buildThemeTokens } from "./components/theme-tokens";
import { ToolCallout } from "./components/tool-callouts";
import { ReasoningTrace } from "./components/reasoning-trace";
import { TaskList } from "./components/task-list";
import { UserMessage } from "./components/user-message";
import { hostFontEscape } from "./components/host-font-escape";
import type { TurnUsage } from "./components/user-message";
import { useEnhancerPreferences } from "./preferences";
import type {
  ToolCalloutData,
  ToolCallKind,
  ReasoningTraceData,
  TaskListData,
  TaskItemData,
  EvalCell,
  HubData,
  HubDaemonRow,
  McpToolData,
  PaseoToolData,
} from "../shared/contracts";
import { revealPathRpc } from "../shared/file-rpc";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

export interface LiveToolCallPayload {
  name: string;
  status: string;
  detail?: Record<string, unknown>;
  callId?: string;
  error?: string | null;
  phase?: string;
}

export interface LiveReasoningPayload {
  text: string;
  phase?: string;
}

export interface LiveTodoPayload {
  items: Array<Record<string, unknown>>;
  phase?: string;
}

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

const HUB_PROCESS_OPS = new Set(["start", "ps", "logs", "stop", "restart", "describe"]);
const HUB_JOB_OPS = new Set(["jobs", "cancel"]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Shapes one hub call for the callout.
 *
 * Every op answers with prose rather than a record, so the card carries the
 * arguments it was called with plus that text. Without this the body renders
 * nothing at all, which is what a bare `hub start` used to look like.
 */
/** `hub ps` answers with a typed roster beside its prose. */
function extractDaemons(output: unknown): HubDaemonRow[] | undefined {
  if (!output || typeof output !== "object") return undefined;
  const details = (output as Record<string, unknown>).details;
  if (!details || typeof details !== "object") return undefined;
  const rows = (details as Record<string, unknown>).daemons;
  if (!Array.isArray(rows) || rows.length === 0) return undefined;

  const parsed = rows.flatMap((entry): HubDaemonRow[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const name = asString(row.name);
    if (!name) return [];
    return [
      {
        name,
        state: asString(row.state) ?? "unknown",
        pid: typeof row.pid === "number" ? row.pid : undefined,
        restarts: typeof row.restartCount === "number" ? row.restartCount : undefined,
        readyMatch: asString(row.readyMatch),
        exitCode: typeof row.exitCode === "number" ? row.exitCode : undefined,
        startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
        exitedAt: typeof row.exitedAt === "number" ? row.exitedAt : undefined,
      },
    ];
  });
  return parsed.length > 0 ? parsed : undefined;
}

export function buildHubData(
  input: Record<string, unknown>,
  outputText: string | undefined,
  output?: unknown,
): HubData | undefined {
  const op = (asString(input.op) ?? "").toLowerCase();
  if (!op) return undefined;
  const name = asString(input.name);

  // `wait` addresses a process when it names one, and peers otherwise.
  if (HUB_PROCESS_OPS.has(op) || (op === "wait" && name)) {
    const daemons = extractDaemons(output);
    const logs = daemons
      ? undefined
      : outputText
        ? outputText
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .slice(-12)
        : undefined;
    return {
      kind: "process",
      data: {
        op: op as "start" | "ps" | "logs" | "stop" | "restart" | "describe" | "wait",
        name: name ?? "process",
        application: asString(input.application),
        args: Array.isArray(input.args) ? input.args.map((entry) => String(entry)) : undefined,
        port:
          typeof input.ready === "object" && input.ready
            ? typeof (input.ready as Record<string, unknown>).port === "number"
              ? ((input.ready as Record<string, unknown>).port as number)
              : undefined
            : undefined,
        readyLogPattern:
          typeof input.ready === "object" && input.ready
            ? asString((input.ready as Record<string, unknown>).log)
            : asString(input.pattern),
        status: /\bready\b/i.test(outputText ?? "")
          ? "ready"
          : /\bstopped\b|\bexited\b/i.test(outputText ?? "")
            ? "stopped"
            : /\bfailed\b/i.test(outputText ?? "")
              ? "failed"
              : op === "start"
                ? "starting"
                : "unknown",
        recentLogs: logs,
        daemons,
      },
    };
  }

  if (HUB_JOB_OPS.has(op)) {
    return {
      kind: "jobs",
      data: { op: op as "jobs" | "cancel", activeJobs: [], output: outputText },
    };
  }

  return {
    kind: "message",
    data: {
      op: (op === "send" || op === "wait" || op === "inbox" || op === "list" ? op : "list") as
        | "send"
        | "wait"
        | "inbox"
        | "list",
      to: asString(input.to),
      message: asString(input.message),
      delivered: /delivered/i.test(outputText ?? ""),
      replyTo: asString(input.replyTo),
      awaitReply: input.await === true,
      response: op === "send" && input.await === true ? outputText : undefined,
      output: op === "send" ? undefined : outputText,
    },
  };
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
    result: output === "" ? undefined : output,
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

export function LiveToolCallRenderer({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<LiveToolCallPayload>) {
  const revealPath = useRpc(revealPathRpc);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const data = item.data;

  const calloutData = useMemo((): ToolCalloutData => {
    const rawName = (data.name || "").toLowerCase();
    const detail = (data.detail && typeof data.detail === "object" ? data.detail : {}) as Record<
      string,
      unknown
    >;
    const detailType = typeof detail.type === "string" ? detail.type.toLowerCase() : "";
    const input = (
      detail.input && typeof detail.input === "object"
        ? detail.input
        : detail.arguments && typeof detail.arguments === "object"
          ? detail.arguments
          : detail.args && typeof detail.args === "object"
            ? detail.args
            : {}
    ) as Record<string, unknown>;
    const output = detail.output ?? detail.result ?? detail.content ?? "";

    // Universal path extraction across OMP, Paseo, Claude, and Codex formats
    const filePath: string | undefined =
      (typeof detail.filePath === "string" ? detail.filePath : undefined) ||
      (typeof input.path === "string" ? input.path : undefined) ||
      (typeof input.filePath === "string" ? input.filePath : undefined) ||
      (typeof detail.path === "string" ? detail.path : undefined);

    // Universal command extraction
    const command: string | undefined =
      (typeof detail.command === "string" ? detail.command : undefined) ||
      (typeof input.command === "string" ? input.command : undefined) ||
      (typeof detail.input === "string" ? detail.input : undefined);

    // Universal code / file content extraction
    const code: string | undefined =
      (typeof detail.content === "string" ? detail.content : undefined) ||
      (typeof output === "string" ? output : undefined) ||
      (typeof input.content === "string" ? input.content : undefined);

    // Universal diff extraction
    const diff: string | undefined =
      (typeof detail.unifiedDiff === "string" ? detail.unifiedDiff : undefined) ||
      (typeof detail.diff === "string" ? detail.diff : undefined) ||
      extractStringProp(output, "diff");

    // A tool that answers with content blocks carries its prose in
    // `content[0].text`. Stringifying the envelope instead put raw JSON on
    // screen, which is what every hub card used to show.
    const outputText: string | undefined =
      typeof output === "string"
        ? output
        : extractStringProp(output, "stdout") ||
          extractStringProp(output, "text") ||
          (output && typeof output === "object"
            ? extractContentText(output as Record<string, unknown>)
            : undefined) ||
          (typeof output === "object" && output ? JSON.stringify(output) : undefined);
    const durationMs =
      typeof detail.durationMs === "number" ? detail.durationMs : extractEvalDuration(output);
    let toolKind: ToolCallKind = "bash";
    let hub: HubData | undefined;
    let mcp: McpToolData | undefined;
    let paseo: PaseoToolData | undefined;
    let evalCells: EvalCell[] = [];
    let askOptions: AskOption[] = [];
    let askAnswer: string[] = [];
    let title = data.name || "tool";

    const isGitHubTool =
      rawName === "github" ||
      detailType === "github" ||
      filePath === "xd://github" ||
      filePath?.startsWith("xd://github/") === true;
    const isGitCommand =
      rawName === "git" || detailType === "git" || /^\s*git(?:\.exe)?(?:\s|$)/i.test(command ?? "");

    if (isGitHubTool) {
      toolKind = "github";
      title = "GitHub";
    } else if (isGitCommand) {
      toolKind = "git";
      title = command ? `$ ${command.trim().slice(0, 55)}` : "Git command";
    } else if (rawName === "read" || detailType === "read") {
      toolKind = "read";
      title = filePath ? `Read ${filePath.split(/[/\\]/).pop() || filePath}` : "Read file";
    } else if (rawName === "write" || detailType === "write") {
      toolKind = "write";
      title = filePath ? `Write ${filePath.split(/[/\\]/).pop() || filePath}` : "Write file";
    } else if (rawName === "edit" || detailType === "edit") {
      toolKind = "edit";
      title = filePath ? `Edit ${filePath.split(/[/\\]/).pop() || filePath}` : "Edit file";
    } else if (rawName === "bash" || rawName === "shell" || detailType === "shell") {
      toolKind = rawName === "shell" || detailType === "shell" ? "shell" : "bash";
      title = command ? `$ ${command.trim().slice(0, 55)}` : "Execute command";
    } else if (rawName === "thinking") {
      toolKind = "thinking";
      title = "Reasoning Process";
    } else if (
      rawName === "create_agent" ||
      rawName === "list_providers" ||
      rawName === "list_models" ||
      rawName === "get_agent_activity" ||
      rawName === "send_agent_prompt" ||
      rawName === "get_agent_status"
    ) {
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
    }

    const exitCodeCandidate =
      typeof detail.exitCode === "number"
        ? detail.exitCode
        : typeof detail.code === "number"
          ? detail.code
          : undefined;

    return {
      id: `live-${rawName}`,
      tool: toolKind,
      title,
      status:
        data.status === "running" ? "running" : data.status === "failed" ? "failed" : "completed",
      filePath,
      language:
        toolKind === "bash" || toolKind === "shell" || toolKind === "git"
          ? "bash"
          : languageFromPath(filePath),
      command,
      code,
      diff,
      output: evalCells.length > 0 ? undefined : outputText,
      cells: evalCells.length > 0 ? evalCells : undefined,
      askOptions: askOptions.length > 0 ? askOptions : undefined,
      askAnswer: askAnswer.length > 0 ? askAnswer : undefined,
      exitCode: exitCodeCandidate,
      durationMs,
      hub,
      mcp,
      paseo,
    };
  }, [data]);

  // Collapse completed tools by default; expand active or failed tools
  const isExpanded = data.status === "running" || data.status === "failed";

  // The daemon side owns the shell, so revealing a file is one RPC. A path the
  // daemon cannot stat answers with an error the press simply ignores.
  const handleRevealPath = useCallback(
    (path: string) => {
      void revealPath({ cwd: cwd ?? "", path }).catch(() => {});
    },
    [cwd, revealPath],
  );

  return (
    <View {...hostFontEscape}>
      <ToolCallout
        data={calloutData}
        tokens={tokens}
        defaultExpanded={isExpanded}
        onRevealPath={handleRevealPath}
      />
    </View>
  );
}

export function LiveReasoningRenderer({
  item,
  theme,
}: PluginTimelineItemProps<LiveReasoningPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const data = item.data;
  // The host owns the reveal cadence, so streamed reasoning animates the same
  // way it does in the native timeline instead of appearing in whole blocks.
  const revealed = useRevealedText(
    data.text || "",
    data.phase === "streaming" ? "streaming" : "complete",
  );

  const reasoningData: ReasoningTraceData = useMemo(() => {
    const rawText = revealed;
    // Split into paragraphs or steps if separated
    const paragraphs = rawText.split("\n\n").filter(Boolean);
    // No fabricated title: slicing the first 60 characters of the body cut
    // words in half and then repeated the same text underneath.
    // The final paragraph is the one still being written, so it reads as
    // active while streaming. That is what advances the timeline rail one
    // tick at a time instead of lighting the whole thing up at once.
    const streaming = data.phase === "streaming";
    const steps = paragraphs.map((p, idx) => ({
      id: `live-step-${idx}`,
      number: idx + 1,
      status:
        streaming && idx === paragraphs.length - 1 ? ("active" as const) : ("completed" as const),
      content: p,
    }));

    return {
      id: "live-reasoning",
      agentModel: "",
      durationMs: 0,
      totalTokens: Math.round(rawText.length / 4),
      status: data.phase === "streaming" ? "thinking" : "completed",
      steps:
        steps.length > 0
          ? steps
          : [
              {
                id: "step-1",
                number: 1,
                title: "Thought Process",
                status: "completed" as const,
                content: rawText,
              },
            ],
    };
  }, [data, revealed]);

  return (
    <View {...hostFontEscape}>
      <ReasoningTrace
        data={reasoningData}
        tokens={tokens}
        defaultExpanded={data.phase === "streaming"}
      />
    </View>
  );
}

export function LiveTodoRenderer({ item, theme }: PluginTimelineItemProps<LiveTodoPayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const data = item.data;

  const taskListData: TaskListData = useMemo(() => {
    const tasks: TaskItemData[] = (data.items || []).map((task, idx) => ({
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      title: typeof task.text === "string" ? task.text : "Untitled task",
      phase: "Execution",
      status:
        task.completed === true
          ? "completed"
          : task.status === "in_progress"
            ? "in_progress"
            : "pending",
    }));

    return {
      id: "live-todo",
      phaseName: "Checklist Progress",
      tasks,
    };
  }, [data]);

  return (
    <View {...hostFontEscape}>
      <TaskList data={taskListData} tokens={tokens} />
    </View>
  );
}

export interface LiveUserMessagePayload {
  text: string;
  images?: string[];
}

/**
 * Usage is reported on the agent, not on the timeline item, so it is read from
 * the live agent handle while the turn runs and frozen once the agent leaves
 * `running`. A turn this client never observed live has no recoverable usage,
 * so its footer is omitted rather than filled with the current session total.
 */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function LiveUserMessageRenderer({
  item,
  theme,
  agentId,
  timestamp,
}: PluginTimelineItemProps<LiveUserMessagePayload>) {
  const preferences = useEnhancerPreferences();
  const tokens = useMemo(
    () => buildThemeTokens(theme.colors, preferences),
    [theme.colors, preferences],
  );
  const paseo = usePaseo();
  const handle = useMemo(() => paseo.agents.ref(agentId), [paseo, agentId]);

  // Decided once, on mount: a replayed turn must not borrow later figures.
  const observedLive = useMemo(
    () => Date.now() - timestamp.getTime() < LIVE_WINDOW_MS,
    [timestamp],
  );

  const snapshot = useAgent(agentId, (agent) => ({
    status: agent.status,
    updatedAt: agent.updatedAt,
  }));
  const running = snapshot?.status === "running";

  const [usage, setUsage] = useState<TurnUsage | null>(null);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    if (!observedLive || frozen) return;
    let cancelled = false;
    handle
      .refresh()
      .then((result) => {
        if (cancelled || !result) return;
        const next = result.agent.lastUsage;
        if (next) setUsage(next);
        // The turn has settled, so this reading is final.
        if (next && !running) setFrozen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handle, observedLive, frozen, running, snapshot?.updatedAt]);

  return (
    <View {...hostFontEscape}>
      <UserMessage
        text={item.data.text}
        images={item.data.images}
        timestamp={timestamp}
        tokens={tokens}
        usage={observedLive ? usage : null}
        pending={running && !frozen}
      />
    </View>
  );
}
