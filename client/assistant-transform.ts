import { isAssistantPlaceholder } from "./assistant-text";
import { splitBlockTokens } from "./components/markdown/blocks";
import { parseSystemEnvelope } from "./system-envelope";
import { lexBlockTokens } from "./components/markdown/lex";
import type { Token, Tokens } from "./vendor/marked";

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
 * Wait for the opening line during streaming so a partial language stays put.
 */
export function hasUiFence(text: string, phase = "complete"): boolean {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const open = FENCE_OPEN.exec(lines[index] ?? "");
    if (open === null) continue;
    if (phase === "streaming" && index === lines.length - 1) return false;
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

// Match browser-prompt's closed-fence parser, including indented blocks.
export function hasBrowserPromptFence(text: string): boolean {
  if (!text.includes("browser-prompt")) return false;
  let open: { char: string; size: number; prompt: boolean } | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (open === null) {
      const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
      if (!match) continue;
      const marker = match[1]!;
      const info = match[2]!.trim();
      if (marker[0] === "`" && info.includes("`")) continue;
      open = { char: marker[0]!, size: marker.length, prompt: info.split(/\s+/)[0]!.toLowerCase() === "browser-prompt" };
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.length >= open.size && [...trimmed].every((char) => char === open!.char)) {
      if (open.prompt) return true;
      open = null;
    }
  }
  return false;
}

const DIRECTIVE_MARKER = /::(?:browser-complete|code-comment|artifact-template)\{|:codex-file-citation\{/;

/**
 * Whether the Codex lexer read a block directive (a card, a review, an output
 * file), at any depth. Blocks are split with that lexer while a reply from
 * another provider renders the same text literally, so such a reply stays
 * whole. A directive quoted in a code fence is code, not a block of its own.
 */
function hasBlockDirective(tokens: readonly Token[]): boolean {
  return tokens.some((token) => token.type === "codex" ? token.kind !== "memory"
    : hasBlockDirective(token.type === "list" ? (token as Tokens.List).items : (token as Tokens.Generic).tokens ?? []));
}

// A line that could open code, a math block or raw HTML, any of which can hold a directive as text.
// Each run of the prefix has one reading (a marker takes exactly one blank), so a long one cannot backtrack.
const CODE_OR_HTML = /^(?: {4}|\t)|^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(?:`{3,}|~{3,}|<|\$\$)/;
// A table delimiter row, with or without pipes, or a rule: the line before or after may be a table cell.
const TABLE_OR_RULE = /\||^[ \t]*[-:][-: \t]*$/;
// Every block directive carries attributes; an empty one is plain text.
const TOP_DIRECTIVE = /^ {0,3}(?:::(?:browser-complete|code-comment|artifact-template)\{\s*[\w-]+=|:codex-file-citation\{[^\n]*purpose=["']?output)/;

/**
 * A top-level directive line before anything that could open code or raw
 * HTML is a block directive, so the reply stays whole without being lexed.
 * Anything after such a line is left to the lexer.
 */
function leadingDirective(text: string): boolean {
  for (const line of text.split("\n")) {
    // A table can take the next line into a row, so it goes to the lexer too.
    if (CODE_OR_HTML.test(line) || TABLE_OR_RULE.test(line)) return false;
    // A block directive ends its line; a table row or prose after it is not one.
    if (TOP_DIRECTIVE.test(line) && /\}\s*$/.test(line)) return true;
  }
  return false;
}

/** One lex both splits the reply and finds its directives. */
function historyRows(text: string): Array<{ text: string; listContinuation?: boolean }> {
  const marked = DIRECTIVE_MARKER.test(text);
  if (marked && leadingDirective(text)) return [{ text }];
  const { blocks, tokens } = splitBlockTokens(text);
  // Footnote references and definitions share one tree: never split.
  if (tokens === null || (marked && hasBlockDirective(tokens))) return [{ text }];
  return blocks.flatMap(historyBlockRows);
}

/** Completed long replies use the host's existing row virtualization. */
export function assistantRows(text: string, phase: string) {
  if (isAssistantPlaceholder(text)) return [];
  // Definitions and their references share a lexer context, as do system cards.
  const blocks = phase === "complete" && text.length > 16_384 &&
    !/^ {0,3}\[[^\]]+\]:/m.test(text) && !parseSystemEnvelope(text)
    ? historyRows(text) : [{ text }];
  return blocks.map((block, index) => ({
    type: "plugin" as const, kind: "omp-assistant", version: 1,
    data: {
      ...block, phase,
      ...(blocks.length > 1 ? { blockIndex: index,
        ...(index === blocks.length - 1 ? { messageText: text } : {}) } : {}),
    } satisfies AssistantRowData,
  }));
}
