import React, { Fragment, useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { space, type ExtendedThemeTokens } from "../components/theme-tokens";
import { diffLineNumbers } from "../components/diff-lines";
import { lineNumberWidth } from "../components/syntax-highlight";
import { selectionCodeText } from "../components/selection-actions";
import { unselectable } from "../components/selection";
import { useEnhancerPreferences } from "../preferences";
import { usePreviewWraps } from "./hover-preview";
import { SelectableText } from "./prose-text";

/**
 * A file, a diff or a command's output in a preview panel, numbered and
 * shaded every other line as the reader set them (Preview panel settings).
 * Either one draws a row per line. With both off the content is one text, as
 * it always was, so a selection on a phone can still run across lines.
 */
export function PreviewLines({ text, lines, style, tokens, renderLine, diff = false, firstLine = 1 }: {
  /** The content as one text, drawn as is when there are no rows. */
  text: string;
  lines: readonly string[];
  /** The text's own style (font, size, colour). */
  style: TextStyle;
  tokens: ExtendedThemeTokens;
  /** One line's runs, when the content is coloured; plain text otherwise. */
  renderLine?(line: string, index: number): ReactNode;
  /** A diff is numbered with the file's own lines, its chrome left blank. */
  diff?: boolean;
  /** The number of the first line, for a read of part of a file. */
  firstLine?: number;
}) {
  const { previewLineNumbers, previewStripes } = useEnhancerPreferences();
  const wraps = usePreviewWraps();
  const numbers = useMemo(
    () => (!previewLineNumbers ? null : diff ? diffLineNumbers(lines) : lines.map((_, index) => firstLine + index)),
    [previewLineNumbers, diff, lines, firstLine],
  );
  const mono = tokens.typography.mono;
  const gutter = useMemo(() => {
    if (!numbers) return null;
    const largest = numbers.reduce<number>((max, number) => Math.max(max, number ?? 0), 0);
    return {
      width: lineNumberWidth(largest, mono.size),
      fontSize: mono.size,
      lineHeight: mono.lineHeight,
      fontFamily: tokens.fontMono,
      color: tokens.syntax.comment,
    };
  }, [numbers, mono, tokens]);

  if (!numbers && !previewStripes) {
    return (
      <SelectableText {...selectionCodeText} style={style}>
        {renderLine
          ? lines.map((line, index) => (
            <Fragment key={index}>{renderLine(line, index)}{index < lines.length - 1 ? "\n" : ""}</Fragment>
          ))
          : text}
      </SelectableText>
    );
  }
  const stripe = previewStripes ? { backgroundColor: tokens.v2.surface1 } : null;
  return (
    <View testID="preview-lines">
      {lines.map((line, index) => (
        <View key={index} style={[styles.row, { minHeight: mono.lineHeight }, index % 2 === 1 && stripe]}>
          {gutter ? <Text selectable={false} style={[styles.number, gutter]}>{numbers![index] ?? ""}</Text> : null}
          <SelectableText {...selectionCodeText} style={[style, wraps ? styles.wrapped : styles.unwrapped]}>
            {renderLine ? renderLine(line, index) : line}
          </SelectableText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  number: { flexShrink: 0, textAlign: "right", paddingRight: space.sm, fontVariant: ["tabular-nums"], ...unselectable },
  wrapped: { flex: 1, minWidth: 0 },
  // A line in the sideways scroller sizes to its own text: `flex: 1` would map
  // to a zero basis on web and wrap every word.
  unwrapped: { flexShrink: 0, flexGrow: 1 },
});
