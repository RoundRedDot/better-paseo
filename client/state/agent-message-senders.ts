import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentTimelineEvent, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { agentMessageSchema, type AgentMessage } from "../tools/agent-message";
import { createAgentTimelinePageReader, getAgentTimelinePageReader, isAgentTimelinePageInvalidation,
  type AgentTimelinePageReader } from "./agent-timeline-page-reader";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">;
type Page = Awaited<ReturnType<Timeline["refetch"]>>;
type Cursor = NonNullable<Page["startCursor"]>;

/** The contiguous span of the timeline already read, newest first. */
interface Covered { epoch: string; start: Cursor; endSeq: number; complete: boolean }

function readEntry(item: unknown): [string, AgentMessage] | undefined {
  const call = item as { type?: unknown; name?: unknown; callId?: unknown; agentMessage?: unknown } | null;
  if (call?.type !== "tool_call" || call.name !== "agent_message" || typeof call.callId !== "string") return undefined;
  const message = agentMessageSchema.safeParse(call.agentMessage);
  return message.success ? [call.callId, message.data] : undefined;
}

/**
 * Paseo hands timeline transformers a tool call without its `agentMessage`,
 * and a plain agent-to-agent message names no sender in its detail. The
 * daemon's timeline still carries it, so a message row reads its sender back
 * by call ID. One read serves every row of an agent, and the span read is
 * remembered: a row mounting further up history pages on from there instead
 * of from the tail again.
 */
export function createAgentMessageSenderStore(source: () => Timeline,
  pageReader: AgentTimelinePageReader = createAgentTimelinePageReader()) {
  const senders = new Map<string, AgentMessage>();
  const wanted = new Map<string, number>();
  /** Not in the timeline when last read through; not asked for again. */
  const searched = new Set<string>();
  const listeners = new Set<() => void>();
  let covered: Covered | null = null;
  let dirty = false;
  let pending: Promise<void> | null = null;
  let stopObserving: (() => void) | null = null;

  const unresolved = () => [...wanted.keys()].filter((id) => !senders.has(id) && !searched.has(id));
  const absorb = (entries: Page["entries"]) => {
    let changed = false;
    for (const entry of entries) {
      const read = readEntry(entry.item);
      if (read && !senders.has(read[0])) { senders.set(read[0], read[1]); changed = true; }
    }
    return changed;
  };

  async function read(ids: string[]): Promise<boolean> {
    const timeline = source();
    const tail = await pageReader.tail(timeline);
    if (tail.error) throw new Error(tail.error);
    let changed = absorb(tail.entries);
    if (!tail.startCursor || !tail.endCursor) {
      covered = null;
      return changed;
    }
    // The tail reaches back into the span already read: carry on below that span.
    const joins = covered && covered.epoch === tail.epoch && tail.startCursor.seq <= covered.endSeq + 1 &&
      tail.startCursor.seq >= covered.start.seq;
    covered = joins && covered
      ? { ...covered, endSeq: tail.endCursor.seq }
      : { epoch: tail.epoch, start: tail.startCursor, endSeq: tail.endCursor.seq, complete: !tail.hasOlder };
    while (!covered.complete && ids.some((id) => !senders.has(id))) {
      const cursor: Cursor = covered.start;
      const page = await pageReader.before(timeline, cursor);
      if (page.error || page.reset || page.staleCursor || page.gap || page.epoch !== cursor.epoch ||
        !page.startCursor || page.startCursor.seq >= cursor.seq) {
        covered = null;
        throw new Error("Agent message timeline changed while paging");
      }
      changed = absorb(page.entries) || changed;
      covered = { ...covered, start: page.startCursor, complete: !page.hasOlder };
    }
    return changed;
  }

  function request() {
    dirty = true;
    pending ??= Promise.resolve().then(async () => {
      while (dirty) {
        dirty = false;
        const ids = unresolved();
        if (!ids.length) break;
        let changed = false;
        try { changed = await read(ids); }
        catch { /* The rows keep their senderless look. */ }
        for (const id of ids) if (!senders.has(id)) searched.add(id);
        if (changed) for (const listener of listeners) listener();
      }
    }).finally(() => {
      pending = null;
      if (dirty) request();
    });
  }

  function onTimelineEvent(event: PaseoAgentTimelineEvent) {
    if (!isAgentTimelinePageInvalidation(event)) return;
    if (event.event.type === "replacement" || event.event.type === "subscription_restored") {
      covered = null;
      searched.clear();
      if (senders.size) {
        senders.clear();
        for (const listener of listeners) listener();
      }
    }
    const activeIds = [...wanted.keys()].filter((id) => !senders.has(id));
    for (const id of activeIds) searched.delete(id);
    if (activeIds.length) request();
  }

  return {
    get: (callId: string) => senders.get(callId) ?? null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    retain(callId: string) {
      wanted.set(callId, (wanted.get(callId) ?? 0) + 1);
      stopObserving ??= pageReader.observe(source(), onTimelineEvent);
      if (!senders.has(callId) && !searched.has(callId)) request();
      return () => {
        const count = (wanted.get(callId) ?? 1) - 1;
        if (count > 0) wanted.set(callId, count);
        else wanted.delete(callId);
        if (!wanted.size) {
          stopObserving?.();
          stopObserving = null;
        }
      };
    },
  };
}

const stores = new WeakMap<PaseoApi, Map<string, ReturnType<typeof createAgentMessageSenderStore>>>();

/** The provenance of a message row the transformer could not see, or null while it is unknown. */
export function useAgentMessageSender(agentId: string, callId: string): AgentMessage | null {
  const paseo = usePaseo();
  const store = useMemo(() => {
    let agents = stores.get(paseo);
    if (!agents) stores.set(paseo, agents = new Map());
    let store = agents.get(agentId);
    if (!store) agents.set(agentId, store = createAgentMessageSenderStore(() => paseo.agents.ref(agentId).timeline,
      getAgentTimelinePageReader(paseo, agentId)));
    return store;
  }, [paseo, agentId]);
  useLayoutEffect(() => store.retain(callId), [store, callId]);
  const get = useCallback(() => store.get(callId), [store, callId]);
  return useSyncExternalStore(store.subscribe, get, get);
}
