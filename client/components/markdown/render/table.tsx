import React, { useLayoutEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View, type TextProps, type TextStyle, type ViewProps, type ViewStyle } from "react-native";
import type { Tokens } from "../../../vendor/marked";
import type { RenderContext } from "./context";
import { inlineText, inlineWidth, renderInline } from "./inline";
import { nextReuse, reuseNode, type NodeReuse } from "./reuse";
import { contentTextProps, contentTextStyle } from "../../../ui/content-text";
import { HScroll } from "../../../ui/h-scroll";
import { TableCopyMenu } from "./table-copy-menu";
import { bindTableCellSelection, TABLE_CELL_TEST_ID } from "./table-selection";
import { useTableTouchSelection } from "./table-touch-selection";
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
 * the divider on its left.
 */
export function columnWidths(token: Tokens.Table, metrics: VariantMetrics): number[] {
  const ratio = metrics.mono ? CHAR_RATIO_MONO : CHAR_RATIO_UI;
  const cellSize = metrics.cellSize;
  const widths: number[] = [];
  for (let column = 0; column < token.header.length; column++) {
    // The header is bold, which the average advance does not cover, so it is
    // measured a shade wider than a body cell of the same length.
    let longest = inlineWidth(token.header[column]?.tokens, cellSize, ratio) * 1.06;
    for (const row of token.rows) {
      const cell = row[column];
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
 * A table keeps its own columns and scrolls sideways when the widest row beats
 * the card. Its indicator appears only during scrolling. While the table is
 * still being written its columns only widen, so a short cell arriving in a
 * new row never pulls the layout back; once it is complete the widths are
 * measured once more from the final cells.
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
  const measured = columnWidths(token, metrics);
  const widest = useRef<number[]>([]);
  const frameRef = useRef<View>(null);
  const selection = useTableTouchSelection(token.raw);
  useLayoutEffect(() => bindTableCellSelection(frameRef.current, selection.select), [selection.select]);
  let widths = measured;
  if (open) {
    widths = measured.map((width, column) => Math.max(width, widest.current[column] ?? 0));
    widest.current = widths;
  } else {
    widest.current = measured;
  }
  // A column the author left unaligned is right-aligned when every cell is a
  // figure, so digits line up (S7 §3.7).
  const aligns = token.header.map(
    (_, column) => token.align[column] ?? (numericColumn(token, column) ? "right" : "left"),
  );
  const align = (column: number) => styles[ALIGN_KEYS[aligns[column] ?? "left"]];
  const frame = (column: number) => [
    column === 0 ? null : styles.tableDivider,
    { width: widths[column] ?? metrics.columnMin },
  ];
  // While the table is written, a chunk lands in its last row: a row whose
  // cells, columns and selection are as they were keeps its element.
  const drawn = useRef<{ context: RenderContext; nodes: NodeReuse["next"] } | null>(null);
  const reuse = nextReuse(drawn, context, open);
  const columns = `${widths.join(",")}|${aligns.join(",")}`;
  const rowSource = (key: string, cells: readonly Tokens.TableCell[], last: boolean) => {
    const selected = selection.selected?.key;
    const marked = selected !== undefined && selected.startsWith(key) ? selected : "";
    return `${columns}|${last ? 1 : 0}|${marked}|${JSON.stringify(cells.map((cell) => cell.text))}`;
  };
  const cellTokens = (cells: readonly Tokens.TableCell[]) => () => cells.map((cell) => cell.tokens);
  const drawRow = (
    key: string | undefined,
    cellPrefix: string,
    cells: readonly Tokens.TableCell[],
    rowStyle: ViewStyle,
    cellStyle: TextStyle,
    last: boolean,
  ) => (
    <View key={key} style={[rowStyle, last && styles.tableRowLast]}>
      {cells.map((cell, column) => {
        const cellKey = `${cellPrefix}${column}`;
        return (
          <TableCell
            key={cellKey}
            testID={TABLE_CELL_TEST_ID}
            selectable
            {...contentTextProps()}
            {...(Platform.OS === "web" ? { dataSet: { tableCellKey: cellKey, tableCellText: inlineText(cell.tokens) } } : {})}
            touchProps={selection.cellProps(cellKey, () => inlineText(cell.tokens))}
            style={[
              cellStyle,
              align(column),
              ...frame(column),
              contentTextStyle(),
              selection.selected?.key === cellKey && { backgroundColor: context.tokens.accentBg },
            ]}
          >
            {renderInline(cell.tokens, context, cellKey)}
          </TableCell>
        );
      })}
    </View>
  );

  return (
    <View style={copyStyles.outer}>
      <HScroll tokens={context.tokens} indicatorOnScroll style={styles.tableScroll} contentContainerStyle={styles.tableContent}
        onScrollBeginDrag={selection.selected ? selection.dismiss : undefined}>
        <View style={copyStyles.container}>
          <View ref={frameRef} style={styles.tableFrame}>
            {reuseNode(reuse, `${keyPrefix}h`, rowSource(`${keyPrefix}h`, token.header, token.rows.length === 0),
              cellTokens(token.header), () => drawRow(undefined, `${keyPrefix}h`, token.header, styles.tableHeaderRow,
                styles.tableHeaderCell, token.rows.length === 0))}
            {token.rows.map((row, rowIndex) => {
              const rowKey = `${keyPrefix}r${rowIndex}`;
              const last = rowIndex === token.rows.length - 1;
              return reuseNode(reuse, rowKey, rowSource(`${rowKey}c`, row, last), cellTokens(row),
                () => drawRow(rowKey, `${rowKey}c`, row, styles.tableRow, styles.tableCell, last));
            })}
          </View>
        </View>
      </HScroll>
      {/* Over the scroller rather than in it: a scroller clips what passes its
          edges, and the open menu's border and shadow reach past the left one. */}
      <View style={copyStyles.corner}>
        {/* Only the closed icon needs a static backing; the menu paints its
            own expanding frame so no full-width fill remains during exit. */}
        <View pointerEvents="none" style={[copyStyles.corner, copyStyles.backing, { backgroundColor: context.tokens.surface0 }]} />
        <TableCopyMenu source={() => token.raw} frame={frameRef} tokens={context.tokens}
          selected={selection.selected ? { text: selection.selected.text, dismiss: selection.dismiss } : undefined} />
      </View>
    </View>
  );
}

/** View owns native raw touches; Text keeps its layout and rich inline runs. */
function TableCell({ touchProps, ...props }: TextProps & { touchProps: ViewProps }) {
  const text = <Text {...props} />;
  return Platform.OS !== "web"
    ? <View testID="markdown-table-touch-cell" style={copyStyles.touchCell} {...touchProps}>{text}</View>
    : text;
}

const copyStyles = StyleSheet.create({
  touchCell: { flexDirection: "row" },
  outer: { position: "relative" },
  // Room for the corner control outside the columns: half its side, so its
  // centre sits on the table's corner.
  container: {
    paddingTop: FLOAT.control / 2,
    paddingLeft: FLOAT.control / 2,
  },
  // Shaped like the control it backs, so the table's border is not cut square.
  corner: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: FLOAT.radius,
  },
  backing: { width: FLOAT.control, height: FLOAT.control },
});
