import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";

/**
 * The prompt a task started from, for the details card. The snapshot carries
 * only the title (the prompt's first line, cut short); the full text is the
 * first `user_message` of the agent's timeline, read once from its head.
 *
 * Reading a timeline makes the daemon load the agent, and a closed one
 * resumes. `auto` reads as soon as the caller shows the card; otherwise
 * the read waits for `load()`.
 */
export type FirstPrompt =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; text: string; timestamp?: string }
  /** The timeline's head holds no prompt (or the daemon dropped it). */
  | { state: "none" }
  | { state: "error"; unavailable?: true };

type Api = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "refetch"> } } };

/** The head rows read: a prompt is the first row, or follows a few of the harness's. */
const HEAD_LIMIT = 8;

const IDLE: FirstPrompt = { state: "idle" };
const LOADING: FirstPrompt = { state: "loading" };

interface Store {
  read(agentId: string): FirstPrompt;
  /** Details keep the last empty result visible while a retry is in flight. */
  readForDetails(agentId: string): FirstPrompt;
  readRequestedForDetails(agentId: string): FirstPrompt;
  /** What `read` returns right after `request(agentId)`: the same object, without reading or changing anything. */
  readRequested(agentId: string): FirstPrompt;
  request(agentId: string, canRead?: () => boolean, owner?: object): Promise<void>;
  claim(agentId: string, owner: object, canRead: () => boolean): void;
  release(owner: object): void;
  retain(agentId: string): void;
  subscribe(listener: () => void): () => void;
  version(): number;
}

export function createFirstPromptStore(api: Api): Store {
  const prompts = new Map<string, FirstPrompt>();
  const empty = new Map<string, FirstPrompt>();
  const listeners = new Set<() => void>();
  const pending = new Map<string, Promise<void>>();
  const owners = new Map<string, Map<object, () => boolean>>();
  const epochs = new Map<string, object>();
  let revision = 0;
  // Found once is found for good; a miss or a failure is asked again on the next open. One read at a time.
  const starts = (agentId: string) => prompts.get(agentId)?.state !== "ready" && !pending.has(agentId);
  const set = (agentId: string, value: FirstPrompt) => {
    prompts.set(agentId, value);
    if (value.state === "none") empty.set(agentId, value);
    else if (value.state !== "loading") empty.delete(agentId);
    revision += 1;
    for (const listener of [...listeners]) listener();
  };
  const read = async (agentId: string, canRead: (() => boolean) | undefined, epoch: object, interrupted: FirstPrompt) => {
    const save = (value: FirstPrompt) => { if (epochs.get(agentId) === epoch) set(agentId, value); };
    try {
      let cursor: NonNullable<Parameters<PaseoAgentTimelineHandle["refetch"]>[0]>["cursor"];
      for (;;) {
        if (epochs.get(agentId) !== epoch) return;
        if (canRead && !canRead()) return save(interrupted);
        const page = await api.agents.ref(agentId).timeline.refetch({
          direction: "after", projection: "projected", limit: HEAD_LIMIT, ...(cursor ? { cursor } : {}),
        });
        if (epochs.get(agentId) !== epoch) return;
        if (canRead && !canRead()) return save(interrupted);
        if (page.error) return save(firstPromptError(page.error));
        if (page.reset && cursor) return save({ state: "error" });
        // An empty first user message is still the first; never substitute a later prompt.
        if (page.entries.some((entry) => entry.item.type === "user_message")) {
          return save(firstPromptMessage(page.entries) ?? { state: "none" });
        }
        if (!page.hasNewer) return save({ state: "none" });
        const next = page.endCursor;
        if (!next || cursor && (next.epoch !== cursor.epoch || next.seq <= cursor.seq)) return save({ state: "error" });
        cursor = next;
      }
    } catch (error) {
      if (canRead && !canRead()) return save(interrupted);
      save(firstPromptError(error instanceof Error ? error.message : String(error)));
    }
  };
  return {
    read: (agentId) => prompts.get(agentId) ?? IDLE,
    readForDetails: (agentId) => {
      const value = prompts.get(agentId);
      return value?.state === "loading" ? empty.get(agentId) ?? value : value ?? IDLE;
    },
    readRequestedForDetails: (agentId) => {
      const value = prompts.get(agentId);
      if (value?.state === "none" || value?.state === "loading" && empty.has(agentId)) return empty.get(agentId)!;
      return starts(agentId) ? LOADING : value ?? IDLE;
    },
    readRequested: (agentId) => (starts(agentId) ? LOADING : prompts.get(agentId) ?? IDLE),
    claim(agentId, owner, canRead) { owners.get(agentId)?.set(owner, canRead); },
    request(agentId, canRead, owner) {
      if (!owner) owners.delete(agentId);
      if (owner && canRead) owners.get(agentId)?.set(owner, canRead);
      const previous = prompts.get(agentId);
      if (!starts(agentId)) return previous?.state === "ready" ? Promise.resolve() : pending.get(agentId)!;
      if (owner && !prompts.has(agentId)) owners.set(agentId, new Map([[owner, canRead ?? (() => true)]]));
      set(agentId, LOADING);
      const epoch = {};
      epochs.set(agentId, epoch);
      const canContinue = owner && owners.get(agentId)?.has(owner) && canRead ? () => !owners.has(agentId) || [...owners.get(agentId)!.values()].some((allowed) => allowed()) : canRead;
      const interrupted = owner ? previous ?? IDLE : { state: "error" as const };
      const request = read(agentId, canContinue, epoch, interrupted).finally(() => { if (pending.get(agentId) === request) { pending.delete(agentId); epochs.delete(agentId); } });
      pending.set(agentId, request);
      return request;
    },
    retain(agentId) { owners.delete(agentId); },
    release(owner) {
      let changed = false;
      for (const [id, held] of owners) if (held.delete(owner) && held.size === 0) {
        owners.delete(id);
        prompts.delete(id);
        empty.delete(id);
        pending.delete(id);
        epochs.delete(id);
        changed = true;
      }
      if (changed) { revision++; for (const listener of [...listeners]) listener(); }
    },
    version: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The daemon cannot load these sessions; retrying cannot repair their prerequisites. */
function firstPromptError(message: string): Extract<FirstPrompt, { state: "error" }> {
  return /^(Working directory does not exist: |Agent \S+ references unavailable provider ')/.test(message)
    ? { state: "error", unavailable: true }
    : { state: "error" };
}

/** The first user message and its own timestamp among a timeline's head rows. */
export function firstPromptMessage(entries: readonly { timestamp?: string; item: { type: string; text?: string } }[]): Extract<FirstPrompt, { state: "ready" }> | null {
  for (const entry of entries) {
    if (entry.item.type !== "user_message") continue;
    const text = entry.item.text?.trim();
    return text ? { state: "ready", text, timestamp: entry.timestamp } : null;
  }
  return null;
}

const stores = new WeakMap<object, Store>();

export function firstPromptStoreFor(api: PaseoApi | Api): Store {
  let store = stores.get(api);
  if (!store) stores.set(api, (store = createFirstPromptStore(api as Api)));
  return store;
}

/**
 * A card's first prompt. `auto` reads it as soon as the card shows;
 * otherwise it waits for `load()`. Reading a closed agent resumes it.
 */
export function useFirstPrompt(api: PaseoApi, agentId: string, auto: boolean): { prompt: FirstPrompt; load(): void } {
  const store = firstPromptStoreFor(api);
  useLayoutEffect(() => { if (auto) store.retain(agentId); }, [store, agentId, auto]);
  // Until this commit's request runs, an auto read shows what it will: no draw of the state it replaces at once.
  const asked = useRef<{ store: Store; agentId: string } | null>(null);
  const snapshot = () => (auto && (asked.current?.store !== store || asked.current.agentId !== agentId) ? store.readRequestedForDetails(agentId) : store.readForDetails(agentId));
  const prompt = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  useLayoutEffect(() => {
    if (auto) store.request(agentId);
    asked.current = auto ? { store, agentId } : null;
  }, [store, agentId, auto]);
  return { prompt, load: () => store.request(agentId) };
}
