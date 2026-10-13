/**
 * One-line tool summaries (plan §3.3 item 3, BC-01).
 *
 * `summarizeTool(view)` is what a collapsed tool row says:
 *
 *   Read · src/a.ts · L10–80
 *   Bash · npm test · exit 0 · 1.2s
 *   Search · "useAgent" · 8 files · 23 matches
 *
 * `verb` and `target` lead the row, `meta` sits right-aligned and muted. A
 * target that is a file path is flagged so the row draws it with `PathText`
 * (relative to the workspace); `metaPath` is a path drawn as meta (a shell's
 * cwd, a worktree's directory).
 *
 * Pure and table-tested (`test/unit/tool-summarize.test.ts`).
 */
import { stripAnsi } from "../copy/content";
import type { ToolCallView } from "./classify";

export interface ToolSummary {
  verb: string;
  target?: string;
  /** `target` is a file path: draw it with `PathText`. */
  targetIsPath?: boolean;
  meta: string[];
  /** A path shown among the meta (shell cwd, worktree directory). */
  metaPath?: string;
  /** `danger` for a failure, a non-zero exit, or an HTTP error. */
  tone: "default" | "danger";
  /** The first line of a failure, drawn under the header. */
  errorLine?: string;
}

/** Longest target kept before the header's own middle truncation. */
const TARGET_MAX = 160;
const VERB_MAX = 40;

/* ------------------------------------------------------------ formatting */

/** `820ms`, `1.2s`, `2m 5s`. */
export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** `512 B`, `1.5 KB`, `12 KB`, `3.4 MB`. */
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)} ${units[unit]}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The line window a read asked for, as `L10–80`. `offset` is the first line
 * (1-based; 0 means the start), `limit` the number of lines. Null when the
 * call read the whole file.
 */
export function lineRangeLabel(offset?: number, limit?: number): string | undefined {
  const hasOffset = offset !== undefined && offset > 0;
  const hasLimit = limit !== undefined && limit > 0;
  if (!hasOffset && !hasLimit) return undefined;
  const start = hasOffset ? Math.floor(offset) : 1;
  if (!hasLimit) return `L${start}+`;
  return `L${start}–${start + Math.floor(limit) - 1}`;
}

/** Lines in a text, not counting a trailing newline. */
export function countLines(text: string | undefined): number {
  if (!text) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

/**
 * Added and removed lines of a unified diff; file headers are not counted.
 * A diff built from an edit's text has none, so there a `--- x` row is a
 * removed `-- x` line.
 */
export function countDiff(diff: string, fileHeaders = true): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (fileHeaders && (line.startsWith("+++") || line.startsWith("---"))) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

/** First non-empty line, trimmed; with `…` when more followed. */
export function firstLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? "").trim();
    if (!line) continue;
    const more = lines.slice(index + 1).some((rest) => rest.trim() !== "");
    return more ? `${line} …` : line;
  }
  return undefined;
}

function lastLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = stripAnsi(text).split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = (lines[index] ?? "").trim();
    if (line) return line;
  }
  return undefined;
}

function clip(text: string | undefined, max: number): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The host of an http(s) URL, without credentials; the input when it is not one. */
export function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  if (!match) return url.trim();
  const authority = match[1] ?? "";
  const at = authority.lastIndexOf("@");
  return at >= 0 ? authority.slice(at + 1) : authority;
}

/* -------------------------------------------------------------------- git */

/** Shell-style words, honouring single and double quotes. */
function splitWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n") {
      if (started) words.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) words.push(current);
  return words;
}

/** Global options that take a value: `git -C dir status`. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/**
 * What a git command did, for the header: `commit · <subject>`,
 * `push → origin/main`, or the subcommand and its arguments.
 */
export function describeGitCommand(command: string): string {
  const head = command.split("\n")[0] ?? "";
  // Only the first command of a chain: `git add . && git commit` reads as add.
  const words = splitWords(head.split(/\s(?:&&|\|\||;|\|)\s/)[0] ?? head);
  let index = words[0] && /^git(?:\.exe)?$/i.test(words[0]) ? 1 : 0;
  while (index < words.length && (words[index] ?? "").startsWith("-")) {
    const option = words[index] ?? "";
    index += GIT_VALUE_OPTIONS.has(option) ? 2 : 1;
  }
  const sub = words[index];
  if (!sub) return head.trim();
  const args = words.slice(index + 1);

  if (sub === "commit") {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] ?? "";
      if (arg === "-m" || arg === "--message") return withSubject(sub, args[i + 1]);
      if (arg.startsWith("--message=")) return withSubject(sub, arg.slice("--message=".length));
      if (/^-[a-zA-Z]*m$/.test(arg)) return withSubject(sub, args[i + 1]);
    }
    return sub;
  }
  if (sub === "push" || sub === "pull" || sub === "fetch") {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    if (positional.length === 0) return sub;
    const [remote, ...refs] = positional;
    return refs.length > 0 ? `${sub} → ${remote}/${refs.join(" ")}` : `${sub} → ${remote}`;
  }
  return [sub, ...args].join(" ");
}

function withSubject(sub: string, message: string | undefined): string {
  const subject = message ? (message.split("\n")[0] ?? "").trim() : "";
  return subject ? `${sub} · ${subject}` : sub;
}

/* -------------------------------------------------------------- arguments */

/** Arguments that best name what a call acted on, in preference order. */
const KEY_ARGUMENTS = [
  "query",
  "path",
  "file_path",
  "filePath",
  "url",
  "pattern",
  "command",
  "name",
  "title",
  "id",
  "agentId",
  "prompt",
];

/** The argument a header shows for a call it has no typed shape for. */
export function keyArgument(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return typeof input === "string" ? firstLine(input) : undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of KEY_ARGUMENTS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return firstLine(value);
  }
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim() && value.length <= 120) return firstLine(value);
  }
  return undefined;
}

/* ---------------------------------------------------------------- summary */

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function base(view: ToolCallView): { meta: string[]; tone: ToolSummary["tone"] } {
  return { meta: [], tone: view.status === "failed" ? "danger" : "default" };
}

function errorLineFor(view: ToolCallView): string | undefined {
  if (view.status !== "failed") return undefined;
  return (
    firstLine(view.error ? stripAnsi(view.error) : undefined)?.replace(/ \u2026$/, "") ??
    lastLine(view.output) ??
    (view.exitCode !== undefined ? `Exited with code ${view.exitCode}` : "The tool call failed.")
  );
}

function pushDuration(meta: string[], view: ToolCallView): void {
  const duration = formatDuration(view.durationMs);
  if (duration) meta.push(duration);
}

function summarizeKind(view: ToolCallView): ToolSummary {
  const { meta, tone } = base(view);
  const settled = view.status !== "running";

  switch (view.tool) {
    case "read": {
      const range = lineRangeLabel(view.offset, view.limit) ?? view.lineRange;
      if (range) meta.push(range);
      return path("Read", view, meta, tone);
    }
    case "write": {
      const lines = countLines(view.code);
      if (lines > 0) meta.push(plural(lines, "line"));
      return path("Write", view, meta, tone);
    }
    case "edit": {
      if (view.diff) {
        const { added, removed } = countDiff(view.diff, !view.diffFromText);
        meta.push(`+${added} −${removed}`);
      }
      return path("Edit", view, meta, tone);
    }
    case "bash":
    case "shell": {
      const command = view.shell?.command ?? view.command;
      const exitCode = view.shell?.exitCode ?? view.exitCode;
      let danger = tone === "danger";
      if (settled && exitCode !== undefined) {
        meta.push(`exit ${exitCode}`);
        if (exitCode !== 0) danger = true;
      }
      pushDuration(meta, view);
      const verb = view.tool === "bash" || (view.name ?? "").toLowerCase() === "bash" ? "Bash" : "Shell";
      return {
        verb,
        target: clip(firstLine(command) ?? view.title.replace(/^\$\s*/, ""), TARGET_MAX),
        meta,
        metaPath: view.shell?.cwd ?? view.cwd,
        tone: danger ? "danger" : "default",
      };
    }
    case "git": {
      const command = view.shell?.command ?? view.command;
      let danger = tone === "danger";
      if (settled && view.exitCode !== undefined && view.exitCode !== 0) {
        meta.push(`exit ${view.exitCode}`);
        danger = true;
      }
      pushDuration(meta, view);
      return {
        verb: "Git",
        target: clip(command ? describeGitCommand(command) : view.title.replace(/^\$\s*/, ""), TARGET_MAX),
        meta,
        metaPath: view.cwd,
        tone: danger ? "danger" : "default",
      };
    }
    case "search": {
      const search = view.search;
      const files = search?.numFiles ?? search?.files?.length;
      if (files !== undefined) meta.push(plural(files, "file"));
      if (search?.numMatches !== undefined) meta.push(plural(search.numMatches, "match", "matches"));
      if (files === undefined && search?.webResults) meta.push(plural(search.webResults.length, "result"));
      pushDuration(meta, view);
      return {
        verb: search?.toolName === "web_search" ? "Web search" : "Search",
        target: search?.query ? clip(`"${search.query}"`, TARGET_MAX) : undefined,
        meta,
        tone,
      };
    }
    case "fetch": {
      const fetch = view.fetch;
      let danger = tone === "danger";
      if (fetch?.code !== undefined) {
        meta.push(String(fetch.code));
        if (fetch.code >= 400) danger = true;
      }
      const size = formatBytes(fetch?.bytes);
      if (size) meta.push(size);
      pushDuration(meta, view);
      return {
        verb: "Fetch",
        target: fetch?.url ? hostOf(fetch.url) : undefined,
        meta,
        tone: danger ? "danger" : "default",
      };
    }
    case "mcp": {
      const server = view.mcp?.server ?? "mcp";
      const tool = view.mcp?.tool ?? view.title;
      pushDuration(meta, view);
      return {
        verb: clip(`${server} / ${tool}`, VERB_MAX) ?? server,
        target: clip(keyArgument(view.mcp?.arguments ?? view.input), TARGET_MAX),
        meta,
        tone,
      };
    }
    case "paseo": {
      const paseo = view.paseo;
      // The title carries the bare name; `name` may still be `mcp__paseo__…`.
      const tool = paseo?.tool ?? (view.title.replace(/^Paseo:\s*/, "") || view.name);
      const target =
        paseo?.createAgent?.title ??
        (paseo?.models ? paseo.models.provider : undefined) ??
        (paseo?.activity ? paseo.activity.agentId : undefined) ??
        keyArgument(view.input);
      pushDuration(meta, view);
      return { verb: clip(`paseo / ${tool}`, VERB_MAX) ?? "paseo", target: clip(target, TARGET_MAX), meta, tone };
    }
    case "hub": {
      const op = view.input && typeof view.input === "object" ? (view.input as Record<string, unknown>).op : undefined;
      return {
        verb: "Hub",
        target: typeof op === "string" && op ? op : view.title.replace(/^Hub:\s*/, "") || undefined,
        meta,
        tone,
      };
    }
    case "github":
      return {
        verb: "GitHub",
        target: clip(
          view.github ? [view.github.op, view.github.repo, view.github.subject].filter(Boolean).join(" ") : view.title,
          TARGET_MAX,
        ),
        meta,
        tone,
      };
    case "thinking":
      return {
        verb: "Thinking",
        target: clip(firstLine(view.thinking?.text ?? view.code ?? view.output), TARGET_MAX),
        meta,
        tone,
      };
    case "plan":
      // A verdict is no failure: a rejected or canceled plan keeps the quiet tone.
      if (view.planOutcome) meta.push(view.planOutcome);
      return { verb: "Plan", target: clip(firstLine(stripHeading(view.text)), TARGET_MAX), meta, tone };
    case "plain_text":
      return {
        verb: clip(view.label, VERB_MAX) ?? (capitalize(view.name ?? "") || "Text"),
        target: clip(firstLine(view.text), TARGET_MAX),
        meta,
        tone,
      };
    case "worktree_setup": {
      const worktree = view.worktree;
      const commands = worktree?.commands ?? [];
      const failed = commands.some((command) => command.status === "failed");
      if (commands.length > 0) meta.push(plural(commands.length, "command"));
      return {
        verb: "Worktree",
        target: clip(worktree?.branchName || undefined, TARGET_MAX),
        meta,
        metaPath: worktree?.worktreePath || undefined,
        tone: failed ? "danger" : tone,
      };
    }
    case "sub_agent": {
      const agent = view.subAgent;
      const actions = agent?.actions?.length ?? 0;
      if (actions > 0) meta.push(plural(actions, "action"));
      return {
        verb: clip(agent?.subAgentType ? capitalize(agent.subAgentType) : "Agent", VERB_MAX) ?? "Agent",
        target: clip(firstLine(agent?.description), TARGET_MAX),
        meta,
        tone,
      };
    }
    default: {
      pushDuration(meta, view);
      return {
        verb: clip(view.name, VERB_MAX) ?? clip(view.title, VERB_MAX) ?? "Tool",
        target: clip(keyArgument(view.input), TARGET_MAX),
        meta,
        tone,
      };
    }
  }
}

function stripHeading(text: string | undefined): string | undefined {
  return text?.replace(/^\s*#+\s*/, "");
}

function path(verb: string, view: ToolCallView, meta: string[], tone: ToolSummary["tone"]): ToolSummary {
  return view.filePath
    ? { verb, target: view.filePath, targetIsPath: true, meta, tone }
    : { verb, meta, tone };
}

export function summarizeTool(view: ToolCallView): ToolSummary {
  const summary = summarizeKind(view);
  const errorLine = errorLineFor(view);
  if (!errorLine) return summary;
  // A failed background task's summary is its label, text and error at once:
  // a line that only repeats what the row already says is not drawn again.
  const shown = summary.target ?? summary.verb;
  if (errorLine.trim() === shown.trim()) return { ...summary, tone: "danger" };
  return { ...summary, tone: "danger", errorLine };
}
