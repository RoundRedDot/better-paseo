import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Which user prompt is the newest one per agent (F2, defect D3).
 *
 * Only the newest prompt's card follows the agent live (its status, its
 * usage figures). Before this, every prompt card subscribed to the agent's
 * `status`/`updatedAt` and asked the daemon for usage on each change, so a
 * long live head of 110 prompts re-rendered all 110 cards on every agent
 * update (about 56 renders each on web `history-100`).
 *
 * A card's answer changes only when a newer prompt of the same agent
 * arrives, so subscribers re-render once per new prompt, not per chunk.
 */
export interface LatestPromptRegistry {
  /** Records a prompt card's arrival. */
  note(agentId: string, key: string, at: number): void;
  /** The newest prompt seen for an agent, or null. */
  latest(agentId: string): string | null;
  /**
   * Whether a prompt is (or, once noted, will be) the newest for its agent.
   * Answers correctly before `note`, so a new card renders right the first time.
   */
  isNewest(agentId: string, key: string, at: number): boolean;
  subscribe(listener: () => void): () => void;
}

/**
 * The newest prompt is the one with the latest timestamp ever seen for the
 * agent. It is not handed back to an older card when the newest unmounts
 * (scrolled out of a virtualised list): an older turn's figures are final,
 * and borrowing the current turn's usage would show the wrong numbers.
 */
export function createLatestPromptRegistry(): LatestPromptRegistry {
  const newest = new Map<string, { key: string; at: number }>();
  const listeners = new Set<() => void>();
  return {
    note(agentId, key, at) {
      const current = newest.get(agentId);
      if (current) {
        if (current.key === key && current.at === at) return;
        // Ties go to the key that sorts last, so the answer is stable.
        if (at < current.at || (at === current.at && key < current.key)) return;
      }
      newest.set(agentId, { key, at });
      for (const listener of listeners) listener();
    },
    latest: (agentId) => newest.get(agentId)?.key ?? null,
    isNewest(agentId, key, at) {
      const current = newest.get(agentId);
      return !current || at > current.at || (at === current.at && key >= current.key);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const registry = createLatestPromptRegistry();

/** True while this prompt card is the newest prompt seen for its agent. */
export function useIsLatestPrompt(agentId: string, key: string, at: number): boolean {
  useLayoutEffect(() => {
    registry.note(agentId, key, at);
  }, [agentId, key, at]);
  const getSnapshot = useCallback(() => registry.isNewest(agentId, key, at), [agentId, key, at]);
  return useSyncExternalStore(registry.subscribe, getSnapshot, getSnapshot);
}
