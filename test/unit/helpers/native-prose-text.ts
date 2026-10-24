import { Lexer, type Token, type Tokens } from "../../../client/vendor/marked";
import { decodeEntities, softBreaks } from "../../../client/components/markdown/render/text";

/** Visible native text lives in a Markdown prop, rather than React children. */
export function nativeProseText(node: unknown): string | undefined {
  const value = node as { type?: unknown; props?: { markdown?: unknown } } | null;
  if ((value?.type !== "EnrichedMarkdownText" && value?.type !== "EnrichedMarkdown") || typeof value.props?.markdown !== "string") return undefined;
  const read = (tokens: readonly Token[], block = false): string => tokens.filter((token) => token.type !== "space").map((token): string => {
    if (token.type === "list") return (token as Tokens.List).items.map((item) => read(item.tokens, true)).join("\n");
    const children = (token as { tokens?: Token[] }).tokens;
    if (children) return read(children);
    if (token.type === "text") return softBreaks(decodeEntities(token.text));
    if (token.type === "br") return "\n";
    if (token.type === "escape" || token.type === "codespan") return token.text;
    return token.raw;
  }).join(block ? "\n" : "");
  return read(Lexer.lex(value.props.markdown, { gfm: true, breaks: true }), true);
}
