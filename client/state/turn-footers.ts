import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentTimelineHandle } from "@getpaseo/client";
import { useRpc } from "@getpaseo/plugin/client";
import { turnUsageRpc, type RecordedTurn } from "../../shared/turn-usage-rpc";
import { completedTurnFooters, startsTurn, type CompletedTurnFooter, type Entry, type TurnMarks } from "./turn-duration";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">;
interface Target { at: number; text: string }
type Footers = Map<number, Map<string, CompletedTurnFooter>>;
type Usage = NonNullable<CompletedTurnFooter["usage"]>;

/**
 * A recorded turn ends at most this far before its last timeline item and this
 * far after it. Turn IDs restart with each daemon, and history the daemon
 * reloads from the provider has none, so the end time does the matching.
 */
const RECORD_EARLY_MS = 5_000;
const RECORD_LATE_MS = 10 * 60_000;

/**
 * Gives each record to the loaded turn that ended nearest to it, among all of
 * them, so a turn without a record never takes its neighbour's. A turn ID, when
 * the footer has one, must also match.
 */
function assignRecorded(turns: readonly RecordedTurn[], footers: readonly CompletedTurnFooter[]) {
  const assigned = new Map<CompletedTurnFooter, { usage?: Usage; gap: number }>();
  for (const turn of turns) {
    let best: CompletedTurnFooter | undefined;
    let bestGap = Infinity;
    for (const footer of footers) {
      const gap = turn.endedAt - footer.completedAt;
      if ((footer.turnId && footer.turnId !== turn.turnId) || gap < -RECORD_EARLY_MS || gap > RECORD_LATE_MS) continue;
      if (Math.abs(gap) < bestGap) { best = footer; bestGap = Math.abs(gap); }
    }
    const previous = best && assigned.get(best);
    if (best && (!previous || bestGap < previous.gap)) assigned.set(best, { usage: turn.usage, gap: bestGap });
  }
  return assigned;
}

/** The recorded turns' starts and ends that fall in the loaded span. */
function turnMarks(turns: readonly RecordedTurn[], from: number): TurnMarks | undefined {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const turn of turns) {
    if (turn.startedAt !== undefined && turn.startedAt >= from) starts.push(turn.startedAt);
    if (turn.endedAt >= from) ends.push(turn.endedAt);
  }
  if (!starts.length && !ends.length) return undefined;
  return { starts: starts.sort((a, b) => a - b), ends: ends.sort((a, b) => a - b) };
}

/**
 * One paginated read and one event subscription per agent, shared by all rows.
 * Usage seen live wins; a turn this client did not see falls back to the
 * server's record, which survives reloads. The record also times turns no
 * prompt started and splits history reloaded without turn IDs.
 */
export function createTurnFooterStore(source: () => Timeline, loadRecorded?: (since: number) => Promise<RecordedTurn[]>) {
  const targets = new Set<Target>();
  const listeners = new Set<() => void>();
  const usageByTurn = new Map<string, Usage>();
  let recorded: readonly RecordedTurn[] = [];
  let recordedStale = true;
  let recordedSince = Infinity;
  let observers = 0;
  let footers: Footers = new Map();
  let entries: Entry[] = [];
  /** The loaded entries begin at the agent's first item. */
  let fromStart = false;
  let running: boolean | null = null;
  let unsubscribe: ReturnType<Timeline["subscribe"]> | null = null;
  let generation = 0;
  let dirty = false;
  let pending: Promise<void> | null = null;
  const coverage = new WeakMap<Entry[], Map<number, Map<string, boolean>>>();
  const publish = () => { for (const listener of listeners) listener(); };
  const get = (at: number, text: string) => footers.get(at)?.get(text) ?? null;

  /** `atStart`: no older page exists, so a turn at the top is whole. */
  function needsOlder(items: Entry[], atStart = false): boolean {
    let indexed = coverage.get(items);
    if (!indexed) {
      indexed = new Map();
      let start = 0;
      for (let index = 0; index < items.length; index++) {
        if (index > 0 && startsTurn(items[index - 1]!, items[index]!)) start = index;
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
      if (!complete && !atStart) return true;
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
    fromStart = !page.hasOlder;
    const isRunning = snapshot ? snapshot.status === "running" : running === true;
    const activeTurnId = snapshot?.activeTurn?.turnId ?? null;
    const build = (marks?: TurnMarks) => {
      const completed = completedTurnFooters(items, isRunning, activeTurnId, { marks, fromStart });
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
      return completed;
    };
    let completed = build();
    // Ask only for the loaded turns' span, and again when older pages or new turns lack usage.
    const unseen = (footer: CompletedTurnFooter) => footer.turnId ? !usageByTurn.has(footer.turnId) : !footer.usage;
    let since = Infinity;
    for (const footer of completed) if (unseen(footer)) since = Math.min(since, footer.completedAt - RECORD_EARLY_MS);
    // History without turn IDs, or a turn without a prompt, needs the record's turn boundaries.
    const firstAt = items.length ? Date.parse(items[0]!.timestamp) : NaN;
    const prompts = new Set<number>();
    for (const entry of items) if (entry.item.type === "user_message") prompts.add(Date.parse(entry.timestamp));
    if (Number.isFinite(firstAt) && completed.length && (items.some((entry) => entry.turnId === undefined) ||
      completed.some((footer) => footer.startedAt === null || !prompts.has(footer.startedAt)))) {
      since = Math.min(since, firstAt - RECORD_EARLY_MS);
    }
    if (loadRecorded && since !== Infinity && (recordedStale || since < recordedSince)) {
      recordedStale = false;
      recordedSince = since;
      try { recorded = await loadRecorded(since); }
      catch { recordedStale = true; }
      if (ticket !== generation || !targets.size) return;
    }
    const marks = Number.isFinite(firstAt) ? turnMarks(recorded, firstAt - RECORD_EARLY_MS) : undefined;
    if (marks) completed = build(marks);
    const fallback = since === Infinity ? null : assignRecorded(recorded, completed);
    const next: Footers = new Map();
    for (const footer of completed) {
      const record = unseen(footer) ? fallback?.get(footer)?.usage : undefined;
      if (footer.turnId) footer.usage = usageByTurn.get(footer.turnId) ?? record;
      else footer.usage ??= record;
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
    if (ticket === generation && !needsOlder(entries, fromStart)) dirty = false;
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
        recordedStale = true;
        publish();
        if (targets.size) void refresh();
      } else if (event.type === "turn_started" || event.type === "turn_completed" ||
        event.type === "turn_failed" || event.type === "turn_canceled") {
        // Only a provider-reported turn ID can attribute usage to history.
        if (event.type === "turn_completed" && event.turnId && event.usage) {
          usageByTurn.set(event.turnId, { ...event.usage });
        }
        // The server records every ended turn's timing, and usage on completion.
        if (event.type !== "turn_started") recordedStale = true;
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
    fromStart = false;
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
      if (!entries.length || needsOlder(entries, fromStart)) void request();
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
  const turnUsage = useRpc(turnUsageRpc);
  const turnUsageRef = useRef(turnUsage);
  turnUsageRef.current = turnUsage;
  const store = useMemo(() => {
    let agents = stores.get(paseo);
    if (!agents) stores.set(paseo, agents = new Map());
    let store = agents.get(agentId);
    if (!store) agents.set(agentId, store = createTurnFooterStore(() => paseo.agents.ref(agentId).timeline,
      async (since) => (await turnUsageRef.current({ agentId, since })).turns));
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
