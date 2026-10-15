import type { PaseoAgentTimelineHandle } from "@getpaseo/client";

type Entry = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>["entries"][number];

function continuesTurn(previous: Entry, next: Entry): boolean {
  if (previous.turnId !== undefined && next.turnId !== undefined) return previous.turnId === next.turnId;
  return next.item.type !== "user_message";
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
