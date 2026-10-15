import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { completedTurnFooters, continuesTurn, type CompletedTurnFooter, type Entry } from "./turn-duration";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">;
interface Target { at: number; text: string }
type Footers = Map<number, Map<string, CompletedTurnFooter>>;

/** One paginated read and one event subscription per agent, shared by all rows. */
export function createTurnFooterStore(source: () => Timeline) {
  const targets = new Set<Target>();
  const listeners = new Set<() => void>();
  let footers: Footers = new Map();
  let entries: Entry[] = [];
  let running: boolean | null = null;
  let unsubscribe: ReturnType<Timeline["subscribe"]> | null = null;
  let generation = 0;
  let dirty = false;
  let pending: Promise<void> | null = null;
  const publish = () => { for (const listener of listeners) listener(); };
  const get = (at: number, text: string) => footers.get(at)?.get(text) ?? null;

  function needsOlder(items: Entry[]): boolean {
    for (const target of targets) {
      let index = items.findIndex((entry) => entry.item.type === "assistant_message" &&
        entry.item.text === target.text && Date.parse(entry.timestamp) === target.at);
      if (index < 0) {
        // New replies in the active turn wait for its terminal event. They
        // must not fetch history again for each intermediate model message.
        if (running && items.length && target.at >= Date.parse(items[items.length - 1]!.timestamp)) continue;
        return true;
      }
      while (index > 0 && continuesTurn(items[index - 1]!, items[index]!)) index--;
      if (index === 0 && items[index]!.item.type !== "user_message") return true;
    }
    return false;
  }

  async function read(ticket: number): Promise<void> {
    const timeline = source();
    let page = await timeline.refetch({ direction: "tail", projection: "projected", limit: 200 });
    const snapshot = page.agent;
    const epoch = page.epoch;
    let items = page.entries;
    while (ticket === generation && targets.size) {
      if (page.error || page.staleCursor || page.gap || page.epoch !== epoch) throw new Error("Incomplete turn footer timeline");
      if (!page.hasOlder || !needsOlder(items)) break;
      const cursor = page.startCursor;
      if (!cursor) throw new Error("Missing turn footer timeline cursor");
      page = await timeline.refetch({ direction: "before", cursor, projection: "projected", limit: 200 });
      if (page.reset || !page.entries.length || (page.startCursor && page.startCursor.seq >= cursor.seq)) {
        throw new Error("Turn footer timeline changed while paging");
      }
      items = [...page.entries, ...items];
    }
    if (ticket !== generation || !targets.size) return;
    entries = items;
    const next: Footers = new Map();
    for (const footer of completedTurnFooters(items, snapshot ? snapshot.status === "running" : running === true,
      snapshot?.activeTurn?.turnId ?? null)) {
      const previous = get(footer.at, footer.text);
      const value = previous?.completedAt === footer.completedAt && previous.startedAt === footer.startedAt &&
        previous.durationMs === footer.durationMs ? previous : footer;
      let at = next.get(footer.at);
      if (!at) next.set(footer.at, at = new Map());
      at.set(footer.text, value);
    }
    footers = next;
    publish();
    if (ticket === generation && !needsOlder(entries)) dirty = false;
  }

  function request(): Promise<void> {
    dirty = true;
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        while (dirty && targets.size) {
          dirty = false;
          const ticket = generation;
          try { await read(ticket); }
          catch {
            if (ticket === generation) {
              entries = [];
              footers = new Map();
              publish();
            }
          }
        }
      }).finally(() => { pending = null; });
    }
    return pending;
  }

  function refresh(): Promise<void> {
    generation++;
    return request();
  }

  return {
    get,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setRunning(next: boolean) {
      if (running === next) return;
      running = next;
      if (targets.size) void refresh();
    },
    retain(at: number, text: string) {
      const target = { at, text };
      targets.add(target);
      if (!unsubscribe) {
        unsubscribe = source().subscribe(({ event }) => {
          if (event.type === "replacement" || event.type === "subscription_restored") {
            entries = [];
            footers = new Map();
            publish();
            void refresh();
          } else if (event.type === "turn_started" || event.type === "turn_completed" ||
            event.type === "turn_failed" || event.type === "turn_canceled") void refresh();
        });
        void unsubscribe.ready.catch(() => {});
      }
      if (!entries.length || needsOlder(entries)) void request();
      return () => {
        targets.delete(target);
        if (!targets.size) {
          generation++;
          dirty = false;
          unsubscribe?.();
          unsubscribe = null;
          entries = [];
          footers = new Map();
        }
      };
    },
  };
}

const stores = new WeakMap<PaseoApi, Map<string, ReturnType<typeof createTurnFooterStore>>>();

export function useTurnFooter(paseo: PaseoApi, agentId: string, at: number, text: string, running: boolean | null) {
  const store = useMemo(() => {
    let agents = stores.get(paseo);
    if (!agents) stores.set(paseo, agents = new Map());
    let store = agents.get(agentId);
    if (!store) agents.set(agentId, store = createTurnFooterStore(() => paseo.agents.ref(agentId).timeline));
    return store;
  }, [paseo, agentId]);
  const enabled = typeof running === "boolean";
  useLayoutEffect(() => { if (enabled) store.setRunning(running); }, [store, enabled, running]);
  useLayoutEffect(() => {
    if (enabled) return store.retain(at, text);
  }, [store, enabled, at, text]);
  const getSnapshot = useCallback(() => enabled ? store.get(at, text) : null, [store, enabled, at, text]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
