import React, { useCallback, useLayoutEffect, useRef } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { Tokens } from "../../../vendor/marked";
import type { RenderContext } from "./context";
import { inlineWidth, renderInline } from "./inline";
import { nextReuse, reuseNode, type NodeReuse } from "./reuse";
import { contentTextProps, contentTextStyle } from "../../../ui/content-text";
import { TableCopyMenu } from "./table-copy-menu";
import { addsCellRange, bindTableCellSelection, TABLE_CELL_TEST_ID } from "./table-selection";
import { useTableCellSelection } from "./table-touch-selection";
import { rangeHas, rangeText, rowSpan, type CellRange } from "./table-range";
import { FLOAT } from "../../../ui/tokens/float";
import {
  ALIGN_KEYS,
  CHAR_RATIO_MONO,
  CHAR_RATIO_UI,
  TABLE_CELL_PADDING,
  TABLE_DIVIDER_WIDTH,
  type VariantMetrics,
} from "./styles";

/**
 * React Native offers no synchronous text measurement, so a column's width is
 * estimated from its longest cell and clamped to the variant's range, then
 * widened by the column gap, which every cell splits around its edges, and by
 * the divider on its left. Only the header and the first `rows` body rows
 * are measured.
 */
export function columnWidths(token: Tokens.Table, metrics: VariantMetrics, rows = token.rows.length): number[] {
  const ratio = metrics.mono ? CHAR_RATIO_MONO : CHAR_RATIO_UI;
  const cellSize = metrics.cellSize;
  const widths: number[] = [];
  for (let column = 0; column < token.header.length; column++) {
    // The header is bold, which the average advance does not cover, so it is
    // measured a shade wider than a body cell of the same length.
    let longest = inlineWidth(token.header[column]?.tokens, cellSize, ratio) * 1.06;
    for (let index = 0; index < rows; index++) {
      const cell = token.rows[index]?.[column];
      if (cell === undefined) continue;
      const width = inlineWidth(cell.tokens, cellSize, ratio);
      if (width > longest) longest = width;
    }
    const estimate = Math.ceil(longest) + TABLE_CELL_PADDING * 2 + 2;
    const extra = metrics.tableGap + (column === 0 ? 0 : TABLE_DIVIDER_WIDTH);
    widths.push(Math.min(metrics.columnMax, Math.max(metrics.columnMin, estimate)) + extra);
  }
  return widths;
}

/**
 * A figure: digits with an optional sign, separators, unit or percent. The
 * escapes are euro, pound, yen, minus, almost-equal, micro and times: the
 * bundle stays ASCII (see `scripts/check-hermes.mjs`).
 */
const FIGURE = /^[\s$\u20ac\u00a3\u00a5+\-\u2212~\u2248<>]*\d[\d,._\s]*(%|[a-zA-Z\u00b5]{1,3}|\u00d7)?\s*$/;

/** Every non-empty body cell of the column reads as a figure. */
export function numericColumn(token: Tokens.Table, column: number): boolean {
  let seen = false;
  for (const row of token.rows) {
    const text = (row[column]?.text ?? "").trim();
    if (text === "" || text === "-" || text === "—") continue;
    if (!FIGURE.test(text)) return false;
    seen = true;
  }
  return seen;
}

/**
 * The body rows the columns are measured from. While the table is still being
 * written its last row grows with every chunk, so the columns follow only the
 * rows that are complete: they change when a row ends, never inside one, and
 * the row being written wraps until then. Once the table is complete every
 * row counts. The widths depend on the text alone, so a streamed table draws
 * what a fresh mount of the same text draws.
 */
export function measuredRows(token: Tokens.Table, open: boolean): number {
  return open && !token.raw.endsWith("\n") ? Math.max(0, token.rows.length - 1) : token.rows.length;
}

const NO_RANGES: readonly CellRange[] = [];

/**
 * A table keeps its own columns and scrolls sideways when the widest row beats
 * the card. Its indicator appears only during scrolling.
 */
export function MdTable({
  token,
  context,
  open,
  keyPrefix,
}: {
  token: Tokens.Table;
  context: RenderContext;
  open: boolean;
  keyPrefix: string;
}) {
  const { styles, metrics } = context;
  const widths = columnWidths(token, metrics, measuredRows(token, open));
  const frameRef = useRef<View>(null);
  const rowRefs = useRef<(View | null)[]>([]);
  // Read when pressed, so the copy control keeps one callback and skips the
  // draws a streamed chunk causes.
  const raw = useRef(token.raw);
  raw.current = token.raw;
  const source = useCallback(() => raw.current, []);
  // A column the author left unaligned is right-aligned when every cell is a
  // figure, so digits line up (S7 §3.7).
  const aligns = token.header.map(
    (_, column) => token.align[column] ?? (numericColumn(token, column) ? "right" : "left"),
  );
  const columnStarts: number[] = [];
  widths.reduce((start, width) => { columnStarts.push(start); return start + width; }, TABLE_DIVIDER_WIDTH);
  const selection = useTableCellSelection(token.raw, { frame: frameRef, rows: rowRefs, columns: columnStarts });
  const { select, begin, extend, end } = selection;
  useLayoutEffect(() => bindTableCellSelection(frameRef.current, { select, begin, extend, end }), [select, begin, extend, end]);
  // A press on this table with the add key extends the selection the menu shows.
  const keeps = useCallback((event: PointerEvent) => addsCellRange(event)
    && ((frameRef.current as unknown as HTMLElement | null)?.contains(event.target as Node) ?? false), []);
  rowRefs.current.length = token.rows.length + 1;
  const selectedText = rangeText(token, selection.ranges);
  // Ranges of empty cells have nothing to copy, so they are not drawn once let go.
  const ranges = selection.dragging || selectedText ? selection.ranges : NO_RANGES;
  const align = (column: number) => styles[ALIGN_KEYS[aligns[column] ?? "left"]];
  const frame = (column: number) => [
    column === 0 ? null : styles.tableDivider,
    { width: widths[column] ?? metrics.columnMin },
  ];
  // While the table is written, a chunk lands in its last row: a row whose
  // cells, columns and selection are as they were keeps its element. The
  // columns hold still until a row ends (`measuredRows`), so a chunk redraws
  // the row it grew and no other.
  const drawn = useRef<{ context: RenderContext; nodes: NodeReuse["next"] } | null>(null);
  const reuse = nextReuse(drawn, context, open);
  const columns = `${widths.join(",")}|${aligns.join(",")}`;
  const rowSource = (row: number, cells: readonly Tokens.TableCell[], last: boolean) =>
    `${columns}|${last ? 1 : 0}|${rowSpan(ranges, row)}|${JSON.stringify(cells.map((cell) => cell.text))}`;
  const cellTokens = (cells: readonly Tokens.TableCell[]) => () => cells.map((cell) => cell.tokens);
  const drawRow = (
    key: string | undefined,
    row: number,
    cellPrefix: string,
    cells: readonly Tokens.TableCell[],
    rowStyle: ViewStyle,
    cellStyle: TextStyle,
    last: boolean,
  ) => (
    <View key={key} ref={(node) => { rowRefs.current[row] = node; }} style={[rowStyle, row > 0 && row % 2 === 0 && styles.tableRowAlternate, last && styles.tableRowLast]}>
      {cells.map((cell, column) => {
        const cellKey = `${cellPrefix}${column}`;
        // One Text per cell: on iOS and Android the frame takes the touches
        // and finds the cell from its rows and column starts.
        return (
          <Text
            key={cellKey}
            testID={TABLE_CELL_TEST_ID}
            // On iOS and Android a held cell starts a range, which the
            // platform's own text selection would take over.
            selectable={Platform.OS === "web"}
            {...contentTextProps()}
            {...(Platform.OS === "web" ? { dataSet: { tableCellRow: row, tableCellColumn: column } } : {})}
            style={[
              cellStyle,
              align(column),
              ...frame(column),
              contentTextStyle(),
              rangeHas(ranges, row, column) && { backgroundColor: context.tokens.selectionFill },
            ]}
          >
            {renderInline(cell.tokens, context, cellKey)}
          </Text>
        );
      })}
    </View>
  );

  return (
    <View style={copyStyles.outer}>
      {/* The platform indicator, shown while scrolling: nothing to draw or
          measure until then. */}
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.tableScroll}
        contentContainerStyle={[styles.tableContent, copyStyles.content]}
        scrollEnabled={!selection.dragging}
        onScrollBeginDrag={ranges.length > 0 ? selection.dismiss : undefined}>
        <View ref={frameRef} style={styles.tableFrame} {...selection.frameProps}>
          {reuseNode(reuse, `${keyPrefix}h`, rowSource(0, token.header, token.rows.length === 0),
            cellTokens(token.header), () => drawRow(undefined, 0, `${keyPrefix}h`, token.header, styles.tableHeaderRow,
              styles.tableHeaderCell, token.rows.length === 0))}
          {token.rows.map((row, rowIndex) => {
            const rowKey = `${keyPrefix}r${rowIndex}`;
            const last = rowIndex === token.rows.length - 1;
            return reuseNode(reuse, rowKey, rowSource(rowIndex + 1, row, last), cellTokens(row),
              () => drawRow(rowKey, rowIndex + 1, `${rowKey}c`, row, styles.tableRow, styles.tableCell, last));
          })}
        </View>
      </ScrollView>
      {/* Over the scroller rather than in it: a scroller clips what passes its
          edges, and the open menu's border and shadow reach past the left one. */}
      <TableCopyMenu source={source} frame={frameRef} tokens={context.tokens}
        selected={selectedText && !selection.dragging ? { text: selectedText, dismiss: selection.dismiss, keeps } : undefined} />
    </View>
  );
}

const copyStyles = StyleSheet.create({
  outer: { position: "relative" },
  // Room for the corner control outside the columns: half its side, so its
  // centre sits on the table's corner.
  content: {
    paddingTop: FLOAT.control / 2,
    paddingLeft: FLOAT.control / 2,
  },
});
