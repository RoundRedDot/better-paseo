import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoAgentTimelineHandle } from "@getpaseo/client";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import { useRpc } from "@getpaseo/plugin/client";
import { turnUsageRpc, type RecordedTurn } from "../../shared/turn-usage-rpc";
import { createAgentTimelinePageReader, getAgentTimelinePageReader, type AgentTimelinePageReader } from "./agent-timeline-page-reader";
import { completedTurnFooters, startsTurn, type CompletedTurnFooter, type Entry, type TurnMarks } from "./turn-duration";
import { collectTurnWork, liveCallSignature, splitTurns, workSignature, type TurnSpan, type TurnWork } from "./turn-work";

type Timeline = Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe">;
interface Target { at: number; text: string }
type Footers = Map<number, Map<string, CompletedTurnFooter>>;
type Usage = NonNullable<CompletedTurnFooter["usage"]>;

/**
 * The row that draws a turn's work card. A finished turn uses its final
 * assistant reply. While that reply is still streaming, every live update
 * shares one anchor, because the reply text changes on each chunk.
 */
export type WorkAnchor =
  | { kind: "reply"; at: number; text: string }
  | { kind: "live" };

export function workAnchorKey(anchor: WorkAnchor): string {
  return anchor.kind === "reply" ? `r:${anchor.at}:${anchor.text}` : "live";
}

type TurnSplitState = { running: boolean; activeTurnId: string | null; marks?: TurnMarks; fromStart: boolean };

/** Added and removed lines of one edit or write; `viewable`: it has a diff or content to show. */
export interface LineCount { added: number; removed: number; viewable: boolean }

interface TurnIndex {
  spans: TurnSpan[];
  byReply: Map<string, TurnSpan>;
}

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

/**
 * The loaded window is one running turn cut off at the top. A turn boundary
 * inside the window means the running turn starts here.
 */
function activeWindowIsCut(items: Entry[], atStart: boolean): boolean {
  if (atStart || items.length === 0) return false;
  let start = 0;
  for (let index = 1; index < items.length; index++) {
    if (startsTurn(items[index - 1]!, items[index]!)) start = index;
  }
  return start === 0 && items[0]!.item.type !== "user_message";
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
export function createTurnFooterStore(source: () => Timeline, loadRecorded?: (since: number) => Promise<RecordedTurn[]>,
  pageReader: AgentTimelinePageReader = createAgentTimelinePageReader()) {
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
  let unsubscribe: (() => void) | null = null;
  let generation = 0;
  let dirty = false;
  let pending: Promise<void> | null = null;
  const coverage = new WeakMap<Entry[], Map<number, Map<string, boolean>>>();
  // Turn work (`turn-work.ts`): how the last read split its entries, the
  // calls the subscription delivered since, and each card's last result.
  let split: TurnSplitState = { running: false, activeTurnId: null, fromStart: false };
  // The entries as of the last published read: a read assigns `entries`
  // before its footers settle, and the cards follow the footers.
  let workEntries: Entry[] = [];
  let index: TurnIndex | null = null;
  const live = new Map<string, ToolCallTimelineItem>();
  let liveRevision = 0;
  let liveRetains = 0;
  const workListeners = new Map<string, Set<() => void>>();
  const works = new Map<string, { entries: Entry[]; liveRevision: number; owns: (text: string) => boolean; work: TurnWork | null }>();
  const lineCounts = new Map<string, LineCount | null>();
  const publish = () => {
    for (const listener of listeners) listener();
    for (const set of workListeners.values()) for (const listener of set) listener();
  };
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
    // The streaming reply's card needs the running turn back to its start.
    // A newer reply still waits for the turn event that refreshes the read.
    if (liveRetains > 0 && activeWindowIsCut(items, atStart)) return true;
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
    let page = await pageReader.tail(timeline);
    const snapshot = page.agent;
    const hasNewer = page.hasNewer;
    const epoch = page.epoch;
    let items = page.entries;
    while (ticket === generation && retained()) {
      if (page.error || page.staleCursor || page.gap || page.epoch !== epoch) throw new Error("Incomplete turn footer timeline");
      if (!page.hasOlder || !needsOlder(items)) break;
      const cursor = page.startCursor;
      if (!cursor) throw new Error("Missing turn footer timeline cursor");
      page = await pageReader.before(timeline, cursor);
      if (page.reset || !page.entries.length || (page.startCursor && page.startCursor.seq >= cursor.seq)) {
        throw new Error("Turn footer timeline changed while paging");
      }
      items = [...page.entries, ...items];
    }
    if (ticket !== generation || !retained()) return;
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
      if (ticket !== generation || !retained()) return;
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
    split = { running: isRunning, activeTurnId, marks, fromStart };
    workEntries = items;
    index = null;
    // The read now holds every call the subscription delivered before it.
    if (!isRunning) live.clear();
    publish();
    if (ticket === generation && !needsOlder(entries, fromStart)) dirty = false;
  }

  function request(): Promise<void> {
    dirty = true;
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        while (dirty && retained()) {
          dirty = false;
          const ticket = generation;
          try { await read(ticket); }
          catch {
            if (ticket === generation) {
              entries = [];
              workEntries = [];
              footers = new Map();
              index = null;
              publish();
            }
          }
        }
      }).finally(() => { pending = null; });
    }
    return pending;
  }

  function refresh(): Promise<void> {
    pageReader.invalidate();
    generation++;
    return request();
  }

  function connect() {
    if (unsubscribe) return;
    unsubscribe = pageReader.observe(source(), ({ event }) => {
      if (event.type === "timeline") {
        if (event.item.type === "tool_call") noteLiveCall(event.item);
        return;
      }
      if (event.type === "replacement" || event.type === "subscription_restored") {
        entries = [];
        workEntries = [];
        footers = new Map();
        index = null;
        live.clear();
        liveRevision++;
        if (event.type === "replacement") usageByTurn.clear();
        recordedStale = true;
        publish();
        if (retained()) void refresh();
      } else if (event.type === "turn_started" || event.type === "turn_completed" ||
        event.type === "turn_failed" || event.type === "turn_canceled") {
        // Only a provider-reported turn ID can attribute usage to history.
        if (event.type === "turn_completed" && event.turnId && event.usage) {
          usageByTurn.set(event.turnId, { ...event.usage });
        }
        // The server records every ended turn's timing, and usage on completion.
        if (event.type !== "turn_started") recordedStale = true;
        else if (live.size) { live.clear(); liveRevision++; }
        if (retained()) void refresh();
      }
    });
  }

  function disconnect() {
    if (retained() || observers) return;
    generation++;
    dirty = false;
    unsubscribe?.();
    unsubscribe = null;
    entries = [];
    workEntries = [];
    fromStart = false;
    footers = new Map();
    index = null;
    live.clear();
    works.clear();
    lineCounts.clear();
  }

  function retained(): boolean {
    return targets.size > 0 || liveRetains > 0;
  }

  function turnIndex(): TurnIndex {
    if (index) return index;
    const spans = splitTurns(workEntries, split);
    const byReply = new Map<string, TurnSpan>();
    const replies = new Map<string, number>();
    for (const span of spans) {
      if (span.reply) {
        const key = workAnchorKey({ kind: "reply", ...span.reply });
        replies.set(key, (replies.get(key) ?? 0) + 1);
        byReply.set(key, span);
      }
    }
    // Two turns whose final replies cannot be told apart draw neither card.
    for (const [key, count] of replies) if (count > 1) byReply.delete(key);
    index = { spans, byReply };
    return index;
  }

  /**
   * A call the subscription delivered. Copied only while something retains
   * the live anchor. Only a change of status, kind, path or command notifies
   * that listener. Streamed output, or another chunk of the same edit, does not.
   */
  function noteLiveCall(item: ToolCallTimelineItem) {
    const listeners = workListeners.get(workAnchorKey({ kind: "live" }));
    // Nobody is drawing the running card, so the call's payload is not copied.
    if (!item.callId || !listeners?.size) return;
    const previous = live.get(item.callId);
    live.set(item.callId, item);
    if (previous && liveCallSignature(previous) === liveCallSignature(item)) return;
    liveRevision++;
    listeners.forEach((listener) => listener());
  }

  /**
   * The card for `anchor`, or null when this row does not draw it or the turn
   * folded nothing. `owns` says whether the plugin draws a reply's row.
   */
  function work(anchor: WorkAnchor, owns: (text: string) => boolean): TurnWork | null {
    const key = workAnchorKey(anchor);
    const cached = works.get(key);
    const { spans, byReply } = turnIndex();
    const span = anchor.kind === "reply" ? byReply.get(key) :
      spans[spans.length - 1]?.active ? spans[spans.length - 1] : undefined;
    const dependsOnLive = anchor.kind === "live" || (span?.active ?? false);
    if (cached && cached.entries === workEntries && cached.owns === owns &&
      (!dependsOnLive || cached.liveRevision === liveRevision)) return cached.work;
    let next: TurnWork | null = null;
    if (span && (anchor.kind === "live" || (span.reply !== null && owns(span.reply.text)))) {
      const collected = collectTurnWork(workEntries, span, key, live);
      if (anchor.kind === "reply") {
        const footer = get(anchor.at, anchor.text);
        if (footer && footer.durationMs !== null) collected.durationMs = footer.durationMs;
      }
      next = collected.steps.length || collected.current ? collected : null;
    }
    if (cached && workSignature(cached.work) === workSignature(next)) next = cached.work;
    works.set(key, { entries: workEntries, liveRevision, owns, work: next });
    return next;
  }

  /** A folded edit's added and removed lines, measured once per call. */
  function lineCount(callId: string, item: ToolCallTimelineItem, measure: (item: ToolCallTimelineItem) => LineCount | null) {
    if (lineCounts.has(callId)) return lineCounts.get(callId)!;
    const count = item.status === "completed" ? measure(item) : null;
    if (item.status === "completed") lineCounts.set(callId, count);
    return count;
  }

  return {
    get,
    work,
    lineCount,
    subscribeWork(anchor: WorkAnchor, listener: () => void) {
      const key = workAnchorKey(anchor);
      let set = workListeners.get(key);
      if (!set) workListeners.set(key, set = new Set());
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (!set!.size) {
          workListeners.delete(key);
          works.delete(key);
        }
      };
    },
    /**
     * A live-anchor caller keeps the read back to the running turn's start.
     * The product card does not call this.
     */
    retainLive() {
      liveRetains++;
      connect();
      if (!entries.length || needsOlder(entries, fromStart)) void request();
      // The running card passes from row to row as rows arrive: the row
      // giving it up releases in the same commit the next row retains. The
      // release waits for that commit to finish, so the store neither drops
      // the turn's live calls in between nor counts itself unretained while
      // the commit's other rows report the agent's status.
      let released = false;
      return () => {
        if (released) return;
        released = true;
        queueMicrotask(() => {
          liveRetains = Math.max(0, liveRetains - 1);
          disconnect();
        });
      };
    },
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setRunning(next: boolean) {
      if (running === next) return;
      running = next;
      if (retained()) void refresh();
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

/** The agent's one footer store, shared by its reply footers and work cards. */
function useFooterStore(paseo: PaseoApi, agentId: string) {
  const turnUsage = useRpc(turnUsageRpc);
  const turnUsageRef = useRef(turnUsage);
  turnUsageRef.current = turnUsage;
  return useMemo(() => {
    let agents = stores.get(paseo);
    if (!agents) stores.set(paseo, agents = new Map());
    let store = agents.get(agentId);
    if (!store) agents.set(agentId, store = createTurnFooterStore(() => paseo.agents.ref(agentId).timeline,
      async (since) => (await turnUsageRef.current({ agentId, since })).turns,
      getAgentTimelinePageReader(paseo, agentId)));
    return store;
  }, [paseo, agentId]);
}

export type TurnFooterStore = ReturnType<typeof createTurnFooterStore>;

/**
 * A row's work card (`turn-work.ts`), or null. A finished reply rides on the
 * read its footer already retains. The live anchor keeps that read back to
 * the running turn, and the product card does not use it. A null anchor
 * subscribes to nothing.
 */
/**
 * `retain`: a live anchor keeps the store reading the running turn. A reader
 * that only takes over a card another row still retains passes false.
 */
export function useTurnWork(paseo: PaseoApi, agentId: string, anchor: WorkAnchor | null, owns: (text: string) => boolean,
  running: boolean | null = null, retain = true) {
  const store = useFooterStore(paseo, agentId);
  useLayoutEffect(() => { if (typeof running === "boolean") store.setRunning(running); }, [store, running]);
  const key = anchor ? workAnchorKey(anchor) : null;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const live = anchor?.kind === "live" && retain;
  useLayoutEffect(() => {
    if (live) return store.retainLive();
  }, [store, live]);
  const subscribe = useCallback((listener: () => void) => {
    const current = anchorRef.current;
    return current ? store.subscribeWork(current, listener) : () => {};
  }, [store, key]);
  const getSnapshot = useCallback(() => anchorRef.current ? store.work(anchorRef.current, owns) : null,
    [store, key, owns]);
  return { store, work: useSyncExternalStore(subscribe, getSnapshot, getSnapshot) };
}

export function useTurnFooter(paseo: PaseoApi, agentId: string, at: number, text: string, running: boolean | null,
  observeOnly = false) {
  const store = useFooterStore(paseo, agentId);
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
