import type { Token, TokenizerThis } from "../../vendor/marked";

export interface InsightToken {
  type: "insight";
  raw: string;
  text: string;
  tokens: Token[];
  closed: boolean;
}

// Claude Code's explanatory output style uses single-backtick terminal rules.
// Require the whole header line so ordinary mentions and code keep their meaning.
const HEADER = /^ {0,3}`[\u2605\u2726] Insight [\u2500\u2501\u2014-]{3,}`[ \t]*(?:\n|$)/;
const START = /(?:^|\n) {0,3}`[\u2605\u2726] Insight [\u2500\u2501\u2014-]{3,}`[ \t]*(?:\n|$)/;
const FOOTER = /^ {0,3}`[\u2500\u2501\u2014-]{3,}`[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function insightStart(src: string): number | undefined {
  const match = START.exec(src);
  if (!match) return undefined;
  return match.index + (match[0].startsWith("\n") ? 1 : 0);
}

export function insightTokenizer(this: TokenizerThis, src: string): InsightToken | undefined {
  const header = HEADER.exec(src);
  if (!header) return undefined;
  let bodyEnd = src.length;
  let end = src.length;
  let closed = false;
  let fence: { char: string; length: number } | undefined;
  for (let offset = header[0].length; offset < src.length;) {
    const newline = src.indexOf("\n", offset);
    const lineEnd = newline < 0 ? src.length : newline;
    const line = src.slice(offset, lineEnd);
    const run = FENCE.exec(line);
    if (fence) {
      if (run && run[1]![0] === fence.char && run[1]!.length >= fence.length && run[2]!.trim() === "") {
        fence = undefined;
      }
    } else if (run && !(run[1]![0] === "`" && run[2]!.includes("`"))) {
      fence = { char: run[1]![0]!, length: run[1]!.length };
    } else if (FOOTER.test(line)) {
      bodyEnd = offset;
      end = newline < 0 ? src.length : newline + 1;
      closed = true;
      break;
    }
    offset = lineEnd + 1;
  }
  const text = src.slice(header[0].length, bodyEnd);
  // Queue inline parsing on the owning lexer, preserving reference links.
  const top = this.lexer.state.top;
  this.lexer.state.top = true;
  const tokens = this.lexer.blockTokens(text, []);
  this.lexer.state.top = top;
  return { type: "insight", raw: src.slice(0, end), text, tokens, closed };
}
