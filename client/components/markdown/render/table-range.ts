import type { Tokens } from "../../../vendor/marked";
import { inlineText } from "./inline";

/** A cell by row and column; row 0 is the header. */
export interface CellPos {
  row: number;
  column: number;
}

/** The rectangle between the cell a range began on and the one it reached; a selection holds one or more. */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function cellRange(anchor: CellPos, focus: CellPos): CellRange {
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.column, focus.column),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.column, focus.column),
  };
}

export function sameCell(a: CellPos, b: CellPos): boolean {
  return a.row === b.row && a.column === b.column;
}

/**
 * Ranges added beside each other take the same columns, from the leftmost
 * any of them reaches to the rightmost, so rows picked apart line up under
 * the widest.
 */
export function alignColumns(ranges: readonly CellRange[]): readonly CellRange[] {
  if (ranges.length < 2) return ranges;
  const left = Math.min(...ranges.map((range) => range.left));
  const right = Math.max(...ranges.map((range) => range.right));
  return ranges.map((range) => ({ ...range, left, right }));
}

/** The selected columns of a row, as `left-right` per range that covers it, or "" when none does. */
export function rowSpan(ranges: readonly CellRange[], row: number): string {
  return ranges.filter((range) => row >= range.top && row <= range.bottom)
    .map((range) => `${range.left}-${range.right}`).join(",");
}

export function rangeHas(ranges: readonly CellRange[], row: number, column: number): boolean {
  return ranges.some((range) => row >= range.top && row <= range.bottom && column >= range.left && column <= range.right);
}

const ALIGN_RULES = { left: ":---", center: ":---:", right: "---:" } as const;

/**
 * What a selection copies. One cell copies its text, as a double tap always
 * has. Several copy a Markdown table of the rows and columns the ranges
 * cover, in the table's order, with a cell no range holds left empty: a
 * Markdown table cannot start without its header, so the selected columns'
 * header leads even when no range reaches it.
 */
export function rangeText(token: Tokens.Table, ranges: readonly CellRange[]): string {
  const cell = (row: number, column: number) => (row === 0 ? token.header : token.rows[row - 1])?.[column];
  const rowSet = new Set<number>();
  const columnSet = new Set<number>();
  for (const range of ranges) {
    for (let row = range.top; row <= range.bottom; row++) rowSet.add(row);
    for (let column = range.left; column <= range.right; column++) columnSet.add(column);
  }
  const rows = [...rowSet].sort((a, b) => a - b);
  const columns = [...columnSet].sort((a, b) => a - b);
  if (rows.length === 0) return "";
  if (rows.length === 1 && columns.length === 1) return inlineText(cell(rows[0]!, columns[0]!)?.tokens);
  const line = (row: number) => `| ${columns.map((column) =>
    row === 0 || rangeHas(ranges, row, column) ? (cell(row, column)?.text ?? "").replace(/\|/g, "\\|") : "").join(" | ")} |`;
  const lines = [line(0), `| ${columns.map((column) => (token.align[column] ? ALIGN_RULES[token.align[column]!] : "---")).join(" | ")} |`];
  for (const row of rows) if (row > 0) lines.push(line(row));
  return lines.join("\n");
}

/** The index of the last start at or before `value`, clamped to the first. */
export function indexAt(starts: readonly number[], value: number): number {
  let index = 0;
  while (index + 1 < starts.length && value >= starts[index + 1]!) index++;
  return index;
}
