import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { PaseoApi } from "@getpaseo/client";
import type { ConversationCursor, ConversationSearchInput, ConversationSearchPage } from "../../../shared/conversation-search";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../model";
import { taskSearchText } from "./search";
import type { SearchCoverageControl, SearchPrompt } from "./search-first-prompts";

type Loader = (input: ConversationSearchInput) => Promise<ConversationSearchPage>;
let loader: Loader | null = null;
export function setConversationSearchLoader(next: Loader | null): void { loader = next; }

const IDLE: SearchPrompt = { state: "idle", field: "conversation" };
const UNAVAILABLE: SearchPrompt = { state: "error", unavailable: true, field: "conversation" };
const EMPTY_MESSAGES = new Map<string, string>();
type RecordState = { key: string; prompt: SearchPrompt; cursor?: ConversationCursor; retrying: boolean };

/** Only the current query's statuses, cursors and one bounded excerpt per task survive a page. */
export function createConversationSearch(load: Loader): SearchCoverageControl & {
  configure(cards: readonly TaskCard[], query: string): void;
  messages(): ReadonlyMap<string, string>;
  query(): string;
  version(): number;
  retryCard(card: TaskCard): Promise<void>;
} {
  let query = "";
  let cards = new Map<string, TaskCard>();
  const records = new Map<string, RecordState>();
  const queue = new Set<string>();
  const inflight = new Set<Promise<void>>();
  const listeners = new Set<() => void>();
  let revision = 0;
  let matches: ReadonlyMap<string, string> = EMPTY_MESSAGES;
  let counts = { pending: 0, unavailable: 0, failed: 0, retrying: 0 };
  const publish = () => {
    revision++;
    const next = { pending: 0, unavailable: 0, failed: 0, retrying: 0 };
    for (const record of records.values()) {
      if (record.prompt.state === "loading") next.pending++;
      if (record.prompt.state === "error") record.prompt.unavailable ? next.unavailable++ : next.failed++;
      if (record.retrying) next.retrying++;
    }
    if (Object.keys(next).some((key) => next[key as keyof typeof next] !== counts[key as keyof typeof counts])) counts = next;
    for (const listener of listeners) listener();
  };
  const eligible = (card: TaskCard) => {
    const owner = card.subagent ? cards.get(card.parent?.id ?? "") : card;
    return !card.closed && owner !== undefined && !owner.closed && !owner.availability?.blocked.read && !card.availability?.blocked.read;
  };
  const pump = () => {
    while (query && inflight.size < 2 && queue.size) {
      const id = queue.values().next().value!;
      queue.delete(id);
      const record = records.get(id)!;
      const card = cards.get(id)!;
      if (!eligible(card)) { record.prompt = UNAVAILABLE; record.retrying = false; publish(); continue; }
      const currentQuery = query;
      const request = Promise.resolve().then(() => {
        if (query !== currentQuery || records.get(id) !== record) return null;
        const remaining = currentQuery.split(/\s+/).filter((word) => !taskSearchText(card).includes(word)).join(" ");
        return load({ agentId: id, ...(card.subagent ? { parentAgentId: card.parent!.id } : {}), query: remaining || currentQuery, ...(record.cursor ? { cursor: record.cursor } : {}) });
      }).then((page) => {
        if (!page) return;
        if (query !== currentQuery || records.get(id) !== record) return;
        if (!eligible(cards.get(id)!)) record.prompt = UNAVAILABLE;
        else if (page.unavailable) record.prompt = UNAVAILABLE;
        else if (page.error) record.prompt = { state: "error", field: "conversation" };
        else if (page.match !== null) {
          record.prompt = { state: "ready", text: page.match, field: "conversation" };
          matches = new Map(matches).set(id, page.match);
        } else if (page.nextCursor) {
          record.cursor = page.nextCursor;
          queue.add(id);
          return;
        } else record.prompt = { state: "none", field: "conversation" };
        record.retrying = false;
        publish();
      }, () => {
        if (query !== currentQuery || records.get(id) !== record) return;
        record.prompt = { state: "error", field: "conversation" };
        record.retrying = false;
        publish();
      }).finally(() => { inflight.delete(request); pump(); });
      inflight.add(request);
    }
  };
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const retry = async (ids: string[]) => {
    const batch = ids.flatMap((id) => {
      const record = records.get(id);
      const card = cards.get(id);
      if (!query || !card || !record || record.prompt.state !== "error" || record.prompt.unavailable || !eligible(card)) return [];
      record.prompt = { state: "loading", field: "conversation" };
      record.cursor = undefined;
      record.retrying = true;
      queue.add(id);
      return [{ id, record }];
    });
    if (!batch.length) return;
    publish();
    await new Promise<void>((resolve) => {
      const release = subscribe(() => { if (batch.every(({ id, record }) => !record.retrying || records.get(id) !== record)) { release(); resolve(); } });
      pump();
    });
  };
  return {
    subscribe,
    read: () => counts,
    prompt: (card) => records.get(card.id)?.prompt ?? IDLE,
    messages: () => matches,
    query: () => query,
    version: () => revision,
    retry: () => retry([...records.keys()]),
    retryCard: (card) => retry([card.id]),
    configure(nextCards, nextQuery) {
      const normalized = nextQuery.trim().toLowerCase();
      if (query !== normalized) { records.clear(); queue.clear(); matches = EMPTY_MESSAGES; }
      query = normalized;
      cards = new Map((query ? nextCards : []).map((card) => [card.id, card]));
      for (const id of records.keys()) if (!query || !cards.has(id)) {
        records.delete(id); queue.delete(id);
        if (matches.has(id)) { const next = new Map(matches); next.delete(id); matches = next; }
      }
      if (query) for (const card of cards.values()) {
        const owner = card.subagent ? cards.get(card.parent?.id ?? "") : card;
        const key = JSON.stringify([card.parent?.id, card.closed, owner?.closed, card.timing.lastUserMessageAt, card.timing.lastTurnEndedAt, card.availability?.blocked.read?.code, owner?.availability?.blocked.read?.code]);
        if (records.get(card.id)?.key === key) continue;
        const known = records.get(card.id);
        if (known?.prompt.state === "ready") { known.key = key; continue; }
        if (matches.has(card.id)) { const next = new Map(matches); next.delete(card.id); matches = next; }
        records.set(card.id, { key, prompt: eligible(card) ? { state: "loading", field: "conversation" } : UNAVAILABLE, retrying: false });
        if (eligible(card)) queue.add(card.id);
        else queue.delete(card.id);
      }
      publish();
      pump();
    },
  };
}

const stores = new WeakMap<object, ReturnType<typeof createConversationSearch>>();
export function conversationSearchFor(api: PaseoApi) {
  let store = stores.get(api);
  if (!store) {
    store = createConversationSearch((input) => {
      if (!loader) return Promise.reject(new Error("No conversation search loader."));
      return loader(input);
    });
    stores.set(api, store);
  }
  return store;
}

export function useSearchConversations(api: PaseoApi, lanes: Record<LaneId, LaneModel>, query: string) {
  const store = conversationSearchFor(api);
  const cards = useMemo(() => LANE_ORDER.flatMap((id) => lanes[id].cards), [lanes]);
  const key = JSON.stringify(cards.map((card) => [card.id, card.closed, card.parent?.id, card.timing.lastUserMessageAt, card.timing.lastTurnEndedAt, card.availability?.blocked.read?.code]));
  useEffect(() => {
    if (!query.trim()) { store.configure([], ""); return; }
    const timer = setTimeout(() => store.configure(cards, query), 200);
    return () => { clearTimeout(timer); store.configure([], ""); };
  }, [store, query]);
  useEffect(() => {
    if (query.trim() && store.query() === query.trim().toLowerCase()) store.configure(cards, query);
  }, [store, key, query]);
  const messages = useSyncExternalStore(store.subscribe, store.messages, store.messages);
  return { messages: store.query() === query.trim().toLowerCase() ? messages : EMPTY_MESSAGES, status: store };
}
