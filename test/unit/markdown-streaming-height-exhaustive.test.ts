import { describe, expect, it } from "vitest";
import type { Token, Tokens } from "../../client/vendor/marked";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { blockKind, lexBlock } from "../../client/components/markdown/lex";
import { repairTail } from "../../client/components/markdown/repair";
import { fixtureNames, streamTexts } from "./helpers/stream-texts";

const texts = fixtureNames().flatMap((name) => streamTexts(name)).filter((t) => t.text.trim() !== "");

function drawn(prefix: string, cache: ReturnType<typeof createBlockCache>): Token[][] {
  const blocks = splitBlocks(prefix, cache);
  return blocks.map((raw, index) => lexBlock(index === blocks.length - 1 ? repairTail(raw) : raw));
}

/** Rows a code block draws, as `SyntaxHighlightBlock` counts them. */
function codeRows(tokens: Token[]): number | null {
  const code = tokens.find((token) => token.type === "code") as Tokens.Code | undefined;
  return code === undefined ? null : code.text.trimEnd().split("\n").length;
}

describe("streamed tail exhaustive prefixes", () => {
  it("never removes a row from a code block (D4)", () => {
    const shrinks: string[] = [];
    for (const item of texts) {
      if (!item.text.includes("```")) continue;
      const cache = createBlockCache();
      const rows: Array<number | null> = [];
      for (let at = 1; at <= item.text.length; at++) {
        drawn(item.text.slice(0, at), cache).forEach((tokens, index) => {
          const count = codeRows(tokens);
          const before = rows[index];
          if (count !== null && before !== null && before !== undefined && count < before) {
            shrinks.push(`${item.fixture} #${item.index} @${at} block ${index}: ${before} -> ${count}`);
          }
          rows[index] = count;
        });
      }
    }
    expect(shrinks).toEqual([]);
  }, 120_000);

  it.each(texts)("keeps every block's kind across any reveal jump (D5): $fixture #$index", async (item) => {
    const flips: string[] = [];
    const cache = createBlockCache();
    const lastKind: string[] = [];
    for (let at = 1; at <= item.text.length; at++) {
      // Keep the worker responsive while each fixture is swept character by character.
      if (at % 256 === 0) await new Promise((resolve) => setImmediate(resolve));
      drawn(item.text.slice(0, at), cache).forEach((tokens, index) => {
        const kind = blockKind(tokens);
        if (kind === "empty") return;
        const before = lastKind[index];
        if (before !== undefined && before !== kind) {
          flips.push(`${item.fixture} #${item.index} @${at} block ${index}: ${before} -> ${kind}`);
        }
        lastKind[index] = kind;
      });
    }
    expect(flips).toEqual([]);
    // history-long-load #399 is 59427 characters and exceeded 60 s on a busy CI runner.
  }, 180_000);
});
