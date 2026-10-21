import type { PaseoAgentTimelineHandle } from "@getpaseo/client";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch">;
export type AgentTimelinePage = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Cursor = NonNullable<AgentTimelinePage["startCursor"]>;

/** Recent rows cover the visible reply and tool cards; older targets page on demand. */
export const AGENT_TIMELINE_TAIL_LIMIT = 50;
const PAGE_LIMIT = 200;

export interface AgentTimelinePageReader {
  tail(timeline: Timeline): Promise<AgentTimelinePage>;
  before(timeline: Timeline, cursor: Cursor): Promise<AgentTimelinePage>;
}

/** Coalesce concurrent reads so each store can consume the same cold tail page. */
export function createAgentTimelinePageReader(): AgentTimelinePageReader {
  let pendingTail: Promise<AgentTimelinePage> | null = null;
  const pendingBefore = new Map<string, Promise<AgentTimelinePage>>();

  return {
    tail(timeline) {
      if (pendingTail) return pendingTail;
      const request = timeline.refetch({
        direction: "tail",
        projection: "projected",
        limit: AGENT_TIMELINE_TAIL_LIMIT,
      });
      pendingTail = request;
      const clear = () => { if (pendingTail === request) pendingTail = null; };
      void request.then(clear, clear);
      return request;
    },
    before(timeline, cursor) {
      const key = `${cursor.epoch}:${cursor.seq}`;
      const existing = pendingBefore.get(key);
      if (existing) return existing;
      const request = timeline.refetch({
        direction: "before",
        cursor,
        projection: "projected",
        limit: PAGE_LIMIT,
      });
      pendingBefore.set(key, request);
      const clear = () => { if (pendingBefore.get(key) === request) pendingBefore.delete(key); };
      void request.then(clear, clear);
      return request;
    },
  };
}

const readers = new WeakMap<object, Map<string, AgentTimelinePageReader>>();

/** One reader per Paseo client and agent, shared by the footer and sender stores. */
export function getAgentTimelinePageReader(owner: object, agentId: string): AgentTimelinePageReader {
  let agents = readers.get(owner);
  if (!agents) readers.set(owner, agents = new Map());
  let reader = agents.get(agentId);
  if (!reader) agents.set(agentId, reader = createAgentTimelinePageReader());
  return reader;
}
