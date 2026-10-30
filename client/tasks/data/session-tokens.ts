import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { SessionTokens } from "../../../shared/tasks-rpc";

/**
 * The tokens a running task's whole session has used, for the details card's
 * running turn. The plugin server reads them from the provider's session
 * files (`tasks.session-tokens`); the card asks while it shows a running task.
 */
export type SessionTokensLoader = (agentId: string) => Promise<SessionTokens | null>;

let loader: SessionTokensLoader | null = null;

export function setSessionTokensLoader(next: SessionTokensLoader | null): void {
  loader = next;
}

/** How often a running task's figure is read again. */
const POLL_MS = 5_000;

/** The last figure by agent, so a card opened again shows it at once. */
const known = new Map<string, SessionTokens>();
const listeners = new Map<string, Set<() => void>>();
/** One poll per agent, however many cards show it. */
const polls = new Map<string, { holders: number; stop(): void }>();

const same = (a: SessionTokens | null, b: SessionTokens | null) => a === b || (!!a && !!b && a.total === b.total && a.cached === b.cached);

export function readSessionTokens(agentId: string): SessionTokens | null {
  return known.get(agentId) ?? null;
}

function publish(agentId: string, next: SessionTokens | null): void {
  if (same(readSessionTokens(agentId), next)) return;
  if (next) known.set(agentId, next);
  else known.delete(agentId);
  for (const listener of listeners.get(agentId) ?? []) listener();
}

export function subscribeSessionTokens(agentId: string, listener: () => void): () => void {
  let set = listeners.get(agentId);
  if (!set) listeners.set(agentId, set = new Set());
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(agentId);
  };
}

function startPoll(agentId: string): () => void {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const read = () => {
    const load = loader;
    if (!load) return;
    load(agentId)
      .then((next) => { if (live) publish(agentId, next); })
      .catch(() => {
        // An older server without `tasks.session-tokens`, or a failed read: no figure.
      })
      .finally(() => {
        if (live) timer = setTimeout(read, POLL_MS);
      });
  };
  read();
  return () => {
    live = false;
    if (timer !== null) clearTimeout(timer);
  };
}

/** Keeps the agent's figure fresh while anyone holds it. */
export function retainSessionTokens(agentId: string): () => void {
  const poll = polls.get(agentId) ?? { holders: 0, stop: startPoll(agentId) };
  polls.set(agentId, poll);
  poll.holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    poll.holders -= 1;
    if (poll.holders > 0) return;
    poll.stop();
    if (polls.get(agentId) === poll) polls.delete(agentId);
  };
}

/** Null until read, when not active, or when the server has no figure. */
export function useSessionTokens(agentId: string, active: boolean): SessionTokens | null {
  const id = active && agentId ? agentId : null;
  useEffect(() => (id === null ? undefined : retainSessionTokens(id)), [id]);
  const subscribe = useCallback((listener: () => void) => (id === null ? () => {} : subscribeSessionTokens(id, listener)), [id]);
  const get = useCallback(() => (id === null ? null : readSessionTokens(id)), [id]);
  return useSyncExternalStore(subscribe, get, get);
}
