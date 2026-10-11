import React, { useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Tokens } from "../../../vendor/marked";
import type { RenderContext } from "./context";
import { inlineWidth, renderInline } from "./inline";
import { ALIGN_KEYS, CHAR_RATIO_MONO, CHAR_RATIO_UI, TABLE_CELL_PADDING, type VariantMetrics } from "./styles";

/**
 * React Native offers no synchronous text measurement, so a column's width is
 * estimated from its longest cell and clamped to the variant's range.
 */
export function columnWidths(token: Tokens.Table, metrics: VariantMetrics): number[] {
  const ratio = metrics.mono ? CHAR_RATIO_MONO : CHAR_RATIO_UI;
  const cellSize = metrics.bodySize - 1;
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
    widths.push(Math.min(metrics.columnMax, Math.max(metrics.columnMin, estimate)));
  }
  return widths;
}

/**
 * A table keeps its own columns and scrolls sideways when the widest row beats
 * the card: clipping would hide the cell that carries the answer. While the
 * table is still being written its columns only widen, so a short cell
 * arriving in a new row never pulls the layout back; once it is complete the
 * widths are measured once more from the final cells.
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
  const align = (column: number) => styles[ALIGN_KEYS[token.align[column] ?? "left"]];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tableScroll}
      contentContainerStyle={styles.tableContent}
    >
      <View>
        <View style={styles.tableHeaderRow}>
          {token.header.map((cell, column) => {
            const cellKey = `${keyPrefix}h${column}`;
            return (
              <Text
                key={cellKey}
                selectable
                style={[
                  styles.tableHeaderCell,
                  align(column),
                  { width: widths[column] ?? metrics.columnMin },
                ]}
              >
                {renderInline(cell.tokens, context, cellKey)}
              </Text>
            );
          })}
        </View>
        {token.rows.map((row, rowIndex) => (
          <View key={`${keyPrefix}r${rowIndex}`} style={styles.tableRow}>
            {row.map((cell, column) => {
              const cellKey = `${keyPrefix}r${rowIndex}c${column}`;
              return (
                <Text
                  key={cellKey}
                  selectable
                  style={[
                    styles.tableCell,
                    align(column),
                    { width: widths[column] ?? metrics.columnMin },
                  ]}
                >
                  {renderInline(cell.tokens, context, cellKey)}
                </Text>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
