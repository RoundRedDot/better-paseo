import { useEffect, useSyncExternalStore } from "react";
import type { PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";

/**
 * The prompt a task started from, for the details card. The snapshot carries
 * only the title (the prompt's first line, cut short); the full text is the
 * first `user_message` of the agent's timeline, read once from its head.
 *
 * Reading a timeline makes the daemon load the agent: one it holds already
 * (idle, running) is read as the card opens, a closed one only when asked,
 * since loading resumes it.
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
  request(agentId: string, canRead?: () => boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
  version(): number;
}

export function createFirstPromptStore(api: Api): Store {
  const prompts = new Map<string, FirstPrompt>();
  const listeners = new Set<() => void>();
  const pending = new Map<string, Promise<void>>();
  let revision = 0;
  const set = (agentId: string, value: FirstPrompt) => {
    prompts.set(agentId, value);
    revision += 1;
    for (const listener of [...listeners]) listener();
  };
  const read = async (agentId: string, canRead?: () => boolean) => {
    try {
      let cursor: NonNullable<Parameters<PaseoAgentTimelineHandle["refetch"]>[0]>["cursor"];
      for (;;) {
        if (canRead && !canRead()) return set(agentId, { state: "error" });
        const page = await api.agents.ref(agentId).timeline.refetch({
          direction: "after", projection: "projected", limit: HEAD_LIMIT, ...(cursor ? { cursor } : {}),
        });
        if (page.error) return set(agentId, firstPromptError(page.error));
        if (page.reset && cursor) return set(agentId, { state: "error" });
        // An empty first user message is still the first; never substitute a later prompt.
        if (page.entries.some((entry) => entry.item.type === "user_message")) {
          return set(agentId, firstPromptMessage(page.entries) ?? { state: "none" });
        }
        if (!page.hasNewer) return set(agentId, { state: "none" });
        const next = page.endCursor;
        if (!next || cursor && (next.epoch !== cursor.epoch || next.seq <= cursor.seq)) return set(agentId, { state: "error" });
        cursor = next;
      }
    } catch (error) {
      set(agentId, firstPromptError(error instanceof Error ? error.message : String(error)));
    }
  };
  return {
    read: (agentId) => prompts.get(agentId) ?? IDLE,
    request(agentId, canRead) {
      const known = prompts.get(agentId)?.state;
      // Found once is found for good; a miss or a failure is asked again on the next open.
      if (known === "ready") return Promise.resolve();
      const inflight = pending.get(agentId);
      if (inflight) return inflight;
      set(agentId, LOADING);
      const request = read(agentId, canRead).finally(() => pending.delete(agentId));
      pending.set(agentId, request);
      return request;
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
 * A card's first prompt. `auto` reads it as soon as the card shows (an agent
 * the daemon holds); otherwise it waits for `load()`.
 */
export function useFirstPrompt(api: PaseoApi, agentId: string, auto: boolean): { prompt: FirstPrompt; load(): void } {
  const store = firstPromptStoreFor(api);
  const prompt = useSyncExternalStore(store.subscribe, () => store.read(agentId), () => store.read(agentId));
  useEffect(() => {
    if (auto) store.request(agentId);
  }, [store, agentId, auto]);
  return { prompt, load: () => store.request(agentId) };
}
