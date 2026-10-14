import { afterEach, describe, expect, it } from "vitest";
import { disablePerf, enablePerf, perfSnapshot, resetPerf } from "../../client/debug/perf";
import { lexBlock } from "../../client/components/markdown/lex";

afterEach(() => {
  disablePerf();
  resetPerf();
});

describe("completed Markdown lex misses", () => {
  it("does not count or alter work while probes are off", () => {
    disablePerf();
    resetPerf();

    const source = "probe-off **completed block**";
    const tokens = lexBlock(source);

    expect(tokens[0]).toMatchObject({ type: "paragraph", raw: source });
    expect(lexBlock(source)).toBe(tokens);
    expect(perfSnapshot().counters).toEqual({});
  });

  it("counts completed LRU misses, excluding hits and open streaming tails", () => {
    enablePerf();
    resetPerf();

    const completed = "probe-on **completed block**";
    const first = lexBlock(completed);
    expect(perfSnapshot().counters).toEqual({ "md.lexFinalMiss": 1 });
    expect(lexBlock(completed)).toBe(first);
    expect(perfSnapshot().counters).toEqual({ "md.lexFinalMiss": 1 });

    const tail = "probe-on **streaming tail";
    const openTokens = lexBlock(tail, true);
    expect(lexBlock(tail, true)).toBe(openTokens);
    expect(perfSnapshot().counters).toEqual({ "md.lexFinalMiss": 1 });

    lexBlock(tail);
    expect(perfSnapshot().counters).toEqual({ "md.lexFinalMiss": 2 });
  });
});
