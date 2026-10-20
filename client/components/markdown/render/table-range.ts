import type { Tokens } from "../../../vendor/marked";
import { inlineText } from "./inline";

/** A cell by row and column; row 0 is the header. */
export interface CellPos {
  row: number;
  column: number;
}

/** The rectangle between the cell a selection began on and the one it reached. */
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

/** The selected columns of a row, as `left-right`, or "" when the row is outside the range. */
export function rowSpan(range: CellRange | null, row: number): string {
  return range && row >= range.top && row <= range.bottom ? `${range.left}-${range.right}` : "";
}

export function rangeHas(range: CellRange | null, row: number, column: number): boolean {
  return range !== null && row >= range.top && row <= range.bottom && column >= range.left && column <= range.right;
}

const ALIGN_RULES = { left: ":---", center: ":---:", right: "---:" } as const;

/**
 * What a selection copies. One cell copies its text, as a double tap always
 * has. Several copy a Markdown table of the selected rows and columns: a
 * Markdown table cannot start without its header, so the selected columns'
 * header leads even when the range began below it.
 */
export function rangeText(token: Tokens.Table, range: CellRange): string {
  const cell = (row: number, column: number) => (row === 0 ? token.header : token.rows[row - 1])?.[column];
  if (range.top === range.bottom && range.left === range.right) {
    return inlineText(cell(range.top, range.left)?.tokens);
  }
  const columns: number[] = [];
  for (let column = range.left; column <= range.right; column++) columns.push(column);
  const line = (row: number) =>
    `| ${columns.map((column) => (cell(row, column)?.text ?? "").replace(/\|/g, "\\|")).join(" | ")} |`;
  const lines = [line(0), `| ${columns.map((column) => (token.align[column] ? ALIGN_RULES[token.align[column]!] : "---")).join(" | ")} |`];
  for (let row = Math.max(1, range.top); row <= range.bottom; row++) lines.push(line(row));
  return lines.join("\n");
}

/** The index of the last start at or before `value`, clamped to the first. */
export function indexAt(starts: readonly number[], value: number): number {
  let index = 0;
  while (index + 1 < starts.length && value >= starts[index + 1]!) index++;
  return index;
}
