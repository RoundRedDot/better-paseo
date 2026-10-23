import { formatFullStamp } from "../../ui/time";
import type { TasksLanguage } from "../i18n";
import { turnRunning, type TaskCard } from "../model";
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

/** Timed by its lane and timing alone, so a subtask row passes its child. */
export type Timed = Pick<TaskCard, "lane" | "timing" | "waitingOnSubtasks">;

/** "12m ago" on the day of `now`, the full stamp before it; null when absent or unparseable. */
export function formatEnded(iso: string | null, now: number, language: TasksLanguage): string | null {
  const ago = since(iso, now);
  if (ago === null) return null;
  const at = new Date(iso!);
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return sameDay && ago < 86_400_000 ? formatRelative(ago, language) : formatFullStamp(at);
}

/** The footer's timer at `now`; null when there is nothing to count. */
export function cardTimer(card: Timed, now: number, language: TasksLanguage): TimerView | null {
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
  const parts: string[] = [];
  if (timing.lastTurnMs !== null) parts.push(formatApprox(timing.lastTurnMs, language));
  const ended = formatEnded(timing.updatedAt, now, language);
  if (ended !== null) parts.push(ended);
  return parts.length ? { text: parts.join(" · "), tone: "muted" } : null;
}

/** When the running turn started, in local time; null without a running turn or before the turn has a start. */
export function cardStart(card: Timed, now: number): string | null {
  if (!turnRunning(card) || !card.timing.turnStartedAt) return null;
  const at = Date.parse(card.timing.turnStartedAt);
  return Number.isNaN(at) ? null : formatClockTime(at, now);
}
