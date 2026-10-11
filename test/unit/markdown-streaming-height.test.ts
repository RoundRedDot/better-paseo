/**
 * Defects D4 and D5 of the V1 report, as properties of the streamed tail.
 *
 * D4: a code block must never lose a line while it streams. The closing fence
 * arrives a character at a time, and an unheld "``" was drawn as a code line,
 * then dropped when the fence closed (18 px per block).
 *
 * D5: a block must never change kind, even when the host's frame-paced reveal
 * jumps several characters at once. Jumps skip intermediate states, so the
 * check remembers each block's last visible kind across held-back (empty)
 * states instead of comparing neighbours only.
 */
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

describe("streamed tail", () => {
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

  it("holds the start of a closing fence, and only that", () => {
    expect(repairTail("```ts\nconst a = 1;\n``")).toBe("```ts\nconst a = 1;\n");
    expect(repairTail("````md\n```\n``")).toBe("````md\n```\n");
    expect(repairTail("~~~\nx\n~~")).toBe("~~~\nx\n");
    // A backtick run inside a tilde fence is code, not a closer.
    expect(repairTail("~~~\nx\n``")).toBe("~~~\nx\n``");
  });

  it("holds a line of digits until it is a number or an item (D5)", () => {
    expect(repairTail("Steps:\n\n1")).toBe("Steps:\n\n");
    expect(repairTail("1. one\n2")).toBe("1. one\n");
    expect(repairTail("```\n1")).toBe("```\n1");
  });

  it("keeps every block's kind across any reveal jump (D5)", () => {
    const flips: string[] = [];
    for (const item of texts) {
      const cache = createBlockCache();
      const lastKind: string[] = [];
      for (let at = 1; at <= item.text.length; at++) {
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
    }
    expect(flips).toEqual([]);
  }, 120_000);
});
