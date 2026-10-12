import type { Token } from "../../../vendor/marked";
import { isImagePath } from "../../../image-file";

/**
 * The filesystem path a `file://` image address names, or null for any other
 * address or a file that is not an image. The daemon writes a tool's image
 * output to disk and adds a reply holding only `![Image](file:///…)`
 * (Paseo `provider-image-output.ts`); `file:` never reaches a browser or
 * `Linking`, so the plugin's own image RPC is the one way to draw it.
 */
export function localImagePath(href: string): string | null {
  const match = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(href.trim());
  if (!match) return null;
  let path: string;
  try {
    path = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  // `file:///C:/x.png` names `C:/x.png`.
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return isImagePath(path) ? path : null;
}

/** The local image a paragraph consists of, ignoring the blanks around it. */
export function soleLocalImage(tokens: readonly Token[] | undefined): string | null {
  if (!tokens) return null;
  const visible = tokens.filter((token) => !(token.type === "text" && token.raw.trim() === ""));
  const only = visible.length === 1 ? visible[0] : undefined;
  return only?.type === "image" ? localImagePath(only.href) : null;
}
