/**
 * Splits a message into blocks, reusing the blocks of the previous call that
 * appending text cannot change.
 *
 * Ported from streamdown's `lib/parse-blocks.tsx`
 * (https://github.com/vercel/streamdown, packages/streamdown):
 *
 *   Copyright 2023 Vercel, Inc.
 *   Licensed under the Apache License, Version 2.0 (the "License"); you may
 *   not use this file except in compliance with the License. You may obtain a
 *   copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 *   WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 *   License for the specific language governing permissions and limitations
 *   under the License.
 *
 * Changes from the original: the cache is a per-message object the caller
 * owns (a React ref) instead of a module singleton, so two replies streaming
 * at once never evict each other; the `$$` pairing rule merges only into an
 * unclosed math block (this engine lexes `$$ … $$` as one block token, so a
 * stray `$$` in prose must not swallow the blocks after it); no `Array.at`.
 */
import type { Token } from "../../vendor/marked";
import { lexBlockTokens } from "./lex";
import { directiveChanged } from "./codex";

// Footnote identifiers are alphanumeric, underscore or hyphen ([^1], [^note]).
const footnoteReferencePattern = /\[\^[\w-]{1,200}\](?!:)/;
const footnoteDefinitionPattern = /\[\^[\w-]{1,200}\]:/;
// Hyphens and colons too, so custom tags like <ai-thinking> are tracked across
// blank-line interruptions.
const openingTagPattern = /<([A-Za-z][\w:-]*)[\s>/]/;
// Link definitions live on the lexer instance: lexing the tail alone does not
// see definitions from earlier blocks, so a document that has any is never
// reused incrementally. 0-3 leading spaces (4+ is indented code).
const linkDefinitionPattern = /^ {0,3}\[[^\]]+\]:/m;
const lineEndingPattern = /\r\n|\r/g;

const voidElements: Record<string, true> = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
};

const openTagPatternCache = new Map<string, RegExp>();
const closeTagPatternCache = new Map<string, RegExp>();

function getOpenTagPattern(tagName: string): RegExp {
  const tag = tagName.toLowerCase();
  let pattern = openTagPatternCache.get(tag);
  if (!pattern) {
    pattern = new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, "gi");
    openTagPatternCache.set(tag, pattern);
  }
  return pattern;
}

function getCloseTagPattern(tagName: string): RegExp {
  const tag = tagName.toLowerCase();
  let pattern = closeTagPatternCache.get(tag);
  if (!pattern) {
    pattern = new RegExp(`</${tag}(?=[\\s>])[^>]*>`, "gi");
    closeTagPatternCache.set(tag, pattern);
  }
  return pattern;
}

function countNonSelfClosingOpenTags(block: string, tagName: string): number {
  if (voidElements[tagName.toLowerCase()] === true) return 0;
  const matches = block.match(getOpenTagPattern(tagName));
  if (!matches) return 0;
  let count = 0;
  for (const match of matches) {
    if (!match.trimEnd().endsWith("/>")) count += 1;
  }
  return count;
}

function countClosingTags(block: string, tagName: string): number {
  const matches = block.match(getCloseTagPattern(tagName));
  return matches ? matches.length : 0;
}

function countDoubleDollars(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length - 1; i += 1) {
    if (str[i] === "$" && str[i + 1] === "$") {
      count += 1;
      i += 1;
    }
  }
  return count;
}

/** Per-message state. Create one with `createBlockCache` and keep it in a ref. */
export interface BlockCache {
  input: string;
  blocks: string[];
  codex: boolean;
  /**
   * How many leading blocks have been checked to sit at their expected offsets
   * in `input`. marked trims a few raws (a bare "- " lexes to "-\n"), so the
   * offsets are checked before they are trusted, but only for blocks about to
   * be reused.
   */
  verifiedCount: number;
  verifiedLength: number;
  /** False until the first split, so "" is not mistaken for a cache hit. */
  primed: boolean;
}

export function createBlockCache(): BlockCache {
  return { input: "", blocks: [], codex: true, verifiedCount: 0, verifiedLength: 0, primed: false };
}

const blankLineEnding = "\n\n";

/**
 * Streaming appends to the end of the document, but text before the tail can
 * still change meaning: a lone "#" is a heading that ends the paragraph above
 * it, while "#x" continues that paragraph; "2" after a list is a paragraph,
 * while "2." is another item of that list. A block is final once it ends with
 * a blank line and the block after it is complete, that is, followed by
 * another block.
 */
function countStableBlocks(blocks: readonly string[]): number {
  for (let i = blocks.length - 3; i >= 0; i -= 1) {
    if ((blocks[i] ?? "").endsWith(blankLineEnding)) return i + 1;
  }
  return 0;
}

// A slice keeps its whole parent string alive on some engines; copying keeps
// the cache from pinning every intermediate document of a stream.
function copyString(value: string): string {
  return ` ${value}`.slice(1);
}

function mergeTokensIntoBlocks(tokens: readonly Token[]): string[] {
  const merged: string[] = [];
  const htmlStack: string[] = [];

  for (const token of tokens) {
    const current = token.raw;
    const count = merged.length;

    // Inside an HTML block: everything joins it until its tag closes.
    if (htmlStack.length > 0) {
      merged[count - 1] += current;
      const tracked = htmlStack[htmlStack.length - 1] ?? "";
      const opened = countNonSelfClosingOpenTags(current, tracked);
      const closed = countClosingTags(current, tracked);
      for (let i = 0; i < opened; i += 1) htmlStack.push(tracked);
      for (let i = 0; i < closed; i += 1) {
        if (htmlStack.length > 0 && htmlStack[htmlStack.length - 1] === tracked) htmlStack.pop();
      }
      continue;
    }

    if (token.type === "html" && token.block === true) {
      const opening = openingTagPattern.exec(current);
      if (opening) {
        const tag = opening[1] ?? "";
        if (countNonSelfClosingOpenTags(current, tag) > countClosingTags(current, tag)) {
          htmlStack.push(tag);
        }
      }
    }

    // marked 18 gives a block's trailing blank lines their own `space` token;
    // a bare space is never content, so it folds into the block before it.
    if (token.type === "space" && count > 0) {
      merged[count - 1] += current;
      continue;
    }

    // An unclosed math block owns what follows until its `$$` pair arrives.
    if (count > 0) {
      const previous = merged[count - 1] ?? "";
      if (/^ {0,3}\$\$/.test(previous) && countDoubleDollars(previous) % 2 === 1) {
        merged[count - 1] = previous + current;
        continue;
      }
    }

    merged.push(current);
  }

  return merged;
}

function reuse(previous: BlockCache, input: string, codex: boolean): BlockCache | null {
  if (!previous.primed || previous.codex !== codex || input.length <= previous.input.length) return null;
  // A slice compared with === is a bulk comparison; startsWith walks chars.
  if (input.slice(0, previous.input.length) !== previous.input) return null;
  if (linkDefinitionPattern.test(input)) return null;
  const stableCount = countStableBlocks(previous.blocks);
  if (stableCount === 0) return null;
  // An unfinished review can change earlier blocks when its header or closing
  // delimiter arrives. Ordinary appends can continue reusing those blocks.
  const appended = previous.input.slice(-2) + input.slice(previous.input.length);
  if (codex && /(?:^|\n)::|}/.test(appended) && /::(?:code-comment|browser-complete|artifact-template)\{|:codex-file-citation\{/.test(previous.input)) {
    let offset = 0;
    for (let index = 0; index < stableCount; index++) {
      const block = previous.blocks[index] ?? "";
      if (!previous.input.startsWith(block, offset)) return null;
      if (!/^ {0,3}(`{3,}|~{3,})/.test(block)) {
        const markers = /(?:^|\n) {0,3}::(?:code-comment|browser-complete|artifact-template)\{|:codex-file-citation\{/g;
        for (const marker of block.matchAll(markers)) {
          const start = offset + marker.index + marker[0].indexOf(":");
          if (directiveChanged(previous.input.slice(start), input.slice(start))) return null;
        }
      }
      offset += block.length;
    }
  }

  let verifiedCount = previous.verifiedCount;
  let verifiedLength = previous.verifiedLength;
  // The tail can shrink the stable region (a setext underline can pull several
  // blocks into one), so never trust more blocks than are stable.
  if (verifiedCount > stableCount) {
    verifiedCount = stableCount;
    verifiedLength = 0;
    for (let i = 0; i < verifiedCount; i += 1) verifiedLength += (previous.blocks[i] ?? "").length;
  }
  while (
    verifiedCount < stableCount &&
    input.startsWith(previous.blocks[verifiedCount] ?? "", verifiedLength)
  ) {
    verifiedLength += (previous.blocks[verifiedCount] ?? "").length;
    verifiedCount += 1;
  }
  if (verifiedCount !== stableCount) return null;

  const tail = mergeTokensIntoBlocks(lexBlockTokens(input.slice(verifiedLength), codex)).map(copyString);
  return {
    input,
    codex,
    // The same string instances for stable blocks, so memo by value is free.
    blocks: previous.blocks.slice(0, stableCount).concat(tail),
    verifiedCount,
    verifiedLength,
    primed: true,
  };
}

/**
 * The message's blocks, as raw source strings that join back into the input
 * (line endings normalised). Pass the message's own cache to reuse the stable
 * prefix of the previous call; without one, every call lexes the whole text.
 */
export function splitBlocks(markdown: string, cache?: BlockCache, codex = true): string[] {
  if (cache === undefined) return splitBlockTokens(markdown, codex).blocks;
  // Footnote references and definitions must share one tree.
  if (footnoteReferencePattern.test(markdown) || footnoteDefinitionPattern.test(markdown)) {
    return [markdown];
  }

  const input = markdown.includes("\r") ? markdown.replace(lineEndingPattern, "\n") : markdown;
  if (cache.primed && cache.codex === codex && cache.input === input) return cache.blocks;

  const next = reuse(cache, input, codex) ?? {
    input,
    codex,
    blocks: mergeTokensIntoBlocks(lexBlockTokens(input, codex)).map(copyString),
    verifiedCount: 0,
    verifiedLength: 0,
    primed: true,
  };
  cache.input = next.input;
  cache.codex = codex;
  cache.blocks = next.blocks;
  cache.verifiedCount = next.verifiedCount;
  cache.verifiedLength = next.verifiedLength;
  cache.primed = true;
  return next.blocks;
}

/**
 * `splitBlocks` without a cache, with the block tokens the blocks came from
 * for a caller that inspects them too. A reply with footnotes is one block
 * and is not lexed: its tokens are null.
 */
export function splitBlockTokens(markdown: string, codex = true): { blocks: string[]; tokens: Token[] | null } {
  if (footnoteReferencePattern.test(markdown) || footnoteDefinitionPattern.test(markdown)) {
    return { blocks: [markdown], tokens: null };
  }
  const input = markdown.includes("\r") ? markdown.replace(lineEndingPattern, "\n") : markdown;
  const tokens = lexBlockTokens(input, codex);
  return { blocks: mergeTokensIntoBlocks(tokens), tokens };
}
