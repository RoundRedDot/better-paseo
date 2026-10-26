import React from "react";
import { Platform, Text, View } from "react-native";
import type { MarkedToken, Token, Tokens } from "../../../vendor/marked";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { MathToken } from "../lex";
import type { InsightToken } from "../insight";
import { CodeBlock } from "./code-block";
import type { RenderContext } from "./context";
import { codeSurface } from "../../host-font-escape";
import { contentTextProps, contentTextStyle } from "../../../ui/content-text";
import { MarkdownProse, NativeProseGroup } from "./prose";
import { nativeList, nativeParagraphs } from "./native-prose-source";
import { CopyButton } from "../../../ui/copy-button";
import { LocalImage } from "./local-image";
import { splitLocalImages } from "./local-path";
import {
  BULLETS,
  CHAR_RATIO_MONO,
  CHAR_RATIO_UI,
  HASH_LABELS,
  HEADING_KEYS,
  INDENT_KEYS,
  MARKER_GAP,
  type VariantMetrics,
} from "./styles";
import { MdTable } from "./table";
import { reuseNode, type NodeReuse } from "./reuse";

export interface BlockOptions {
  /** The first block of the message: a heading there takes no top margin. */
  first: boolean;
  /** The block is the tail of a reply that is still streaming. */
  open: boolean;
  /** Inside a quote: paragraphs take the quote's text style. */
  inQuote?: boolean;
  /** The open tail's parts as drawn last, for the parts a chunk left alone. */
  reuse?: NodeReuse;
}

function optionSource(options: BlockOptions): string {
  return `${options.first ? 1 : 0}${options.open ? 1 : 0}${options.inQuote ? 1 : 0}`;
}

/** Block tokens as React Native nodes; `space` and link definitions draw nothing. */
export function renderBlocks(
  tokens: readonly Token[],
  context: RenderContext,
  keyPrefix: string,
  options: BlockOptions,
): React.ReactNode[] {
  if (Platform.OS === "ios" && !context.plainProse) {
    const list = tokens.find((token) => token.type !== "space");
    if (nativeParagraphs(tokens) ||
      (list && nativeList(list) && tokens.every((token) => token === list || token.type === "space"))) {
      return [<NativeProseGroup key={keyPrefix} context={context} tokens={tokens} inQuote={options.inQuote} />];
    }
  }
  const out: React.ReactNode[] = [];
  let first = options.first;
  tokens.forEach((token, index) => {
    const key = `${keyPrefix}.${index}`;
    const blockOptions = { ...options, first };
    const node = reuseNode(
      options.reuse,
      key,
      `${optionSource(blockOptions)}${token.type}:${token.raw}`,
      () => token,
      () => renderBlock(token, context, key, blockOptions),
    );
    if (node !== null) {
      out.push(node);
      first = false;
    }
  });
  return out;
}

function renderBlock(
  generic: Token,
  context: RenderContext,
  key: string,
  options: BlockOptions,
): React.ReactNode {
  const { styles, metrics } = context;

  if (generic.type === "insight") {
    const insight = generic as unknown as InsightToken;
    const insightContext = {
      ...context,
      styles: { ...styles, listBlock: styles.insightList },
    };
    return (
      <View key={key} style={styles.insight}>
        <View style={styles.insightHeader}>
          <MarkdownProse context={context} style={styles.insightTitle} text="✦ Insight" />
          <CopyButton text={insight.text.trim()} tokens={context.tokens} label="Copy section" />
        </View>
        {renderBlocks(insight.tokens, insightContext, `${key}i`, {
          ...options, first: true, open: options.open && !insight.closed,
        })}
      </View>
    );
  }

  if (generic.type === "math") {
    // TeX source on the code face (plan D6): readable, and copyable as TeX.
    const math = generic as unknown as MathToken;
    return (
      <MarkdownProse key={key} context={context} {...(codeSurface as object)} style={styles.plain} text={math.text} />
    );
  }

  const token = generic as MarkedToken;
  switch (token.type) {
    case "space":
    case "def":
      return null;

    case "heading": {
      // Deeper hashes clamp to 4: a chat bubble has no room for six tiers.
      const level = Math.min(4, Math.max(1, token.depth));
      const headingStyle = styles[HEADING_KEYS[level - 1] ?? "h4"];
      return (
        <View
          key={key}
          style={
            options.first
              ? styles.headingBlockFirst
              : level <= 2
                ? styles.headingBlock
                : styles.headingBlockMinor
          }
        >
          <MarkdownProse context={context} style={headingStyle} tokens={token.tokens} bold
            prefix={metrics.headingHash ? HASH_LABELS[level - 1] ?? "# " : undefined} />
        </View>
      );
    }

    case "paragraph": {
      const parts = splitLocalImages(token.tokens);
      if (parts.some((part) => part.kind === "image")) {
        return (
          <View key={key}>
            {parts.map((part, index) =>
              part.kind === "image" ? (
                <LocalImage key={index} path={part.path} context={context} />
              ) : (
                <MarkdownProse key={index} context={context} style={options.inQuote ? styles.quoteText : styles.paragraph}
                  tokens={part.tokens} />
              ),
            )}
          </View>
        );
      }
      return (
        <MarkdownProse key={key} context={context} style={options.inQuote ? styles.quoteText : styles.paragraph}
          tokens={token.tokens} />
      );
    }

    // A bare text block: a tight list item's body, or prose marked could not
    // place anywhere else.
    case "text":
      return (
        <MarkdownProse key={key} context={context} style={options.inQuote ? styles.quoteText : styles.paragraph}
          tokens={token.tokens ?? [token]} />
      );

    case "list":
      return renderList(token, context, key, options);

    case "blockquote":
      return (
        <View key={key} style={styles.quote}>
          {renderBlocks(token.tokens, context, key, { ...options, first: false, inQuote: true })}
        </View>
      );

    case "code":
      return <CodeBlock key={key} token={token} context={context} open={options.open} />;

    case "hr":
      return <View key={key} style={styles.rule} />;

    case "table":
      return (
        <MdTable key={key} token={token} context={context} open={options.open} keyPrefix={key} />
      );

    // HTML is shown as the source the author wrote, never interpreted.
    case "html": {
      const source = token.raw.replace(/\n+$/, "");
      if (source.trim() === "") return null;
      return (
        <MarkdownProse key={key} context={context} {...(codeSurface as object)} style={styles.plain} text={source} />
      );
    }

    default:
      return token.raw.trim() === "" ? null : (
        <MarkdownProse key={key} context={context} {...(codeSurface as object)} style={styles.plain} text={token.raw} />
      );
  }
}

interface ListRow {
  item: Tokens.ListItem;
  depth: number;
  ordered: boolean;
  number: number;
  /** The widest marker of the list this row belongs to. */
  numberWidth: number;
}

/**
 * A list, flattened to one row per item with nested lists as deeper rows. A
 * row is a marker column and a body column, so a wrapped second line starts
 * under the item's first character instead of under its marker, and every
 * depth keeps the indent step the variant defines.
 */
function renderList(
  token: Tokens.List,
  context: RenderContext,
  key: string,
  options: BlockOptions,
): React.ReactNode {
  const rows: React.ReactNode[] = [];
  collectRows(token, 0, context, key, options, rows);
  if (rows.length === 0) return null;
  return (
    <View key={key} style={context.styles.listBlock}>
      {rows}
    </View>
  );
}

function collectRows(
  list: Tokens.List,
  depth: number,
  context: RenderContext,
  key: string,
  options: BlockOptions,
  out: React.ReactNode[],
): void {
  const start = typeof list.start === "number" ? list.start : 1;
  const numberWidth = orderedColumnWidth(start + list.items.length - 1, context.metrics);
  list.items.forEach((item, index) => {
    const itemKey = `${key}l${depth}.${index}`;
    const body: Token[] = [];
    const nested: Tokens.List[] = [];
    for (const child of item.tokens) {
      if (child.type === "list") nested.push(child as Tokens.List);
      else if (child.type !== "checkbox" && child.type !== "space") body.push(child);
    }
    // A marker with no body is not a row: drawing a bullet beside nothing
    // reads as a rendering fault.
    if (body.length > 0) {
      const row = { item, depth, ordered: list.ordered, number: start + index, numberWidth };
      out.push(
        reuseNode(
          options.reuse,
          itemKey,
          `${optionSource(options)}${depth}:${list.ordered ? 1 : 0}:${row.number}:${numberWidth}:${item.raw}`,
          () => body,
          () => renderRow(row, body, context, itemKey, options),
        ),
      );
    }
    for (const child of nested) collectRows(child, depth + 1, context, itemKey, options, out);
  });
}

function renderRow(
  row: ListRow,
  body: Token[],
  context: RenderContext,
  key: string,
  options: BlockOptions,
): React.ReactNode {
  const { styles, tokens, metrics } = context;
  const depth = row.depth > 3 ? 3 : row.depth;
  const indentStyle = styles[INDENT_KEYS[depth] ?? "indent0"];
  const done = row.item.task && row.item.checked === true;
  const textStyle = done ? styles.itemTextDone : styles.itemText;

  // One inline run is the common case and stays a single Text, exactly like
  // a paragraph; an item holding code or several paragraphs gets a column.
  const only = body.length === 1 ? body[0] : undefined;
  const bodyNode =
    only !== undefined && (only.type === "text" || only.type === "paragraph") ? (
      <MarkdownProse context={context} style={textStyle} tokens={(only as Tokens.Text).tokens ?? [only]} />
    ) : (
      <View style={[styles.listItemBody, { gap: metrics.itemGap }]}>
        {body.map((child, index) =>
          child.type === "text" || child.type === "paragraph" ? (
            <MarkdownProse key={`${key}b${index}`} context={context} style={[textStyle, styles.listItemText]}
              tokens={(child as Tokens.Text).tokens ?? [child]} />
          ) : (
            renderBlocks([child], context, `${key}b${index}`, { ...options, first: false })
          ),
        )}
      </View>
    );

  let marker: React.ReactNode;
  if (row.item.task) {
    marker = (
      <View style={styles.checkboxCell}>
        <Icon
          name={row.item.checked ? "Check" : "Circle"}
          size={metrics.glyphSize}
          color={row.item.checked ? tokens.success : tokens.foregroundSubtle}
        />
      </View>
    );
  } else if (row.ordered) {
    marker = (
      <Text
        numberOfLines={1}
        {...contentTextProps()}
        style={[styles.markerOrdered, { width: row.numberWidth }, contentTextStyle()]}
      >
        {`${row.number}.`}
      </Text>
    );
  } else {
    marker = (
      <Text numberOfLines={1} {...contentTextProps()} style={[styles.markerBullet, contentTextStyle()]}>
        {BULLETS[depth % BULLETS.length] ?? BULLETS[0]}
      </Text>
    );
  }

  return (
    <View key={key} style={[styles.listRow, indentStyle]}>
      {marker}
      {bodyNode}
    </View>
  );
}

/**
 * Numbers share one right edge, so `9.` and `10.` line up. The column holds the
 * whole marker — digits, dot and gutter — because a column sized to the digits
 * alone wraps the dot under the number and splits the item across two rows.
 */
function orderedColumnWidth(largest: number, metrics: VariantMetrics): number {
  const longest = Math.max(2, `${largest}.`.length);
  const ratio = metrics.mono ? CHAR_RATIO_MONO : CHAR_RATIO_UI;
  // The ratio is an average advance, so a marker of wide digits needs the spare
  // point on top of it.
  const marker = Math.ceil(longest * metrics.bodySize * ratio) + 2;
  return Math.max(metrics.markerWidth, marker + MARKER_GAP);
}
