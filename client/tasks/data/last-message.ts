import { useEffect, useSyncExternalStore } from "react";
import type { PaseoAgentTimelineEvent, PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";
import type { FirstPrompt } from "./first-prompt";
import { turnRunning, type LaneId } from "../model";

/**
 * The agent's latest reply, for the details card under the first prompt: the
 * last `assistant_message` of the timeline's tail (the projected rows merge a
 * reply's chunks into one).
 *
 * Unlike the first prompt it moves, so each read is tied to a version the
 * caller derives from the card (a turn starting or ending, the lane); a new
 * version reads the tail again and keeps the old text up until it lands.
 * A closed agent waits for `load()`, as reading its timeline resumes it.
 */
export type LastMessage = FirstPrompt;

type Api = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "refetch"> } } };
type Timeline = Pick<PaseoAgentTimelineHandle, "refetch">;
/** How a versioned store reads its value off an agent's timeline. */
export type TimelineRead<V extends Value = LastMessage> = (timeline: Timeline) => Promise<V>;
/** What a versioned store holds: a read's states, plus whatever its reader adds. */
type Value = LastMessage | { state: string };

/** The tail rows read: tool rows can follow the last reply, the projection folding each call into one. */
const TAIL_LIMIT = 40;

const IDLE: LastMessage = { state: "idle" };
const LOADING: LastMessage = { state: "loading" };
/** Read once for its version: asked again only when the version moves. */
const SETTLED = new Set(["ready", "loading", "first"]);

interface Entry<V> {
  version: string;
  value: V;
  /** Bumped on each read, so a slower stale read cannot land over a newer one. */
  ticket: number;
}

interface Store<V extends Value = LastMessage> {
  read(agentId: string): V;
  request(agentId: string, version: string): void;
  subscribe(listener: () => void): () => void;
}

/** The latest reply: the last assistant message among the tail rows. */
const readLastReply: TimelineRead = (timeline) =>
  timeline.refetch({ direction: "tail", projection: "projected", limit: TAIL_LIMIT }).then((page) => {
    if (page.error) return { state: "error" };
    return lastReplyMessage(page.entries) ?? { state: "none" };
  });

/** A value read off a timeline once per version; `readValue` is the latest reply unless given another. */
export function createLastMessageStore<V extends Value = LastMessage>(api: Api, readValue: TimelineRead<V> = readLastReply as TimelineRead<V>): Store<V> {
  const entries = new Map<string, Entry<V>>();
  const listeners = new Set<() => void>();
  let tickets = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    read: (agentId) => entries.get(agentId)?.value ?? (IDLE as V),
    request(agentId, version) {
      const known = entries.get(agentId);
      if (known && known.version === version && SETTLED.has(known.value.state)) return;
      const ticket = ++tickets;
      // A newer version keeps showing the older reply until the tail answers.
      const value = known?.value.state === "ready" ? known.value : (LOADING as V);
      entries.set(agentId, { version, value, ticket });
      if (value !== known?.value) notify();
      const land = (next: V) => {
        if (entries.get(agentId)?.ticket !== ticket) return;
        entries.set(agentId, { version, value: next, ticket });
        notify();
      };
      readValue(api.agents.ref(agentId).timeline)
        .then(land)
        .catch(() => land({ state: "error" } as V));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The last nonempty assistant message and its own timestamp among a timeline's tail rows. */
export function lastReplyMessage(entries: readonly { timestamp?: string; item: { type: string; text?: string } }[]): Extract<LastMessage, { state: "ready" }> | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { item, timestamp } = entries[index]!;
    if (item.type !== "assistant_message") continue;
    const text = item.text?.trim();
    if (text) return { state: "ready", text, timestamp };
  }
  return null;
}

/**
 * What the latest reply is read again on: a running card's turn start, else
 * its lane and last update (a turn ending, an answer, a resume).
 */
export function lastMessageVersion(card: { lane: LaneId; waitingOnSubtasks?: boolean; timing: { updatedAt: string; turnStartedAt: string | null } }): string {
  return turnRunning(card) ? `running|${card.timing.turnStartedAt ?? ""}` : `${card.lane}|${card.timing.updatedAt}`;
}

type LiveApi = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "refetch" | "subscribe"> } } };
type Stream = { seq?: number; epoch?: string; timestamp: string; event: Extract<PaseoAgentTimelineEvent["event"], { type: "timeline" }> };
type Tail = { type: string; seqEnd: number; turnId?: string; messageId?: string };

interface LiveEntry {
  value: LastMessage;
  version: string;
  ticket: number;
  cursor: { epoch: string; seq: number } | null;
  tail: Tail | null;
  raw: string;
  pending: boolean;
  buffered: Stream[];
  observers: number;
  unsubscribe?: () => void;
  ready?: Promise<void>;
}

/** The projected tail seeds the reply; canonical live rows extend it without another RPC per chunk. */
export function createLiveLastMessageStore(api: LiveApi) {
  const entries = new Map<string, LiveEntry>();
  const listeners = new Set<() => void>();
  const entryFor = (id: string) => {
    let entry = entries.get(id);
    if (!entry) {
      entry = { value: IDLE, version: "", ticket: 0, cursor: null, tail: null, raw: "", pending: false, buffered: [], observers: 0 };
      entries.set(id, entry);
    }
    return entry;
  };
  const notify = () => { for (const listener of listeners) listener(); };
  const apply = (entry: LiveEntry, update: Stream): boolean => {
    // Timeline rows carry canonical identity; other stream events do not.
    if (update.seq === undefined || update.epoch === undefined) return false;
    if (!entry.cursor || entry.cursor.epoch !== update.epoch) return false;
    if (update.seq <= entry.cursor.seq) return true;
    if (update.seq !== entry.cursor.seq + 1) return false;
    const event = update.event;
    const append = event.item.type === "assistant_message" && entry.tail?.type === "assistant_message" &&
      entry.tail.seqEnd + 1 === update.seq && entry.tail.turnId === event.turnId &&
      (event.item.messageId === undefined || event.item.messageId === entry.tail.messageId);
    if (event.item.type === "assistant_message") {
      entry.raw = append ? entry.raw + event.item.text : event.item.text;
      const text = entry.raw.trim();
      if (text) entry.value = { state: "ready", text, timestamp: update.timestamp };
    }
    entry.tail = { type: event.item.type, seqEnd: update.seq, turnId: event.turnId,
      messageId: event.item.type === "assistant_message" ? append ? entry.tail?.messageId : event.item.messageId : undefined };
    entry.cursor = { epoch: update.epoch, seq: update.seq };
    return true;
  };
  const refresh = (id: string, buffered: Stream[] = []) => {
    const entry = entryFor(id);
    const ticket = ++entry.ticket;
    entry.pending = true;
    entry.buffered = buffered;
    if (entry.value.state !== "ready") {
      entry.value = LOADING;
      notify();
    }
    api.agents.ref(id).timeline.refetch({ direction: "tail", projection: "projected", limit: TAIL_LIMIT }).then((page) => {
      if (entry.ticket !== ticket) return;
      entry.pending = false;
      if (page.error) {
        entry.value = { state: "error" };
        notify();
        return;
      }
      entry.value = lastReplyMessage(page.entries) ?? { state: "none" };
      const tail = page.entries.at(-1);
      entry.raw = tail?.item.type === "assistant_message" ? tail.item.text : "";
      entry.tail = tail ? { type: tail.item.type, seqEnd: tail.seqEnd, turnId: tail.turnId, messageId: tail.item.type === "assistant_message" ? tail.item.messageId : undefined } : null;
      entry.cursor = { epoch: page.epoch, seq: page.endCursor?.seq ?? page.window.nextSeq - 1 };
      const pending = entry.buffered;
      entry.buffered = [];
      for (const update of pending) {
        if (update.epoch !== page.epoch) continue;
        if (!apply(entry, update)) {
          refresh(id, pending);
          return;
        }
      }
      notify();
    }).catch(() => {
      if (entry.ticket !== ticket) return;
      entry.pending = false;
      entry.value = { state: "error" };
      notify();
    });
  };
  return {
    read: (id: string) => entryFor(id).value,
    request(id: string, version: string, force = false) {
      const entry = entryFor(id);
      if (!force && entry.version === version && SETTLED.has(entry.value.state)) return;
      entry.version = version;
      refresh(id);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    watch(id: string) {
      const entry = entryFor(id);
      entry.observers += 1;
      if (entry.observers === 1) {
        const subscription = api.agents.ref(id).timeline.subscribe((update) => {
          const event = update.event;
          if (event.type === "timeline") {
            const row = update as Stream;
            if (entry.pending) entry.buffered.push(row);
            if (!apply(entry, row)) {
              if (!entry.pending) refresh(id, [row]);
              return;
            }
            notify();
            return;
          }
          if (event.type === "subscription_restored" || event.type === "replacement" ||
              event.type === "turn_completed" || event.type === "turn_failed" || event.type === "turn_canceled") refresh(id);
          if (event.type === "error") {
            entry.value = { state: "error" };
            notify();
          }
        });
        entry.unsubscribe = subscription;
        entry.ready = subscription.ready;
        subscription.ready.catch(() => {
          entry.value = { state: "error" };
          notify();
        });
      }
      return Object.assign(() => {
        entry.observers -= 1;
        if (entry.observers === 0) {
          entry.unsubscribe?.();
          entry.unsubscribe = undefined;
        }
      }, { ready: entry.ready! });
    },
  };
}

const stores = new WeakMap<object, ReturnType<typeof createLiveLastMessageStore>>();

function storeFor(api: PaseoApi) {
  let store = stores.get(api);
  if (!store) stores.set(api, (store = createLiveLastMessageStore(api)));
  return store;
}

/** The visible running reply observes live chunks; closed tasks still wait for an explicit load. */
export function useLastMessage(api: PaseoApi, agentId: string, version: string, auto: boolean, live = false): { prompt: LastMessage; load(): void } {
  const store = storeFor(api);
  const prompt = useSyncExternalStore(store.subscribe, () => store.read(agentId), () => store.read(agentId));
  useEffect(() => {
    if (!live || !agentId) return;
    const release = store.watch(agentId);
    let watching = true;
    // Establish observation before reading history so no chunk falls between them.
    release.ready.then(() => {
      if (watching) store.request(agentId, version, true);
    }, () => {});
    return () => { watching = false; release(); };
  }, [store, agentId, live, version]);
  useEffect(() => {
    if (auto && !live) store.request(agentId, version);
  }, [store, agentId, version, auto, live]);
  return { prompt, load: () => store.request(agentId, version) };
}
