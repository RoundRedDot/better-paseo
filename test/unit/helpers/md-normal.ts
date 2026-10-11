/**
 * The new engine's output in the old engine's block-tree shape (the shape
 * `parse.ts` produced and `.showcase/md-compare/old-engine.json` records), so
 * the two can be compared block by block. Mirrors what the renderer draws:
 * lists flatten to depth-tagged rows, soft breaks are spaces, empty items and
 * link definitions draw nothing.
 */
import type { MarkedToken, Token, Tokens } from "../../../client/vendor/marked";
import { splitBlocks } from "../../../client/components/markdown/blocks";
import { lexBlock, type MathToken } from "../../../client/components/markdown/lex";
import { codeLanguage, decodeEntities, softBreaks } from "../../../client/components/markdown/render/text";

export type NInline =
  | { kind: "text"; text: string }
  | { kind: "codeSpan"; text: string }
  | { kind: "strong" | "emphasis" | "strike"; spans: NInline[] }
  | { kind: "link"; href: string; spans: NInline[] };

export interface NItem {
  spans: NInline[];
  depth: number;
  ordered: boolean;
  index: number;
  checked?: boolean;
}

export type NBlock =
  | { kind: "heading"; level: number; spans: NInline[] }
  | { kind: "paragraph"; spans: NInline[] }
  | { kind: "list"; ordered: boolean; items: NItem[] }
  | { kind: "quote"; paragraphs: NInline[][] }
  | { kind: "code"; code: string; language: string }
  | { kind: "rule" }
  | { kind: "table"; header: NInline[][]; rows: NInline[][][]; align: string[] }
  | { kind: "plain"; text: string };

/** Adjacent text runs merge, empty runs drop: both engines split text differently. */
export function mergeText(spans: NInline[]): NInline[] {
  const out: NInline[] = [];
  for (const span of spans) {
    if (span.kind === "text") {
      if (span.text === "") continue;
      const last = out[out.length - 1];
      if (last?.kind === "text") {
        out[out.length - 1] = { kind: "text", text: last.text + span.text };
        continue;
      }
      out.push(span);
      continue;
    }
    if (span.kind === "codeSpan") out.push(span);
    else out.push({ ...span, spans: mergeText(span.spans) });
  }
  return out;
}

function inline(tokens: readonly Token[] | undefined): NInline[] {
  const out: NInline[] = [];
  for (const generic of tokens ?? []) {
    const token = generic as MarkedToken;
    switch (token.type) {
      case "text":
        if (token.tokens && token.tokens.length > 0) out.push(...inline(token.tokens));
        else out.push({ kind: "text", text: softBreaks(decodeEntities(token.text)) });
        break;
      case "escape":
        out.push({ kind: "text", text: token.text });
        break;
      case "br":
        out.push({ kind: "text", text: "\n" });
        break;
      case "html":
        out.push({ kind: "text", text: token.raw });
        break;
      case "codespan":
        out.push({ kind: "codeSpan", text: token.text });
        break;
      case "strong":
        out.push({ kind: "strong", spans: inline(token.tokens) });
        break;
      case "em":
        out.push({ kind: "emphasis", spans: inline(token.tokens) });
        break;
      case "del":
        out.push({ kind: "strike", spans: inline(token.tokens) });
        break;
      case "link":
        out.push({ kind: "link", href: token.href, spans: inline(token.tokens) });
        break;
      case "image":
        out.push({ kind: "link", href: token.href, spans: [{ kind: "text", text: token.text || token.href }] });
        break;
      default:
        out.push({ kind: "text", text: generic.raw });
    }
  }
  return mergeText(out);
}

function listItems(list: Tokens.List, depth: number, out: NItem[]): void {
  const start = typeof list.start === "number" ? list.start : 1;
  list.items.forEach((item, index) => {
    const spans: NInline[] = [];
    const nested: Tokens.List[] = [];
    for (const child of item.tokens) {
      if (child.type === "list") nested.push(child as Tokens.List);
      else if (child.type === "text" || child.type === "paragraph") {
        if (spans.length > 0) spans.push({ kind: "text", text: " " });
        spans.push(...inline((child as Tokens.Text).tokens ?? [child]));
      } else if (child.type !== "checkbox" && child.type !== "space") {
        // A block inside an item (code, quote) has no place in the old shape.
        spans.push({ kind: "text", text: `[${child.type}]` });
      }
    }
    if (spans.length > 0) {
      const entry: NItem = {
        spans: mergeText(spans),
        depth,
        ordered: list.ordered,
        index: list.ordered ? start + index : out.length + 1,
      };
      if (item.task) entry.checked = item.checked === true;
      out.push(entry);
    }
    for (const child of nested) listItems(child, depth + 1, out);
  });
}

function quoteParagraphs(tokens: readonly Token[], out: NInline[][]): void {
  for (const child of tokens) {
    if (child.type === "paragraph" || child.type === "text") {
      out.push(inline((child as Tokens.Paragraph).tokens ?? [child]));
    } else if (child.type === "blockquote") {
      quoteParagraphs((child as Tokens.Blockquote).tokens, out);
    } else if (child.type !== "space") {
      out.push([{ kind: "text", text: `[${child.type}]` }]);
    }
  }
}

export function normalizeTokens(tokens: readonly Token[]): NBlock[] {
  const out: NBlock[] = [];
  for (const generic of tokens) {
    if (generic.type === "math") {
      out.push({ kind: "plain", text: (generic as unknown as MathToken).text });
      continue;
    }
    const token = generic as MarkedToken;
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading":
        out.push({ kind: "heading", level: Math.min(4, token.depth), spans: inline(token.tokens) });
        break;
      case "paragraph":
      case "text":
        out.push({ kind: "paragraph", spans: inline(token.tokens ?? [token]) });
        break;
      case "list": {
        const items: NItem[] = [];
        listItems(token, 0, items);
        if (items.length > 0) out.push({ kind: "list", ordered: token.ordered, items });
        break;
      }
      case "blockquote": {
        const paragraphs: NInline[][] = [];
        quoteParagraphs(token.tokens, paragraphs);
        out.push({ kind: "quote", paragraphs });
        break;
      }
      case "code": {
        const lang = codeLanguage(token.lang);
        out.push({ kind: "code", code: token.text, language: lang });
        break;
      }
      case "hr":
        out.push({ kind: "rule" });
        break;
      case "table":
        out.push({
          kind: "table",
          header: token.header.map((cell) => inline(cell.tokens)),
          rows: token.rows.map((row) => row.map((cell) => inline(cell.tokens))),
          align: token.align.map((align) => align ?? "left"),
        });
        break;
      case "html":
        if (token.raw.trim() !== "") out.push({ kind: "plain", text: token.raw.replace(/\n+$/, "") });
        break;
      default:
        out.push({ kind: "plain", text: generic.raw });
    }
  }
  return out;
}

/** A whole message through the new engine: split, lex per block, normalise. */
export function normalizeMarkdown(text: string): NBlock[] {
  return splitBlocks(text).flatMap((raw) => normalizeTokens(lexBlock(raw)));
}

/** The old engine's tree with the same text merging applied. */
export function normalizeOld(blocks: NBlock[]): NBlock[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case "heading":
      case "paragraph":
        return { ...block, spans: mergeText(block.spans) };
      case "list":
        return { ...block, items: block.items.map((item) => ({ ...item, spans: mergeText(item.spans) })) };
      case "quote":
        return { ...block, paragraphs: block.paragraphs.map(mergeText) };
      case "table":
        return {
          ...block,
          header: block.header.map(mergeText),
          rows: block.rows.map((row) => row.map(mergeText)),
        };
      default:
        return block;
    }
  });
}
