import { describe, expect, it } from "vitest";
import { type BlockCache, createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { fixtureNames, type StreamText, sweepTexts } from "./helpers/stream-texts";

const texts = sweepTexts();

/** One text's stream: the cache and the next prefix length it has not seen. */
interface Sweep {
  cache: BlockCache;
  next: number;
  /** A slice is feeding this stream now. */
  busy: boolean;
}

const sweeps = new Map<StreamText, Sweep>();

/**
 * Feeds the text one character at a time and compares every prefix in
 * `[from, to)` with a full split. Prefixes before `from` still go through the
 * incremental cache, so its state is the one a real stream would have.
 *
 * Slices of one text run in order, so each continues the stream the previous
 * one left off instead of replaying it from the first character. A slice that
 * runs out of order (a filtered run or a retry) starts a new stream.
 */
async function firstMismatch(
  item: StreamText,
  from: number,
  to: number,
): Promise<{ at: number; incremental: string[]; full: string[] } | null> {
  let sweep = sweeps.get(item);
  // A slice that timed out keeps running; never share its cache.
  if (sweep === undefined || sweep.busy || sweep.next > from) {
    sweep = { cache: createBlockCache(), next: 1, busy: false };
    sweeps.set(item, sweep);
  }
  sweep.busy = true;
  try {
    const { cache } = sweep;
    const { text } = item;
    for (let at = sweep.next; at < to; at++) {
      // Yield now and then, so the test worker can still talk to the runner on
      // a loaded machine.
      if (at % 250 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        // A later slice replaced this stream: this one already timed out.
        if (sweeps.get(item) !== sweep) return null;
      }
      const prefix = text.slice(0, at);
      const incremental = splitBlocks(prefix, cache);
      sweep.next = at + 1;
      if (at < from) continue;
      const full = splitBlocks(prefix);
      if (incremental.length !== full.length || incremental.some((b, i) => b !== full[i])) {
        return { at, incremental, full };
      }
    }
    return null;
  } finally {
    sweep.busy = false;
  }
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
          expect(await firstMismatch(item, from, to)).toBeNull();
        }, 120_000);
      }
    }
  }

});
