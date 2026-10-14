import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { HighlightLine } from "../../shared/highlight-rpc";

interface Answer { lines: HighlightLine[]; diffLines?: HighlightLine[]; language: string | null; theme: string }
interface Baseline {
  loaded: string[];
  resolver: Array<{ input: { language?: string; filename?: string }; language: string | null }>;
  cases: Array<{ name: string; input: { code: string }; output: Answer }>;
}
const root = path.resolve(__dirname, "../..");
const expected: Baseline = JSON.parse(readFileSync(path.join(root, "test/fixtures/p4-highlight/eager.json"), "utf8"));
let actual: Baseline;

beforeAll(() => {
  // In-process plugin contribution, in a fresh offline Node child. Only highlight.tokens is invoked.
  // The observer sees the real core; it does not replace grammar registration or tokenisation.
  actual = JSON.parse(execFileSync(process.execPath, ["docs/bench/2026-10-14-p4/baseline.mjs"], {
    cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  }));
}, 30_000);

describe("P4 current eager server equivalence baseline", () => {
  it("retains every loaded grammar name and alias", () => {
    expect(actual.loaded).toEqual(expected.loaded);
    expect(actual.resolver).toHaveLength(expected.resolver.length);
    expect(actual.cases).toHaveLength(expected.cases.length);
    expect(actual.loaded).toEqual(expect.arrayContaining(["cts", "mts", "cjs", "mjs", "ps", "pwsh"]));
  });
  it.each(expected.resolver.map((item, index) => ({ ...item, index })))
    ("resolves hint $input.language / filename $input.filename ($index)", ({ index, input, language }) => {
      expect(actual.resolver[index]?.input).toEqual(input);
      expect(actual.resolver[index]?.language).toEqual(language);
    });
  it.each(expected.cases.map((item, index) => ({ ...item, index })))
    ("preserves full token output: $name", ({ index, input, output }) => {
      expect(actual.cases[index]?.output).toEqual(output);
      expect(actual.cases[index]?.output.lines.map(line => line.map(token => token.text).join("")).join("\n"))
        .toEqual(input.code.replace(/\r\n/g, "\n"));
    });
});
