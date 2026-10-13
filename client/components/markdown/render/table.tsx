import React, { useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Tokens } from "../../../vendor/marked";
import type { RenderContext } from "./context";
import { inlineWidth, renderInline } from "./inline";
import { contentTextProps, contentTextStyle } from "../../../ui/content-text";
import { HScroll } from "../../../ui/h-scroll";
import { CopyButton } from "../../../ui/copy-button";
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
 * the card, with a 2px indicator under it while it overflows: clipping would
 * hide the cell that carries the answer, and an unmarked scroller looks
 * clipped (S7 iOS screenshots). While the table is still being written its
 * columns only widen, so a short cell arriving in a new row never pulls the
 * layout back; once it is complete the widths are measured once more from the
 * final cells.
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
  let widths = measured;
  if (open) {
    widths = measured.map((width, column) => Math.max(width, widest.current[column] ?? 0));
    widest.current = widths;
  } else {
    widest.current = measured;
  }
  // A column the author left unaligned is right-aligned when every cell is a
  // figure, so digits line up (S7 §3.7).
  const align = (column: number) =>
    styles[ALIGN_KEYS[token.align[column] ?? (numericColumn(token, column) ? "right" : "left")]];
  const frame = (column: number) => [
    column === 0 ? null : styles.tableDivider,
    { width: widths[column] ?? metrics.columnMin },
  ];

  return (
    <HScroll tokens={context.tokens} style={styles.tableScroll} contentContainerStyle={styles.tableContent}>
      <View style={copyStyles.container}>
        <View style={styles.tableFrame}>
          <View style={[styles.tableHeaderRow, token.rows.length === 0 && styles.tableRowLast]}>
            {token.header.map((cell, column) => {
              const cellKey = `${keyPrefix}h${column}`;
              return (
                <Text
                  key={cellKey}
                  selectable
                  {...contentTextProps()}
                  style={[
                    styles.tableHeaderCell,
                    align(column),
                    ...frame(column),
                    contentTextStyle(),
                  ]}
                >
                  {renderInline(cell.tokens, context, cellKey)}
                </Text>
              );
            })}
          </View>
          {token.rows.map((row, rowIndex) => (
            <View
              key={`${keyPrefix}r${rowIndex}`}
              style={[styles.tableRow, rowIndex === token.rows.length - 1 && styles.tableRowLast]}
            >
              {row.map((cell, column) => {
                const cellKey = `${keyPrefix}r${rowIndex}c${column}`;
                return (
                  <Text
                    key={cellKey}
                    selectable
                    {...contentTextProps()}
                    style={[
                      styles.tableCell,
                      align(column),
                      ...frame(column),
                      contentTextStyle(),
                    ]}
                  >
                    {renderInline(cell.tokens, context, cellKey)}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
        <View style={[copyStyles.corner, { backgroundColor: context.tokens.surface0 }]}>
          <CopyButton text={() => token.raw} tokens={context.tokens} />
        </View>
      </View>
    </HScroll>
  );
}

const copyStyles = StyleSheet.create({
  // Keep the corner control inside the scroller's bounds, outside the columns.
  container: {
    position: "relative",
    paddingTop: 12,
    paddingLeft: 12,
  },
  corner: {
    position: "absolute",
    top: 0,
    left: 0,
    borderRadius: 4,
  },
});
