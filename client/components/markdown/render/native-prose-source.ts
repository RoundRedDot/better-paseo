import { INCOMPLETE_IMAGE_PLACEHOLDER } from "remend";
import type { Token, Tokens } from "../../../vendor/marked";
import { decodeEntities, isPathLike, softBreaks } from "./text";
import { localImagePath, localPath } from "./local-path";
import { lexBlock } from "../lex";

export type ProseLink = { kind: "path" | "file" | "url"; target: string };
export interface NativeProseSource { markdown: string; links: ProseLink[] }

/** Visible text cannot introduce new Markdown syntax in the native parser. */
export function escapeProse(text: string): string {
  return text.replace(/[\\`*_[\]{}()<>#+.!|~&-]/g, "\\$&");
}

function code(text: string): string {
  const width = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1;
  const fence = "`".repeat(width);
  const pad = /^`|`$/.test(text) || (/^ .* $/.test(text) && text.trim() !== "") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Re-emit parsed runs, preserving our literal HTML, breaks, image labels and path actions. */
function proseWriter() {
  const links: ProseLink[] = [];
  const link = (label: string, kind: ProseLink["kind"], target: string) => {
    const index = links.push({ kind, target }) - 1;
    return `[${label}](bc-prose://${index})`;
  };
  const walk = (runs: readonly Token[] = []): string => runs.map((token): string => {
    switch (token.type) {
      case "text": return token.tokens ? walk(token.tokens) : escapeProse(softBreaks(decodeEntities(token.text)));
      case "escape": return escapeProse(token.text);
      case "br": return "\n";
      case "html": return escapeProse(token.raw);
      case "codespan": return isPathLike(token.text)
        ? link(code(token.text), "path", token.text) : code(token.text);
      case "strong": return `**${walk(token.tokens)}**`;
      case "em": return `_${walk(token.tokens)}_`;
      case "del": return `~~${walk(token.tokens)}~~`;
      case "link": {
        const path = localPath(token.href);
        return link(walk(token.tokens), path === null ? "url" : "file", path ?? token.href);
      }
      case "image": {
        const label = escapeProse(token.text || token.href);
        if (token.href === INCOMPLETE_IMAGE_PLACEHOLDER) return label;
        const path = localPath(token.href);
        return link(label, path === null ? "url" : "file", path ?? token.href);
      }
      default: return escapeProse((token as Tokens.Generic).raw ?? "");
    }
  }).join("");
  return { inline: walk, links };
}

export function nativeProseSource(tokens: readonly Token[]): NativeProseSource {
  const writer = proseWriter();
  return { markdown: writer.inline(tokens), links: writer.links };
}

/** Local images retain their existing preview UI. */
export function nativeParagraphs(tokens: readonly Token[]): boolean {
  return tokens.some((token) => token.type === "paragraph" || token.type === "text") && tokens.every((token) =>
    token.type === "space" || ((token.type === "paragraph" || token.type === "text") &&
      !token.tokens?.some((run) => run.type === "image" && localImagePath(run.href) !== null)));
}

export function nativeList(token: Token): boolean {
  if (token.type !== "list") return false;
  const list = token as Tokens.List;
  // Keep custom nested markers, loose-item spacing, checkboxes and embedded blocks.
  return !list.loose && list.items.every((item) => !item.task &&
    item.tokens.some((child) => child.type === "paragraph" || child.type === "text") &&
    item.tokens.every((child) => child.type === "space" || nativeParagraphs([child])));
}

export function nativeBlockSource(tokens: readonly Token[]): NativeProseSource {
  const writer = proseWriter();
  const blocks = (runs: readonly Token[]): string => runs.map((token): string => {
    if (token.type === "space") return "";
    if (token.type === "list") return (token as Tokens.List).items.map((item, index) => {
      const list = token as Tokens.List;
      const marker = list.ordered ? `${(typeof list.start === "number" ? list.start : 1) + index}. ` : "- ";
      const body = blocks(item.tokens).split("\n");
      return marker + body.map((line, row) => row === 0 ? line : " ".repeat(marker.length) + line).join("\n");
    }).join("\n");
    return writer.inline((token as Tokens.Paragraph).tokens ?? [token]);
  }).filter(Boolean).join("\n\n");
  return { markdown: blocks(tokens), links: writer.links };
}

/** Batch up to eight paragraphs / 8 KiB; an oversized single paragraph stays intact. */
export function groupNativeParagraphs(blocks: readonly string[],
  classify: (raw: string) => boolean = (raw) => nativeParagraphs(lexBlock(raw, true)),
): string[] {
  const groups: string[] = [];
  let pending = "";
  let count = 0;
  const flush = () => { if (pending) groups.push(pending); pending = ""; count = 0; };
  for (const raw of blocks) {
    if (!classify(raw)) { flush(); groups.push(raw); continue; }
    if (count === 8 || pending.length + raw.length > 8192) flush();
    pending += raw;
    count += 1;
  }
  flush();
  return groups;
}
