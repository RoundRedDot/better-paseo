import type { PaseoAgentTimelineHandle } from "@getpaseo/client";

export type TimelinePage = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
export type TimelineEntry = TimelinePage["entries"][number];

export function timelineEntry(item: TimelineEntry["item"], seq: number, at = seq * 1000, turnId?: string): TimelineEntry {
  return { provider: "codex", item, timestamp: new Date(at).toISOString(), turnId,
    seqStart: seq, seqEnd: seq, sourceSeqRanges: [], collapsed: [] };
}

export function timelinePage(entries: TimelineEntry[], options: Partial<TimelinePage> = {}): TimelinePage {
  return { entries, hasOlder: false, hasNewer: false, epoch: "e",
    startCursor: entries.length ? { epoch: "e", seq: entries[0]!.seqStart } : null,
    endCursor: entries.length ? { epoch: "e", seq: entries[entries.length - 1]!.seqEnd } : null,
    error: null, gap: false, staleCursor: false, reset: false, requestId: "r", agentId: "a",
    agent: null, direction: "tail", projection: "projected", window: { minSeq: 0, maxSeq: 1000, nextSeq: 1001 },
    ...options };
}
