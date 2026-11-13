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

// The language is the whole first word of the info string, so ```ui.json and
// ```ui+json stay ordinary code blocks rather than handing the reply over.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*(\S*)/;

/**
 * True when the reply opens a ```ui or ```app fence. Plugins like genui render
 * those live, and Paseo offers an assistant message to chat transformers
 * first-wins in plugin-name order, where better-paseo sorts before them: the
 * transformer must leave such a reply unclaimed or the widgets show as code.
 */
export function hasUiFence(text: string): boolean {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const open = FENCE_OPEN.exec(lines[index] ?? "");
    if (open === null) continue;
    const language = (open[2] ?? "").toLowerCase();
    if (language === "ui" || language === "app") return true;
    // A fence of another language still swallows its body: a ```ui inside it
    // is code being quoted, not a block to hand over. Skip to the closing
    // marker (or the end of an unterminated fence).
    const marker = open[1] ?? "```";
    const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
    let close = index + 1;
    while (close < lines.length && !closing.test(lines[close] ?? "")) close++;
    index = close;
  }
  return false;
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
