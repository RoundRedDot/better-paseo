import { describe, expect, it } from "vitest";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { fixtureNames, streamTexts } from "./helpers/stream-texts";

const texts = fixtureNames().flatMap((name) => streamTexts(name)).filter((t) => t.text.trim() !== "");

/**
 * Feeds the text one character at a time and compares every prefix in
 * `[from, to)` with a full split. Prefixes before `from` still go through the
 * incremental cache, so its state is the one a real stream would have.
 */
async function firstMismatch(
  text: string,
  from = 1,
  to = text.length + 1,
): Promise<{ at: number; incremental: string[]; full: string[] } | null> {
  const cache = createBlockCache();
  for (let at = 1; at < to; at++) {
    // Yield now and then, so the test worker can still talk to the runner on
    // a loaded machine.
    if (at % 250 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const prefix = text.slice(0, at);
    const incremental = splitBlocks(prefix, cache);
    if (at < from) continue;
    const full = splitBlocks(prefix);
    if (incremental.length !== full.length || incremental.some((b, i) => b !== full[i])) {
      return { at, incremental, full };
    }
  }
  return null;
}

/** Long texts are checked in slices, so no single test holds the worker for long. */
const SLICE = 2500;

describe("splitBlocks exhaustive prefixes", () => {
  for (const fixture of fixtureNames()) {
    const items = texts.filter((t) => t.fixture === fixture);
    for (const item of items) {
      for (let from = 1; from <= item.text.length; from += SLICE) {
        const to = Math.min(item.text.length + 1, from + SLICE);
        it(`equals a full split at every prefix: ${fixture} ${item.kind} #${item.index} [${from}, ${to})`, async () => {
          expect(await firstMismatch(item.text, from, to)).toBeNull();
        }, 120_000);
      }
    }
  }

});
