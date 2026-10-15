import { splitBlocks } from "./components/markdown/blocks";
import { parseSystemEnvelope } from "./system-envelope";
import { lexBlockTokens } from "./components/markdown/lex";
import type { Tokens } from "./vendor/marked";

export interface AssistantRowData {
  text: string;
  phase?: string;
  blockIndex?: number;
  /** Only the last row carries the original text for copy and turn attribution. */
  messageText?: string;
  listContinuation?: boolean;
}

function historyBlockRows(text: string): Array<{ text: string; listContinuation?: boolean }> {
  if (text.length <= 8192) return [{ text }];
  const tokens = lexBlockTokens(text);
  const list = tokens[0] as Tokens.List | undefined;
  // Unordered, tight list items have no numbering or paragraph context to
  // carry across rows. Keep each item, including all its nesting, intact.
  if (list?.type !== "list" || list.ordered || list.loose || list.items.length < 32 ||
    !tokens.slice(1).every((token) => token.type === "space") ||
    list.items.map((item) => item.raw).join("") !== list.raw) return [{ text }];
  const rows = [];
  for (let index = 0; index < list.items.length; index += 16) {
    rows.push({ text: list.items.slice(index, index + 16).map((item) => item.raw).join(""),
      ...(index > 0 ? { listContinuation: true } : {}) });
  }
  rows[rows.length - 1]!.text += text.slice(list.raw.length);
  return rows;
}

/** Completed long replies use the host's existing row virtualization. */
export function assistantRows(text: string, phase: string) {
  // Definitions and their references share a lexer context, as do system cards.
  const blocks = phase === "complete" && text.length > 16_384 &&
    !/^ {0,3}\[[^\]]+\]:/m.test(text) && !parseSystemEnvelope(text)
    ? splitBlocks(text).flatMap(historyBlockRows) : [{ text }];
  return blocks.map((block, index) => ({
    type: "plugin" as const, kind: "omp-assistant", version: 1,
    data: {
      ...block, phase,
      ...(blocks.length > 1 ? { blockIndex: index,
        ...(index === blocks.length - 1 ? { messageText: text } : {}) } : {}),
    } satisfies AssistantRowData,
  }));
}
