import type { Token } from "../../../vendor/marked";
import { isImagePath } from "../../../image-file";

/**
 * The filesystem path a link points at, or null for a web or mail address.
 *
 * Paseo's own bubble opens such a link in its file panel, but a plugin has no
 * way to ask for that (the SDK's `navigation` opens browsers, agents and
 * workspaces only, and timeline items do not get it), and `openLink` refuses
 * anything that is not http(s) or mailto. So a path is recognised here and
 * handled like a path in the prose instead.
 *
 * `file://` addresses are decoded (the daemon writes a tool's image output as
 * `![Image](file:///…)`, `provider-image-output.ts`); a bare absolute,
 * home-relative or relative path is taken as written, percent escapes
 * decoded.
 */
export function localPath(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("?")) return null;
  const file = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(trimmed);
  if (file) {
    const path = decoded(file[1]!);
    // `file:///C:/x.png` names `C:/x.png`.
    return path !== null && /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  }
  const windowsDrive = /^[A-Za-z]:[\\/]/.test(trimmed);
  // Any other scheme (`https:`, `mailto:`, `javascript:`) is not a file.
  if (!windowsDrive && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;
  const path = decoded(trimmed);
  if (path === null) return null;
  // A word with no separator and no extension ("here") is not a file.
  return /[\\/]/.test(path) || /\.[A-Za-z0-9]+$/.test(path) ? path : null;
}

function decoded(path: string): string | null {
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** `localPath`, for an image the chat can draw. */
export function localImagePath(href: string): string | null {
  const path = localPath(href);
  return path !== null && isImagePath(path) ? path : null;
}

export type ParagraphPart =
  | { kind: "text"; tokens: Token[] }
  | { kind: "image"; path: string };

/**
 * A paragraph cut at its local images, so each is drawn as an image block
 * and the prose around it stays a paragraph. The host joins consecutive
 * image replies with nothing between them (`![Image](a)![Image](b)`), and a
 * reply may run straight into them, so a paragraph that is only one image is
 * not the only shape. Blank runs between images are dropped; a paragraph with
 * no local image comes back as one text part.
 */
export function splitLocalImages(tokens: readonly Token[] | undefined): ParagraphPart[] {
  const parts: ParagraphPart[] = [];
  let run: Token[] = [];
  const flush = () => {
    if (run.some((token) => !(token.type === "text" && token.raw.trim() === ""))) {
      parts.push({ kind: "text", tokens: run });
    }
    run = [];
  };
  for (const token of tokens ?? []) {
    const path = token.type === "image" ? localImagePath(token.href) : null;
    if (path === null) {
      run.push(token);
      continue;
    }
    flush();
    parts.push({ kind: "image", path });
  }
  flush();
  return parts;
}
