import { useEffect, useSyncExternalStore } from "react";
import type { PaseoAgentTimelineHandle, PaseoApi } from "@getpaseo/client";
import { parseSystemEnvelope } from "../../system-envelope";
import type { FirstPrompt } from "./first-prompt";
import { createLastMessageStore, lastMessageVersion, type TimelineRead } from "./last-message";

/**
 * The last message a person sent the agent, for the details card above its
 * latest reply: the last nonempty `user_message` that is not harness text
 * (`<system-reminder>`, `<paseo-system>`, …). A long turn's tool rows bury it
 * far from the tail, so the read pages back until it finds one.
 *
 * `first` when it is the task's first prompt, which the card already shows.
 * It moves only when someone sends again, so its version is the card's last
 * user message time.
 */
export type LastHumanMessage = FirstPrompt | { state: "first" };

type Api = { agents: { ref(id: string): { timeline: Pick<PaseoAgentTimelineHandle, "refetch"> } } };
type Cursor = NonNullable<Parameters<PaseoAgentTimelineHandle["refetch"]>[0]>["cursor"];
type Row = { timestamp?: string; item: { type: string; text?: string } };

/** The rows read per page. */
const PAGE_LIMIT = 40;
/** The pages read back before giving up: a thousand rows, past any turn worth showing. */
const MAX_PAGES = 25;

export interface HumanMatch {
  message: Extract<FirstPrompt, { state: "ready" }>;
  /** No user message precedes it on its page: the timeline's first when the page is its head. */
  earliest: boolean;
}

/** A person's text: not empty, and not an envelope the harness filed as a user message. */
function humanText(text: string | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed && !parseSystemEnvelope(trimmed) ? trimmed : null;
}

/** The last message a person sent among a page's rows, oldest first. */
export function lastHumanMessage(entries: readonly Row[]): HumanMatch | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { item, timestamp } = entries[index]!;
    if (item.type !== "user_message") continue;
    const text = humanText(item.text);
    if (!text) continue;
    const earliest = !entries.slice(0, index).some((entry) => entry.item.type === "user_message");
    return { message: { state: "ready", text, timestamp }, earliest };
  }
  return null;
}

const readLastHuman: TimelineRead<LastHumanMessage> = async (timeline) => {
  let cursor: Cursor;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await timeline.refetch({
      direction: cursor ? "before" : "tail", projection: "projected", limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}),
    });
    if (page.error || page.reset && cursor) return { state: "error" };
    const found = lastHumanMessage(page.entries);
    if (found) return found.earliest && !page.hasOlder ? { state: "first" } : found.message;
    const next = page.startCursor;
    if (!page.hasOlder || !next) return { state: "none" };
    if (cursor && (next.epoch !== cursor.epoch || next.seq >= cursor.seq)) return { state: "error" };
    cursor = next;
  }
  return { state: "none" };
};

export function createLastHumanMessageStore(api: Api) {
  return createLastMessageStore<LastHumanMessage>(api, readLastHuman);
}

/** Read again when someone sends; a card without that time falls back to the reply's version. */
export function lastHumanMessageVersion(card: Parameters<typeof lastMessageVersion>[0] & { timing: { lastUserMessageAt: string | null } }): string {
  return card.timing.lastUserMessageAt ?? lastMessageVersion(card);
}

const stores = new WeakMap<object, ReturnType<typeof createLastHumanMessageStore>>();

function storeFor(api: PaseoApi | Api) {
  let store = stores.get(api);
  if (!store) stores.set(api, (store = createLastHumanMessageStore(api as Api)));
  return store;
}

/**
 * A card's last message from a person. `auto` reads it as the card shows and
 * again when someone sends; otherwise it waits for `load()`.
 */
export function useLastHumanMessage(api: PaseoApi, agentId: string, version: string, auto: boolean): { prompt: LastHumanMessage; load(): void } {
  const store = storeFor(api);
  const prompt = useSyncExternalStore(store.subscribe, () => store.read(agentId), () => store.read(agentId));
  useEffect(() => {
    if (auto) store.request(agentId, version);
  }, [store, agentId, version, auto]);
  return { prompt, load: () => store.request(agentId, version) };
}
