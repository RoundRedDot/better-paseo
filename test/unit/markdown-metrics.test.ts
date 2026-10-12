import { describe, expect, it, vi } from "vitest";
import type { Tokens } from "../../client/vendor/marked";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
vi.mock("@getpaseo/plugin/client", () => ({}));

const { variantMetrics } = await import("../../client/components/markdown/render/styles");
const { columnWidths, numericColumn } = await import("../../client/components/markdown/render/table");
const { textWidth } = await import("../../client/components/markdown/render/inline");
const { lexBlock } = await import("../../client/components/markdown/lex");

describe("variantMetrics", () => {
  it("follows the host body size in integers (S7 F0)", () => {
    const web = variantMetrics("document", 15, false);
    expect([web.bodySize, web.bodyLineHeight]).toEqual([15, 22]);
    expect(web.headingSizes.slice(0, 3)).toEqual([22, 18, 16]);
    expect(web.blockGap).toBe(12);
    const native = variantMetrics("document", 16, true);
    expect([native.bodySize, native.bodyLineHeight]).toEqual([16, 24]);
    expect(native.headingSizes.slice(0, 3)).toEqual([24, 20, 17]);
    expect(native.blockGap).toBe(16);
    expect(variantMetrics("compact", 15).bodyLineHeight).toBe(20);
    expect([variantMetrics("terminal", 15).bodySize, variantMetrics("terminal", 15).bodyLineHeight]).toEqual([14, 20]);
  });

  it("has no fractional size anywhere", () => {
    for (const variant of ["document", "compact", "terminal"] as const) {
      for (const b of [13, 14, 15, 16, 17, 18, 20]) {
        for (const quiet of [false, true]) {
          const m = variantMetrics(variant, b, false, quiet);
          const values = [
            m.bodySize, m.bodyLineHeight, m.blockGap, ...m.headingSizes, ...m.headingLineHeights,
            m.cellSize, m.cellLineHeight, m.codeSize, m.markerWidth, m.indentStep,
          ];
          for (const value of values) expect(Number.isInteger(value)).toBe(true);
        }
      }
    }
  });

  it("sets table cells one step under the body in every variant", () => {
    for (const variant of ["document", "compact", "terminal"] as const) {
      const m = variantMetrics(variant, 15, false);
      expect(m.cellSize).toBe(m.bodySize - 1);
      expect(m.cellLineHeight).toBeLessThan(m.bodyLineHeight);
      expect(m.cellLineHeight % 2).toBe(0);
    }
  });

  it("returns the same object for the same inputs, so blocks stay memoised", () => {
    expect(variantMetrics("document", 15, true)).toBe(variantMetrics("document", 15, true));
    expect(variantMetrics("document", 15, true, true)).not.toBe(variantMetrics("document", 15, true));
  });
});

describe("numericColumn", () => {
  function table(source: string): Tokens.Table {
    return lexBlock(source).find((token) => token.type === "table") as Tokens.Table;
  }
  it("right-aligns a column of figures and leaves text columns alone", () => {
    const t = table("| Metric | Before | After | Unit |\n| --- | --- | --- | --- |\n| Flips | 10 | 0 | ms |\n| RPC | 1,200 | 4.8% | µs |\n");
    expect([0, 1, 2, 3].map((column) => numericColumn(t, column))).toEqual([false, true, true, false]);
  });
  it("ignores empty and dash cells but needs at least one figure", () => {
    const t = table("| a | b |\n| --- | --- |\n| — | x |\n| 3 | |\n");
    expect(numericColumn(t, 0)).toBe(true);
    expect(numericColumn(t, 1)).toBe(false);
  });
});

describe("text width estimate", () => {
  it("counts a CJK or full-width character as a full em", () => {
    expect(textWidth("abcd", 10, 0.5)).toBe(20);
    expect(textWidth("两边都跑", 10, 0.5)).toBe(40);
    expect(textWidth("跑 14 个", 10, 0.5)).toBeCloseTo(20 + 2 * 5 + 2 * 6.2);
    expect(textWidth("（全角）", 10, 0.5)).toBe(40);
  });

  it("counts a digit at the tabular figure's advance, not the average letter's", () => {
    expect(textWidth("974", 10, 0.55)).toBeCloseTo(3 * 6.2);
    expect(textWidth("974", 10, 0.7)).toBeCloseTo(3 * 7);
  });

  it("keeps a short figure with a unit on one line", () => {
    // Measured on a 15px desktop reply: tabular digits advance 0.62 em, so
    // `974 ms` is about 52px (3.5 em) and wrapped in a column estimated at
    // 0.55 em. The cell is a step under the body, so scale it to the cell.
    const [table] = lexBlock("| 页 | 耗时 |\n| --- | --- |\n| 1 | 974 ms |");
    const metrics = variantMetrics("document", 15, false);
    const [, width = 0] = columnWidths(table as Tokens.Table, metrics);
    // Less the cell padding on both sides and the divider on its left.
    const content = width - metrics.tableGap - 12 - 1;
    expect(content).toBeGreaterThanOrEqual(Math.ceil((52 / 15) * metrics.cellSize) + 2);
  });

  it("gives a Chinese column room for its longest cell", () => {
    const [table] = lexBlock("| | Offhand |\n| --- | --- |\n| 两边都跑的 14 个任务 | 成功率 280/280 |");
    const metrics = variantMetrics("document", 15, false);
    const [first] = columnWidths(table as Tokens.Table, metrics);
    // 8 CJK characters alone are 8 em at the cell size.
    expect(first).toBeGreaterThan(8 * metrics.cellSize);
  });
});
