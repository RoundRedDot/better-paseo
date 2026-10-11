/**
 * The nine kinds of unfinished syntax in requirement §6.5, streamed one
 * character at a time. Every intermediate state is snapshotted (what the tail
 * block is drawn as), and no block may change kind on the way: a block that
 * becomes a table, a list or code is that from its first visible character.
 */
import { describe, expect, it } from "vitest";
import { createBlockCache, splitBlocks } from "../../client/components/markdown/blocks";
import { blockKind, lexBlock } from "../../client/components/markdown/lex";
import { repairTail } from "../../client/components/markdown/repair";

const CASES: Record<string, string> = {
  "unclosed bold": "Some **bold text** and ***both*** here.",
  "unclosed inline code": "Run `npm test` before `git push`.",
  "unfinished fenced code": "Intro\n\n```ts\nconst a = 1;\n```\n\nAfter",
  "streaming table": "| Metric | Value |\n| :--- | ---: |\n| flips | 0 |\n| rpc | 1 |",
  "streaming ordered list": "1. one\n2. two\n10. ten",
  "multi-line quote": "> line one\n> line two\n>\n> second paragraph",
  "nested list": "- a\n  - b\n    - c\n- d",
  "unfinished link": "See [the docs](https://example.com/docs) now.",
  "math expression": "Energy:\n\n$$\nE = mc^2\n$$\n\nDone",
};

interface Step {
  prefix: string;
  /** Every block as drawn: the tail repaired, the rest as written. */
  drawn: string[];
  kinds: string[];
}

function stream(text: string): Step[] {
  const cache = createBlockCache();
  const steps: Step[] = [];
  for (let at = 1; at <= text.length; at++) {
    const prefix = text.slice(0, at);
    const blocks = splitBlocks(prefix, cache);
    const drawn = blocks.map((raw, index) => (index === blocks.length - 1 ? repairTail(raw) : raw));
    steps.push({ prefix, drawn, kinds: drawn.map((raw) => blockKind(lexBlock(raw))) });
  }
  return steps;
}

function flips(steps: Step[]): string[] {
  const out: string[] = [];
  const seen: string[] = [];
  for (const step of steps) {
    step.kinds.forEach((kind, index) => {
      const before = seen[index];
      if (before !== undefined && before !== "empty" && kind !== "empty" && before !== kind) {
        out.push(`${JSON.stringify(step.prefix)}: block ${index} ${before} -> ${kind}`);
      }
      seen[index] = kind;
    });
  }
  return out;
}

describe("streaming repair", () => {
  for (const [name, text] of Object.entries(CASES)) {
    it(`${name}: no block changes kind while it streams`, () => {
      expect(flips(stream(text))).toEqual([]);
    });

    it(`${name}: intermediate states`, () => {
      const lines = stream(text).map(
        (step) =>
          `${JSON.stringify(step.prefix)} => ${step.drawn.map((raw) => JSON.stringify(raw)).join(" + ")}  [${step.kinds.join(", ")}]`,
      );
      expect(lines).toMatchSnapshot();
    });
  }

  it("never touches the inside of an open fence", () => {
    expect(repairTail("```md\n- \n| a | b |\n**")).toBe("```md\n- \n| a | b |\n**");
  });

  it("completes a half-typed delimiter to the header's width, keeping alignment", () => {
    expect(repairTail("| a | b | c |\n| :-")).toBe("| a | b | c |\n| :- | --- | --- |");
  });

  it("leaves a finished table, link and emphasis as written", () => {
    const done = "| a |\n| --- |\n| 1 |\n\n[x](https://a.b) **b** `c`";
    expect(repairTail(done)).toBe(done);
  });
});
