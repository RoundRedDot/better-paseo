import type { Token, Tokens } from "./vendor/marked";
import { lexBlock } from "./components/markdown/lex";
import { localPath } from "./components/markdown/render/local-path";
import { isPathLike } from "./components/markdown/render/text";

function fileHref(href: string): boolean {
  const destination = href.trim();
  if (!destination || /^[#?]/.test(destination) || destination.startsWith("//")) return false;
  if (localPath(destination) !== null) return true;
  // Explicit relative links can name extensionless files. Keep URI schemes
  // external, while recognizing a filename with a line selector (notes.md:12).
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)) {
    const file = destination.replace(/(?:#|\?).*$/, "").replace(/:\d+(?::\d+)?(?:-\d+)?$/, "");
    return localPath(file) !== null;
  }
  return true;
}

function containsFile(tokens: readonly Token[]): boolean {
  return tokens.some((token) => {
    if ((token.type === "link" || token.type === "image") && fileHref(token.href)) return true;
    if (token.type === "codespan" && isPathLike(token.text)) return true;
    if (token.type === "table") {
      const table = token as Tokens.Table;
      return [...table.header, ...table.rows.flat()].some((cell) => containsFile(cell.tokens));
    }
    if (token.type === "list") return (token as Tokens.List).items.some((item) => containsFile(item.tokens));
    // Fenced code and raw HTML have no inline child tokens to inspect.
    return containsFile((token as Tokens.Generic).tokens ?? []);
  });
}

/** Leave file-opening replies to Paseo; plugin rows cannot navigate its file panel. */
export function assistantNeedsNativeFiles(text: string): boolean {
  // Keep references with their definitions, using the lexer's existing
  // transient cache rather than retaining whole replies in the block LRU.
  return containsFile(lexBlock(text, true));
}
