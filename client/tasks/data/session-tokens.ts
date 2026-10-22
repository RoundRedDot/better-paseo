import { useEffect, useState } from "react";
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

const same = (a: SessionTokens | null, b: SessionTokens | null) => a === b || (!!a && !!b && a.total === b.total && a.cached === b.cached);

/** Null until read, when not active, or when the server has no figure. */
export function useSessionTokens(agentId: string, active: boolean): SessionTokens | null {
  const [tokens, setTokens] = useState<SessionTokens | null>(() => known.get(agentId) ?? null);
  useEffect(() => {
    setTokens((was) => {
      const next = known.get(agentId) ?? null;
      return same(was, next) ? was : next;
    });
    if (!active || !agentId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      const load = loader;
      if (!load) return;
      load(agentId)
        .then((next) => {
          if (!live) return;
          if (next) known.set(agentId, next);
          else known.delete(agentId);
          setTokens((was) => (same(was, next) ? was : next));
        })
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
  }, [agentId, active]);
  return active ? tokens : null;
}
