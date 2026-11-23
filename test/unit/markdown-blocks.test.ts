/**
 * Incremental splitting must never disagree with a full split (plan §3.1
 * test 1): fed one character at a time, the blocks of every prefix equal the
 * blocks of lexing that prefix from scratch. Run over every assistant and
 * reasoning text in the stream fixtures, and once more in the fixtures' own
 * delta sizes.
 */
import { describe, expect, it } from "vitest";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { fixtureNames, streamTexts } from "./helpers/stream-texts";

const texts = fixtureNames().flatMap((name) => streamTexts(name)).filter((t) => t.text.trim() !== "");

describe("splitBlocks", () => {
  it("joins back into its input", () => {
    for (const { text } of texts) expect(splitBlocks(text).join("")).toBe(text.replace(/\r\n?/g, "\n"));
  });

  it("finds markdown-bearing fixtures", () => {
    expect(new Set(texts.map((t) => t.fixture)).size).toBeGreaterThanOrEqual(8);
  });

  it("equals a full split at every delta boundary, reusing the stable prefix", () => {
    let reused = 0;
    for (const item of texts) {
      const cache = createBlockCache();
      let text = "";
      let previous: string[] = [];
      for (const delta of item.deltas) {
        text += delta;
        const blocks = splitBlocks(text, cache);
        expect(blocks).toEqual(splitBlocks(text));
        // Same string instance for a reused block: memo by value costs nothing.
        if (previous.length > 1 && blocks[0] === previous[0]) reused += 1;
        previous = blocks;
      }
    }
    expect(reused).toBeGreaterThan(0);
  }, 120_000);

  it("keeps two messages' caches apart", () => {
    const a = createBlockCache();
    const b = createBlockCache();
    splitBlocks("# A\n\npara\n\n- x\n\n", a);
    splitBlocks("other\n\ntext\n\n", b);
    expect(splitBlocks("# A\n\npara\n\n- x\n\nmore", a)).toEqual(["# A\n\n", "para\n\n", "- x\n\n", "more"]);
  });

  it("returns a footnoted document as one block", () => {
    expect(splitBlocks("a[^1]\n\n[^1]: note")).toEqual(["a[^1]\n\n[^1]: note"]);
  });

  it("keeps a math block whole, open or closed", () => {
    expect(splitBlocks("x\n\n$$\na\n\nb\n$$\n\ny")).toEqual(["x\n\n", "$$\na\n\nb\n$$\n\n", "y"]);
    expect(splitBlocks("x\n\n$$\na\n\nb")).toEqual(["x\n\n", "$$\na\n\nb"]);
    // A `$$` inside prose does not swallow what follows.
    expect(splitBlocks("echo `$$` pid\n\nnext")).toEqual(["echo `$$` pid\n\n", "next"]);
  });
});
