import React, { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type TextLayoutEventData,
  type NativeSyntheticEvent,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { space, type ExtendedThemeTokens } from "../components/theme-tokens";
import { diffLineNumbers } from "../components/diff-lines";
import { lineNumberWidth } from "../components/syntax-highlight";
import { selectionCodeText } from "../components/selection-actions";
import { unselectable } from "../components/selection";
import { useEnhancerPreferences } from "../preferences";
import { usePreviewWraps } from "./hover-preview";
import { SelectableText } from "./prose-text";

/** A line as laid out: its text, ending in `\n` where a source line ends, and its top where the platform says. */
export interface VisualLine {
  text: string;
  y?: number;
}

/**
 * The top of each source line, from the lines the text was laid out in. A
 * source line starts the text and follows every laid-out line that ends in
 * `\n`; a wrapped line's continuations add none. iOS reports only each line's
 * text, so a line without `y` sits at its index times the line height, which
 * holds for code at one size. Null when the count does not match, so a stale
 * layout is ignored.
 */
export function sourceLineTops(visual: readonly VisualLine[], lineHeight: number, count: number): number[] | null {
  const tops: number[] = [];
  let starts = true;
  visual.forEach((line, index) => {
    if (starts) tops.push(line.y ?? index * lineHeight);
    starts = line.text.endsWith("\n");
  });
  return tops.length === count ? tops : null;
}

/**
 * The same tops on web, where text reports no layout: the first character of
 * each source line, measured with a range. An empty line is its own `\n`,
 * which may have no box; it then sits one line below the line before.
 */
function measureWebTops(root: HTMLElement, lineHeight: number, count: number): number[] | null {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  const tops: number[] = [];
  let starts = true;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    for (let index = 0; index < text.length; index++) {
      if (starts) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const box = range.getClientRects()[0];
        tops.push(box ? box.top : Number.NaN);
      }
      starts = text[index] === "\n";
    }
  }
  if (tops.length !== count || !Number.isFinite(tops[0])) return null;
  // A glyph box sits inside its line by half the leading; the first line is at 0.
  const first = tops[0]!;
  for (let index = 0; index < tops.length; index++) {
    tops[index] = Number.isFinite(tops[index]) ? tops[index]! - first : tops[index - 1]! + lineHeight;
  }
  return tops;
}

/**
 * A file, a diff or a command's output in a preview panel, numbered and
 * shaded every other line as the reader set them (Preview panel settings).
 * The content stays one text, so a selection runs across lines on a phone
 * too. The shading is drawn behind it and the numbers in a column of their
 * own beside it, both placed from where the text laid each line out.
 */
export function PreviewLines({ text, lines, style, tokens, renderLine, diff = false, firstLine = 1 }: {
  /** The content as one text, drawn as is when there is nothing to place. */
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
  const lineHeight = tokens.typography.mono.lineHeight;
  const placed = previewLineNumbers || previewStripes;
  const numbers = useMemo(
    () => (!previewLineNumbers ? null : diff ? diffLineNumbers(lines) : lines.map((_, index) => firstLine + index)),
    [previewLineNumbers, diff, lines, firstLine],
  );
  const content = useMemo(
    () => renderLine
      ? lines.map((line, index) => (
        <Fragment key={index}>{renderLine(line, index)}{index < lines.length - 1 ? "\n" : ""}</Fragment>
      ))
      : placed ? lines.join("\n") : text,
    [renderLine, lines, placed, text],
  );

  // Until the text reports its layout, every line is taken to fit on one.
  const [measured, setMeasured] = useState<number[] | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const tops = measured ?? lines.map((_, index) => index * lineHeight);
  const bottom = height ?? lines.length * lineHeight;
  const contentRef = useRef<View>(null);
  const onTextLayout = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const visual = (event.nativeEvent.lines as ReadonlyArray<VisualLine | string>)
      .map((line) => (typeof line === "string" ? { text: line } : line));
    setMeasured(sourceLineTops(visual, lineHeight, lines.length));
  }, [lineHeight, lines.length]);
  const onLayout = useCallback((event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height), []);
  useLayoutEffect(() => {
    if (!placed || Platform.OS !== "web") return;
    const root = contentRef.current as unknown as HTMLElement | null;
    if (!root?.ownerDocument?.defaultView) return;
    const measure = () => setMeasured(measureWebTops(root, lineHeight, lines.length));
    measure();
    // A new width rewraps the lines; fonts settling move them too.
    const observer = new root.ownerDocument.defaultView.ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [placed, lineHeight, lines.length, content]);

  if (!placed) {
    return <SelectableText {...selectionCodeText} style={style}>{content}</SelectableText>;
  }
  const gutter = numbers ? lineNumberWidth(numbers.reduce<number>((max, n) => Math.max(max, n ?? 0), 0), tokens.typography.mono.size) : 0;
  return (
    <View testID="preview-lines" style={styles.row}>
      {numbers ? (
        // Beside the text, not in it: never selected, and it stays put while
        // unwrapped lines scroll sideways (web).
        <View testID="preview-line-numbers" style={[styles.gutter, { width: gutter }, !wraps && stickyGutter(tokens)]}>
          {numbers.map((number, index) => (
            <Text key={index} selectable={false}
              style={[styles.number, {
                top: tops[index],
                fontSize: tokens.typography.mono.size,
                lineHeight,
                color: tokens.syntax.comment,
                fontFamily: tokens.fontMono,
              }]}>
              {number ?? ""}
            </Text>
          ))}
        </View>
      ) : null}
      <View ref={contentRef} onLayout={onLayout} style={wraps ? styles.wrapped : styles.unwrapped}>
        {previewStripes ? (
          <View testID="preview-line-stripes" pointerEvents="none" style={StyleSheet.absoluteFill}>
            {tops.map((top, index) => index % 2 === 1 ? (
              <View key={index} style={[styles.stripe, {
                top,
                height: (tops[index + 1] ?? bottom) - top,
                backgroundColor: tokens.v2.surface1,
              }]} />
            ) : null)}
          </View>
        ) : null}
        <SelectableText {...selectionCodeText} style={[style, styles.clear]} onTextLayout={onTextLayout}>{content}</SelectableText>
      </View>
    </View>
  );
}

/** Pinned to the scroller's left edge on web, over a fill so lines pass under it. */
function stickyGutter(tokens: ExtendedThemeTokens): ViewStyle | null {
  if (Platform.OS !== "web") return null;
  return { position: "sticky", left: 0, zIndex: 1, backgroundColor: tokens.surface0 } as unknown as ViewStyle;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  gutter: { flexShrink: 0 },
  number: { position: "absolute", left: 0, right: 0, textAlign: "right", paddingRight: space.sm, fontVariant: ["tabular-nums"], ...unselectable },
  wrapped: { flex: 1, minWidth: 0 },
  // In the sideways scroller the text sizes to its longest line: `flex: 1`
  // would map to a zero basis on web and wrap every word.
  unwrapped: { flexGrow: 1, flexShrink: 0 },
  stripe: { position: "absolute", left: 0, right: 0 },
  // iOS draws the text in a UITextView, which keeps UIKit's own fill unless
  // told otherwise and would hide the shading behind it.
  clear: { backgroundColor: "transparent" },
});
