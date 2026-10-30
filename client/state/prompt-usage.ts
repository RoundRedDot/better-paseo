import { useCallback, useSyncExternalStore } from "react";
import type { PaseoApi } from "@getpaseo/client";
import type { TurnUsage } from "../components/user-message";

/**
 * The usage figures a prompt card read while its turn ran, by agent and
 * prompt. The host remounts a row when it scrolls back into a virtualised
 * list, and only the newest prompt reads the agent again, so an older row
 * would otherwise come back without its final figures. `frozen`: the turn had
 * settled when they were read, so they are final.
 *
 * In memory only, bounded to the most recently written prompts.
 */
export interface PromptUsage {
  usage: TurnUsage | null;
  frozen: boolean;
}

export const PROMPT_USAGE_LIMIT = 2000;

export function createPromptUsageStore(limit = PROMPT_USAGE_LIMIT) {
  const records = new Map<string, PromptUsage>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => { for (const listener of listeners.get(key) ?? []) listener(); };
  return {
    get: (key: string): PromptUsage | null => records.get(key) ?? null,
    set(key: string, next: PromptUsage) {
      const previous = records.get(key);
      if (previous && previous.frozen === next.frozen &&
        (previous.usage === next.usage || JSON.stringify(previous.usage) === JSON.stringify(next.usage))) return;
      // Re-inserting moves the key to the young end, so eviction drops the least recently written.
      records.delete(key);
      records.set(key, next);
      while (records.size > limit) {
        const oldest = records.keys().next().value as string;
        records.delete(oldest);
        notify(oldest);
      }
      notify(key);
    },
    subscribe(key: string, listener: () => void) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, set = new Set());
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
  };
}

const stores = new WeakMap<PaseoApi, ReturnType<typeof createPromptUsageStore>>();

function storeFor(paseo: PaseoApi) {
  let store = stores.get(paseo);
  if (!store) stores.set(paseo, store = createPromptUsageStore());
  return store;
}

const promptUsageKey = (agentId: string, promptKey: string) => JSON.stringify([agentId, promptKey]);

export function setPromptUsage(paseo: PaseoApi, agentId: string, promptKey: string, next: PromptUsage): void {
  storeFor(paseo).set(promptUsageKey(agentId, promptKey), next);
}

/** What this prompt's card last read, or null before its first reading. */
export function usePromptUsage(paseo: PaseoApi, agentId: string, promptKey: string): PromptUsage | null {
  const store = storeFor(paseo);
  const key = promptUsageKey(agentId, promptKey);
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]);
  const get = useCallback(() => store.get(key), [store, key]);
  return useSyncExternalStore(subscribe, get, get);
}
