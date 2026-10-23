import { useEffect, useState, useSyncExternalStore } from "react";
import { createFirstPromptStore, type FirstPrompt } from "./first-prompt";
import { createLastMessageStore, type LastMessage } from "./last-message";

/**
 * A provider subagent's prompt and latest reply, for its details. `PaseoApi`
 * cannot read a subagent's timeline, so the plugin server reads it off the
 * daemon (`tasks.subagent-timeline`); the stores are the agent ones, handed
 * a timeline that asks the server. The task the subagent was given is its
 * timeline's first user message, its report the last assistant message.
 */
export type SubagentTimelineLoader = (input: {
  parentAgentId: string;
  subagentId: string;
  direction: "after" | "tail";
  limit: number;
}) => Promise<{ rows: Array<{ type: string; text?: string }>; error: string | null }>;

let loader: SubagentTimelineLoader | null = null;

/** `chunk/entry` sets the loader. */
export function setSubagentTimelineLoader(next: SubagentTimelineLoader | null): void {
  loader = next;
}

/** How often a running subagent's latest reply is read again while its details show. */
const POLL_MS = 15_000;

/** Each subagent's parent, which the daemon's request names with it. */
const parents = new Map<string, string>();

const api = {
  agents: {
    ref: (subagentId: string) => ({
      timeline: {
        refetch(options: { direction?: string; limit?: number }) {
          const parentAgentId = parents.get(subagentId);
          const load = loader;
          if (!load || !parentAgentId) return Promise.reject(new Error("No subagent timeline loader."));
          return load({ parentAgentId, subagentId, direction: options.direction === "tail" ? "tail" : "after", limit: options.limit ?? 40 }).then((page) => ({
            entries: page.rows.map((item) => ({ item })),
            error: page.error,
          }));
        },
      },
    }),
  },
} as unknown as Parameters<typeof createFirstPromptStore>[0];

const prompts = createFirstPromptStore(api);
const messages = createLastMessageStore(api);

/**
 * A subagent's first prompt and latest reply, read while `auto` (its details
 * show); the reply again every 15 s while it runs, and when its status or
 * last update moves.
 */
export function useSubagentTimeline(
  subagent: { id: string; parentId: string; running: boolean; version: string },
  auto: boolean,
): { firstPrompt: { prompt: FirstPrompt; load(): void }; lastMessage: { prompt: LastMessage; load(): void } } {
  const { id, parentId, running } = subagent;
  if (id && parentId) parents.set(id, parentId);
  const prompt = useSyncExternalStore(prompts.subscribe, () => prompts.read(id), () => prompts.read(id));
  const message = useSyncExternalStore(messages.subscribe, () => messages.read(id), () => messages.read(id));
  const [tick, setTick] = useState(0);
  const version = `${subagent.version}|${tick}`;
  useEffect(() => {
    if (auto && id) prompts.request(id);
  }, [id, auto]);
  useEffect(() => {
    if (auto && id) messages.request(id, version);
  }, [id, auto, version]);
  useEffect(() => {
    if (!auto || !running || !id) return;
    const timer = setInterval(() => setTick((was) => was + 1), POLL_MS);
    return () => clearInterval(timer);
  }, [id, auto, running]);
  return {
    firstPrompt: { prompt, load: () => prompts.request(id) },
    lastMessage: { prompt: message, load: () => messages.request(id, version) },
  };
}
