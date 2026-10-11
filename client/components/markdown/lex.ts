/**
 * marked, configured once for the whole engine, and the per-block lexer.
 *
 * Each block is lexed on its own (`blocks.ts` splits the message first), and
 * the result is kept in an LRU keyed by the block's source: a finished block
 * of a streaming reply, or the same snippet in another message, is never
 * lexed twice. Pure module: no React.
 */
import { Lexer, type MarkedOptions, type Token } from "../../vendor/marked";

/**
 * `$$ … $$` on its own lines: TeX shown as source (plan D6, no KaTeX). An
 * unclosed run takes the rest of the input, like an unclosed fence, so a
 * formula that is still streaming is a math block from its first character.
 */
export interface MathToken {
  type: "math";
  raw: string;
  text: string;
  closed: boolean;
}

const MATH_CLOSED_RE = /^ {0,3}\$\$([\s\S]*?)\$\$[ \t]*(?:\n+|$)/;
const MATH_OPEN_RE = /^ {0,3}\$\$([\s\S]*)$/;
const MATH_START_RE = /(?:^|\n) {0,3}\$\$/;

function mathTokenizer(src: string): MathToken | undefined {
  const closed = MATH_CLOSED_RE.exec(src);
  if (closed !== null) {
    return { type: "math", raw: closed[0], text: (closed[1] ?? "").trim(), closed: true };
  }
  const open = MATH_OPEN_RE.exec(src);
  if (open !== null) {
    return { type: "math", raw: open[0], text: (open[1] ?? "").trim(), closed: false };
  }
  return undefined;
}

/** Where a math block could interrupt a paragraph, so the paragraph stops there. */
function mathStart(src: string): number | undefined {
  const match = MATH_START_RE.exec(src);
  if (match === null) return undefined;
  return match[0].startsWith("\n") ? match.index + 1 : match.index;
}

/**
 * The options every lexer in the engine uses. Extensions are given in the
 * shape `marked.use` would build, so no global marked instance is touched.
 */
export const LEXER_OPTIONS: MarkedOptions = {
  gfm: true,
  extensions: {
    renderers: {},
    childTokens: {},
    block: [mathTokenizer as never],
    startBlock: [mathStart],
  },
};

/** Block-level tokens only: what the splitter needs, without inline work. */
export function lexBlockTokens(markdown: string): Token[] {
  return new Lexer(LEXER_OPTIONS).blockTokens(markdown);
}

const LRU_LIMIT = 500;
const lru = new Map<string, Token[]>();

/**
 * The full token tree (block and inline) of one block's source. Callers must
 * treat the result as read-only: it is shared by every block with this
 * source.
 */
export function lexBlock(raw: string): Token[] {
  const hit = lru.get(raw);
  if (hit !== undefined) {
    // Re-inserting moves the key to the young end of the insertion order.
    lru.delete(raw);
    lru.set(raw, hit);
    return hit;
  }
  const tokens: Token[] = Lexer.lex(raw, LEXER_OPTIONS);
  lru.set(raw, tokens);
  while (lru.size > LRU_LIMIT) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
  return tokens;
}

/** The kind a reader sees for a block: its first token that is not blank space. */
export function blockKind(tokens: readonly Token[]): string {
  for (const token of tokens) {
    if (token.type !== "space" && token.type !== "def") return token.type;
  }
  return "empty";
}

/** Test seam: the LRU's current size. */
export function lexCacheSize(): number {
  return lru.size;
}
