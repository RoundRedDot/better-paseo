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
  const cards = useMemo(() => LANE_ORDER.flatMap((id) => lanes[id].cards), [lanes]);
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

  const result = useMemo(() => {
    const messages = new Map<string, string>();
    const prompts = new Map<string, FirstPrompt>();
    const coverage: SearchCoverage = { pending: 0, unavailable: 0, failed: 0 };
    if (!active) return { messages, coverage, prompts };
    for (const card of cards) {
      const prompt = (card.subagent ? subagentFirstPrompts : store).read(card.id);
      prompts.set(card.id, prompt);
      if (prompt.state === "ready") messages.set(card.id, prompt.text);
      else if (prompt.state === "none") continue;
      else if (card.closed || card.subagent && (!card.parent || !byId.has(card.parent.id) || byId.get(card.parent.id)!.closed)) coverage.unavailable += 1;
      else if (prompt.state === "error") coverage.failed += 1;
      else coverage.pending += 1;
    }
    return { messages, coverage, prompts };
  }, [store, cards, byId, active, revision]);
  // Holding a streamed title can rebuild lanes with exactly the same card objects.
  // A new map with identical prompt snapshots must not invalidate lane memoization.
  const prompts = useRef(result.prompts);
  if (prompts.current.size !== result.prompts.size || [...result.prompts].some(([id, prompt]) => prompts.current.get(id) !== prompt)) prompts.current = result.prompts;
  return { ...result, prompts: prompts.current };
}
