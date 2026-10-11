/**
 * The three variants' metrics and the one style sheet every renderer reads.
 * Moved unchanged from the pre-marked `markdown-view.tsx`, so a reply looks
 * the same on either engine; additions are marked as such.
 */
import { StyleSheet } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { radiusV2, space, withAlpha, type ExtendedThemeTokens } from "../../theme-tokens";
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
  headingGap: number;
  /** Draws a rule under h1 and h2. */
  headingRule: boolean;
  /** Prefixes headings with their own `#` run instead of relying on size. */
  headingHash: boolean;
  markerWidth: number;
  itemGap: number;
  indentStep: number;
  tableGap: number;
  columnMin: number;
  columnMax: number;
  glyphSize: number;
  codeCompact: boolean;
  codeLineNumbers: boolean;
}

export const VARIANT_METRICS: Record<MarkdownVariant, VariantMetrics> = {
  // document: for a long answer read top to bottom. Wide leading and big ruled
  // headings buy scanability with vertical space, so a section can be found
  // without reading it.
  document: {
    bodySize: 13.5,
    bodyLineHeight: 22.5,
    mono: false,
    blockGap: 13,
    headingSizes: [23, 18.5, 15.5, 13],
    headingGap: 9,
    headingRule: true,
    headingHash: false,
    markerWidth: 20,
    itemGap: 6,
    indentStep: 18,
    tableGap: 18,
    columnMin: 60,
    columnMax: 320,
    glyphSize: 13,
    codeCompact: false,
    codeLineNumbers: false,
  },
  // compact: for a short reply in a crowded thread. Spacing is tight and
  // headings stay near body size, so a three-line answer reads as one bubble
  // rather than a document.
  compact: {
    bodySize: 13,
    bodyLineHeight: 19,
    mono: false,
    blockGap: 7,
    headingSizes: [16.5, 14.5, 13.5, 12],
    headingGap: 4,
    headingRule: false,
    headingHash: false,
    markerWidth: 15,
    itemGap: 2,
    indentStep: 13,
    tableGap: 12,
    columnMin: 48,
    columnMax: 240,
    glyphSize: 11,
    codeCompact: true,
    codeLineNumbers: false,
  },
  // terminal: for an answer that is mostly code. Body text joins the code on
  // the mono family at a tight line height, headings keep their literal `##`
  // marker, and fences carry line numbers so prose and code read as one log.
  terminal: {
    bodySize: 12.5,
    bodyLineHeight: 17.5,
    mono: true,
    blockGap: 9,
    headingSizes: [14.5, 13.5, 12.5, 12],
    headingGap: 7,
    headingRule: false,
    headingHash: true,
    markerWidth: 18,
    itemGap: 1,
    indentStep: 16,
    tableGap: 14,
    columnMin: 52,
    columnMax: 280,
    glyphSize: 11,
    codeCompact: false,
    codeLineNumbers: true,
  },
};

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
// of Inter and Iosevka as a fraction of the font size.
export const CHAR_RATIO_UI = 0.55;
export const CHAR_RATIO_MONO = 0.62;

// A marker sits in a fixed column, so its width has to carry the gutter the
// style adds; an estimate that forgets it wraps `2.` onto a second line.
export const MARKER_GAP = 6;
// The inline-code chip's own horizontal padding, counted twice per chip when a
// table column is measured, and matched by the cell's padding so a chip never
// sits against the column edge.
export const CODE_CHIP_PADDING = 4;
export const TABLE_CELL_PADDING = 6;

/** Every style the renderer draws with, so callers never infer it from the builder. */
export interface MarkdownStyles {
  root: ViewStyle;
  headingBlock: ViewStyle;
  headingBlockFirst: ViewStyle;
  h1: TextStyle;
  h2: TextStyle;
  h3: TextStyle;
  h4: TextStyle;
  headingHash: TextStyle;
  headingRule: ViewStyle;
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
  tableHeaderRow: ViewStyle;
  tableRow: ViewStyle;
  tableHeaderCell: TextStyle;
  tableCell: TextStyle;
  cellLeft: TextStyle;
  cellCenter: TextStyle;
  cellRight: TextStyle;
  strong: TextStyle;
  emphasis: TextStyle;
  strike: TextStyle;
  codeSpan: TextStyle;
  link: TextStyle;
  /** Added with marked: the one-line summary of a folded code block. */
  codeSummary: ViewStyle;
  codeSummaryText: TextStyle;
  /** Added with marked: an item body holding more than one block. */
  listItemBody: ViewStyle;
  listItemText: TextStyle;
}

export function buildStyles(tokens: ExtendedThemeTokens, variant: MarkdownVariant): MarkdownStyles {
  const metrics = VARIANT_METRICS[variant];
  const bodyFont = metrics.mono ? tokens.fontMono : tokens.fontUi;
  const [size1, size2, size3, size4] = metrics.headingSizes;
  // The terminal variant's headings sit within a point of body size, so the
  // accent on h1 and the hash run carry the hierarchy that size cannot.
  const topColor = variant === "terminal" ? tokens.accent : tokens.foreground;

  return StyleSheet.create({
    root: {
      ...selectableSurface,
      width: "100%",
      gap: metrics.blockGap,
    },
    headingBlock: {
      marginTop: metrics.headingGap,
      gap: space.xs,
    },
    headingBlockFirst: {
      gap: space.xs,
    },
    h1: {
      fontFamily: bodyFont,
      fontSize: size1,
      lineHeight: size1 * 1.28,
      fontWeight: "700",
      letterSpacing: -0.3,
      color: topColor,
    },
    h2: {
      fontFamily: bodyFont,
      fontSize: size2,
      lineHeight: size2 * 1.3,
      fontWeight: "700",
      letterSpacing: -0.15,
      color: tokens.foreground,
    },
    h3: {
      fontFamily: bodyFont,
      fontSize: size3,
      lineHeight: size3 * 1.35,
      fontWeight: "600",
      color: tokens.foreground,
    },
    h4: {
      fontFamily: bodyFont,
      fontSize: size4,
      lineHeight: size4 * 1.4,
      fontWeight: "600",
      letterSpacing: 0.7,
      textTransform: "uppercase",
      color: tokens.foregroundMuted,
    },
    headingHash: {
      color: tokens.accent,
      fontWeight: "400",
      ...unselectable,
    },
    headingRule: {
      height: 1,
      backgroundColor: tokens.borderSubtle,
    },
    paragraph: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foreground,
    },
    plain: {
      fontFamily: tokens.fontMono,
      fontSize: metrics.bodySize - 0.5,
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
      // Centres the box on the first line of the item, not on the whole item.
      paddingTop: Math.max(0, (metrics.bodyLineHeight - metrics.glyphSize) / 2),
      ...unselectable,
    },
    itemText: {
      flex: 1,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foreground,
    },
    itemTextDone: {
      flex: 1,
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
      textDecorationLine: "line-through",
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: withAlpha(tokens.foregroundMuted, 0.5),
      paddingLeft: 10,
      gap: 5,
    },
    quoteText: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize,
      lineHeight: metrics.bodyLineHeight,
      fontStyle: "italic",
      color: tokens.foregroundMuted,
    },
    codeBlock: {
      marginVertical: 1,
    },
    rule: {
      height: 1,
      backgroundColor: tokens.border,
      marginVertical: 2,
    },
    tableScroll: {
      alignSelf: "stretch",
    },
    tableContent: {
      paddingRight: 6,
    },
    tableHeaderRow: {
      flexDirection: "row",
      gap: metrics.tableGap,
      paddingBottom: 5,
      marginBottom: space.xs,
      borderBottomWidth: 1,
      borderBottomColor: tokens.border,
    },
    tableRow: {
      flexDirection: "row",
      gap: metrics.tableGap,
      paddingVertical: 2,
    },
    tableHeaderCell: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize - 1,
      lineHeight: metrics.bodyLineHeight - 2,
      paddingHorizontal: TABLE_CELL_PADDING,
      fontWeight: "700",
      color: tokens.foreground,
    },
    tableCell: {
      fontFamily: bodyFont,
      fontSize: metrics.bodySize - 1,
      lineHeight: metrics.bodyLineHeight - 2,
      paddingHorizontal: TABLE_CELL_PADDING,
      color: tokens.foreground,
    },
    cellLeft: { textAlign: "left" },
    cellCenter: { textAlign: "center" },
    cellRight: { textAlign: "right" },
    strong: {
      fontWeight: "700",
      color: tokens.foreground,
    },
    emphasis: {
      fontStyle: "italic",
    },
    strike: {
      textDecorationLine: "line-through",
      color: tokens.foregroundMuted,
    },
    codeSpan: {
      fontFamily: tokens.fontMono,
      fontSize: metrics.bodySize - 1,
      // A neutral tint, not the accent: inline code is not a link and must not
      // borrow the one colour that means "action" everywhere else in the card.
      backgroundColor: withAlpha(tokens.foreground, tokens.isDark ? 0.12 : 0.07),
      borderRadius: radiusV2.chip,
      paddingHorizontal: CODE_CHIP_PADDING,
      color: tokens.foreground,
    },
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
      fontSize: metrics.bodySize - 1,
      lineHeight: metrics.bodyLineHeight,
      color: tokens.foregroundMuted,
      ...unselectable,
    },
  });
}
