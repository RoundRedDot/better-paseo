import type { Token, Tokens } from "./vendor/marked";
import { lexBlockTokens } from "./components/markdown/lex";

/** Leave matching fences whole so the host or another plugin can render them. */
export function assistantNeedsNativeBlocks(text: string, configured: readonly string[]): boolean {
  const patterns = configured.flatMap((pattern) => {
    try { return [new RegExp(pattern, "i")]; }
    catch { return []; }
  });
  if (!patterns.length) return false;
  const contains = (tokens: readonly Token[]): boolean => tokens.some((token) => {
    if (token.type === "code") {
      const code = token as Tokens.Code;
      const language = (code.lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      return code.codeBlockStyle !== "indented" && patterns.some((pattern) => pattern.test(language));
    }
    if (token.type === "list") return (token as Tokens.List).items.some((item) => contains(item.tokens));
    return contains((token as Tokens.Generic).tokens ?? []);
  });
  return contains(lexBlockTokens(text));
}
