import { useSyncExternalStore } from "react";

/**
 * Replies whose whole-message translation (the footer's Translate) is running.
 * The footer and the reply's text are separate trees, and a long reply is
 * split into several timeline rows, so the flag lives here: every row of the
 * reply dims the same way a block does while its own translation runs.
 */
const pending = new Map<string, number>();
const listeners = new Set<() => void>();

export function replyTranslationKey(agentId: string, at: number): string {
  return `${agentId}\u0000${at}`;
}

/** Marks the reply as translating until the returned release runs. */
export function holdReplyTranslation(key: string): () => void {
  pending.set(key, (pending.get(key) ?? 0) + 1);
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (pending.get(key) ?? 1) - 1;
    if (count > 0) pending.set(key, count);
    else pending.delete(key);
    emit();
  };
}

function emit() { for (const listener of [...listeners]) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function useReplyTranslationPending(key: string | null): boolean {
  return useSyncExternalStore(subscribe, () => key !== null && pending.has(key), () => false);
}
