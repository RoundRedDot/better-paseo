import type { TasksLanguage } from "../i18n";
import type { StatusKind, TaskCard, TaskChild } from "../model";
import { contextRatio, formatCost, formatDuration, formatRelative, formatTokens, since } from "./format";
import { cardStrings } from "./strings";

/**
 * What the details card (`detail-cards.tsx`) shows, as pure functions for the
 * tests: which block leads, the order of the sections, and the numbers behind
 * the charts. Spec: `docs/prototypes/task-details-rich.md`.
 */

const MINUTE = 60_000;

/** The block under the header, by what the card needs first. */
export type DetailHero = "turn" | "permission" | "error" | "summary";

export type DetailSection = "properties" | "subtasks" | "usage" | "activity";

export function detailHero(card: TaskCard): DetailHero {
  if (card.lane === "needs_input" && card.permission) return "permission";
  if (card.lane === "running") return "turn";
  if (card.error) return "error";
  return "summary";
}

/** The sections after the hero, in order, and the ones closed unless the user opened them. */
export function detailSections(card: TaskCard): { order: DetailSection[]; closed: DetailSection[] } {
  const hero = detailHero(card);
  let order: DetailSection[];
  if (hero === "turn") order = ["subtasks", "properties", "usage", "activity"];
  else if (hero === "permission") order = ["properties", "subtasks", "usage", "activity"];
  else if (hero === "error") order = ["properties", "activity", "usage", "subtasks"];
  else order = ["subtasks", "properties", "usage", "activity"];
  if (card.children.length === 0) order = order.filter((section) => section !== "subtasks");
  const closed: DetailSection[] = hero === "permission" || hero === "error" ? ["usage"] : [];
  return { order, closed };
}

/** The colour each status draws with in the charts: the board's status band, done in grey. */
export type StatusTone = "running" | "warning" | "success" | "danger" | "muted";

export function statusTone(status: StatusKind): StatusTone {
  if (status === "running") return "running";
  if (status === "needs_input") return "warning";
  if (status === "unread") return "success";
  if (status === "failed") return "danger";
  return "muted";
}

/** "4:19", "1:02:07": the running turn's timer. */
export function formatTurnClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** A span on the timeline: "<1m", "24m", "2h 5m", "3d". */
export function formatSpan(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 && hours < 10 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ---- Subtasks --------------------------------------------------------------

/**
 * A subtask row's second line, as Paseo 0.12's subagent row writes it
 * (`buildAgentFactsLine`): model · thinking · mode · context, the context as
 * "120k / 200k tokens (60%)". Null until the child has a model.
 */
export function childFacts(child: TaskChild): string | null {
  const parts = childFactParts(child);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** `childFacts` as its parts, so a narrow row can wrap between them rather than inside one. */
export function childFactParts(child: TaskChild): string[] {
  if (!child.modelLabel) return [];
  const parts = [child.modelLabel];
  if (child.thinkingLabel) parts.push(child.thinkingLabel);
  if (child.modeLabel) parts.push(child.modeLabel);
  const context = child.context;
  if (context && Number.isFinite(context.usedTokens) && Number.isFinite(context.maxTokens) && context.usedTokens >= 0 && context.maxTokens > 0) {
    const share = Math.round(Math.min(100, (context.usedTokens / context.maxTokens) * 100));
    parts.push(`${hostTokens(context.usedTokens)} / ${hostTokens(context.maxTokens)} tokens (${share}%)`);
  }
  return parts;
}

/** The host's token count (`formatTokenCount`): "950", "120k", "1m". */
function hostTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

// ---- Tokens ----------------------------------------------------------------

export type TokenPart = "cached" | "input" | "output";

export interface TokenSegment {
  part: TokenPart;
  tokens: number;
  /** Its share of the total, 0..1. */
  share: number;
}

export interface TokenMix {
  total: number;
  segments: TokenSegment[];
}

/** The OpenAI family, as `normalizeProvider` names it "codex"; kept here so the model needs no React Native. */
const OPENAI_USAGE = /codex|openai|gpt/i;

/**
 * Cached input, new input and output. Codex counts its cached tokens inside
 * `inputTokens` (OpenAI's usage); Claude and the others report them apart, so
 * only Codex's input is split.
 */
export function tokenMix(card: TaskCard): TokenMix | null {
  const usage = card.usage;
  if (!usage) return null;
  const cached = usage.cachedInputTokens ?? null;
  let input = usage.inputTokens ?? null;
  if (input !== null && cached !== null && OPENAI_USAGE.test(card.provider) && cached <= input) input -= cached;
  const parts: Array<[TokenPart, number | null]> = [
    ["cached", cached],
    ["input", input],
    ["output", usage.outputTokens ?? null],
  ];
  const present = parts.filter((part): part is [TokenPart, number] => part[1] !== null && part[1] >= 0);
  const total = present.reduce((sum, [, tokens]) => sum + tokens, 0);
  if (present.length === 0 || total <= 0) return null;
  return { total, segments: present.map(([part, tokens]) => ({ part, tokens, share: tokens / total })) };
}

/** "99.2%", "<0.1%". */
export function formatShare(share: number): string {
  return share > 0 && share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`;
}

/** 225,312: exact counts in the tooltips. */
export function formatExact(count: number): string {
  return Math.round(count).toLocaleString("en-US");
}

// ---- Context ---------------------------------------------------------------

export type ContextLevel = "normal" | "warning" | "danger";

export interface ContextView {
  ratio: number;
  level: ContextLevel;
  percent: string;
  text: string;
  exact: string;
}

/** The context gauge: < 75% normal, 75-89% warning, 90% and up danger. */
export function contextView(card: TaskCard): ContextView | null {
  const ratio = contextRatio(card.context);
  if (ratio === null || !card.context) return null;
  const level: ContextLevel = ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warning" : "normal";
  return {
    ratio,
    level,
    percent: `${Math.round(ratio * 100)}%`,
    text: `${formatTokens(card.context.usedTokens)} / ${formatTokens(card.context.maxTokens)}`,
    exact: `${formatExact(card.context.usedTokens)} / ${formatExact(card.context.maxTokens)}`,
  };
}

// ---- Summary tiles (review and done) ---------------------------------------

export interface SummaryTile {
  key: "turn" | "cost" | "tokens";
  icon: string;
  label: string;
  /** Null when not reported: drawn as "—". */
  value: string | null;
  sub: string;
}

export function summaryTiles(card: TaskCard, now: number, language: TasksLanguage): SummaryTile[] {
  const words = cardStrings(language).details;
  const ended = since(card.timing.updatedAt, now);
  const mix = tokenMix(card);
  const cached = mix?.segments.find((segment) => segment.part === "cached");
  const cost = card.usage?.totalCostUsd ?? null;
  return [
    {
      key: "turn",
      icon: "Hourglass",
      label: words.lastTurnTime,
      value: card.timing.lastTurnMs !== null ? formatDuration(card.timing.lastTurnMs) : null,
      sub: card.timing.lastTurnMs !== null && ended !== null ? words.ended(formatRelative(ended, language)) : words.notReported,
    },
    { key: "cost", icon: "Coins", label: words.cost, value: cost !== null ? formatCost(cost) : null, sub: cost !== null ? words.total : words.notReported },
    {
      key: "tokens",
      icon: "Layers",
      label: "Token",
      value: mix ? formatTokens(mix.total) : null,
      sub: cached ? words.cacheShare(`${Math.round(cached.share * 100)}%`) : mix ? words.total : words.notReported,
    },
  ];
}

// ---- Timeline --------------------------------------------------------------

export interface TimelinePoint {
  key: string;
  name: string;
  /** "30 分钟前", or the live state ("进行中") at the end. */
  time: string;
  at: number;
}

export interface Timeline {
  points: TimelinePoint[];
  /** The last span is still going (running, waiting) or ended the run (failed): drawn in the status colour. */
  live: boolean;
}

const parse = (iso: string | null): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
};

/**
 * Created, the last message, the turn's start (or the wait's), and now or the
 * last update. A middle point within a minute of the one before it adds no
 * span worth drawing and is dropped, as is anything out of order.
 */
export function timeline(card: TaskCard, now: number, language: TasksLanguage): Timeline | null {
  const words = cardStrings(language).details.timeline;
  const created = parse(card.timing.createdAt);
  if (created === null) return null;
  const ago = (at: number) => formatRelative(now - at, language);
  const middle: TimelinePoint[] = [];
  const message = parse(card.timing.lastUserMessageAt);
  if (message !== null) middle.push({ key: "message", name: words.lastMessage, time: ago(message), at: message });
  let end: TimelinePoint;
  let live = false;
  if (card.lane === "running") {
    const turn = parse(card.timing.turnStartedAt);
    if (turn !== null) middle.push({ key: "turn", name: words.turnStarted, time: ago(turn), at: turn });
    end = { key: "now", name: words.now, time: words.running, at: now };
    live = true;
  } else if (card.lane === "needs_input") {
    const waiting = parse(card.timing.attentionAt);
    if (waiting !== null) middle.push({ key: "waiting", name: words.waiting, time: ago(waiting), at: waiting });
    end = { key: "now", name: words.now, time: words.waitingNow, at: now };
    live = true;
  } else {
    const updated = parse(card.timing.updatedAt) ?? now;
    const failed = card.status === "failed" && !card.stoppedManually;
    end = { key: "end", name: failed ? words.failed : words.updated, time: ago(updated), at: updated };
    live = failed;
  }
  const points: TimelinePoint[] = [{ key: "created", name: words.created, time: ago(created), at: created }];
  for (const point of middle.sort((a, b) => a.at - b.at)) {
    const last = points[points.length - 1]!;
    if (point.at - last.at >= MINUTE && end.at - point.at >= MINUTE) points.push(point);
    else if (point.at - last.at < MINUTE && points.length > 1 && end.at - point.at >= MINUTE) points[points.length - 1] = point;
  }
  if (end.at < points[points.length - 1]!.at) end = { ...end, at: points[points.length - 1]!.at };
  points.push(end);
  return { points, live };
}

/**
 * Each span's share of the track: its time, but never so narrow that the
 * labels around it collide. The first and last spans carry an edge-aligned
 * label, so they need more room than a middle one.
 */
export function timelineFractions(spans: number[], width: number): number[] {
  const count = spans.length;
  if (count === 0) return [];
  if (count === 1) return [1];
  const room = Math.max(width, 1);
  const mins = spans.map((_, index) => (index === 0 || index === count - 1 ? 84 : 68) / room);
  if (mins.reduce((sum, min) => sum + min, 0) >= 1) return spans.map(() => 1 / count);
  const fixed = new Set<number>();
  for (;;) {
    const free = 1 - [...fixed].reduce((sum, index) => sum + mins[index]!, 0);
    const open = spans.map((span, index) => (fixed.has(index) ? 0 : Math.max(span, 0)));
    const openTotal = open.reduce((sum, span) => sum + span, 0);
    const openCount = count - fixed.size;
    const fractions = spans.map((_, index) => (fixed.has(index) ? mins[index]! : openTotal > 0 ? (open[index]! / openTotal) * free : free / openCount));
    const short = fractions.map((fraction, index) => !fixed.has(index) && fraction < mins[index]!);
    if (!short.includes(true)) return fractions;
    short.forEach((isShort, index) => isShort && fixed.add(index));
  }
}

// ---- Section summaries -----------------------------------------------------

export function usageSummary(card: TaskCard, language: TasksLanguage): string {
  const parts: string[] = [];
  if (card.usage?.totalCostUsd != null) parts.push(formatCost(card.usage.totalCostUsd));
  const context = contextView(card);
  if (context) parts.push(context.percent);
  return parts.length > 0 ? parts.join(" · ") : cardStrings(language).details.notReported;
}

/** The error's lines, trailing blank ones dropped. */
export function errorLines(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 1 && lines[lines.length - 1]!.trim() === "") lines.pop();
  return lines;
}
