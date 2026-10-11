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
  return { input: "", blocks: [], verifiedCount: 0, verifiedLength: 0, primed: false };
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

function reuse(previous: BlockCache, input: string): BlockCache | null {
  if (!previous.primed || input.length <= previous.input.length) return null;
  // A slice compared with === is a bulk comparison; startsWith walks chars.
  if (input.slice(0, previous.input.length) !== previous.input) return null;
  if (linkDefinitionPattern.test(input)) return null;

  const stableCount = countStableBlocks(previous.blocks);
  if (stableCount === 0) return null;

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

  const tail = mergeTokensIntoBlocks(lexBlockTokens(input.slice(verifiedLength))).map(copyString);
  return {
    input,
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
export function splitBlocks(markdown: string, cache?: BlockCache): string[] {
  // Footnote references and definitions must share one tree.
  if (footnoteReferencePattern.test(markdown) || footnoteDefinitionPattern.test(markdown)) {
    return [markdown];
  }

  const input = markdown.includes("\r") ? markdown.replace(lineEndingPattern, "\n") : markdown;
  if (cache === undefined) return mergeTokensIntoBlocks(lexBlockTokens(input));
  if (cache.primed && cache.input === input) return cache.blocks;

  const next = reuse(cache, input) ?? {
    input,
    blocks: mergeTokensIntoBlocks(lexBlockTokens(input)).map(copyString),
    verifiedCount: 0,
    verifiedLength: 0,
    primed: true,
  };
  cache.input = next.input;
  cache.blocks = next.blocks;
  cache.verifiedCount = next.verifiedCount;
  cache.verifiedLength = next.verifiedLength;
  cache.primed = true;
  return next.blocks;
}
