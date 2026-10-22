/**
 * Rows for tools that have no card of their own and do not fit one: a
 * provider's housekeeping (Claude's task notifications, a skill launch, a
 * scheduled wakeup), a terminal it types into, a computer-use step. Each
 * reader turns one tool's input and output into the row's words and a few
 * body sections, so one renderer draws them all.
 *
 * Pure: no React, no host hooks.
 */
import { mcpServiceIcon } from "./mcp-service-icon";
import { readTaskNotification } from "./task-notification";

export interface ActivitySection {
  /** A small heading above the section. */
  label?: string;
  text: string;
  /** Prose as markdown, code in the code face, or a file path. */
  format: "markdown" | "code" | "path";
  /** The code's language, for highlighting. */
  language?: string;
}

export interface ActivityData {
  verb: string;
  target?: string;
  /** `target` is a file path. */
  targetIsPath?: boolean;
  meta: string[];
  /** A lucide name for the settled row. */
  icon: string;
  /** A failure the call's status does not carry. */
  failed?: boolean;
  /** The settled icon in the success colour: a background task that finished. */
  success?: boolean;
  /** The failure to show in place of the host's, or null when the row already says it. */
  error?: string | null;
  sections: ActivitySection[];
}

export interface ActivityInput {
  name: string;
  status: string;
  detail: Record<string, unknown>;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstLine(value: string | undefined): string | undefined {
  return value?.split("\n").map((line) => line.trim()).find(Boolean);
}

/** `ab12cd34`: enough of an ID to tell two apart. */
function shortId(id: string): string {
  const bare = id.replace(/^call-/, "");
  return bare.length > 8 ? bare.slice(0, 8) : bare;
}

function plural(count: number, word: string, words = `${word}s`): string {
  return `${count} ${count === 1 ? word : words}`;
}

/** `20m`, `1h 30m`, `45s`. */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${minutes / 60}h`;
}

/** The text of an MCP-style answer: a string, or its first text block. */
function contentText(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  const content = record(output)?.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    const value = text(record(block)?.text);
    if (value) return value;
  }
  return undefined;
}

function section(label: string | undefined, value: string | undefined, format: ActivitySection["format"],
  language?: string): ActivitySection[] {
  return value?.trim() ? [{ ...(label ? { label } : {}), text: value, format, ...(language ? { language } : {}) }] : [];
}

/* ------------------------------------------------------------------ Claude */

/** The names of the tools Claude loaded, as it calls them (`mcp__cua-driver__list_windows`). */
function readToolReferences(output: unknown): string[] | undefined {
  const list = record(output)?.output;
  if (!Array.isArray(list) || !list.length) return undefined;
  const names = list.map((entry) => text(record(entry)?.tool_name)).filter((name): name is string => Boolean(name));
  return names.length === list.length ? names : undefined;
}

/** The tools a `select:` query names, before its answer lands. */
function readSelectedTools(query: string | undefined): string[] | undefined {
  const names = query?.startsWith("select:") ? query.slice(7).split(",").map((name) => name.trim()).filter(Boolean) : [];
  return names.length ? names : undefined;
}

/** `mcp__cua-driver__list_windows` reads `cua-driver / list_windows`. */
const toolLabel = (name: string) => name.startsWith("mcp__") ? name.slice(5).split("__").join(" / ") : name;

/** The service icon every loaded tool shares (all Linear's draw Linear's mark), else the wrench. */
function toolsIcon(names: string[]): string {
  const icons = new Set(names.map((name) => {
    if (!name.startsWith("mcp__")) return undefined;
    const [server = "", ...tool] = name.slice(5).split("__");
    return mcpServiceIcon(server, tool.join("__"));
  }));
  const [icon] = icons;
  return icons.size === 1 && icon ? icon : "Wrench";
}

function loadTools(names: string[], query?: string): ActivityData {
  const labels = names.map(toolLabel);
  return {
    verb: "Load tools", target: labels.join(", "), meta: names.length > 1 ? [plural(names.length, "tool")] : [],
    icon: toolsIcon(names),
    sections: [...section("Tools", labels.map((name) => `- ${name}`).join("\n"), "markdown"),
      ...(query && !query.startsWith("select:") ? section("Query", query, "code") : [])],
  };
}

function readClaude({ name, status, detail, input }: ActivityInput): ActivityData | undefined {
  const output = detail.output;
  switch (name) {
    case "ToolSearch": {
      const names = readToolReferences(output);
      const query = text(input.query);
      if (names) return loadTools(names, query);
      const selected = readSelectedTools(query);
      return { verb: "Search tools", target: query?.replace(/^select:/, ""), meta: [],
        icon: selected ? toolsIcon(selected) : "Wrench", sections: [] };
    }
    case "tool": {
      // An unnamed call: Claude's tool loading, or a call the reader turned down.
      const names = readToolReferences(output);
      return names ? loadTools(names) : undefined;
    }
    case "Skill": {
      const skill = text(detail.label) ?? text(input.skill) ?? text(input.command);
      return { verb: "Skill", target: skill, meta: [], icon: "Sparkles", sections: [] };
    }
    case "SendMessage": {
      const to = text(input.to) ?? text(input.recipient);
      const message = text(input.message) ?? text(input.content);
      const result = record(record(output)?.output);
      const meta = [to ? `to ${shortId(to)}` : undefined, result?.resumedAgentId ? "resumed" : undefined]
        .filter((entry): entry is string => Boolean(entry));
      return {
        verb: status === "running" ? "Sending message" : "Sent message",
        target: text(input.summary) ?? firstLine(message), meta, icon: "Send",
        sections: section(undefined, message, "markdown"),
      };
    }
    case "ScheduleWakeup": {
      const delay = typeof input.delaySeconds === "number" ? input.delaySeconds : undefined;
      const at = /scheduled for (\d{1,2}:\d{2})/.exec(contentText(record(output)?.output) ?? "")?.[1];
      return {
        verb: delay !== undefined ? `Wake up in ${formatSeconds(delay)}` : "Wake up",
        target: text(input.reason) ?? firstLine(text(input.prompt)), meta: at ? [`at ${at}`] : [], icon: "AlarmClock",
        sections: section("Prompt", text(input.prompt), "markdown"),
      };
    }
    case "CronCreate": {
      const cron = text(input.cron);
      return {
        verb: "Schedule", target: firstLine(text(input.prompt)),
        meta: [cron, input.recurring === false ? "once" : input.recurring === true ? "recurring" : undefined]
          .filter((entry): entry is string => Boolean(entry)),
        icon: "CalendarClock", sections: section("Prompt", text(input.prompt), "markdown"),
      };
    }
    case "ListAgents": {
      const listing = contentText(record(output)?.output) ?? contentText(output);
      const peers = /Peer sessions \((\d+)\)/.exec(listing ?? "")?.[1];
      const self = /^This session is (\S+)/.exec(listing ?? "")?.[1];
      return {
        verb: "List sessions", target: peers ? `${peers} peer session${peers === "1" ? "" : "s"}` : undefined,
        meta: self ? [`this is ${self}`] : [], icon: "Users", sections: section(undefined, listing, "code"),
      };
    }
    case "TaskStop": {
      const id = text(input.task_id) ?? text(input.shell_id);
      return { verb: "Stop task", target: id, meta: [], icon: "CircleStop", sections: [] };
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------- Codex */

/** Keys typed into a terminal, each newline shown as the Return it was. */
function typedKeys(keys: string): string {
  return keys.replace(/\r?\n/g, " ⏎ ").replace(/\s+/g, " ").trim();
}

function readCodex({ name, status, detail, input }: ActivityInput): ActivityData | undefined {
  if (name === "terminal" && detail.type === "plain_text") {
    const command = text(detail.label);
    const keys = typeof detail.text === "string" ? detail.text : "";
    // An empty write is Codex polling the session for output.
    return {
      verb: keys ? "Terminal input" : "Terminal", target: command, meta: keys ? [typedKeys(keys)] : [],
      icon: "SquareTerminal", sections: section("Command", command && command.length > 80 ? command : undefined, "code", "bash"),
    };
  }
  if (name === "cua_repl.js" || name === "cua_repl") {
    const output = contentText(detail.output);
    return {
      verb: "Computer use", target: text(input.title) ?? firstLine(text(input.code)), meta: [], icon: "MousePointerClick",
      // A failed step answers with why; the host's own error only says "Tool call failed".
      ...(status === "failed" && output ? { error: output } : {}),
      sections: [...section("Script", text(input.code), "code", "javascript"),
        ...(status === "failed" ? [] : section("Result", output, "code"))],
    };
  }
  return undefined;
}

/* -------------------------------------------------------------------- Grok */

interface GrokTask {
  task_id?: string;
  command?: string;
  status?: string;
  exit_code?: number | null;
  duration_secs?: number;
  output?: string;
  output_file?: string;
}

/** `[subagent:general-purpose] Third send caller args` is a subtask, not a command. */
function grokTaskSubject(command: string | undefined): { subject?: string; subtask: boolean } {
  const match = /^\[subagent:[^\]]*\]\s*(.*)$/s.exec(command ?? "");
  return match ? { subject: match[1], subtask: true } : { subject: command, subtask: false };
}

function grokTaskMeta(task: GrokTask): string[] {
  const meta: string[] = [];
  if (task.status && task.status !== "completed") meta.push(task.status);
  if (typeof task.exit_code === "number") meta.push(`exit ${task.exit_code}`);
  if (typeof task.duration_secs === "number") meta.push(formatSeconds(task.duration_secs));
  return meta;
}

function readGrokTodos(raw: string): ActivityData | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return undefined; }
  const todos = record(record(parsed)?.TodosUpdated)?.todos;
  if (!Array.isArray(todos)) return undefined;
  const items = todos.map(record).filter((todo): todo is Record<string, unknown> => Boolean(todo));
  const done = items.filter((todo) => todo.status === "completed").length;
  const current = items.find((todo) => todo.status === "in_progress");
  const list = items.map((todo) => `- [${todo.status === "completed" ? "x" : " "}] ${text(todo.content) ?? ""}` +
    (todo.status === "in_progress" ? " *(in progress)*" : "")).join("\n");
  return {
    verb: "Plan", target: text(current?.content), meta: [`${done}/${items.length} done`], icon: "ListTodo",
    sections: section(undefined, list, "markdown"),
  };
}

function readGrokToolSearch(label: string, raw: string | undefined): ActivityData | undefined {
  const query = /^Search tools:\s*"(.*)"$/s.exec(label)?.[1];
  if (query === undefined) return undefined;
  let found: string[] = [];
  try {
    const results = record(JSON.parse(raw ?? ""))?.results;
    if (Array.isArray(results)) {
      found = results.flatMap((server) => {
        const tools = record(server)?.tools;
        return Array.isArray(tools) ? tools.map((tool) => {
          const entry = record(tool);
          const name = text(entry?.tool_name) ?? "";
          const description = firstLine(text(entry?.description));
          return `- \`${name}\`${description ? ` ${description}` : ""}`;
        }) : [];
      });
    }
  } catch { /* An answer that is not JSON still names the query. */ }
  return {
    verb: "Search tools", target: query, meta: found.length ? [plural(found.length, "tool")] : [], icon: "Wrench",
    sections: section(undefined, found.join("\n"), "markdown"),
  };
}

function readGrok({ detail, input }: ActivityInput): ActivityData | undefined {
  const output = record(detail.output);
  switch (input.variant) {
    case "TaskOutput": {
      const single = record(output?.Result) as GrokTask | undefined;
      const many = record(output?.MultiResult);
      const tasks = (single ? [single] : Array.isArray(many?.results) ? many.results.map(record) : [])
        .filter((task): task is Record<string, unknown> => Boolean(task)) as GrokTask[];
      if (tasks.length !== 1) {
        const running = tasks.filter((task) => task.status === "running").length;
        return {
          verb: "Wait for tasks", target: tasks.map((task) => grokTaskSubject(task.command).subject).filter(Boolean).join(", "),
          meta: [plural(tasks.length, "task"), ...(running ? [`${running} running`] : [])], icon: "Hourglass",
          sections: tasks.flatMap((task) => section(grokTaskSubject(task.command).subject, task.output, "code")),
        };
      }
      const task = tasks[0]!;
      const { subject, subtask } = grokTaskSubject(task.command);
      return {
        verb: subtask ? "Subtask output" : "Task output", target: subject, meta: grokTaskMeta(task),
        icon: subtask ? "Workflow" : "SquareTerminal", failed: task.status === "failed" ||
          (typeof task.exit_code === "number" && task.exit_code !== 0),
        sections: [...section(undefined, task.output, "code"), ...section("Log", task.output_file, "path")],
      };
    }
    case "KillTask": {
      const result = record(output?.Result);
      const outcome = text(result?.outcome)?.replace(/_/g, " ");
      const id = text(input.task_id) ?? text(result?.task_id);
      return { verb: "Stop task", target: id ? shortId(id) : undefined, meta: outcome ? [outcome] : [], icon: "CircleStop",
        sections: [] };
    }
    case "Monitor": {
      const timeout = typeof input.timeout_ms === "number" ? input.timeout_ms / 1000 : undefined;
      return {
        verb: "Monitor", target: text(input.description) ?? text(input.command),
        meta: timeout ? [`up to ${formatSeconds(timeout)}`] : [], icon: "Activity",
        sections: section("Command", text(input.command), "code", "bash"),
      };
    }
    case "ListDir": {
      const listing = text(record(output?.Content)?.content);
      const entries = listing ? listing.split("\n").length - 1 : 0;
      return {
        verb: "List", target: text(input.target_directory), targetIsPath: true,
        meta: entries > 0 ? [plural(entries, "entry", "entries")] : [], icon: "FolderOpen",
        sections: section(undefined, listing, "code"),
      };
    }
  }
  const label = text(detail.label);
  const body = typeof detail.text === "string" ? detail.text : undefined;
  if (detail.type === "plain_text" && label === "Updating plan" && body) return readGrokTodos(body);
  if (detail.type === "plain_text" && label) {
    const search = readGrokToolSearch(label, body);
    if (search) return search;
    if (body?.startsWith("Subagent started in background.")) {
      return { verb: "Started subtask", target: label, meta: ["background"], icon: "Workflow", sections: [] };
    }
  }
  return undefined;
}

/* ---------------------------------------------------------------- OpenCode */

function readOpenCode({ name, status, detail, input }: ActivityInput): ActivityData | undefined {
  const output = contentText(detail.output);
  if (name === "execute" && text(input.code)) {
    return {
      verb: "Run code", target: firstLine(text(input.code)), meta: [], icon: "Braces",
      sections: [...section("Script", text(input.code), "code", "javascript"),
        ...section(status === "failed" ? "Error" : "Result", output, "code")],
    };
  }
  if (name === "skill" && text(input.id)) {
    return { verb: "Skill", target: text(input.id), meta: [], icon: "Sparkles", sections: [] };
  }
  return undefined;
}

/* ------------------------------------------------------------- Antigravity */

const ANTIGRAVITY_VERBS: Record<string, string> = {
  read_file: "Read", write_file: "Write", manage_task: "Task", list_dir: "List", view_file: "Read",
};

function readAntigravity({ name, detail, input }: ActivityInput): ActivityData | undefined {
  // Antigravity names every call `other`, or `think` for its task tools; what it did is in the label.
  if (name !== "other" && name !== "think") return undefined;
  const label = text(detail.label);
  if (detail.type === "plain_text" && label && /^[a-z]+(?:_[a-z]+)+$/.test(label)) {
    const body = typeof detail.text === "string" ? detail.text : undefined;
    // A short answer ("59 lines, 5446 bytes") is the row's meta; a long one its body.
    const short = body && !body.includes("\n") && body.length <= 60 ? body : undefined;
    const verb = ANTIGRAVITY_VERBS[label] ?? label.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
    return {
      verb, target: short ? undefined : firstLine(body), meta: short ? [short] : [], icon: "Wrench",
      sections: short ? [] : section(undefined, body, "code"),
    };
  }
  const path = text(input.Path);
  if (detail.type === "unknown" && path && Object.keys(input).length === 1) {
    return { verb: "File", target: path, targetIsPath: true, meta: [], icon: "FileText", sections: [] };
  }
  return undefined;
}

/* ------------------------------------------------------------- compaction */

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tokens`;
  if (count >= 1000) return `${Math.round(count / 1000)}K tokens`;
  return `${count} tokens`;
}

function readCompaction({ status, detail }: ActivityInput): ActivityData {
  const before = typeof detail.preTokens === "number" ? detail.preTokens : undefined;
  return {
    verb: status === "running" ? "Compacting context" : "Compacted context", meta: [
      ...(detail.trigger === "manual" ? ["manual"] : []),
      ...(before ? [`from ${formatTokens(before)}`] : []),
    ],
    icon: "FoldVertical", sections: [],
  };
}

/** The row for a call this module knows, or undefined for any other. */
export function readActivity(call: ActivityInput): ActivityData | undefined {
  if (call.name === "compaction" && call.detail.type === "compaction") return readCompaction(call);
  if (call.name === "task_notification") return readTaskNotification(call);
  return readClaude(call) ?? readCodex(call) ?? readGrok(call) ?? readOpenCode(call) ?? readAntigravity(call);
}
