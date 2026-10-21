import type { PaseoAgent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { parseSystemEnvelope } from "../system-envelope";

export type Entry = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>["entries"][number];

export function continuesTurn(previous: Entry, next: Entry): boolean {
  if (previous.turnId !== undefined && next.turnId !== undefined) return previous.turnId === next.turnId;
  return next.item.type !== "user_message";
}

/**
 * Turn starts and ends the plugin server recorded, in epoch ms, ascending.
 * They split history the daemon reloaded from the provider, which has no turn
 * IDs, and time a turn that no prompt started.
 */
export interface TurnMarks {
  starts: readonly number[];
  ends: readonly number[];
}

/**
 * A recorded end splits reloaded history only when the next item comes this
 * long after it, so a turn's trailing items stay with it.
 */
const END_SPLIT_MS = 5_000;

/** Whether an ascending list holds a value in (low, high]. */
function holds(sorted: readonly number[], low: number, high: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= low) lo = mid + 1; else hi = mid;
  }
  return lo < sorted.length && sorted[lo]! <= high;
}

/** The last value of an ascending list in (low, high], if any. */
function lastIn(sorted: readonly number[], low: number, high: number): number | null {
  for (let index = sorted.length - 1; index >= 0; index--) {
    const value = sorted[index]!;
    if (value <= high) return value > low ? value : null;
  }
  return null;
}

/**
 * Whether `next` opens a new turn. Live items carry the daemon's turn ID. A
 * live turn after reloaded history is new even without a prompt, and in
 * reloaded history a turn the server saw start or end between two items
 * divides them; the prompt that started a turn stays with it.
 */
export function startsTurn(previous: Entry, next: Entry, marks?: TurnMarks): boolean {
  if (!continuesTurn(previous, next)) return true;
  if (previous.turnId !== undefined || next.turnId !== undefined) return previous.turnId === undefined;
  if (!marks) return false;
  const after = Date.parse(previous.timestamp);
  const before = Date.parse(next.timestamp);
  if (!Number.isFinite(after) || !Number.isFinite(before)) return false;
  if (previous.item.type !== "user_message" && holds(marks.starts, after, before)) return true;
  return holds(marks.ends, after - 1, before - END_SPLIT_MS);
}

export interface CompletedTurnFooter {
  turnId?: string;
  usage?: NonNullable<PaseoAgent["lastUsage"]>;
  at: number;
  text: string;
  completedAt: number;
  startedAt: number | null;
  durationMs: number | null;
}

export interface TurnFooterOptions {
  marks?: TurnMarks;
  /** The entries begin at the agent's first item, so the first turn starts there. */
  fromStart?: boolean;
}

/**
 * Entries arrive in canonical sequence order, including equal timestamps.
 *
 * A turn starts at its prompt. A turn the agent started itself, for a
 * background task notification or a system-injected message, starts when the
 * server saw it start, or else at its first item.
 */
export function completedTurnFooters(
  entries: readonly Entry[],
  running: boolean,
  activeTurnId: string | null,
  { marks, fromStart = false }: TurnFooterOptions = {},
): CompletedTurnFooter[] {
  const result: CompletedTurnFooter[] = [];
  const identities = new Map<number, Map<string, number>>();
  for (const entry of entries) {
    if (entry.item.type !== "assistant_message") continue;
    const at = Date.parse(entry.timestamp);
    let texts = identities.get(at);
    if (!texts) identities.set(at, texts = new Map());
    texts.set(entry.item.text, (texts.get(entry.item.text) ?? 0) + 1);
  }
  let start = 0;
  const close = (end: number) => {
    const first = entries[start]!;
    const turnId = first.turnId;
    const active = running && (activeTurnId && turnId ? activeTurnId === turnId : end === entries.length - 1);
    if (active) return;
    let reply: Entry | undefined;
    for (let index = start; index <= end; index++) {
      const entry = entries[index]!;
      if (entry.item.type === "assistant_message" && entry.item.text.trim() && !parseSystemEnvelope(entry.item.text)) reply = entry;
    }
    if (!reply || reply.item.type !== "assistant_message") return;
    const at = Date.parse(reply.timestamp);
    const completedAt = Date.parse(entries[end]!.timestamp);
    if (!Number.isFinite(at) || !Number.isFinite(completedAt)) return;
    let startedAt = NaN;
    if (first.item.type === "user_message") startedAt = Date.parse(first.timestamp);
    else if (start > 0 || fromStart) {
      // Without a prompt, the turn began after the previous item and no later
      // than its own first. A lone item is no measure of the turn behind it.
      const firstAt = Date.parse(first.timestamp);
      const previousAt = start > 0 ? Date.parse(entries[start - 1]!.timestamp) : NaN;
      const recorded = marks && Number.isFinite(previousAt) ? lastIn(marks.starts, previousAt, firstAt) : null;
      startedAt = recorded ?? (firstAt < completedAt ? firstAt : NaN);
    }
    const duration = completedAt - startedAt;
    result.push({ ...(turnId ? { turnId } : {}), at, text: reply.item.text, completedAt,
      startedAt: Number.isFinite(duration) && duration >= 0 ? startedAt : null,
      durationMs: Number.isFinite(duration) && duration >= 0 ? duration : null });
  };
  for (let index = 1; index < entries.length; index++) {
    if (startsTurn(entries[index - 1]!, entries[index]!, marks)) {
      close(index - 1);
      start = index;
    }
  }
  if (entries.length) close(entries.length - 1);
  // A host without source IDs cannot distinguish identical text at the same
  // timestamp. Do not attach one turn's footer to two indistinguishable rows.
  return result.filter((footer) => identities.get(footer.at)?.get(footer.text) === 1);
}

/** Match the displayed reply before attributing a prompt's time to it. */
export function replyTurnDuration(entries: readonly Entry[], at: number, text: string): number | null {
  const reply = entries.findIndex((entry) =>
    entry.item.type === "assistant_message" && entry.item.text === text && Date.parse(entry.timestamp) === at,
  );
  if (reply < 0) return null;
  let start = reply;
  while (start > 0 && continuesTurn(entries[start - 1]!, entries[start]!)) start--;
  if (entries[start]!.item.type !== "user_message") return null;
  let end = reply;
  while (end + 1 < entries.length && continuesTurn(entries[end]!, entries[end + 1]!)) end++;
  const duration = Date.parse(entries[end]!.timestamp) - Date.parse(entries[start]!.timestamp);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

/** Read persisted timing, including turns that this client never watched live. */
export async function loadReplyTurnDuration(
  timeline: Pick<PaseoAgentTimelineHandle, "refetch">,
  at: number,
  text: string,
  cancelled: () => boolean,
): Promise<number | null> {
  let page = await timeline.refetch({ direction: "tail", limit: 200, projection: "projected" });
  let entries = page.entries;
  while (!cancelled()) {
    if (page.error || page.staleCursor || page.gap) return null;
    const duration = replyTurnDuration(entries, at, text);
    if (duration !== null) return duration;
    // A known turn boundary before the reply cannot be repaired by older pages.
    const reply = entries.findIndex((entry) => entry.item.type === "assistant_message" &&
      entry.item.text === text && Date.parse(entry.timestamp) === at);
    if (reply >= 0 && entries.slice(0, reply + 1).some((entry, index) =>
      entry.item.type === "user_message" || (index > 0 && !continuesTurn(entries[index - 1]!, entry)))) return null;
    if (!page.hasOlder || !page.startCursor) return null;
    const cursor = page.startCursor;
    page = await timeline.refetch({ direction: "before", cursor, limit: 200, projection: "projected" });
    if (page.reset || page.epoch !== cursor.epoch || !page.entries.length ||
      (page.startCursor && page.startCursor.seq >= cursor.seq)) return null;
    entries = [...page.entries, ...entries];
  }
  return null;
}
