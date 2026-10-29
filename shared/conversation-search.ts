import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const cursorSchema = z.object({ epoch: z.string(), seq: z.number().int().nonnegative() });
export const conversationSearchRpc = defineRpc({
  name: "tasks.conversation-search",
  input: z.object({ agentId: z.string().min(1), parentAgentId: z.string().min(1).optional(), query: z.string().trim().min(1).max(1000), cursor: cursorSchema.optional() }),
  output: z.object({ match: z.string().max(1202).nullable(), nextCursor: cursorSchema.nullable(), unavailable: z.boolean(), error: z.string().nullable() }),
});
export type ConversationSearchInput = z.input<typeof conversationSearchRpc.input>;
export type ConversationSearchPage = z.output<typeof conversationSearchRpc.output>;
export type ConversationCursor = z.output<typeof cursorSchema>;

/** Scan strings in bounded windows rather than lowercasing or serializing a whole tool output. */
export function conversationExcerpt(value: unknown, query: string): string | null {
  if (typeof value === "string") {
    const needle = query.toLowerCase();
    for (let offset = 0; offset < value.length; offset += 4096) {
      const chunk = value.slice(offset, offset + 4096 + query.length);
      const index = chunk.toLowerCase().indexOf(needle);
      if (index < 0) continue;
      // Unicode case folding may expand a character. Resolve offsets only in this small window.
      let folded = 0;
      let start = 0;
      for (const char of chunk) {
        if (folded >= index) break;
        folded += char.toLowerCase().length;
        start += char.length;
      }
      start += offset;
      const from = Math.max(0, start - 80);
      const end = Math.min(value.length, start + query.length + 120);
      // A sliced string can retain the entire source buffer in V8; copy the bounded excerpt.
      return `${from ? "…" : ""}${value.slice(from, end).split("").join("")}${end < value.length ? "…" : ""}`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = conversationExcerpt(entry, query);
      if (match !== null) return match;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const key in value) {
      if (key === "type" || key === "metadata" || key === "messageId" || key === "callId" || key === "clientMessageId") continue;
      const match = conversationExcerpt((value as Record<string, unknown>)[key], query);
      if (match !== null) return match;
    }
  }
  return null;
}

export function unavailableConversationError(message: string): boolean {
  return /^(Working directory does not exist: |Agent \S+ references unavailable provider ')/.test(message);
}
