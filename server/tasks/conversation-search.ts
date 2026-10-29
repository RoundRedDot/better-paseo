import type { PaseoApi } from "@getpaseo/client";
import { conversationExcerpt, unavailableConversationError, type ConversationCursor, type ConversationSearchInput, type ConversationSearchPage } from "../../shared/conversation-search";
import { taskDirectoryIssue } from "./availability";
import type { HostDaemonAccess } from "./register";

/** One page per RPC: no transcript cache or background job survives a request. */
export async function searchConversationPage(paseo: PaseoApi, host: HostDaemonAccess, input: ConversationSearchInput): Promise<ConversationSearchPage> {
  const empty = { match: null, nextCursor: null, unavailable: false, error: null };
  try {
    const owner = paseo.agents.ref(input.parentAgentId ?? input.agentId);
    const source = await owner.refresh();
    if (!source || source.agent.status === "closed") return { ...empty, unavailable: true };
    if (!input.cursor && await taskDirectoryIssue(source.agent.cwd)) return { ...empty, unavailable: true };
    const options = { direction: "after" as const, limit: 16, ...(input.cursor ? { cursor: input.cursor } : {}) };
    if (!input.parentAgentId) {
      const page = await owner.timeline.refetch({ ...options, projection: "projected" });
      return searchPage(page.entries, page, input);
    }
    const daemon = await host.connect();
    if (!daemon) return { ...empty, error: "Could not reach the Paseo daemon." };
    try {
      if (!daemon.fetchProviderSubagentTimeline) return { ...empty, unavailable: true };
      const page = await daemon.fetchProviderSubagentTimeline(input.parentAgentId, input.agentId, options);
      return searchPage(page.rows, page, input);
    } finally {
      await daemon.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ...empty, unavailable: unavailableConversationError(message), error: message };
  }
}

function searchPage(
  rows: readonly { item: unknown }[],
  page: { error?: string | null; reset?: boolean; gap?: boolean; staleCursor?: boolean; hasNewer?: boolean; startCursor?: ConversationCursor | null; endCursor?: ConversationCursor | null },
  input: ConversationSearchInput,
): ConversationSearchPage {
  const empty = { match: null, nextCursor: null, unavailable: false, error: null };
  if (page.error) return { ...empty, unavailable: unavailableConversationError(page.error), error: page.error };
  if (input.cursor && (page.reset || page.gap || page.staleCursor || page.endCursor && page.endCursor.epoch !== input.cursor.epoch)) return { ...empty, error: "History changed; search again." };
  for (const row of rows) {
    const item = row.item as { type: string; text?: string };
    if (item.type !== "user_message" && item.type !== "assistant_message" && item.type !== "reasoning") continue;
    const match = conversationExcerpt(item.text, input.query);
    if (match !== null) return { ...empty, match };
  }
  if (page.hasNewer === undefined) return { ...empty, error: "The host did not return timeline pagination." };
  if (!page.hasNewer || !input.cursor && rows.length === 0 && !page.startCursor && !page.endCursor) return empty;
  const next = page.endCursor;
  if (!next || input.cursor && (next.epoch !== input.cursor.epoch || next.seq <= input.cursor.seq)) return { ...empty, error: "The timeline cursor did not advance." };
  return { ...empty, nextCursor: next };
}
