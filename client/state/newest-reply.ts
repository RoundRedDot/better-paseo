import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * The arrival time of each agent's newest assistant reply the plugin has drawn.
 *
 * The standard level's running work card sits above the running turn's newest
 * reply (`live-renderers.tsx`), so the card is already in place when that
 * reply turns out to be the final one and the card settles. The host hands a
 * renderer no position, so each reply row reports its timestamp here and the
 * latest one wins. Like the newest prompt (`latest-prompt.ts`), the answer is
 * not handed back to an older row when the newest unmounts: an older reply
 * scrolled back into view is still not the newest.
 *
 * Replies of one millisecond tie and each counts as the newest. Separate
 * model messages a millisecond apart are rare outside max-speed replays.
 */
export interface NewestReplyRegistry {
  note(agentId: string, at: number): void;
  newest(agentId: string): number | null;
  subscribe(listener: () => void): () => void;
}

export function createNewestReplyRegistry(): NewestReplyRegistry {
  const newest = new Map<string, number>();
  const listeners = new Set<() => void>();
  return {
    note(agentId, at) {
      const current = newest.get(agentId);
      if (current !== undefined && current >= at) return;
      newest.set(agentId, at);
      for (const listener of listeners) listener();
    },
    newest: (agentId) => newest.get(agentId) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

let registry = createNewestReplyRegistry();

/** Tests that reuse an agent ID across cases start from no replies. */
export function resetNewestRepliesForTests(): void {
  registry = createNewestReplyRegistry();
}

/**
 * Records a reply row's arrival. Before paint, so a newer reply's card and the
 * older row giving its card up land in the same commit.
 */
export function useNoteReply(agentId: string, at: number): void {
  useLayoutEffect(() => registry.note(agentId, at), [agentId, at]);
}

/** The newest reply's arrival time for the agent, or null before any reply. */
export function useNewestReplyAt(agentId: string): number | null {
  const getSnapshot = useCallback(() => registry.newest(agentId), [agentId]);
  const subscribe = useCallback((listener: () => void) => registry.subscribe(listener), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
