import { formatFooterStamp, formatFullStamp } from "../../ui/time";
import type { TasksLanguage } from "../i18n";
import { settledAt, turnRunning, type TaskCard, type TaskChild } from "../model";
import { formatApprox, formatClockTime, formatDuration, formatRelative, formatWait, since } from "./format";
import { cardStrings } from "./strings";

/**
 * A card's times against a clock: the footer's timer, the running turn's
 * start, how long ago something ended. Pure, so a board card, its expanded
 * subtask rows and the details' subtask rows read them the same way.
 */

export interface TimerView {
  text: string;
  /** "warning" draws the clock icon in the warning colour. */
  tone: "muted" | "warning" | "running";
}

/**
 * Timed by its lane and timing, so a subtask row passes its child; a card
 * waiting on its subtasks also passes them, to time their work.
 */
export type Timed = Pick<TaskCard, "lane" | "timing" | "waitingOnSubtasks"> & {
  children?: ReadonlyArray<Pick<TaskChild, "status" | "timing">>;
};

/**
 * When a card waiting on its subtasks saw them go to work: the earliest turn
 * start of a subtask that runs or waits for input. Null for any other card, or
 * when none has a start (a subtask itself waiting on its own subtasks has
 * none), and the card keeps its last turn's timer.
 */
function subtasksStartedAt(card: Timed): string | null {
  if (card.lane !== "running" || card.waitingOnSubtasks !== true) return null;
  let first: string | null = null;
  for (const child of card.children ?? []) {
    if (child.status !== "running" && child.status !== "needs_input") continue;
    const at = child.timing?.turnStartedAt ?? null;
    if (at === null || Number.isNaN(Date.parse(at))) continue;
    if (first === null || Date.parse(at) < Date.parse(first)) first = at;
  }
  return first;
}

/**
 * "12m ago" on the day of `now`, the full stamp before it; null when absent or
 * unparseable. `short` drops the seconds and this year ("10-22 16:57"), for a
 * row whose title shares the line.
 */
export function formatEnded(iso: string | null, now: number, language: TasksLanguage, short = false): string | null {
  const ago = since(iso, now);
  if (ago === null) return null;
  const at = new Date(iso!);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  if (sameDay && ago < 86_400_000) return formatRelative(ago, language);
  return short ? formatFooterStamp(at, new Date(now)) : formatFullStamp(at);
}

/** The footer's timer at `now`; null when there is nothing to count. `short` as `formatEnded`. */
export function cardTimer(card: Timed, now: number, language: TasksLanguage, short = false): TimerView | null {
  const timing = card.timing;
  if (card.lane === "needs_input") {
    const waited = since(timing.attentionAt, now) ?? since(timing.turnStartedAt, now);
    return waited === null ? null : { text: formatWait(waited, language), tone: "warning" };
  }
  if (turnRunning(card)) {
    const ran = since(timing.turnStartedAt, now);
    return ran === null
      ? { text: cardStrings(language).starting, tone: "running" }
      : { text: formatDuration(ran), tone: "muted" };
  }
  // Waiting on its subtasks, a card counts their work as a running turn counts its own.
  const working = since(subtasksStartedAt(card), now);
  if (working !== null) return { text: formatDuration(working), tone: "muted" };
  const parts: string[] = [];
  if (timing.lastTurnMs !== null) parts.push(formatApprox(timing.lastTurnMs, language));
  const ended = formatEnded(settledAt(timing), now, language, short);
  if (ended !== null) parts.push(ended);
  return parts.length ? { text: parts.join(" · "), tone: "muted" } : null;
}

/**
 * When the running turn started, or the subtasks a card waits on went to
 * work, in local time; null otherwise or before the turn has a start.
 */
export function cardStart(card: Timed, now: number): string | null {
  const iso = turnRunning(card) ? card.timing.turnStartedAt : subtasksStartedAt(card);
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : formatClockTime(at, now);
}

/**
 * What the footer's times mean, for its hover hint: the running turn's (or
 * the subtasks') length, when the wait began, or the last turn's length and
 * the last update, with full stamps where the footer shows a relative time.
 */
export function timerHint(card: Timed, now: number, language: TasksLanguage): string | null {
  const { hint, starting } = cardStrings(language);
  const timing = card.timing;
  const stamp = (iso: string | null) => (since(iso, now) === null ? null : formatFullStamp(new Date(iso!)));
  if (card.lane === "needs_input") {
    const at = stamp(timing.attentionAt) ?? stamp(timing.turnStartedAt);
    return at === null ? null : hint.pair(hint.waitingSince, at);
  }
  if (turnRunning(card)) {
    const ran = since(timing.turnStartedAt, now);
    return ran === null ? starting : hint.pair(hint.turnRunning, formatDuration(ran));
  }
  const working = since(subtasksStartedAt(card), now);
  if (working !== null) return hint.pair(hint.subtasksRunning, formatDuration(working));
  const lines: string[] = [];
  if (timing.lastTurnMs !== null) lines.push(hint.pair(hint.lastTurn, formatApprox(timing.lastTurnMs, language)));
  const updated = stamp(timing.updatedAt);
  if (updated !== null) lines.push(hint.pair(hint.updated, updated));
  return lines.length ? lines.join("\n") : null;
}

/** The running turn's start, or the subtasks', as a full stamp, for the footer clock's hover hint. */
export function startHint(card: Timed, language: TasksLanguage): string | null {
  const running = turnRunning(card);
  const iso = running ? card.timing.turnStartedAt : subtasksStartedAt(card);
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  const { hint } = cardStrings(language);
  return hint.pair(running ? hint.turnStarted : hint.subtasksStarted, formatFullStamp(new Date(iso)));
}
