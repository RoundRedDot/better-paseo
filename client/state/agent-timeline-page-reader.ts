import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch">;
type ObservableTimeline = Timeline & Pick<PaseoAgentTimelineHandle, "subscribe">;
type TimelineListener = (event: PaseoAgentTimelineEvent) => void;
export type AgentTimelinePage = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Cursor = NonNullable<AgentTimelinePage["startCursor"]>;

const INVALIDATING_EVENT_TYPES = new Set([
  "error", "replacement", "subscription_restored", "turn_started", "turn_completed", "turn_failed", "turn_canceled",
]);

export function isAgentTimelinePageInvalidation(event: PaseoAgentTimelineEvent): boolean {
  return INVALIDATING_EVENT_TYPES.has(event.event.type);
}

/** Recent rows cover the visible reply and tool cards; older targets page on demand. */
export const AGENT_TIMELINE_TAIL_LIMIT = 50;
const PAGE_LIMIT = 200;

export interface AgentTimelinePageReader {
  tail(timeline: Timeline): Promise<AgentTimelinePage>;
  before(timeline: Timeline, cursor: Cursor): Promise<AgentTimelinePage>;
  invalidate(): void;
  /** Keep the tail while at least one store observes this agent's timeline. */
  observe(timeline: ObservableTimeline, listener?: TimelineListener): () => void;
}

/** Share a resolved tail page until timeline changes or every store releases its observation. */
export function createAgentTimelinePageReader(): AgentTimelinePageReader {
  let pendingTail: Promise<AgentTimelinePage> | null = null;
  let cachedTail: AgentTimelinePage | null = null;
  const pendingBefore = new Map<string, Promise<AgentTimelinePage>>();
  const listeners = new Map<TimelineListener, number>();
  let observers = 0;
  let revision = 0;
  let unsubscribe: ReturnType<ObservableTimeline["subscribe"]> | null = null;

  function invalidate() {
    revision++;
    cachedTail = null;
    pendingTail = null;
    pendingBefore.clear();
  }

  return {
    invalidate,
    tail(timeline) {
      if (cachedTail) return Promise.resolve(cachedTail);
      if (pendingTail) return pendingTail;
      const currentRevision = revision;
      const request = timeline.refetch({
        direction: "tail",
        projection: "projected",
        limit: AGENT_TIMELINE_TAIL_LIMIT,
      }).then((page) => {
        if (currentRevision === revision && observers > 0 && !page.error) cachedTail = page;
        return page;
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
    observe(timeline, listener) {
      observers++;
      if (listener) listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
      if (!unsubscribe) {
        unsubscribe = timeline.subscribe((event) => {
          if (isAgentTimelinePageInvalidation(event)) invalidate();
          for (const current of [...listeners.keys()]) current(event);
        });
        void unsubscribe.ready.catch(() => {});
      }

      let active = true;
      return () => {
        if (!active) return;
        active = false;
        if (listener) {
          const count = (listeners.get(listener) ?? 1) - 1;
          if (count > 0) listeners.set(listener, count);
          else listeners.delete(listener);
        }
        observers--;
        if (observers === 0) {
          invalidate();
          const current = unsubscribe;
          unsubscribe = null;
          current?.();
        }
      };
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
