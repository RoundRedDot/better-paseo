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
import { SelectableSpan, SelectableText } from "./prose-text";
import { LineSelectionMenu, useLineSelection } from "./line-selection";

/** A line as laid out: its text, ending in `\n` where a source line ends, and its box where the platform says. */
export interface VisualLine {
  text: string;
  y?: number;
  height?: number;
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

/** The bottom of the last laid-out line: where the platform puts it, or a line height below its top. */
export function layoutBottom(visual: readonly VisualLine[], lineHeight: number): number {
  const last = visual[visual.length - 1];
  if (!last) return 0;
  return (last.y ?? (visual.length - 1) * lineHeight) + (last.height ?? lineHeight);
}

/**
 * The top of each of `count` lines: where the last layout put them, then a
 * line height apart below the last one it saw. Output grows at its end, so a
 * line that just arrived has its place before the text reports its layout,
 * and a report that says the same can be dropped.
 */
export function placeLineTops(measured: readonly number[] | null, count: number, lineHeight: number): number[] {
  const known = measured ? Math.min(measured.length, count) : 0;
  const tops = measured ? measured.slice(0, known) : [];
  const from = known > 0 ? tops[known - 1]! : -lineHeight;
  for (let index = known; index < count; index++) tops.push(from + (index - known + 1) * lineHeight);
  return tops;
}

/** Whether two placements put every line within half a pixel of each other. */
export function sameLineTops(a: readonly number[], b: readonly number[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (!(Math.abs(a[index]! - b[index]!) < 0.5)) return false;
  return true;
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

interface PreviewLinesProps {
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
  /** Semantic row fills take precedence over alternating preview stripes. */
  lineBackgrounds?: readonly (string | undefined)[];
  /** The number of the first line, for a read of part of a file. */
  firstLine?: number;
  /** False for lines that are no file's lines, which get no number column. */
  numbered?: boolean;
}

/**
 * A file, a diff or a command's output in a preview panel, numbered and
 * shaded every other line as the reader set them (Preview panel settings).
 * The content stays one text, so a selection runs across lines on a phone
 * too. The shading is drawn behind it and the numbers in a column of their
 * own beside it, both placed from where the text laid each line out.
 */
export function PreviewLines({ text, lines, style, tokens, renderLine, diff = false, lineBackgrounds, firstLine = 1, numbered = true }: PreviewLinesProps) {
  const { previewLineNumbers, previewStripes } = useEnhancerPreferences();
  const wraps = usePreviewWraps();
  const lineHeight = tokens.typography.mono.lineHeight;
  const placed = previewLineNumbers || previewStripes || Boolean(lineBackgrounds);
  const numbers = useMemo(
    () => (!previewLineNumbers || !numbered ? null : diff ? diffLineNumbers(lines) : lines.map((_, index) => firstLine + index)),
    [previewLineNumbers, numbered, diff, lines, firstLine],
  );
  // Streamed output grows at its end: a line drawn before is drawn again only
  // when it changed, so a chunk costs its own lines, not the whole output's.
  const drawn = useRef<{ renderLine: PreviewLinesProps["renderLine"]; lines: readonly string[]; nodes: ReactNode[] } | null>(null);
  const content = useMemo(
    () => {
      if (!renderLine) return placed ? lines.join("\n") : text;
      const before = drawn.current?.renderLine === renderLine ? drawn.current : null;
      const nodes = lines.map((line, index) => {
        const last = index === lines.length - 1;
        if (before && before.lines[index] === line && (index === before.lines.length - 1) === last) return before.nodes[index];
        // The newline is a run of its own: on iOS the text view takes its
        // text from runs, and a bare string beside them never reaches it.
        return <Fragment key={index}>{renderLine(line, index)}{last ? null : <SelectableSpan>{"\n"}</SelectableSpan>}</Fragment>;
      });
      drawn.current = { renderLine, lines, nodes };
      return nodes;
    },
    [renderLine, lines, placed, text],
  );

  // Lines the text has not laid out yet each take one line below the last it
  // did, so a streamed line is placed in the commit that brings it. A layout
  // that agrees with that costs no second commit. On a phone the text's own
  // layout gives the bottom too, so a layout costs one commit, not two; web
  // reads it from the box.
  const [measured, setMeasured] = useState<{ tops: number[]; bottom: number | null } | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const tops = useMemo(() => placeLineTops(measured?.tops ?? null, lines.length, lineHeight), [measured, lines.length, lineHeight]);
  const bottom = Math.max(measured?.bottom ?? height ?? 0, (tops[tops.length - 1] ?? -lineHeight) + lineHeight);
  const shown = useRef({ tops, bottom });
  shown.current = { tops, bottom };
  const contentRef = useRef<View>(null);
  const selection = useLineSelection({ enabled: previewLineNumbers && numbered, lines, tops, bottom, contentRef });
  // A layout of other lines than these (`null`) is stale: the last one stands.
  const place = useCallback((next: number[] | null, nextBottom: number | null) => {
    if (!next) return;
    if (sameLineTops(shown.current.tops, next) && (nextBottom === null || Math.abs(nextBottom - shown.current.bottom) < 0.5)) return;
    setMeasured({ tops: next, bottom: nextBottom });
  }, []);
  const onTextLayout = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const visual = (event.nativeEvent.lines as ReadonlyArray<VisualLine | string>)
      .map((line) => (typeof line === "string" ? { text: line } : line));
    place(sourceLineTops(visual, lineHeight, lines.length), layoutBottom(visual, lineHeight));
  }, [place, lineHeight, lines.length]);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    const tops = shown.current.tops;
    if (Math.abs(Math.max(next, (tops[tops.length - 1] ?? -lineHeight) + lineHeight) - shown.current.bottom) < 0.5) return;
    setHeight(next);
  }, [lineHeight]);
  useLayoutEffect(() => {
    if (!placed || Platform.OS !== "web") return;
    const root = contentRef.current as unknown as HTMLElement | null;
    if (!root?.ownerDocument?.defaultView) return;
    const measure = () => place(measureWebTops(root, lineHeight, lines.length), null);
    measure();
    // A new width rewraps the lines; fonts settling move them too.
    const observer = new root.ownerDocument.defaultView.ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [placed, place, lineHeight, lines.length, content]);
  // A commit that only moves the numbers or the shading keeps this element,
  // so the text, hundreds of lines in one view, is not laid out again.
  const textStyle = useMemo(() => [style, styles.clear], [style]);
  const body = useMemo(
    () => <SelectableText {...selectionCodeText} style={textStyle} onTextLayout={onTextLayout}>{content}</SelectableText>,
    [textStyle, onTextLayout, content],
  );

  if (!placed) {
    return <SelectableText {...selectionCodeText} style={style}>{content}</SelectableText>;
  }
  const gutter = numbers ? lineNumberWidth(numbers.reduce<number>((max, n) => Math.max(max, n ?? 0), 0), tokens.typography.mono.size) : 0;
  return (
    <View testID="preview-lines" style={styles.row}>
      {numbers ? (
        // The gutter owns hit testing so native locationY is relative to the
        // whole column, never an individual number. Numbers stay out of copies.
        <View ref={selection.gutterRef} {...selection.gutterProps} pointerEvents="box-only"
          testID="preview-line-numbers" style={[styles.gutter, { width: gutter }, !wraps && stickyGutter(tokens)]}>
          {numbers.map((number, index) => (
            <Text key={index} selectable={false}
              style={[styles.number, {
                top: tops[index],
                fontSize: tokens.typography.mono.size - 2,
                lineHeight,
                // A selected line's number stands out, as in an editor.
                color: selection.range && index >= selection.range.from && index <= selection.range.to
                  ? tokens.foreground : tokens.syntax.comment,
                fontFamily: tokens.fontMono,
              }]}>
              {number ?? ""}
            </Text>
          ))}
        </View>
      ) : null}
      <View ref={contentRef} onLayout={Platform.OS === "web" ? onLayout : undefined}
        onTouchStart={Platform.OS !== "web" ? selection.dismiss : undefined}
        style={wraps ? styles.wrapped : styles.unwrapped}>
        {previewStripes || lineBackgrounds ? (
          <View testID="preview-line-stripes" pointerEvents="none" style={StyleSheet.absoluteFill}>
            {tops.map((top, index) => {
              const backgroundColor = lineBackgrounds?.[index] ?? (previewStripes && index % 2 === 1 ? tokens.v2.surface1 : undefined);
              return backgroundColor ? <View key={index} style={[styles.stripe, {
                top,
                height: (tops[index + 1] ?? bottom) - top,
                backgroundColor,
              }]} /> : null;
            })}
          </View>
        ) : null}
        {selection.selectionStyle ? (
          <View testID="preview-line-selection" pointerEvents="none" style={[
            styles.stripe, selection.selectionStyle, { backgroundColor: tokens.accentBg },
          ]} />
        ) : null}
        {body}
      </View>
      {selection.menuTop !== null ? (
        <LineSelectionMenu top={selection.menuTop} text={selection.selectedText} tokens={tokens} dismiss={selection.dismiss} />
      ) : null}
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
  // would map to a zero basis on web and wrap every word. A phone caps the
  // scroller's width (`MAX_UNWRAPPED_WIDTH`), and the text gives the
  // numbers their room inside it.
  unwrapped: { flexGrow: 1, flexShrink: Platform.OS === "web" ? 0 : 1, minWidth: 0 },
  stripe: { position: "absolute", left: 0, right: 0 },
  // iOS draws the text in a UITextView, which keeps UIKit's own fill unless
  // told otherwise and would hide the shading behind it.
  clear: { backgroundColor: "transparent" },
});
