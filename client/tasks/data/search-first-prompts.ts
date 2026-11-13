import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaseoApi } from "@getpaseo/client";
import { type FirstPrompt, firstPromptStoreFor } from "./first-prompt";
import { requestSubagentFirstPrompt, subagentFirstPrompts } from "./subagent-timeline";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../model";

export interface SearchCoverage {
  /** Tasks whose read is still running. */
  pending: number;
  /** Tasks whose first message (or conversation) has been read: "ready" and "none" both finish a read. */
  loaded: number;
}

/**
 * First-message search is limited to the board's loaded cards. Never request
 * a closed agent's timeline: that would resume it. Details' cached messages
 * still participate after an agent closes. Clearing search stops queued work.
 */
export function useSearchFirstPrompts(api: PaseoApi, lanes: Record<LaneId, LaneModel>, query: string, enabled = true) {
  const store = firstPromptStoreFor(api);
  const active = Boolean(query.trim());
  const owner = useRef({}).current;
  useEffect(() => {
    if (!active) return;
    return () => { store.release(owner); subagentFirstPrompts.release(owner); };
  }, [active, store, owner]);
  const subscribe = useMemo(() => (listener: () => void) => {
    if (!active) return () => {};
    const own = store.subscribe(listener);
    const subs = subagentFirstPrompts.subscribe(listener);
    return () => { own(); subs(); };
  }, [store, active]);
  const snapshot = () => active ? `${store.version()}:${subagentFirstPrompts.version()}` : "";
  const revision = useSyncExternalStore(subscribe, snapshot, snapshot);
  const nextCards = useMemo(() => LANE_ORDER.flatMap((id) => lanes[id].cards), [lanes]);
  const cardsRef = useRef(nextCards);
  if (cardsRef.current.length !== nextCards.length || nextCards.some((card, index) => card !== cardsRef.current[index])) cardsRef.current = nextCards;
  const cards = cardsRef.current;
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const latestCards = useRef(byId);
  latestCards.current = byId;
  const latestActive = useRef(active);
  latestActive.current = active && enabled;
  const requests = useRef(new Set<Promise<void>>());
  const enqueue = useRef<((cards: readonly TaskCard[]) => void) | null>(null);
  const wake = useRef<(() => void) | null>(null);
  // Card identities also change on token updates. Only eligibility or a new prompt
  // should restart the queue (a previously empty timeline may now have a message).
  const requestKey = useMemo(() => JSON.stringify(cards.map((card) => [card.id, card.closed, card.parent?.id, card.timing.lastUserMessageAt])), [cards]);
  useEffect(() => {
    if (!active) return;
    for (const card of cards) {
      const prompts = card.subagent ? subagentFirstPrompts : store;
      prompts.claim(card.id, owner, () => {
        const current = latestCards.current.get(card.subagent ? card.parent?.id ?? "" : card.id);
        return latestActive.current && latestCards.current.has(card.id) && current !== undefined && !current.closed;
      });
    }
  }, [active, cards, revision, store, owner]);
  useEffect(() => {
    if (!active || !enabled) return;
    let live = true;
    let started = false;
    const queue: TaskCard[] = [];
    const seen = new Set<string>();
    const work = () => {
      while (live && started && queue.length && requests.current.size < 4) {
        const card = queue.shift()!;
        const prompts = card.subagent ? subagentFirstPrompts : store;
        const state = prompts.read(card.id).state;
        if (state === "ready") continue;
        const canRead = () => {
          const current = latestCards.current.get(card.subagent ? card.parent!.id : card.id);
          return live && latestCards.current.has(card.id) && current !== undefined && !current.closed;
        };
        if (!canRead()) { seen.delete(JSON.stringify([card.id, card.parent?.id, card.timing.lastUserMessageAt])); continue; }
        const request = card.subagent ? requestSubagentFirstPrompt(card.id, card.parent!.id, canRead, owner) : store.request(card.id, canRead, owner);
        requests.current.add(request);
        void request.finally(() => {
          requests.current.delete(request);
          if (live && prompts.read(card.id).state === "idle") {
            const key = JSON.stringify([card.id, card.parent?.id, card.timing.lastUserMessageAt]);
            seen.delete(key);
            if (canRead()) { seen.add(key); queue.push(card); }
          }
          wake.current?.();
        });
      }
    };
    wake.current = work;
    enqueue.current = (next) => {
      for (const card of next) {
        const owner = latestCards.current.get(card.subagent ? card.parent?.id ?? "" : card.id);
        if (card.closed || !owner || owner.closed) continue;
        const key = JSON.stringify([card.id, card.parent?.id, card.timing.lastUserMessageAt]);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(card);
      }
      work();
    };
    const timer = setTimeout(() => { started = true; work(); }, 200);
    return () => { live = false; enqueue.current = null; wake.current = null; clearTimeout(timer); };
  }, [store, active, enabled, owner]);
  useEffect(() => { enqueue.current?.(cards); }, [requestKey, store, active, enabled]);

  const status = useMemo(() => createSearchCoverage(api, () => [...latestCards.current.values()], () => latestActive.current, (id) => latestCards.current.get(id)), [api]);
  const nextMessages = useMemo(() => {
    const messages = new Map<string, string>();
    if (active) for (const card of cards) {
      const prompt = (card.subagent ? subagentFirstPrompts : store).read(card.id);
      if (prompt.state === "ready") messages.set(card.id, prompt.text);
    }
    return messages;
  }, [store, cards, active, revision]);
  // Loading/error count changes update leaf subscribers, not the lane filter.
  const messages = useRef(nextMessages);
  if (messages.current.size !== nextMessages.size || [...nextMessages].some(([id, text]) => messages.current.get(id) !== text)) messages.current = nextMessages;
  const coverage = status.read();
  return { messages: messages.current, coverage: { pending: coverage.pending, loaded: coverage.loaded }, status };
}

export interface SearchCoverageControl {
  subscribe(listener: () => void): () => void;
  read(): SearchCoverage;
  prompt(card: TaskCard): SearchPrompt;
}

export type SearchPrompt = FirstPrompt & { field?: "conversation" };

/** Shared by a card's retry and the board-wide failed batch. Recheck before every page. */
export function retrySearchPrompt(api: PaseoApi, card: TaskCard, cardById: (id: string) => TaskCard | undefined, owner?: object, active = () => true): Promise<void> {
  const ownerId = card.subagent ? card.parent?.id : card.id;
  const canRead = () => Boolean(active() && ownerId && cardById(card.id) && cardById(ownerId) && !cardById(ownerId)!.closed && !cardById(card.id)!.closed);
  if (!ownerId || !canRead()) return Promise.resolve();
  return card.subagent
    ? requestSubagentFirstPrompt(card.id, ownerId, canRead, owner)
    : firstPromptStoreFor(api).request(card.id, canRead, owner);
}

/** Leaf subscribers observe counts directly; a loading tick does not invalidate the board. */
export function createSearchCoverage(api: PaseoApi, getCards: () => readonly TaskCard[], isActive: () => boolean, cardById: (id: string) => TaskCard | undefined): SearchCoverageControl {
  const store = firstPromptStoreFor(api);
  const listeners = new Set<() => void>();
  let snapshot: SearchCoverage = { pending: 0, loaded: 0 };
  const pendingPrompt: FirstPrompt = { state: "idle" };
  return {
    prompt(card) {
      const prompt = (card.subagent ? subagentFirstPrompts : store).read(card.id);
      return prompt.state === "loading" || prompt.state === "idle" ? pendingPrompt : prompt;
    },
    subscribe(listener) {
      listeners.add(listener);
      const own = store.subscribe(listener);
      const sub = subagentFirstPrompts.subscribe(listener);
      return () => { listeners.delete(listener); own(); sub(); };
    },
    read() {
      const next: SearchCoverage = { pending: 0, loaded: 0 };
      if (isActive()) for (const card of getCards()) {
        const prompt = (card.subagent ? subagentFirstPrompts : store).read(card.id);
        if (prompt.state === "ready" || prompt.state === "none") { next.loaded++; continue; }
        // A read that failed or never started (closed session) is neither pending nor loaded.
        if (prompt.state === "error") continue;
        const owner = cardById(card.subagent ? card.parent?.id ?? "" : card.id);
        if (card.closed || !owner || owner.closed) continue;
        next.pending++;
      }
      if (next.pending !== snapshot.pending || next.loaded !== snapshot.loaded) snapshot = next;
      return snapshot;
    },
  };
}
