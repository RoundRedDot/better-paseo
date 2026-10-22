import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { createAgentTimelinePageReader, getAgentTimelinePageReader, type AgentTimelinePageReader } from "./agent-timeline-page-reader";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">;
type Page = Awaited<ReturnType<Timeline["refetch"]>>;

export interface ToolRollupPosition {
  order: number;
  previous?: string;
}

/** Source order, including native messages; timestamps change with tool results. */
export function toolRollupPositions(entries: Page["entries"]): Map<string, ToolRollupPosition> {
  const result = new Map<string, ToolRollupPosition>();
  const duplicates = new Set<string>();
  let previous: string | undefined;
  for (const { item, seqStart } of entries) {
    const id = item.type === "tool_call" ? item.callId : undefined;
    if (id) {
      if (result.has(id)) duplicates.add(id);
      else result.set(id, { order: seqStart, previous });
    }
    // Every other source item is a boundary, even if this plugin doesn't draw it.
    previous = id;
  }
  // Ambiguous duplicate source slots stay standalone rather than moving a card.
  for (const id of duplicates) result.delete(id);
  return result;
}

/** One observation and coalesced read per agent, retained only while rollup rows mount. */
export function createToolRollupOrderStore(source: () => Timeline,
  reader: AgentTimelinePageReader = createAgentTimelinePageReader()) {
  const wanted = new Map<string, number>();
  const listeners = new Set<() => void>();
  let positions = new Map<string, ToolRollupPosition>();
  let searched = new Set<string>();
  let stop: (() => void) | null = null;
  let pending: Promise<void> | null = null;
  let dirty = false;
  let revision = 0;
  const publish = () => { for (const listener of listeners) listener(); };
  const missing = () => [...wanted.keys()].some((id) => !positions.has(id) && !searched.has(id));

  async function read(ticket: number) {
    const timeline = source();
    let page = await reader.tail(timeline);
    const epoch = page.epoch;
    let entries = page.entries;
    const valid = () => !page.error && !page.gap && !page.staleCursor && page.epoch === epoch;
    if (!valid()) throw new Error("Incomplete rollup timeline");
    // ponytail: at most 10 older pages per read (~2050 rows); calls beyond
    // that span stay standalone. Upgrade by retaining covered pages/cursors
    // as the existing agent-message sender store does, if deeper history needs it.
    for (let pages = 0; page.hasOlder && pages < 10 && ticket === revision; pages++) {
      const found = new Set(entries.flatMap(({ item }) => item.type === "tool_call" && item.callId ? [item.callId] : []));
      if ([...wanted.keys()].every((id) => found.has(id))) break;
      const cursor = page.startCursor;
      if (!cursor) throw new Error("Missing rollup cursor");
      page = await reader.before(timeline, cursor);
      if (!valid() || page.reset || !page.entries.length || !page.startCursor || page.startCursor.seq >= cursor.seq) {
        throw new Error("Rollup timeline changed while paging");
      }
      entries = [...page.entries, ...entries];
    }
    if (ticket !== revision || !wanted.size) return;
    positions = toolRollupPositions(entries);
    searched = new Set(wanted.keys());
    publish();
  }

  function request() {
    dirty = true;
    pending ??= Promise.resolve().then(async () => {
      while (dirty && wanted.size) {
        dirty = false;
        const ticket = revision;
        try { await read(ticket); }
        catch {
          if (ticket === revision) {
            positions = new Map();
            searched = new Set(wanted.keys());
            publish(); // Failure is safe: render ordinary cards, never guessed groups.
          }
        }
      }
    }).finally(() => { pending = null; if (dirty && wanted.size) request(); });
  }

  return {
    get: (id: string) => positions.get(id) ?? null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retain(id: string) {
      wanted.set(id, (wanted.get(id) ?? 0) + 1);
      stop ??= reader.observe(source(), ({ event }) => {
        if (event.type === "replacement" || event.type === "subscription_restored" || event.type === "error") {
          revision++;
          positions = new Map();
          searched.clear();
          publish();
          reader.invalidate();
          request();
        } else if (event.type === "timeline" && event.item.type === "tool_call" &&
          event.item.callId && wanted.has(event.item.callId) && !positions.has(event.item.callId)) {
          searched.delete(event.item.callId);
          reader.invalidate();
          request();
        }
      });
      if (missing()) { reader.invalidate(); request(); }
      return () => {
        const count = (wanted.get(id) ?? 1) - 1;
        if (count) wanted.set(id, count); else wanted.delete(id);
        if (!wanted.size) {
          revision++;
          dirty = false;
          stop?.();
          stop = null;
          positions.clear();
          searched.clear();
        }
      };
    },
  };
}

const stores = new WeakMap<PaseoApi, Map<string, ReturnType<typeof createToolRollupOrderStore>>>();

export function useToolRollupPosition(agentId: string, callId: string | undefined): ToolRollupPosition | null {
  const paseo = usePaseo();
  const store = useMemo(() => {
    let agents = stores.get(paseo);
    if (!agents) stores.set(paseo, agents = new Map());
    let store = agents.get(agentId);
    if (!store) agents.set(agentId, store = createToolRollupOrderStore(() => paseo.agents.ref(agentId).timeline,
      getAgentTimelinePageReader(paseo, agentId)));
    return store;
  }, [paseo, agentId]);
  useLayoutEffect(() => callId ? store.retain(callId) : undefined, [store, callId]);
  const get = useCallback(() => callId ? store.get(callId) : null, [store, callId]);
  return useSyncExternalStore(store.subscribe, get, get);
}
