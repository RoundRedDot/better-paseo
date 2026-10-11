import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useAgent, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useThemeTokens } from "./components/theme-tokens";
import { ToolCallout } from "./components/tool-callouts";
import { ReasoningCard } from "./components/reasoning-trace";
import { createReasoningSegmenter } from "./reasoning/segment";
import { useReasoningKey } from "./reasoning/key";
import { observeReasoning, observedDurationMs } from "./reasoning/observed";
import { useDisclosure } from "./state/disclosure-store";
import { TaskList } from "./components/task-list";
import { UserMessage } from "./components/user-message";
import { hostFontEscape } from "./components/host-font-escape";
import { promptRowAnchor } from "./components/prompt-anchor";
import { surfaceProps } from "./components/view-props";
import { useSelectionActions } from "./components/selection-actions";
import { usePointerGlow } from "./components/glow";
import type { TurnUsage } from "./components/user-message";
import { NoticeCallout } from "./components/notice-callout";
import { useEnhancerPreferences } from "./preferences";
import { buildHubData } from "./hub-details";
import { publishHubSnapshot } from "./hub-activity";
import { MarkdownView } from "./components/markdown/markdown-view";
import { TimelineTailHub } from "./components/hub-live";
import { AssistantFooter } from "./components/turn-footer";
import { SystemCard } from "./components/system-card";
import { parseSystemEnvelope } from "./system-envelope";
import { useIsTimelineTail } from "./timeline-tail";
import type {
  ToolCalloutData,
  ToolCallKind,
  TaskListData,
  TaskItemData,
  EvalCell,
  HubData,
  McpToolData,
  NoticeCalloutData,
  PaseoToolData,
  GitHubToolData,
} from "../shared/contracts";
import { revealPathRpc } from "../shared/file-rpc";
import { buildGitHubData } from "./github-request";
import { useImageFile } from "./image-file";
import { probeCard, textItemKey } from "./debug/perf";
import {
  assistantPropsEqual,
  noticePropsEqual,
  reasoningPropsEqual,
  todoPropsEqual,
  toolPropsEqual,
  userMessagePropsEqual,
} from "./state/render-equality";

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

export interface LiveNoticePayload {
  level: string;
  message: string;
  fatal?: boolean;
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
    // `{"content":[{"type":"text",…}]}` in the response panel, so the prose is
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

function LiveToolCallRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveToolCallPayload>) {
  const probe = probeCard(
    "tool_call",
    item.data.callId ?? item.data.name,
    item.data.phase === undefined ? null : item.data.phase === "streaming",
  );
  const revealPath = useRpc(revealPathRpc);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
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
    // `content[0].text`. That text is allowed to be empty — a `hub wait` job
    // snapshot puts everything in `details` and nothing in the text — so there
    // is deliberately no stringify fallback here: a card renders from its typed
    // record instead. Stringifying the envelope is what printed raw JSON.
    const outputText: string | undefined =
      typeof output === "string"
        ? output
        : extractStringProp(output, "stdout") ||
          extractStringProp(output, "text") ||
          (output && typeof output === "object"
            ? extractContentText(output as Record<string, unknown>)
            : undefined);
    const durationMs =
      typeof detail.durationMs === "number" ? detail.durationMs : extractEvalDuration(output);
    let toolKind: ToolCallKind = "bash";
    let hub: HubData | undefined;
    let mcp: McpToolData | undefined;
    let subagent: ToolCalloutData["subagent"];
    let paseo: PaseoToolData | undefined;
    let github: GitHubToolData | undefined;
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
      // A device call is a write: `content` is the request, and the tool's own
      // result text is the reply. They are read separately here because the
      // generic `code` extraction prefers whichever it finds first, which drew
      // the request twice and the answer never.
      const request = asString(input.content) ?? asString(detail.content);
      const reply = outputText && outputText !== request ? outputText : undefined;
      github = buildGitHubData(request, reply);
      title = github
        ? [github.op, github.repo, github.subject].filter(Boolean).join(" ")
        : "GitHub";
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
    } else if (rawName === "task") {
      toolKind = "task";
      subagent = buildSubagentBatch(input);
      const count = subagent?.agents.length ?? 0;
      title =
        count === 1 ? (subagent?.agents[0]?.name ?? "Subagent") : `${count || "No"} subagents`;
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
      // A github card reads its typed record; leaving `code` and `output` set
      // would draw the request and the reply a second time.
      code: toolKind === "github" ? undefined : code,
      diff,
      output: toolKind === "github" || evalCells.length > 0 ? undefined : outputText,
      cells: evalCells.length > 0 ? evalCells : undefined,
      askOptions: askOptions.length > 0 ? askOptions : undefined,
      askAnswer: askAnswer.length > 0 ? askAnswer : undefined,
      exitCode: exitCodeCandidate,
      durationMs,
      hub,
      subagent,
      mcp,
      paseo,
      github,
    };
  }, [data]);

  // The dock has no access to the job manager, so the timeline is its only
  // source: every job snapshot that passes through a card is republished, and
  // the store drops the agent's entry once a snapshot reports nothing running.
  const hubData = calloutData.hub;
  useEffect(() => {
    if (!hubData || hubData.kind !== "jobs") return;
    publishHubSnapshot(agentId, {
      at: timestamp.getTime(),
      running: hubData.data.jobs.filter((job) => job.status === "running"),
      agents: hubData.data.agents ?? [],
    });
  }, [hubData, agentId]);

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

  // Only a read or write of an image asks the daemon for bytes; the hook
  // itself refuses every other path, so a code read costs no RPC.
  const imageFile = useImageFile(
    calloutData.tool === "read" || calloutData.tool === "write" ? calloutData.filePath : undefined,
    cwd,
  );

  return (
    <View {...hostFontEscape} {...probe.viewProps}>
      {probe.node}
      <ToolCallout
        data={calloutData}
        tokens={tokens}
        defaultExpanded={isExpanded}
        onRevealPath={handleRevealPath}
        imageFile={imageFile}
      />
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={`tool:${data.callId ?? calloutData.title}:${timestamp.getTime()}`}
        at={timestamp.getTime()}
        kind="tool"
      />
    </View>
  );
}

function LiveReasoningRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveReasoningPayload>) {
  const probe = probeCard(
    "reasoning",
    textItemKey("reasoning", item.data.text),
    item.data.phase === undefined ? null : item.data.phase === "streaming",
  );
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  const text = item.data.text || "";
  const streaming = item.data.phase === "streaming";

  // Collapsed by default, streaming or not (plan §3.4 item 3); the reader's
  // choice survives the remount into history through the disclosure store.
  const storeKey = useReasoningKey(agentId, text);
  const [expanded, setExpanded] = useDisclosure(storeKey, false);
  const toggle = useCallback(() => setExpanded(!expanded), [expanded, setExpanded]);

  // The host's reveal runs a frame loop only for "streaming". A collapsed card
  // shows one line, so it takes the text whole and renders once per chunk.
  const revealed = useRevealedText(text, expanded && streaming ? "streaming" : "complete");

  const [segmenter] = useState(createReasoningSegmenter);
  const segmentation = useMemo(
    () => segmenter.update(revealed, { streaming }),
    [segmenter, revealed, streaming],
  );

  // Duration only from what this client saw stream (see reasoning/observed.ts).
  observeReasoning(storeKey, streaming, timestamp.getTime());
  const durationMs = streaming ? null : observedDurationMs(storeKey);

  return (
    <View {...hostFontEscape} {...probe.viewProps}>
      {probe.node}
      <ReasoningCard
        segmentation={segmentation}
        streaming={streaming}
        durationMs={durationMs}
        expanded={expanded}
        onToggle={toggle}
        tokens={tokens}
        compact={layout.compact}
        storeKey={storeKey}
        copyText={text}
      />
    </View>
  );
}

function LiveTodoRendererBody({
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveTodoPayload>) {
  const probe = probeCard("todo", String(timestamp.getTime()), item.data.phase === "streaming");
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
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
    <View {...hostFontEscape} {...probe.viewProps}>
      {probe.node}
      <TaskList data={taskListData} tokens={tokens} />
    </View>
  );
}

export interface LiveAssistantPayload {
  text: string;
}

/**
 * The assistant's own reply, drawn with the plugin's markdown renderer.
 *
 * The host's renderer carries a pipeline this plugin cannot import — mermaid,
 * images, its own file-path links — so `assistantMarkdown` exists to hand the
 * turn back when a reply needs any of that.
 */
function LiveAssistantRendererBody({
  agentId,
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveAssistantPayload>) {
  const probe = probeCard("assistant", textItemKey("assistant", item.data.text));
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);

  // Replacing the reply costs the host's footer, which the stream layout hangs
  // off an `assistant_message` item that no longer exists. Rebuild it where the
  // host puts it: under the newest message, once, not under every reply.
  const itemKey = `assistant:${timestamp.getTime()}`;
  const isTail = useIsTimelineTail(itemKey);

  // Job results, IRC relays and reminders arrive as replies because the host
  // files any unclaimed `custom` message under this item kind. They are not
  // the model's words, so they are drawn as a card, not as prose.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);

  return (
    <View {...hostFontEscape} {...probe.viewProps}>
      {probe.node}
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} />
      ) : (
        <MarkdownView
          text={item.data.text}
          tokens={tokens}
          variant={preferences.markdownVariant}
          probeId={itemKey}
        />
      )}
      {isTail && !envelope ? (
        <AssistantFooter text={item.data.text} at={timestamp} tokens={tokens} />
      ) : null}
      <TimelineTailHub
        agentId={agentId}
        tokens={tokens}
        itemKey={itemKey}
        at={timestamp.getTime()}
        kind="reply"
      />
    </View>
  );
}

/**
 * The host draws a `notification` or `error` item as bare text with an icon,
 * which reads as a different product beside the plugin's callouts. Both carry
 * only a level and a message, so the card is a badge plus that message.
 */
function LiveNoticeRendererBody({
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<LiveNoticePayload>) {
  const probe = probeCard("notice", String(timestamp.getTime()));
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
  const data = item.data;
  const level = data.level === "warning" || data.level === "error" ? data.level : "info";

  const noticeData: NoticeCalloutData = useMemo(
    () => ({
      id: `notice-${data.message.length}-${level}`,
      level,
      message: data.message,
      ...(data.fatal ? { fatal: true } : {}),
    }),
    [data.message, data.fatal, level],
  );

  return (
    <View {...hostFontEscape} {...probe.viewProps}>
      {probe.node}
      <NoticeCallout data={noticeData} tokens={tokens} />
    </View>
  );
}

export interface LiveUserMessagePayload {
  text: string;
  images?: string[];
  /** The host's own id for this message, when the provider gave one. */
  messageId?: string;
}

/**
 * Usage is reported on the agent, not on the timeline item, so it is read from
 * the live agent handle while the turn runs and frozen once the agent leaves
 * `running`. A turn this client never observed live has no recoverable usage,
 * so its footer is omitted rather than filled with the current session total.
 */
const LIVE_WINDOW_MS = 5 * 60 * 1000;

function LiveUserMessageRendererBody({
  item,
  theme,
  layout,
  agentId,
  timestamp,
}: PluginTimelineItemProps<LiveUserMessagePayload>) {
  const probe = probeCard("user_message", item.data.messageId ?? String(timestamp.getTime()));
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  useSelectionActions(tokens, preferences.selectionActions);
  usePointerGlow(preferences.pointerGlow);
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

  // The same envelopes reach this item kind on some hosts and on history
  // replay. A job result is not something the user said, so it never takes the
  // user bubble.
  const envelope = useMemo(() => parseSystemEnvelope(item.data.text), [item.data.text]);

  return (
    <View
      {...surfaceProps(hostFontEscape, promptRowAnchor(item.data.messageId))}
      {...probe.viewProps}
    >
      {probe.node}
      {envelope ? (
        <SystemCard envelope={envelope} tokens={tokens} />
      ) : (
        <UserMessage
          text={item.data.text}
          images={item.data.images}
          timestamp={timestamp}
          tokens={tokens}
          usage={observedLive ? usage : null}
          pending={running && !frozen}
        />
      )}
    </View>
  );
}

// The registered renderers, behind semantic memo (plan §3.2): Paseo 0.11.2
// gives every row a fresh theme and data object on every streamed chunk, so
// reference equality never holds. See `state/render-equality.ts` for what
// each comparator treats as "unchanged".
//
// Each export is a plain function around its memoised body: the host's
// `addTimelineRenderer` requires `typeof Component === "function"` and
// rejects the object `memo` returns, which drops every contribution in
// `contribute`. The wrapper renders one element; the body bails out.
const ToolCallMemo = memo(LiveToolCallRendererBody, toolPropsEqual);
const ReasoningMemo = memo(LiveReasoningRendererBody, reasoningPropsEqual);
const TodoMemo = memo(LiveTodoRendererBody, todoPropsEqual);
const AssistantMemo = memo(LiveAssistantRendererBody, assistantPropsEqual);
const NoticeMemo = memo(LiveNoticeRendererBody, noticePropsEqual);
const UserMessageMemo = memo(LiveUserMessageRendererBody, userMessagePropsEqual);

export function LiveToolCallRenderer(props: PluginTimelineItemProps<LiveToolCallPayload>) {
  return <ToolCallMemo {...props} />;
}

export function LiveReasoningRenderer(props: PluginTimelineItemProps<LiveReasoningPayload>) {
  return <ReasoningMemo {...props} />;
}

export function LiveTodoRenderer(props: PluginTimelineItemProps<LiveTodoPayload>) {
  return <TodoMemo {...props} />;
}

export function LiveAssistantRenderer(props: PluginTimelineItemProps<LiveAssistantPayload>) {
  return <AssistantMemo {...props} />;
}

export function LiveNoticeRenderer(props: PluginTimelineItemProps<LiveNoticePayload>) {
  return <NoticeMemo {...props} />;
}

export function LiveUserMessageRenderer(props: PluginTimelineItemProps<LiveUserMessagePayload>) {
  return <UserMessageMemo {...props} />;
}
