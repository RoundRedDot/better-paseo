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
  const usageByTurn = new Map<string, NonNullable<CompletedTurnFooter["usage"]>>();
  let observers = 0;
  let footers: Footers = new Map();
  let entries: Entry[] = [];
  let running: boolean | null = null;
  let unsubscribe: ReturnType<Timeline["subscribe"]> | null = null;
  let generation = 0;
  let dirty = false;
  let pending: Promise<void> | null = null;
  const coverage = new WeakMap<Entry[], Map<number, Map<string, boolean>>>();
  const publish = () => { for (const listener of listeners) listener(); };
  const get = (at: number, text: string) => footers.get(at)?.get(text) ?? null;

  function needsOlder(items: Entry[]): boolean {
    let indexed = coverage.get(items);
    if (!indexed) {
      indexed = new Map();
      let start = 0;
      for (let index = 0; index < items.length; index++) {
        if (index > 0 && !continuesTurn(items[index - 1]!, items[index]!)) start = index;
        const entry = items[index]!;
        if (entry.item.type !== "assistant_message") continue;
        const at = Date.parse(entry.timestamp);
        let texts = indexed.get(at);
        if (!texts) indexed.set(at, texts = new Map());
        // Match the first source occurrence, as the original findIndex did.
        if (!texts.has(entry.item.text)) texts.set(entry.item.text,
          start > 0 || items[0]!.item.type === "user_message");
      }
      coverage.set(items, indexed);
    }
    const lastAt = items.length ? Date.parse(items[items.length - 1]!.timestamp) : NaN;
    for (const target of targets) {
      const complete = indexed.get(target.at)?.get(target.text);
      if (complete === undefined) {
        // New replies in the active turn wait for its terminal event. They
        // must not fetch history again for each intermediate model message.
        if (running && target.at >= lastAt) continue;
        return true;
      }
      if (!complete) return true;
    }
    return false;
  }

  async function read(ticket: number): Promise<void> {
    const timeline = source();
    let page = await timeline.refetch({ direction: "tail", projection: "projected", limit: 200 });
    const snapshot = page.agent;
    const hasNewer = page.hasNewer;
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
    const completed = completedTurnFooters(items, snapshot ? snapshot.status === "running" : running === true,
      snapshot?.activeTurn?.turnId ?? null);
    const latest = completed[completed.length - 1];
    // The daemon retains the latest usage even when a window missed completion.
    // Attach it only to the settled tail turn whose prompt matches its snapshot.
    if (latest && !hasNewer && snapshot?.status === "idle" && !snapshot.activeTurn && snapshot.lastUsage &&
      snapshot.lastUserMessageAt && latest.startedAt === Date.parse(snapshot.lastUserMessageAt) &&
      latest.completedAt === Date.parse(items[items.length - 1]!.timestamp)) {
      const previousUsage = latest.turnId ? usageByTurn.get(latest.turnId) : get(latest.at, latest.text)?.usage;
      latest.usage = JSON.stringify(previousUsage) === JSON.stringify(snapshot.lastUsage)
        ? previousUsage : { ...snapshot.lastUsage };
      if (latest.turnId && latest.usage) usageByTurn.set(latest.turnId, latest.usage);
    }
    for (const footer of completed) {
      if (footer.turnId) footer.usage = usageByTurn.get(footer.turnId);
      const previous = get(footer.at, footer.text);
      const value = previous?.completedAt === footer.completedAt && previous.startedAt === footer.startedAt &&
        previous.durationMs === footer.durationMs && previous.turnId === footer.turnId &&
        previous.usage === footer.usage ? previous : footer;
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

  function connect() {
    if (unsubscribe) return;
    unsubscribe = source().subscribe(({ event }) => {
      if (event.type === "replacement" || event.type === "subscription_restored") {
        entries = [];
        footers = new Map();
        if (event.type === "replacement") usageByTurn.clear();
        publish();
        if (targets.size) void refresh();
      } else if (event.type === "turn_started" || event.type === "turn_completed" ||
        event.type === "turn_failed" || event.type === "turn_canceled") {
        // Only a provider-reported turn ID can attribute usage to history.
        if (event.type === "turn_completed" && event.turnId && event.usage) {
          usageByTurn.set(event.turnId, { ...event.usage });
        }
        if (targets.size) void refresh();
      }
    });
    void unsubscribe.ready.catch(() => {});
  }

  function disconnect() {
    if (targets.size || observers) return;
    generation++;
    dirty = false;
    unsubscribe?.();
    unsubscribe = null;
    entries = [];
    footers = new Map();
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
    observe() {
      observers++;
      connect();
      return () => { observers--; disconnect(); };
    },
    retain(at: number, text: string) {
      const target = { at, text };
      targets.add(target);
      connect();
      if (!entries.length || needsOlder(entries)) void request();
      return () => {
        targets.delete(target);
        disconnect();
      };
    },
  };
}

const stores = new WeakMap<PaseoApi, Map<string, ReturnType<typeof createTurnFooterStore>>>();

export function useTurnFooter(paseo: PaseoApi, agentId: string, at: number, text: string, running: boolean | null,
  observeOnly = false) {
  const store = useMemo(() => {
    let agents = stores.get(paseo);
    if (!agents) stores.set(paseo, agents = new Map());
    let store = agents.get(agentId);
    if (!store) agents.set(agentId, store = createTurnFooterStore(() => paseo.agents.ref(agentId).timeline));
    return store;
  }, [paseo, agentId]);
  const enabled = typeof running === "boolean";
  const targetAt = observeOnly ? 0 : at;
  const targetText = observeOnly ? "" : text;
  useLayoutEffect(() => { if (enabled) store.setRunning(running); }, [store, enabled, running]);
  useLayoutEffect(() => {
    if (enabled) return observeOnly ? store.observe() : store.retain(targetAt, targetText);
  }, [store, enabled, targetAt, targetText, observeOnly]);
  const getSnapshot = useCallback(() => enabled && !observeOnly ? store.get(targetAt, targetText) : null,
    [store, enabled, observeOnly, targetAt, targetText]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
