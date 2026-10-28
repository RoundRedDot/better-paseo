import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaseoApi } from "@getpaseo/client";
import { type FirstPrompt, firstPromptStoreFor } from "./first-prompt";
import { requestSubagentFirstPrompt, subagentFirstPrompts } from "./subagent-timeline";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../model";

export interface SearchCoverage {
  pending: number;
  unavailable: number;
  failed: number;
}

/**
 * First-message search is limited to the board's loaded cards. Never request
 * a closed agent's timeline: that would resume it. Details' cached messages
 * still participate after an agent closes. Clearing search stops queued work.
 */
export function useSearchFirstPrompts(api: PaseoApi, lanes: Record<LaneId, LaneModel>, query: string) {
  const store = firstPromptStoreFor(api);
  const active = Boolean(query.trim());
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
  const requests = useRef(new Set<Promise<void>>());
  // Card identities also change on token updates. Only eligibility or a new prompt
  // should restart the queue (a previously empty timeline may now have a message).
  const requestKey = useMemo(() => JSON.stringify(cards.map((card) => [card.id, card.closed, card.parent?.id, card.timing.lastUserMessageAt])), [cards]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let index = 0;
    const eligible = (card: TaskCard) => card.subagent
      ? Boolean(card.parent && byId.has(card.parent.id) && !byId.get(card.parent.id)!.closed)
      : !card.closed;
    const queue = cards.filter(eligible);
    const work = async () => {
      while (live && index < queue.length) {
        // A replacement queue waits for the previous one's in-flight reads too.
        if (requests.current.size >= 4) {
          await Promise.race(requests.current);
          continue;
        }
        const card = queue[index++]!;
        const prompts = card.subagent ? subagentFirstPrompts : store;
        const state = prompts.read(card.id).state;
        if (state === "ready") continue;
        const canRead = () => {
          const current = latestCards.current.get(card.subagent ? card.parent!.id : card.id);
          return live && current !== undefined && !current.closed;
        };
        if (!canRead()) continue;
        const request = card.subagent ? requestSubagentFirstPrompt(card.id, card.parent!.id) : store.request(card.id, canRead);
        requests.current.add(request);
        await request;
        requests.current.delete(request);
      }
    };
    // Let a typing burst settle, with at most four timeline reads in flight.
    const timer = setTimeout(() => { for (let worker = 0; worker < 4; worker++) void work(); }, 200);
    return () => { live = false; clearTimeout(timer); };
    // `requestKey` captures every card fact the queue depends on.
  }, [store, active, requestKey]);

  const latestActive = useRef(active);
  latestActive.current = active;
  const status = useMemo(() => createSearchCoverage(api, () => [...latestCards.current.values()], () => latestActive.current, (id) => latestCards.current.get(id), requests.current), [api]);
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
  return { messages: messages.current, coverage: { pending: coverage.pending, unavailable: coverage.unavailable, failed: coverage.failed }, status };
}

export interface SearchCoverageControl {
  subscribe(listener: () => void): () => void;
  read(): SearchCoverage & { retrying: number };
  retry(): Promise<void>;
  prompt(card: TaskCard): FirstPrompt;
}

/** Shared by a card's retry and the board-wide failed batch. Recheck before every page. */
export function retrySearchPrompt(api: PaseoApi, card: TaskCard, cardById: (id: string) => TaskCard | undefined): Promise<void> {
  const ownerId = card.subagent ? card.parent?.id : card.id;
  const canRead = () => Boolean(ownerId && cardById(card.id) && cardById(ownerId) && !cardById(ownerId)!.closed && !cardById(card.id)!.closed);
  if (!ownerId || !canRead()) return Promise.resolve();
  return card.subagent
    ? requestSubagentFirstPrompt(card.id, ownerId, canRead)
    : firstPromptStoreFor(api).request(card.id, canRead);
}

/** Leaf subscribers observe counts directly; a loading tick does not invalidate the board. */
export function createSearchCoverage(api: PaseoApi, getCards: () => readonly TaskCard[], isActive: () => boolean, cardById: (id: string) => TaskCard | undefined, requests = new Set<Promise<void>>()): SearchCoverageControl {
  const store = firstPromptStoreFor(api);
  const listeners = new Set<() => void>();
  let retrying = 0;
  let snapshot = { pending: 0, unavailable: 0, failed: 0, retrying: 0 };
  const publish = () => { for (const listener of listeners) listener(); };
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
      const next = { pending: 0, unavailable: 0, failed: 0, retrying };
      if (isActive()) for (const card of getCards()) {
        const prompt = (card.subagent ? subagentFirstPrompts : store).read(card.id);
        if (prompt.state === "ready" || prompt.state === "none") continue;
        const owner = cardById(card.subagent ? card.parent?.id ?? "" : card.id);
        if (card.closed || !owner || owner.closed) next.unavailable++;
        else if (prompt.state === "error") next.failed++;
        else next.pending++;
      }
      if (Object.keys(next).some((key) => next[key as keyof typeof next] !== snapshot[key as keyof typeof snapshot])) snapshot = next;
      return snapshot;
    },
    async retry() {
      if (!isActive() || retrying) return;
      const batch = getCards().filter((card) => {
        const owner = cardById(card.subagent ? card.parent?.id ?? "" : card.id);
        return !card.closed && owner && !owner.closed && (card.subagent ? subagentFirstPrompts : store).read(card.id).state === "error";
      });
      if (!batch.length) return;
      retrying = batch.length;
      publish();
      let index = 0;
      const work = async () => {
        while (isActive() && index < batch.length) {
          // Retries share the automatic reader's four slots, including reads already in flight.
          if (requests.size >= 4) { await Promise.race(requests); continue; }
          const request = retrySearchPrompt(api, batch[index++]!, cardById);
          requests.add(request);
          await request;
          requests.delete(request);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, batch.length) }, () => work()));
      retrying = 0;
      publish();
    },
  };
}
