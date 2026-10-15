import type { PaseoAgent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { parseSystemEnvelope } from "../system-envelope";

export type Entry = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>["entries"][number];

export function continuesTurn(previous: Entry, next: Entry): boolean {
  if (previous.turnId !== undefined && next.turnId !== undefined) return previous.turnId === next.turnId;
  return next.item.type !== "user_message";
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

/** Entries arrive in canonical sequence order, including equal timestamps. */
export function completedTurnFooters(
  entries: readonly Entry[],
  running: boolean,
  activeTurnId: string | null,
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
    const startedAt = first.item.type === "user_message" ? Date.parse(first.timestamp) : NaN;
    const duration = completedAt - startedAt;
    result.push({ ...(turnId ? { turnId } : {}), at, text: reply.item.text, completedAt,
      startedAt: Number.isFinite(duration) && duration >= 0 ? startedAt : null,
      durationMs: Number.isFinite(duration) && duration >= 0 ? duration : null });
  };
  for (let index = 1; index < entries.length; index++) {
    if (!continuesTurn(entries[index - 1]!, entries[index]!)) {
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
