import { useEffect, useSyncExternalStore } from "react";
import type { PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";
import type { FirstPrompt } from "./first-prompt";
import { turnRunning, type LaneId } from "../model";

/**
 * The agent's latest reply, for the details card under the first prompt: the
 * last `assistant_message` of the timeline's tail (the projected rows merge a
 * reply's chunks into one).
 *
 * Unlike the first prompt it moves, so each read is tied to a version the
 * caller derives from the card (a turn starting or ending, the lane); a new
 * version reads the tail again and keeps the old text up until it lands.
 * A closed agent waits for `load()`, as reading its timeline resumes it.
 */
export type LastMessage = FirstPrompt;

type Api = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "refetch"> } } };

/** The tail rows read: tool rows can follow the last reply, the projection folding each call into one. */
const TAIL_LIMIT = 40;

const IDLE: LastMessage = { state: "idle" };
const LOADING: LastMessage = { state: "loading" };

interface Entry {
  version: string;
  value: LastMessage;
  /** Bumped on each read, so a slower stale read cannot land over a newer one. */
  ticket: number;
}

interface Store {
  read(agentId: string): LastMessage;
  request(agentId: string, version: string): void;
  subscribe(listener: () => void): () => void;
}

export function createLastMessageStore(api: Api): Store {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let tickets = 0;
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    read: (agentId) => entries.get(agentId)?.value ?? IDLE,
    request(agentId, version) {
      const known = entries.get(agentId);
      if (known && known.version === version && (known.value.state === "ready" || known.value.state === "loading")) return;
      const ticket = ++tickets;
      // A newer version keeps showing the older reply until the tail answers.
      const value = known?.value.state === "ready" ? known.value : LOADING;
      entries.set(agentId, { version, value, ticket });
      if (value !== known?.value) notify();
      const land = (next: LastMessage) => {
        if (entries.get(agentId)?.ticket !== ticket) return;
        entries.set(agentId, { version, value: next, ticket });
        notify();
      };
      api.agents
        .ref(agentId)
        .timeline.refetch({ direction: "tail", projection: "projected", limit: TAIL_LIMIT })
        .then((page) => {
          if (page.error) return land({ state: "error" });
          land(lastReplyMessage(page.entries) ?? { state: "none" });
        })
        .catch(() => land({ state: "error" }));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The last nonempty assistant message and its own timestamp among a timeline's tail rows. */
export function lastReplyMessage(entries: readonly { timestamp?: string; item: { type: string; text?: string } }[]): Extract<LastMessage, { state: "ready" }> | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { item, timestamp } = entries[index]!;
    if (item.type !== "assistant_message") continue;
    const text = item.text?.trim();
    if (text) return { state: "ready", text, timestamp };
  }
  return null;
}

/**
 * What the latest reply is read again on: a running card's turn start, else
 * its lane and last update (a turn ending, an answer, a resume).
 */
export function lastMessageVersion(card: { lane: LaneId; waitingOnSubtasks?: boolean; timing: { updatedAt: string; turnStartedAt: string | null } }): string {
  return turnRunning(card) ? `running|${card.timing.turnStartedAt ?? ""}` : `${card.lane}|${card.timing.updatedAt}`;
}

const stores = new WeakMap<object, Store>();

function storeFor(api: PaseoApi | Api): Store {
  let store = stores.get(api);
  if (!store) stores.set(api, (store = createLastMessageStore(api as Api)));
  return store;
}

/**
 * A card's latest reply. `auto` reads it as the card shows and again on each
 * new `version`; otherwise it waits for `load()`.
 */
export function useLastMessage(api: PaseoApi, agentId: string, version: string, auto: boolean): { prompt: LastMessage; load(): void } {
  const store = storeFor(api);
  const prompt = useSyncExternalStore(store.subscribe, () => store.read(agentId), () => store.read(agentId));
  useEffect(() => {
    if (auto) store.request(agentId, version);
  }, [store, agentId, version, auto]);
  return { prompt, load: () => store.request(agentId, version) };
}
