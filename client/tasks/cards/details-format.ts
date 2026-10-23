import type { TasksLanguage } from "../i18n";
import type { StatusKind, TaskCard, TaskChild } from "../model";
import { cardStart, cardTimer, formatEnded } from "./card-time";
import { contextRatio, formatDuration } from "./format";
import { cardStrings } from "./strings";

/** What the details cards (`detail-cards.tsx`) show, as pure functions for the tests. */

/** At most this many subtasks are listed, the most urgent after sorting; the rest open on demand. */
export const SUBTASK_ROWS = 10;

/** A wide (CJK) character takes about two Latin ones. */
function charWidth(char: string): number {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1;
}

function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** The middle of `text` cut to `budget` columns: 40% of the head and 60% of the tail around "…"; whole when it fits. */
function middle(text: string, budget: number): string {
  if (textWidth(text) <= budget) return text;
  const chars = [...text];
  const room = Math.max(2, budget - 1);
  const head = Math.floor(room * 0.4);
  const tail = room - head;
  return `${chars.slice(0, head).join("")}…${chars.slice(chars.length - tail).join("")}`;
}

/** A path's segments, each with its "/" but the last. */
function pathPieces(path: string): string[] {
  const parts = path.split("/");
  return parts.map((part, index) => (index < parts.length - 1 ? `${part}/` : part));
}

/** A run of text cut after each "-", the "-" kept on the left part. */
function hyphenParts(text: string): string[] {
  return text.split("-").map((part, index, all) => (index < all.length - 1 ? `${part}-` : part));
}

/**
 * The runs a path is drawn in, each its own text in a wrapping row, so the
 * line breaks are the layout's and the same on every platform (iOS, Android
 * and browsers each read zero-width breaks their own way): a segment that
 * fits a line is one run with its "/"; a segment longer than a line is cut
 * after each of its "-", its first part kept on the run before it.
 */
export function pathTokens(path: string, columns: number): string[] {
  const tokens: string[] = [];
  for (const piece of pathPieces(path)) {
    if (textWidth(piece) <= columns) {
      tokens.push(piece);
      continue;
    }
    hyphenParts(piece).forEach((part, index) => {
      const before = tokens.length - 1;
      if (index === 0 && before >= 0) tokens[before] = `${tokens[before] ?? ""}${part}`;
      else tokens.push(part);
    });
  }
  return tokens;
}

/**
 * How many lines a path takes in lines of `columns`, laid out from its
 * `pathTokens`: a run that does not fit the rest of a line moves to the
 * next; a run longer than a whole line breaks inside itself.
 */
export function pathLines(path: string, columns: number): number {
  let lines = 1;
  let used = 0;
  for (const token of pathTokens(path, columns)) {
    const width = textWidth(token);
    if (used > 0 && used + width > columns) {
      lines += 1;
      used = 0;
    }
    used += width;
    while (used > columns) {
      used -= columns;
      lines += 1;
    }
  }
  return lines;
}

/**
 * A path in `lines` lines of `columns`: whole when it fits, else its head
 * ("~/workspace", "/Users") and as many trailing segments as fit around
 * "…/". A last segment too long for the lines keeps its first and last
 * hyphen parts around "…" ("feat-…-input-crash"), cut inside a word only
 * when it has no hyphens to cut at. Copying still takes the whole path.
 */
export function foldPath(path: string, columns: number, lines = 2): string {
  const fits = (text: string) => pathLines(text, columns) <= lines;
  if (fits(path)) return path;
  const segments = path.split("/");
  const last = segments.pop() ?? path;
  const head = segments.length > 2 ? segments.slice(0, 2).join("/") : null;
  const rest = head ? segments.slice(2) : segments;
  const lead = head ? `${head}/…/` : "…/";
  if (!fits(`${lead}${last}`)) {
    if (fits(`…/${last}`)) return `…/${last}`;
    const parts = hyphenParts(last);
    for (let from = 2; from < parts.length; from++) {
      const candidate = `…/${parts[0]}…${parts.slice(from).join("")}`;
      if (fits(candidate)) return candidate;
    }
    for (let from = 1; from < parts.length; from++) {
      const candidate = `…/…${parts.slice(from).join("")}`;
      if (fits(candidate)) return candidate;
    }
    return `…/${middle(last, columns * lines - 2)}`;
  }
  let tail = last;
  for (let index = rest.length - 1; index >= 0; index--) {
    const next = `${rest[index]}/${tail}`;
    if (!fits(`${lead}${next}`)) break;
    tail = next;
  }
  return `${lead}${tail}`;
}

/** Lets a branch or a name wrap after each "/" and "-" before it wraps inside a word. */
export function breakable(text: string): string {
  return text.replace(/([/-])/g, "$1\u200b");
}

/** Ahead/behind and uncommitted changes beside the branch; a clean, level branch says nothing. */
export function branchHint(git: TaskCard["location"]["git"]): { sync: { ahead: number; behind: number } | null; dirty: boolean } {
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  return { sync: ahead !== 0 || behind !== 0 ? { ahead, behind } : null, dirty: git?.dirty === true };
}

// ---- Subtasks (`docs/prototypes/task-subtasks.md`) --------------------------

/** A subtasks section this wide or narrower drops the running count, the start times and the low context shares. */
export const NARROW_SUBTASKS = 340;

/** What needs a person first: input, then a failure, then the work still running, then what is left to read. */
const SUBTASK_RANK: Readonly<Record<StatusKind, number>> = { needs_input: 0, failed: 1, running: 2, unread: 3, done: 4 };

/** When a running child's turn started; one without a start sorts as the newest. */
function runStart(child: TaskChild): number {
  const at = child.timing?.turnStartedAt ? Date.parse(child.timing.turnStartedAt) : Number.NaN;
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/**
 * The rows in the order they are read: by status, the running ones longest
 * first (earliest start), every other group in its given order. No row moves
 * on a tick: a running pair keeps its order as both timers grow.
 */
export function sortSubtasks(children: readonly TaskChild[]): TaskChild[] {
  return children
    .map((child, index) => ({ child, index }))
    .sort((left, right) => {
      const rank = SUBTASK_RANK[left.child.status] - SUBTASK_RANK[right.child.status];
      if (rank !== 0) return rank;
      if (left.child.status === "running") {
        const a = runStart(left.child);
        const b = runStart(right.child);
        if (a !== b) return a < b ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.child);
}

/** A finished child, read or not: the green unread dot is "to review", not still at work. */
export function subtaskFinished(child: TaskChild): boolean {
  return child.status === "done" || child.status === "unread";
}

/** One run of the heading's summary: a count in its status colour and muted words, or a status word in its colour. */
export interface SubtaskSummaryPart {
  count: number | null;
  text: string;
  /** Colours the count, or the text when there is no count; null is muted. */
  tone: StatusKind | null;
}

export interface SubtaskHeading {
  parts: SubtaskSummaryPart[];
  /** Every child finished: a green circled check follows. */
  check: boolean;
}

/**
 * The heading's summary: "1 needs input · 1 failed · 2 running · 4/8 done"
 * while mixed (empty groups left out), "All 4 done" with the check once all
 * are finished, one child's status word alone. A narrow section leaves out the
 * running count, which the rows' own timers carry, unless it is all there is.
 */
export function subtaskHeading(children: readonly TaskChild[], language: TasksLanguage, narrow = false): SubtaskHeading {
  const text = cardStrings(language);
  const words = text.details;
  const total = children.length;
  if (total === 0) return { parts: [], check: false };
  if (total === 1) {
    const status = children[0]!.status;
    return { parts: [{ count: null, text: text.status[status], tone: status }], check: status === "done" };
  }
  const finished = children.filter(subtaskFinished).length;
  if (finished === total) return { parts: [{ count: null, text: words.subtasksAllDone(total), tone: null }], check: true };
  const count = (status: StatusKind) => children.filter((child) => child.status === status).length;
  const groups: StatusKind[] = ["needs_input", "failed", "running"];
  const parts: SubtaskSummaryPart[] = groups
    .map((status) => ({ count: count(status), text: text.status[status], tone: status }))
    .filter((part) => part.count > 0);
  if (finished > 0) parts.push({ count: null, text: words.subtasksDone(finished, total), tone: null });
  const trimmed = narrow ? parts.filter((part) => part.tone !== "running") : parts;
  return { parts: trimmed.length > 0 ? trimmed : parts, check: false };
}

/** A title's leading tag ("[Handoff]") or Linear id ("RRD-11366"), drawn muted; a tag loses its brackets. */
export function titlePrefix(title: string): { prefix: string | null; rest: string } {
  const tag = /^\[([^\]\n]{1,24})\]\s*/.exec(title);
  if (tag && tag[0].length < title.length) return { prefix: tag[1]!, rest: title.slice(tag[0].length) };
  const id = /^([A-Z][A-Z0-9]+-\d+)(?:\s+|:\s*)/.exec(title);
  if (id && id[0].length < title.length) return { prefix: id[1]!, rest: title.slice(id[0].length) };
  return { prefix: null, rest: title };
}

/** An agent's model, thinking and mode: what the rows compare against their baseline. */
export interface SubtaskModel {
  provider: string | null;
  model: string;
  thinking: string | null;
  mode: string | null;
}

function modelOf(agent: { provider?: string; modelLabel?: string | null; thinkingLabel?: string | null; modeLabel?: string | null }): SubtaskModel | null {
  if (!agent.modelLabel) return null;
  return { provider: agent.provider ?? null, model: agent.modelLabel, thinking: agent.thinkingLabel ?? null, mode: agent.modeLabel ?? null };
}

function modelKey(model: SubtaskModel): string {
  return [model.model, model.thinking ?? "", model.mode ?? ""].join("\u0000");
}

/** "Opus 5.5 · High · Bypass". */
function modelText(model: SubtaskModel): string {
  return [model.model, model.thinking, model.mode].filter(Boolean).join(" \u00b7 ");
}

export interface SubtaskModels {
  /** The model a row leaves unsaid: the children's most common one, the parent's for a single child. */
  baseline: SubtaskModel | null;
  /** Said once under the rows when that baseline is not the parent's own: "All on ...", or "Others on ..." when some rows differ. */
  footnote: { text: string; provider: string | null } | null;
}

/** The baseline the rows compare with, and the footnote that names it. */
export function subtaskModels(card: Pick<TaskCard, "provider" | "modelLabel" | "thinkingLabel" | "modeLabel" | "children">, language: TasksLanguage): SubtaskModels {
  const parent = modelOf(card);
  if (card.children.length <= 1) return { baseline: parent, footnote: null };
  const counts = new Map<string, { model: SubtaskModel; count: number }>();
  card.children.forEach((child) => {
    const model = modelOf(child);
    if (!model) return;
    const key = modelKey(model);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { model, count: 1 });
  });
  // The most common; a tie goes to the one seen first.
  let baseline: SubtaskModel | null = null;
  let most = 0;
  for (const entry of counts.values()) {
    if (entry.count > most) {
      baseline = entry.model;
      most = entry.count;
    }
  }
  if (!baseline || (parent && modelKey(parent) === modelKey(baseline))) return { baseline, footnote: null };
  const key = modelKey(baseline);
  const words = cardStrings(language).details;
  const same = card.children.every((child) => {
    const model = modelOf(child);
    return !model || modelKey(model) === key;
  });
  const text = same ? words.subtasksAllOn(modelText(baseline)) : words.subtasksOthersOn(modelText(baseline));
  return { baseline, footnote: { text, provider: baseline.provider } };
}

/** One part of a row's meta line; the row's leading mark names its agent. */
export interface SubtaskMetaPart {
  text: string;
  tone: "warning" | "danger" | null;
}

/**
 * A row's muted second line, " · " between parts: its model when it is not
 * the baseline, what its status asks for (input, a failure, the running
 * start, a result to read), the last turn's length, then the context share,
 * amber from 75% and red from 90%. A narrow section names the model alone and
 * drops the start and a context share under 75%.
 */
export function subtaskMeta(child: TaskChild, baseline: SubtaskModel | null, now: number, language: TasksLanguage, narrow = false): SubtaskMetaPart[] {
  const words = cardStrings(language).details;
  const parts: SubtaskMetaPart[] = [];
  // A provider subagent's own line (its type, model, effort, tokens), as Paseo's track prints it.
  if (child.kind === "provider" && child.subtitle && !narrow) parts.push({ text: child.subtitle, tone: null });
  const model = modelOf(child);
  if (model && (!baseline || modelKey(model) !== modelKey(baseline))) {
    const text = narrow ? model.model : [model.model, model.thinking].filter(Boolean).join(" \u00b7 ");
    parts.push({ text, tone: null });
  }
  if (child.status === "needs_input") parts.push({ text: words.subtaskWaiting, tone: "warning" });
  else if (child.status === "failed") parts.push({ text: words.subtaskFailed, tone: "danger" });
  else if (child.status === "unread") parts.push({ text: words.subtaskUnread, tone: null });
  if (child.status === "running") {
    const start = !narrow && child.lane && child.timing ? cardStart({ lane: child.lane, timing: child.timing, waitingOnSubtasks: child.waitingOnSubtasks }, now) : null;
    if (start) parts.push({ text: words.subtaskStarted(start), tone: null });
  } else if (child.timing?.lastTurnMs != null) {
    parts.push({ text: words.lastTurn(formatDuration(child.timing.lastTurnMs)), tone: null });
  }
  const ratio = contextRatio(child.context ?? null);
  if (ratio !== null && (!narrow || ratio >= 0.75)) {
    parts.push({ text: words.subtaskContext(Math.round(ratio * 100)), tone: ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warning" : null });
  }
  return parts;
}

/**
 * The row's time at the end of its first line: a running child's live timer
 * (as the card footer counts it), else when it stopped: the wait's start for
 * one asking for input, the last turn's end otherwise.
 */
export function subtaskTime(child: TaskChild, now: number, language: TasksLanguage): { text: string; live: boolean } | null {
  const timing = child.timing;
  if (!timing) return null;
  if (child.status === "running") {
    const timer = child.lane ? cardTimer({ lane: child.lane, timing, waitingOnSubtasks: child.waitingOnSubtasks }, now, language) : null;
    return timer ? { text: timer.text, live: true } : null;
  }
  const ended = child.status === "needs_input" ? (timing.attentionAt ?? timing.lastTurnEndedAt) : timing.lastTurnEndedAt;
  const text = formatEnded(ended ?? timing.updatedAt, now, language);
  return text ? { text, live: false } : null;
}
