/**
 * The three variants' metrics and the one style sheet every renderer reads.
 * Moved unchanged from the pre-marked `markdown-view.tsx`, so a reply looks
 * the same on either engine; additions are marked as such.
 */
import { StyleSheet } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { radiusV2, space, type ExtendedThemeTokens } from "../../theme-tokens";
import { hairline } from "../../../ui/tokens/platform";
import { even, proseScale } from "../../../ui/tokens/typography";
import { selectableSurface, unselectable } from "../../selection";

/**
 * The assistant's own prose, drawn by the plugin instead of the host. Three
 * variants exist because one rhythm cannot serve both a one-line answer and a
 * ten-section report; the user picks the one that matches their thread.
 */
export type MarkdownVariant = "document" | "compact" | "terminal";

export const MARKDOWN_VARIANTS: readonly MarkdownVariant[] = ["document", "compact", "terminal"];

export type MdAlign = "left" | "center" | "right";

export interface VariantMetrics {
  bodySize: number;
  bodyLineHeight: number;
  /** Body text on the mono family, which also drives table column estimates. */
  mono: boolean;
  blockGap: number;
  headingSizes: readonly [number, number, number, number];
  headingLineHeights: readonly [number, number, number, number];
  /** Extra space above h1/h2, and above h3. */
  headingGap: readonly [number, number];
  /** Prefixes headings with their own `#` run instead of relying on size. */
  headingHash: boolean;
  markerWidth: number;
  itemGap: number;
  indentStep: number;
  /** Table cell text and its line height: one step under the body. */
  cellSize: number;
  cellLineHeight: number;
  /** Inline code size. */
  codeSize: number;
  tableGap: number;
  columnMin: number;
  columnMax: number;
  glyphSize: number;
  codeCompact: boolean;
  /** Line numbers on fenced code of at least this many lines; 0 for never. */
  codeLineNumbersFrom: number;
}

/**
 * The three variants' metrics, in integers, from the host body size `b`
 * (S7 design spec §2.3, F0 "Markdown styles"):
 *
 * | | Document | Compact | Terminal |
 * |---|---|---|---|
 * | body | b / even(1.5b) | b / even(1.33b) | mono b−1 / even(1.4(b−1)) |
 * | block gap | 16 touch · 12 desktop | 8 | 8 |
 * | h1 / h2 / h3 | ⌊1.5b⌋ / ⌊1.25b⌋ / b+1 | b+3 / b+2 / b+1 | body size |
 * | space above | +8 h1, h2 · +4 h3 | +4 · 0 | 0 |
 * | list indent | 20 | 16 | 16 |
 * | table cell | b−1 / even(1.5b)−2 | b−1 / even(1.33(b−1)) | mono b−2 / even(1.4(b−2)) |
 * | code line numbers | blocks of 4+ lines | off | off |
 *
 * `quiet` (reasoning) sets the body one step down. Results are cached, so a
 * view gets the same object for the same inputs and its blocks stay memoised.
 */
export function variantMetrics(
  variant: MarkdownVariant,
  b: number,
  compact = false,
  quiet = false,
): VariantMetrics {
  const key = `${variant}|${b}|${compact ? 1 : 0}|${quiet ? 1 : 0}`;
  const cached = METRICS_CACHE.get(key);
  if (cached) return cached;
  const base = Math.round(quiet ? b - 1 : b);
  const scale = proseScale(base);
  let metrics: VariantMetrics;
  if (variant === "document") {
    metrics = {
      bodySize: scale.body.size,
      bodyLineHeight: scale.body.lineHeight,
      mono: false,
      blockGap: compact ? space.lg : space.md,
      headingSizes: [scale.h1.size, scale.h2.size, scale.h3.size, scale.body.size],
      headingLineHeights: [scale.h1.lineHeight, scale.h2.lineHeight, scale.h3.lineHeight, scale.body.lineHeight],
      headingGap: [space.sm, space.xs],
      headingHash: false,
      markerWidth: 20,
      itemGap: space.xs,
      indentStep: 20,
      cellSize: scale.secondary.size,
      cellLineHeight: scale.secondary.lineHeight,
      codeSize: scale.small.size,
      tableGap: space.lg,
      columnMin: 64,
      columnMax: 320,
      glyphSize: 14,
      codeCompact: false,
      codeLineNumbersFrom: 4,
    };
  } else if (variant === "compact") {
    const body = { size: base, lineHeight: even(1.33 * base) };
    metrics = {
      bodySize: body.size,
      bodyLineHeight: body.lineHeight,
      mono: false,
      blockGap: space.sm,
      headingSizes: [base + 3, base + 2, base + 1, base],
      headingLineHeights: [body.lineHeight + 2, body.lineHeight + 2, body.lineHeight, body.lineHeight],
      headingGap: [space.xs, 0],
      headingHash: false,
      markerWidth: 16,
      itemGap: 2,
      indentStep: 16,
      cellSize: base - 1,
      cellLineHeight: even(1.33 * (base - 1)),
      codeSize: scale.small.size,
      tableGap: space.md,
      columnMin: 48,
      columnMax: 240,
      glyphSize: 12,
      codeCompact: true,
      codeLineNumbersFrom: 0,
    };
  } else {
    const size = base - 1;
    const lineHeight = even(1.4 * size);
    metrics = {
      bodySize: size,
      bodyLineHeight: lineHeight,
      mono: true,
      blockGap: space.sm,
      headingSizes: [size, size, size, size],
      headingLineHeights: [lineHeight, lineHeight, lineHeight, lineHeight],
      headingGap: [0, 0],
      headingHash: true,
      markerWidth: 16,
      itemGap: 2,
      indentStep: 16,
      cellSize: size - 1,
      cellLineHeight: even(1.4 * (size - 1)),
      codeSize: size - 1,
      tableGap: space.md,
      columnMin: 52,
      columnMax: 280,
      glyphSize: 12,
      codeCompact: false,
      codeLineNumbersFrom: 0,
    };
  }
  METRICS_CACHE.set(key, metrics);
  return metrics;
}

const METRICS_CACHE = new Map<string, VariantMetrics>();

// One marker per level, so a nested item is distinguishable from its parent
// even when the indent is clipped by a narrow card.
export const BULLETS = ["\u2022", "\u25e6", "\u2023"] as const;
export const HASH_LABELS = ["# ", "## ", "### ", "#### "] as const;
export const HEADING_KEYS = ["h1", "h2", "h3", "h4"] as const;
export const INDENT_KEYS = ["indent0", "indent1", "indent2", "indent3"] as const;
export const ALIGN_KEYS: Record<MdAlign, "cellLeft" | "cellCenter" | "cellRight"> = {
  left: "cellLeft",
  center: "cellCenter",
  right: "cellRight",
};

// React Native offers no synchronous text measurement, so a column's width is
// estimated from its longest cell. These ratios are the average advance width
// of a UI face and a monospace face (SF Mono, Menlo, Consolas) as a fraction of
// the font size.
export const CHAR_RATIO_UI = 0.55;
export const CHAR_RATIO_MONO = 0.62;
// A digit is wider than the average letter: table figures are set tabular, and
// a tabular figure advances about 0.62 em in SF and its kin (measured at 15px).
export const CHAR_RATIO_DIGIT = 0.62;

// A marker sits in a fixed column, so its width has to carry the gutter the
// style adds; an estimate that forgets it wraps `2.` onto a second line.
export const MARKER_GAP = 6;
// The inline-code chip's own horizontal padding, counted twice per chip when a
// table column is measured, and matched by the cell's padding so a chip never
// sits against the column edge.
export const CODE_CHIP_PADDING = 4;
export const TABLE_CELL_PADDING = 6;
// A row is a line of text, not a list row: at 8 above and below, a table of
// body-size cells read a size larger than the prose around it.
export const TABLE_CELL_PADDING_Y = 5;
export const TABLE_DIVIDER_WIDTH = 1;

/** Every style the renderer draws with, so callers never infer it from the builder. */
export interface MarkdownStyles {
  root: ViewStyle;
  headingBlock: ViewStyle;
  /** h3 and deeper: less space above than h1 and h2. */
  headingBlockMinor: ViewStyle;
  headingBlockFirst: ViewStyle;
  h1: TextStyle;
  h2: TextStyle;
  h3: TextStyle;
  h4: TextStyle;
  headingHash: TextStyle;
  paragraph: TextStyle;
  plain: TextStyle;
  listBlock: ViewStyle;
  listRow: ViewStyle;
  indent0: ViewStyle;
  indent1: ViewStyle;
  indent2: ViewStyle;
  indent3: ViewStyle;
  markerBullet: TextStyle;
  markerOrdered: TextStyle;
  checkboxCell: ViewStyle;
  itemText: TextStyle;
  itemTextDone: TextStyle;
  quote: ViewStyle;
  quoteText: TextStyle;
  codeBlock: ViewStyle;
  rule: ViewStyle;
  tableScroll: ViewStyle;
  tableContent: ViewStyle;
  /** The table's outer border; clips the header fill to its rounded corners. */
  tableFrame: ViewStyle;
  /** The table's last row, header included, drops its rule, which would double the frame's. */
  tableRowLast: ViewStyle;
  tableHeaderRow: ViewStyle;
  tableRow: ViewStyle;
  tableHeaderCell: TextStyle;
  tableCell: TextStyle;
  /** The rule between two columns, on the left edge of every cell but the first. */
  tableDivider: TextStyle;
  cellLeft: TextStyle;
  cellCenter: TextStyle;
  cellRight: TextStyle;
  strong: TextStyle;
  emphasis: TextStyle;
  strike: TextStyle;
  codeSpan: TextStyle;
  /** `codeSpan` inside a heading or `strong`: the run's own weight. */
  codeSpanBold: TextStyle;
  link: TextStyle;
  /** Added with marked: the one-line summary of a folded code block. */
  codeSummary: ViewStyle;
  codeSummaryText: TextStyle;
  /** Added with marked: an item body holding more than one block. */
  listItemBody: ViewStyle;
  listItemText: TextStyle;
}

export function buildStyles(
  tokens: ExtendedThemeTokens,
  variant: MarkdownVariant,
  metrics: VariantMetrics,
  quiet = false,
): MarkdownStyles {
  const bodyFont = metrics.mono ? tokens.fontMono : tokens.fontUi;
  const [size1, size2, size3, size4] = metrics.headingSizes;
  const [lead1, lead2, lead3, lead4] = metrics.headingLineHeights;
  const text = quiet ? tokens.foregroundMuted : tokens.foreground;
  // The terminal variant's headings are body size, so the accent on h1 and
  // the hash run carry the hierarchy that size cannot.
  const topColor = variant === "terminal" ? tokens.accent : text;

  // The tokens' platform rather than the running one: the settings page's
  // mobile preview draws a phone's code spans on the web.
  const web = tokens.platform === "web";
  const codeBase: TextStyle =
    web
      ? {
          fontFamily: tokens.fontMono,
          fontSize: metrics.codeSize,
          // A neutral fill, not the accent: inline code is not a link and must
          // not borrow the one colour that means "action" everywhere else.
          backgroundColor: tokens.v2.surface2,
          borderRadius: radiusV2.chip,
          paddingHorizontal: CODE_CHIP_PADDING,
          color: text,
        }
      : {
          // A run inside native text has no padding or radius, and its fill
          // covers the whole line box: on a 1.33 line height that is a tall
          // square slab that touches the next line's. Off the web the span is
          // told apart by its family and the colour picked in the settings,
          // dark grey by default.
          fontFamily: tokens.fontMono,
          fontSize: metrics.codeSize,
          color: quiet ? text : tokens.codeInline,
        };
  // A step under the body and in grey, SF Mono reads thinner than the prose
  // around it until semibold; medium was still too light on a phone.
  // Android's monospace has one face and synthesizes the same bold.
  const codeSpanWeight: TextStyle["fontWeight"] = web ? undefined : "600";
  const codeSpan: TextStyle =
    codeSpanWeight === undefined ? codeBase : { ...codeBase, fontWeight: codeSpanWeight };

  return StyleSheet.create({
    root: {
      ...selectableSurface,
      width: "100%",
      gap: metrics.blockGap,
    },
    headingBlock: {
      marginTop: metrics.headingGap[0],
    },
    headingBlockMinor: {
      marginTop: metrics.headingGap[1],
    },
    headingBlockFirst: {},
    h1: {
      fontFamily: bodyFont,
      fontSize: size1,
      lineHeight: lead1,
      fontWeight: "600",
      color: topColor,
    },
    h2: {
      fontFamily: bodyFont,
      fontSize: size2,
      lineHeight: lead2,
      fontWeight: "600",
      color: text,
    },
    h3: {
      fontFamily: bodyFont,
      fontSize: size3,
      lineHeight: lead3,
      fontWeight: "600",
      color: text,
    },
    h4: {
      fontFamily: bodyFont,
      fontSize: size4,
      lineHeight: lead4,
      fontWeight: "600",
      color: text,
    },
    headingHash: {
      color: tokens.accent,
      fontWeight: "400",
      ...unselectable,
    },
    paragraph: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: text,
    },
    plain: {
      fontFamily: tokens.fontMono,
      fontSize: metrics.codeSize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
    },
    listBlock: {
      gap: metrics.itemGap,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    indent0: { marginLeft: 0 },
    indent1: { marginLeft: metrics.indentStep },
    indent2: { marginLeft: metrics.indentStep * 2 },
    indent3: { marginLeft: metrics.indentStep * 3 },
    markerBullet: {
      width: metrics.markerWidth,
      flexShrink: 0,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
      ...unselectable,
    },
    markerOrdered: {
      flexShrink: 0,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      textAlign: "right",
      paddingRight: MARKER_GAP,
      color: tokens.foregroundMuted,
      fontVariant: ["tabular-nums"],
      ...unselectable,
    },
    checkboxCell: {
      width: metrics.markerWidth,
      flexShrink: 0,
      // Centres the mark on the first line of the item, not on the whole item.
      paddingTop: Math.max(0, Math.round((metrics.bodyLineHeight - metrics.glyphSize) / 2)),
      ...unselectable,
    },
    itemText: {
      flex: 1,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: text,
    },
    // A finished task reads quieter, not struck through (S7 3.3).
    itemTextDone: {
      flex: 1,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: tokens.v2.border,
      paddingLeft: space.md,
      gap: space.xs,
    },
    // A quote is one step quieter than the prose, upright: an italic CJK face
    // is a synthetic slant.
    quoteText: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
    },
    codeBlock: {},
    rule: {
      ...hairline(tokens.platform),
      backgroundColor: tokens.v2.border,
    },
    tableScroll: {
      alignSelf: "stretch",
    },
    tableContent: {
      paddingRight: space.xs,
    },
    tableFrame: {
      borderWidth: TABLE_DIVIDER_WIDTH,
      borderColor: tokens.v2.border,
      borderRadius: radiusV2.block,
      overflow: "hidden",
    },
    tableHeaderRow: {
      flexDirection: "row",
      backgroundColor: tokens.v2.surface2,
      borderBottomWidth: 1,
      borderBottomColor: tokens.v2.border,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: tokens.v2.borderSubtle,
    },
    tableRowLast: {
      borderBottomWidth: 0,
    },
    tableHeaderCell: {
      fontFamily: bodyFont,
      fontSize: metrics.cellSize,
      lineHeight: metrics.cellLineHeight,
      paddingVertical: TABLE_CELL_PADDING_Y,
      paddingHorizontal: TABLE_CELL_PADDING + metrics.tableGap / 2,
      fontWeight: "500",
      color: tokens.foregroundMuted,
    },
    tableCell: {
      fontFamily: bodyFont,
      fontSize: metrics.cellSize,
      lineHeight: metrics.cellLineHeight,
      paddingVertical: TABLE_CELL_PADDING_Y,
      paddingHorizontal: TABLE_CELL_PADDING + metrics.tableGap / 2,
      color: text,
    },
    tableDivider: {
      borderLeftWidth: TABLE_DIVIDER_WIDTH,
      borderLeftColor: tokens.v2.borderSubtle,
    },
    cellLeft: { textAlign: "left" },
    cellCenter: { textAlign: "center" },
    cellRight: { textAlign: "right", fontVariant: ["tabular-nums"] },
    strong: {
      fontWeight: "600",
      color: text,
    },
    emphasis: {
      fontStyle: "italic",
    },
    strike: {
      textDecorationLine: "line-through",
      color: tokens.foregroundMuted,
    },
    codeSpan,
    // Inside bold (a heading, `strong`) the span keeps the run's weight; the
    // medium above would make it lighter than the words around it.
    codeSpanBold: codeBase,
    link: {
      color: tokens.accent,
      textDecorationLine: "underline",
    },
    listItemBody: {
      flex: 1,
      minWidth: 0,
    },
    listItemText: {
      flex: 0,
    },
    codeSummary: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingVertical: 2,
    },
    codeSummaryText: {
      fontFamily: tokens.fontMono,
      fontSize: metrics.codeSize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
      ...unselectable,
    },
  });
}
