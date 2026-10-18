import React, { memo, useCallback, useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { Platform, View, Text, Pressable, StyleSheet } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { StyleProp, TextProps, TextStyle } from "react-native";
import { surfaceProps } from "./view-props";
import { radiusV2, space, type ExtendedThemeTokens } from "./theme-tokens";
import { TYPE } from "../ui/tokens/typography";
import { HScroll } from "../ui/h-scroll";
import { diffHunk, diffRows, type DiffRow } from "./diff-lines";
import { selectableSurface, unselectable } from "./selection";
import { selectionCodeSurface, selectionSurface } from "./selection-actions";
import { useHighlightedLines } from "../highlight";
import { perfCount } from "../debug/perf";
import { CopyButton } from "../ui/copy-button";
import { ToolbarButton } from "../ui/toolbar-button";
import { SelectableSpan } from "../ui/prose-text";
import type { HighlightLine, HighlightToken } from "../../shared/highlight-rpc";

interface SyntaxHighlightProps {
  code: string;
  language?: "typescript" | "bash" | "diff" | "json" | "python" | string;
  tokens: ExtendedThemeTokens;
  showLineNumbers?: boolean;
  filename?: string;
  compact?: boolean;
  /** Shows the file in the machine's own file manager. Omitted: plain label. */
  onRevealFile?: () => void;
  /**
   * Drawn in the header in place of the filename label, e.g. a `PathText` that
   * owns its own press, copy and relative display. `filename` still picks the
   * grammar and the file-type logo.
   */
  filenameNode?: ReactNode;
  /**
   * False while the block is still being written (an open Markdown fence):
   * lines are coloured by the local tokeniser and the daemon is not asked,
   * so a streaming block costs one highlight call, made once it is complete.
   */
  highlight?: boolean;
  /** Lines keep their length and the block scrolls sideways instead of wrapping. */
  scrollX?: boolean;
  /**
   * Lines drawn before "Show all". Blocks longer than `LARGE_BLOCK_LINES` start
   * at that many whatever this says (plan §3.2: mounting every row of a
   * 5000-line diff froze the native UI for seconds).
   */
  initialLines?: number;
  /**
   * Inside an opened tool body, which is already the code surface: no fill,
   * radius or margin of its own, and the header and lines start at its edge.
   */
  bare?: boolean;
  /** Opens this Markdown code block in the preview window. */
  onOpenPreview?: () => void;
}

/** A block longer than this mounts its first rows only, then appends on request. */
export const LARGE_BLOCK_LINES = 400;
/**
 * Rows appended per frame once "Show all" is pressed. Every commit re-lays out
 * the whole growing block natively, so fewer, larger batches finish sooner: on
 * the iOS simulator (dev build) a 5128-row diff expanded with 17% dropped
 * frames at 400 rows per batch and 83% at 100.
 */
const APPEND_BATCH = 400;
/** Code header height (S7 design spec §3.6): 32 on touch platforms, 30 on desktop. */
const HEADER_HEIGHT = Platform.OS === "web" ? 30 : 32;

const scheduleFrame: (callback: () => void) => () => void =
  typeof requestAnimationFrame === "function"
    ? (callback) => {
        const handle = requestAnimationFrame(callback);
        return () => cancelAnimationFrame(handle);
      }
    : (callback) => {
        const handle = setTimeout(callback, 16);
        return () => clearTimeout(handle);
      };

const STATIC_KEYWORDS: Record<string, true> = {
  import: true,
  export: true,
  from: true,
  default: true,
  const: true,
  let: true,
  var: true,
  function: true,
  return: true,
  async: true,
  await: true,
  if: true,
  else: true,
  switch: true,
  case: true,
  try: true,
  catch: true,
  type: true,
  interface: true,
  class: true,
  new: true,
  extends: true,
  implements: true,
};

const PYTHON_KEYWORDS: Record<string, true> = {
  import: true,
  from: true,
  as: true,
  def: true,
  lambda: true,
  return: true,
  yield: true,
  async: true,
  await: true,
  if: true,
  elif: true,
  else: true,
  for: true,
  while: true,
  in: true,
  is: true,
  not: true,
  and: true,
  or: true,
  try: true,
  except: true,
  finally: true,
  raise: true,
  with: true,
  class: true,
  pass: true,
  global: true,
  None: true,
  True: true,
  False: true,
  self: true,
};

/** Eval runs both kernels, so the callout must colour either dialect. */
function keywordsFor(language: string): Record<string, true> {
  return language === "python" ? PYTHON_KEYWORDS : STATIC_KEYWORDS;
}

/**
 * Strings, numbers, identifiers, and punctuation. Identifiers cover keywords
 * too, so the dialect lives in the lookup table rather than this pattern.
 */
const CODE_TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\b|[a-zA-Z_$][a-zA-Z0-9_$]*|[^\s\w]+)/g;

/**
 * The dialect used to colour code tokens. A diff carries no dialect of its own,
 * so it borrows the one belonging to the file being patched.
 */
function dialectFor(isDiff: boolean, language: string, filename?: string): string {
  if (!isDiff) return language;
  const ext = fileExtension(filename);
  if (ext === "py") return "python";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css" || ext === "scss" || ext === "sass") return "css";
  return "typescript";
}

/** The lower-case extension of a path's last segment, or "" when it has none. */
function fileExtension(filename?: string): string {
  const base = (filename || "").toLowerCase().split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

/**
 * Extensions the daemon has a grammar for, minus the diff grammars themselves.
 *
 * The daemon resolves the grammar; this set only decides whether asking it is
 * worth a round trip. So an extension missing here costs one uncoloured diff,
 * never a wrong one.
 */
const CODE_FILE_EXTENSIONS: Record<string, true> = {
  ts: true,
  mts: true,
  cts: true,
  tsx: true,
  js: true,
  mjs: true,
  cjs: true,
  jsx: true,
  json: true,
  jsonc: true,
  sh: true,
  bash: true,
  zsh: true,
  py: true,
  pyi: true,
  yaml: true,
  yml: true,
  md: true,
  markdown: true,
  rs: true,
  go: true,
  html: true,
  htm: true,
  css: true,
  sql: true,
  toml: true,
  dockerfile: true,
  ps1: true,
  psm1: true,
};

/** Whether the patched file names a language the daemon can tokenise. */
function patchedFileIsCode(filename?: string): boolean {
  const base = (filename || "").toLowerCase().split(/[/\\]/).pop() || "";
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return true;
  const ext = fileExtension(filename);
  return ext !== "" && CODE_FILE_EXTENSIONS[ext] === true;
}

/** How far into a block a diff must announce itself before it reads as code. */
const DIFF_SCAN_LINES = 8;

/**
 * Whether a block is a unified diff whatever its label says. A tool labels a
 * patch with the file it patches often enough that the label cannot be trusted,
 * and the markers only make sense once the block is read as a diff.
 */
function looksLikeUnifiedDiff(lines: string[]): boolean {
  const limit = Math.min(lines.length, DIFF_SCAN_LINES);
  for (let idx = 0; idx < limit; idx += 1) {
    const line = lines[idx] ?? "";
    if (diffHunk(line)) return true;
    if (/^diff --(?:git|cc|combined) /.test(line)) return true;
    if (line.startsWith("--- ") && (lines[idx + 1] ?? "").startsWith("+++ ")) return true;
  }
  return false;
}

/**
 * The diff's content with the markers taken off, for the file's own grammar.
 *
 * One line out per line in, so a token row still belongs to the row it is drawn
 * on: a chrome line contributes an empty line instead of disappearing, which
 * keeps every later line on its own number.
 */
export function strippedDiffCode(lines: readonly string[]): string {
  return diffRows(lines).map((row, index) => row.markers ? lines[index]!.slice(row.markers.length) : "").join("\n");
}

/** A tag opening or closing marks the text as markup. */
const HTML_LIKE = /<\/?[a-zA-Z][\w-]*(?:\s|\/?>)/;
/** A declaration inside a block marks the text as style rules. */
const CSS_LIKE = /[a-zA-Z-]+\s*:\s*[^;{}]+;/;

export function detectEmbedded(text: string): "html" | "css" | null {
  if (HTML_LIKE.test(text)) return "html";
  if (text.includes("{") && CSS_LIKE.test(text)) return "css";
  return null;
}

/**
 * JavaScript carries markup and style rules inside template literals, and a
 * literal routinely spans many lines. Highlighting runs per line, so the dialect
 * of each line is resolved up front: a template's whole body is read once,
 * classified once, and that verdict is applied to every line it covers.
 */
export function classifyLines(lines: string[], base: string): string[] {
  // A block that already declares itself markup or styles needs no detection.
  if (base === "html" || base === "css" || base === "bash") {
    return lines.map(() => base);
  }

  const dialects: string[] = new Array(lines.length).fill(base);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const open = line.indexOf("`");
    if (open === -1) continue;

    // Find the line that closes this template literal.
    let end = i;
    if (line.indexOf("`", open + 1) === -1) {
      while (end + 1 < lines.length && !lines[end + 1]?.includes("`")) end++;
      end = Math.min(end + 1, lines.length - 1);
    }

    const body = lines.slice(i, end + 1).join("\n");
    const embedded = detectEmbedded(body);
    if (embedded) {
      for (let j = i; j <= end; j++) dialects[j] = embedded;
    }
    i = end;
  }

  return dialects;
}

/** `${...}` stays JavaScript wherever it is spliced in. */
const INTERPOLATION_RE = /\$\{[^}]*\}/g;

/**
 * Splits a line on its interpolations, tokenising the literal parts with
 * `renderPart` and the spliced expressions as accented code.
 */
function renderWithInterpolation(
  line: string,
  tokens: ExtendedThemeTokens,
  renderPart: (text: string) => React.ReactNode,
  Span: React.ElementType<TextProps> = Text,
): React.ReactNode {
  INTERPOLATION_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Each literal run is wrapped so its own token array keeps a stable key.
  const pushLiteral = (text: string, index: number) => {
    parts.push(
      <Span key={`l${index}`} selectable>
        {renderPart(text)}
      </Span>,
    );
  };

  while ((match = INTERPOLATION_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      pushLiteral(line.slice(lastIndex, match.index), lastIndex);
    }
    parts.push(
      <Span key={`i${match.index}`} selectable style={{ color: tokens.accent }}>
        {match[0]}
      </Span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) pushLiteral(line.slice(lastIndex), lastIndex);
  return parts;
}

const HTML_TOKEN_RE =
  /(<!--[\s\S]*?-->|<\/?[a-zA-Z][\w-]*|\/?>|[a-zA-Z-]+(?=\s*=)|"[^"]*"|'[^']*'|=)/g;

function renderHtmlTokens(
  text: string,
  tokens: ExtendedThemeTokens,
  keyPrefix: string,
  Span: React.ElementType<TextProps> = Text,
): React.ReactNode {
  HTML_TOKEN_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = HTML_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}h${match.index}`;

    if (token.startsWith("<!--")) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.comment }}>
          {token}
        </Span>,
      );
    } else if (token.startsWith("<") || token === ">" || token === "/>") {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.keyword, fontWeight: "600" }}>
          {token}
        </Span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.string }}>
          {token}
        </Span>,
      );
    } else if (token === "=") {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.foregroundMuted }}>
          {token}
        </Span>,
      );
    } else {
      // An attribute name, matched by its lookahead to `=`.
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.property }}>
          {token}
        </Span>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const CSS_TOKEN_RE =
  /(\/\*[\s\S]*?\*\/|[{}:;]|"[^"]*"|'[^']*'|#[0-9a-fA-F]{3,8}\b|-?\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|fr|deg)?|[@.#]?[a-zA-Z][\w-]*)/g;

function renderCssTokens(
  text: string,
  tokens: ExtendedThemeTokens,
  keyPrefix: string,
  Span: React.ElementType<TextProps> = Text,
): React.ReactNode {
  CSS_TOKEN_RE.lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // A name before the first colon is a property; after it, a value.
  let inValue = false;

  while ((match = CSS_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}c${match.index}`;

    if (token.startsWith("/*")) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.comment }}>
          {token}
        </Span>,
      );
    } else if (token === ":") {
      inValue = true;
      parts.push(
        <Span key={key} selectable style={{ color: tokens.foregroundMuted }}>
          {token}
        </Span>,
      );
    } else if (token === ";" || token === "{" || token === "}") {
      inValue = false;
      parts.push(
        <Span key={key} selectable style={{ color: tokens.foregroundMuted }}>
          {token}
        </Span>,
      );
    } else if (token.startsWith("#") && /^#[0-9a-fA-F]{3,8}$/.test(token)) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.number }}>
          {token}
        </Span>,
      );
    } else if (/^-?\d/.test(token)) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.number }}>
          {token}
        </Span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.string }}>
          {token}
        </Span>,
      );
    } else if (inValue) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.string }}>
          {token}
        </Span>,
      );
    } else if (token.startsWith("@") || token.startsWith(".") || token.startsWith("#")) {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.keyword, fontWeight: "600" }}>
          {token}
        </Span>,
      );
    } else {
      parts.push(
        <Span key={key} selectable style={{ color: tokens.syntax.property }}>
          {token}
        </Span>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function SyntaxHighlightBlock({
  code,
  language = "typescript",
  tokens,
  showLineNumbers = false,
  filename,
  compact = false,
  onRevealFile,
  filenameNode,
  highlight = true,
  scrollX = false,
  initialLines,
  bare = false,
  onOpenPreview,
}: SyntaxHighlightProps) {
  const lines = useMemo(() => code.trimEnd().split("\n"), [code]);
  const total = lines.length;
  const { shown, expanding, expanded, showAll, showLess } = useBatchedRows(total, initialLines);
  const [wrapped, setWrapped] = useState(false);
  // A diff is a diff whatever the label says, and everything below reads this
  // flag rather than the label.
  const isDiff = useMemo(
    () => language === "diff" || looksLikeUnifiedDiff(lines),
    [language, lines],
  );
  const parsedDiff = useMemo(() => isDiff ? diffRows(lines) : null, [isDiff, lines]);
  const codeLanguage = useMemo(
    () => dialectFor(isDiff, language, filename),
    [isDiff, language, filename],
  );
  const lineDialects = useMemo(() => classifyLines(lines, codeLanguage), [lines, codeLanguage]);
  const diffBodyCode = useMemo(
    () => (isDiff && patchedFileIsCode(filename) ? strippedDiffCode(lines) : undefined),
    [isDiff, filename, lines],
  );
  // A diff row carries the file's own line number, not its position.
  const numbers = useMemo(
    () => (showLineNumbers && parsedDiff ? parsedDiff.map((row) => row.number) : null),
    [showLineNumbers, parsedDiff],
  );
  // Grammar-accurate colours arrive from the daemon one round trip late, and
  // never for a language it has no grammar for. Until then, and after a failed
  // call, the rows below fall back to the tokeniser in this file.
  const highlightResult = useHighlightedLines({
    code,
    language,
    filename,
    dark: tokens.isDark,
    diffBodyCode,
    enabled: highlight,
  });
  const shikiLines = highlightResult?.lines;
  const diffBodyLines = highlightResult?.diffLines;

  const mono = tokens.typography.mono;
  const languageLabel = codeLanguageLabel(isDiff ? "diff" : language, filename);
  const hasHeader = Boolean(filename || filenameNode !== undefined || languageLabel);
  // Sideways scrolling is the default for a block that asked for it; Wrap
  // turns it off for this block only (S7 design spec §3.6). Plain text has
  // no header to hold Wrap and is usually a sentence, not code, so it wraps.
  const scroll = scrollX && !wrapped && hasHeader;
  // Plain text names nothing, so it has no header to carry Copy. A framed
  // block still offers it, pinned to the first line's end; a bare one sits in
  // a tool body whose row already copies.
  const floatingCopy = !hasHeader && !bare && highlight;
  const styles = useMemo(
    () =>
      StyleSheet.create({
        // One means per block (S7 design spec 3.6): the host's raised surface
        // and a 6px radius say "code", with no border, shadow or blur. `bare`
        // drops even that, inside an opened tool body that is already the
        // code surface.
        container: bare
          ? { ...selectableSurface }
          : {
              ...selectableSurface,
              backgroundColor: tokens.v2.surfaceCode,
              borderRadius: radiusV2.block,
              overflow: "hidden",
              marginVertical: compact ? space.xs : space.sm,
            },
        header: {
          height: HEADER_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingLeft: bare ? 0 : space.md,
          paddingRight: bare ? 0 : space.xs,
        },
        language: {
          flexShrink: 0,
          fontSize: TYPE.caption.size,
          lineHeight: TYPE.caption.lineHeight,
          fontFamily: tokens.fontUi,
          color: tokens.foregroundMuted,
          ...unselectable,
        },
        filenameSlot: {
          flex: 1,
          minWidth: 0,
        },
        filename: {
          flex: 1,
          minWidth: 0,
          fontSize: TYPE.meta.size,
          lineHeight: TYPE.meta.lineHeight,
          fontFamily: tokens.fontMono,
          color: tokens.foreground,
        },
        filenameLink: {
          textDecorationLine: "underline",
          ...unselectable,
        },
        // A fixed slot: Wrap and Copy fill it once the fence closes, and the
        // filename never re-truncates when they appear.
        actions: {
          width: ACTION_SLOT + (onOpenPreview ? COPY_BOX + space.xs : 0),
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: space.xs,
        },
        // A line in the sideways scroller sizes to its own text: `flex: 0`
        // would map to a zero basis on web and wrap every word.
        lineNoWrap: {
          flexShrink: 0,
          fontSize: mono.size,
          lineHeight: mono.lineHeight,
          fontFamily: tokens.fontMono,
          color: tokens.foreground,
        },
        codeArea: {
          paddingHorizontal: bare ? 0 : space.md,
          // Reserved whether or not Copy is drawn yet, so the lines do not
          // reflow when the fence closes.
          paddingRight: !hasHeader && !bare ? FLOATING_COPY_SLOT + (onOpenPreview ? COPY_BOX + space.xs : 0) : bare ? 0 : space.md,
          paddingTop: hasHeader ? 2 : bare ? 0 : space.sm,
          paddingBottom: bare ? 0 : space.sm,
        },
        // Centred on the first line, so a one-line block holds it in its middle.
        floatingCopy: {
          flexDirection: "row",
          gap: space.xs,
          position: "absolute",
          top: Math.max(space.xs, space.sm + mono.lineHeight / 2 - COPY_BOX / 2),
          right: space.xs,
        },
        lineRow: {
          flexDirection: "row",
          alignItems: "flex-start",
        },
        lineNumber: {
          fontSize: mono.size,
          lineHeight: mono.lineHeight,
          fontFamily: tokens.fontMono,
          color: tokens.syntax.comment,
          textAlign: "right",
          paddingRight: space.sm,
          fontVariant: ["tabular-nums"],
          ...unselectable,
        },
        lineContent: {
          flex: 1,
          fontSize: mono.size,
          lineHeight: mono.lineHeight,
          fontFamily: tokens.fontMono,
          color: tokens.foreground,
        },
      }),
    [tokens, compact, hasHeader, bare, Boolean(onOpenPreview)],
  );

  const largestLineNumber = useMemo(() => {
    if (numbers === null) return null;
    perfCount("code.maxLineNumber");
    return maxLineNumber(numbers);
  }, [numbers]);
  const numberWidth = lineNumberWidth(
    numbers === null ? total : largestLineNumber ?? Number.NEGATIVE_INFINITY,
    mono.size,
  );
  // One row, as a stable function of the block's inputs: the chunks below are
  // memoised on it, so appending rows never re-renders the rows already shown.
  const draw = useCallback(
    (line: string, idx: number) => {
      const shikiLine = shikiLines?.[idx];
      // The patched file's tokens, and only for a line the file owns. A
      // chrome line keeps the diff rendering it has today.
      const bodyLine = parsedDiff?.[idx]?.markers ? diffBodyLines?.[idx] : undefined;
      const kind = parsedDiff?.[idx]?.kind;
      const lineBg =
        kind === "add"
          ? tokens.syntax.diffAddBg
          : kind === "remove"
            ? tokens.syntax.diffRemoveBg
            : undefined;
      const number = numbers ? numbers[idx] : idx + 1;

      return (
        <View key={idx} style={lineBg ? [styles.lineRow, { backgroundColor: lineBg }] : styles.lineRow}>
          {showLineNumbers && (
            <Text style={[styles.lineNumber, { width: numberWidth }]}>{number ?? ""}</Text>
          )}
          <Text selectable style={scroll ? styles.lineNoWrap : styles.lineContent}>
            {isDiff
              ? renderDiffLine(line, parsedDiff![idx]!, tokens, filename, bodyLine, shikiLine)
              : shikiLine
                ? renderShikiLine(shikiLine, tokens)
                : renderSyntaxLine(line, language, lineDialects[idx] ?? codeLanguage, tokens)}
          </Text>
        </View>
      );
    },
    [
      shikiLines,
      diffBodyLines,
      parsedDiff,
      filename,
      isDiff,
      lines,
      numbers,
      tokens,
      styles,
      showLineNumbers,
      numberWidth,
      scroll,
      language,
      lineDialects,
      codeLanguage,
    ],
  );
  // A streaming fence grows at its end, and every chunk brings new `lines`, so
  // `draw` changes and every chunk below draws again. A row whose own inputs
  // match the last draw, under the same block-wide inputs, keeps its element
  // instead: a chunk costs the lines it changed, not the whole block.
  const drawnRows = useRef<DrawnRows | null>(null);
  const row = useMemo(() => {
    const shared = [shikiLines, diffBodyLines, filename, isDiff, tokens, styles, showLineNumbers, numberWidth, scroll, language, codeLanguage];
    const before = drawnRows.current && sameItems(drawnRows.current.shared, shared) ? drawnRows.current : null;
    const current: DrawnRows = { shared, lines, dialects: lineDialects, diffRows: parsedDiff, numbers, nodes: [] };
    drawnRows.current = current;
    const unchanged = (drawn: DrawnRows, line: string, idx: number) =>
      drawn.lines[idx] === line
      && drawn.dialects[idx] === lineDialects[idx]
      && drawn.diffRows?.[idx]?.markers === parsedDiff?.[idx]?.markers
      && (drawn.numbers?.[idx] ?? null) === (numbers?.[idx] ?? null);
    return (line: string, idx: number) => {
      const previous = before?.nodes[idx];
      const node = before && previous !== undefined && unchanged(before, line, idx) ? previous : draw(line, idx);
      current.nodes[idx] = node;
      return node;
    };
  }, [draw, shikiLines, diffBodyLines, isDiff, tokens, styles, showLineNumbers, numberWidth, scroll, language, codeLanguage, lines, lineDialects, numbers, parsedDiff, filename]);

  const rows = chunkRows(shown, (from, to) => (
    <CodeRows key={from} from={from} to={to} lines={lines} row={row} />
  ));

  return (
    <View {...surfaceProps(selectionSurface)} style={styles.container}>
      {hasHeader && (
        <View style={styles.header}>
          {languageLabel ? <Text style={styles.language}>{languageLabel}</Text> : null}
          {filenameNode !== undefined ? (
            <View style={styles.filenameSlot}>{filenameNode}</View>
          ) : filename && onRevealFile ? (
            <Pressable
              onPress={onRevealFile}
              accessibilityRole="link"
              accessibilityLabel={`Show ${filename} in the file manager`}
              style={styles.filenameSlot}
            >
              <Text numberOfLines={1} style={[styles.filename, styles.filenameLink]}>
                {filename}
              </Text>
            </Pressable>
          ) : (
            <Text selectable numberOfLines={1} style={styles.filename}>
              {filename ?? ""}
            </Text>
          )}
          <View style={styles.actions}>
            {highlight ? (
              <>
                {scrollX ? (
                  <ToggleIconButton
                    icon="WrapText"
                    label={wrapped ? "Do not wrap lines" : "Wrap lines"}
                    active={wrapped}
                    onPress={() => setWrapped((value) => !value)}
                    tokens={tokens}
                  />
                ) : null}
                {onOpenPreview ? <ToolbarButton icon="Maximize2" label="Open Markdown in a window" onPress={onOpenPreview} tokens={tokens} /> : null}
                <CopyButton text={code} tokens={tokens} label="Copy code" />
              </>
            ) : null}
          </View>
        </View>
      )}

      <View {...selectionCodeSurface} style={styles.codeArea}>
        {scroll ? (
          <HScroll tokens={tokens} contentContainerStyle={rowStyles.scrollContent}>
            <View style={rowStyles.scrollRows}>{rows}</View>
          </HScroll>
        ) : (
          rows
        )}
      </View>
      {floatingCopy ? (
        <View style={styles.floatingCopy}>
          {onOpenPreview ? <ToolbarButton icon="Maximize2" label="Open Markdown in a window" onPress={onOpenPreview} tokens={tokens} /> : null}
          <CopyButton text={code} tokens={tokens} label="Copy code" />
        </View>
      ) : null}
      <FoldFooter
        total={total}
        shown={shown}
        expanding={expanding}
        expanded={expanded}
        onShowAll={showAll}
        onShowLess={showLess}
        tokens={tokens}
        bare={bare}
      />
    </View>
  );
}

/** Lines a code block or a command's output shows before "Show N more lines" (S7 §3.6). */
export const FOLD_LINES = 12;

/** The header's fixed action slot: two 24pt buttons and their gap, plus breathing room. */
const ACTION_SLOT = 64;

/** `CopyButton`'s visual box. */
const COPY_BOX = 24;
/** The right padding of a headerless block: the floating Copy, its inset and a gap before the text. */
const FLOATING_COPY_SLOT = COPY_BOX + space.xs + space.sm;

/** Display names for the languages a reply names most often; anything else as written. */
const LANGUAGE_LABELS: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  json: "JSON",
  bash: "Shell",
  sh: "Shell",
  shell: "Shell",
  zsh: "Shell",
  diff: "Diff",
  py: "Python",
  python: "Python",
  rust: "Rust",
  rs: "Rust",
  go: "Go",
  swift: "Swift",
  kotlin: "Kotlin",
  java: "Java",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  sql: "SQL",
  md: "Markdown",
  markdown: "Markdown",
};

/** What the header names the block: the language, or nothing for plain text. */
export function codeLanguageLabel(language: string | undefined, filename?: string): string {
  const raw = (language ?? "").trim().toLowerCase();
  const fromFile = filename ? (fileExtension(filename) ?? "") : "";
  const key = raw && raw !== "text" && raw !== "plaintext" ? raw : fromFile;
  if (!key || key === "text" || key === "plaintext" || key === "txt") return "";
  return LANGUAGE_LABELS[key] ?? key;
}

/** A 24pt icon button with a pressed-in look while `active` (Wrap). */
function ToggleIconButton({
  icon,
  label,
  active,
  onPress,
  tokens,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress(): void;
  tokens: ExtendedThemeTokens;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      aria-pressed={active}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        toggleStyles.button,
        (active || pressed) && { backgroundColor: tokens.v2.surface2 },
      ]}
    >
      <Icon name={icon} size={TYPE.button.size + 1} color={active ? tokens.foreground : tokens.foregroundMuted} />
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  button: {
    width: 24,
    height: 24,
    borderRadius: radiusV2.chip,
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * "Show N more lines" under a folded block, "Show less" under an unfolded
 * one, and the progress while a long block is still being appended.
 */
function FoldFooter({
  total,
  shown,
  expanding,
  expanded,
  onShowAll,
  onShowLess,
  tokens,
  bare,
  earlier = false,
}: {
  total: number;
  shown: number;
  expanding: boolean;
  expanded: boolean;
  onShowAll(): void;
  onShowLess(): void;
  tokens: ExtendedThemeTokens;
  bare: boolean;
  /** Tail mode: the hidden lines come before the shown ones. */
  earlier?: boolean;
}) {
  const hidden = total - shown;
  let label: string | null = null;
  let onPress: (() => void) | undefined;
  if (!expanded && hidden > 0) {
    label = earlier
      ? `${hidden} earlier ${hidden === 1 ? "line" : "lines"}`
      : `Show ${hidden} more ${hidden === 1 ? "line" : "lines"}`;
    onPress = onShowAll;
  } else if (expanding && hidden > 0) {
    label = `Showing ${shown} of ${total} lines`;
  } else if (expanded && total > FOLD_LINES) {
    label = "Show less";
    onPress = onShowLess;
  }
  if (label === null) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={onPress === undefined}
      hitSlop={6}
      style={({ pressed }) => [
        bare ? footerStyles.bare : [footerStyles.row, { borderTopColor: tokens.v2.borderSubtle }],
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text
        style={[
          footerStyles.label,
          { color: tokens.foregroundMuted, fontFamily: tokens.fontUi },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const footerStyles = StyleSheet.create({
  row: {
    height: 32,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderTopWidth: 1,
  },
  bare: {
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  label: {
    fontSize: TYPE.button.size,
    lineHeight: TYPE.button.lineHeight,
    ...unselectable,
  },
});

/**
 * How many of `total` rows to mount. A block over `FOLD_LINES` starts at
 * `initialLines` (default `FOLD_LINES`), never more than `LARGE_BLOCK_LINES`;
 * after `showAll`, rows are appended a batch per frame until every row is
 * mounted, so expanding a huge block never blocks the UI thread for the whole
 * block at once. `showLess` folds it again.
 */
export function useBatchedRows(
  total: number,
  initialLines: number = FOLD_LINES,
): { shown: number; expanding: boolean; expanded: boolean; showAll(): void; showLess(): void } {
  const firstCap = Math.min(total > FOLD_LINES ? Math.min(initialLines, total) : total, LARGE_BLOCK_LINES);
  // null: the first rows only. A number: "Show all" was pressed.
  const [limit, setLimit] = useState<number | null>(null);
  const shown = limit === null ? firstCap : Math.min(limit, total);
  useEffect(() => {
    if (limit === null || limit >= total) return;
    return scheduleFrame(() => setLimit((current) => (current ?? firstCap) + APPEND_BATCH));
  }, [limit, total, firstCap]);
  const showAll = useCallback(() => setLimit(shown + APPEND_BATCH), [shown]);
  const showLess = useCallback(() => setLimit(null), []);
  return { shown, expanding: limit !== null && shown < total, expanded: limit !== null, showAll, showLess };
}

/** The rows a code block drew last, and the block-wide inputs they were drawn under. */
interface DrawnRows {
  shared: readonly unknown[];
  lines: readonly string[];
  dialects: readonly string[];
  numbers: readonly (number | null)[] | null;
  diffRows: readonly DiffRow[] | null;
  nodes: ReactNode[];
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Rows per memoised chunk: appending a batch mounts new chunks only. */
const CHUNK_LINES = 100;

function chunkRows(
  shown: number,
  render: (from: number, to: number) => React.ReactNode,
): React.ReactNode[] {
  const chunks: React.ReactNode[] = [];
  for (let from = 0; from < shown; from += CHUNK_LINES) {
    chunks.push(render(from, Math.min(shown, from + CHUNK_LINES)));
  }
  return chunks;
}

interface CodeRowsProps {
  from: number;
  to: number;
  lines: string[];
  row(line: string, idx: number): React.ReactNode;
}

function CodeRowsBody({ from, to, lines, row }: CodeRowsProps) {
  const out: React.ReactNode[] = [];
  for (let idx = from; idx < to; idx++) out.push(row(lines[idx] ?? "", idx));
  return <>{out}</>;
}

const CodeRows = memo(CodeRowsBody);

/** The gutter fits the largest line number at the code size, plus its gap. */
export function lineNumberWidth(largest: number, size: number): number {
  const digits = String(Math.max(1, largest)).length;
  return Math.max(2, digits) * Math.ceil(size * 0.62) + space.sm;
}

/** Largest line number in a diff; null rows count as zero. */
export function maxLineNumber(numbers: readonly (number | null)[]): number {
  let largest = Number.NEGATIVE_INFINITY;
  for (const number of numbers) largest = Math.max(largest, number ?? 0);
  return largest;
}

const rowStyles = StyleSheet.create({
  scrollContent: { flexGrow: 1 },
  scrollRows: { flexGrow: 1 },
});

/**
 * One line as the daemon tokenised it. A token the theme gives no colour takes
 * the body colour, which is what shiki's own renderer does.
 */
function consolidateTokens(tokens: HighlightToken[]): HighlightToken[] {
  if (tokens.length <= 1) return tokens;
  const result: HighlightToken[] = [];
  let current = { ...tokens[0]! };
  for (let i = 1; i < tokens.length; i++) {
    const next = tokens[i]!;
    if (
      next.color === current.color &&
      Boolean(next.bold) === Boolean(current.bold) &&
      Boolean(next.italic) === Boolean(current.italic)
    ) {
      current.text += next.text;
    } else {
      result.push(current);
      current = { ...next };
    }
  }
  result.push(current);
  return result;
}

function renderShikiLine(line: HighlightLine, tokens: ExtendedThemeTokens, Span: React.ElementType<TextProps> = Text): React.ReactNode {
  return consolidateTokens(line).map((token, idx) => (
    <Span
      key={idx}
      selectable
      style={{
        color: token.color ?? tokens.foreground,
        fontWeight: token.bold ? "600" : "400",
        fontStyle: token.italic ? "italic" : "normal",
      }}
    >
      {token.text}
    </Span>
  ));
}

/** Shared row renderer for code blocks and selectable preview text. */
export function renderDiffLine(
  line: string,
  row: DiffRow,
  tokens: ExtendedThemeTokens,
  filename?: string,
  body?: HighlightLine,
  chrome?: HighlightLine,
  nativeSelection = false,
): React.ReactNode {
  const Span = nativeSelection ? SelectableSpan : Text;
  if (!row.markers) {
    return chrome ? renderShikiLine(chrome, tokens, Span) : <Span style={{ color: tokens.syntax.comment }}>{line}</Span>;
  }
  return <Span>
    {Array.from(row.markers, (marker, index) => <Span key={index} style={marker === "+" || marker === "-" ? {
      color: marker === "+" ? tokens.syntax.diffAddMarker : tokens.syntax.diffRemoveMarker,
      fontWeight: "600",
    } : undefined}>{marker}</Span>)}
    {body ? renderShikiLine(body, tokens, Span) : renderDialectLine(line.slice(row.markers.length), dialectFor(true, "diff", filename), tokens, Span)}
  </Span>;
}

function renderSyntaxLine(
  line: string,
  language: string,
  lineDialect: string,
  tokens: ExtendedThemeTokens,
): React.ReactNode {
  if (language === "bash") return renderBashTokens(line, tokens);
  return renderDialectLine(line, lineDialect, tokens);
}

/** One line, coloured in whichever dialect that line turned out to be. */
function renderDialectLine(
  line: string,
  dialect: string,
  tokens: ExtendedThemeTokens,
  Span: React.ElementType<TextProps> = Text,
): React.ReactNode {
  if (dialect === "bash") return renderBashTokens(line, tokens, Span);

  if (dialect === "html") {
    return renderWithInterpolation(line, tokens, (text) => renderHtmlTokens(text, tokens, "", Span), Span);
  }

  if (dialect === "css") {
    return renderWithInterpolation(line, tokens, (text) => renderCssTokens(text, tokens, "", Span), Span);
  }

  const commentMark = dialect === "python" ? "#" : "//";
  const commentIndex = line.indexOf(commentMark);
  if (commentIndex !== -1) {
    return (
      <Span>
        {renderCodeTokens(line.slice(0, commentIndex), dialect, tokens, Span)}
        <Span selectable style={{ color: tokens.syntax.comment }}>
          {line.slice(commentIndex)}
        </Span>
      </Span>
    );
  }

  return renderCodeTokens(line, dialect, tokens, Span);
}

function renderCodeTokens(
  text: string,
  language: string,
  tokens: ExtendedThemeTokens,
  Span: React.ElementType<TextProps> = Text,
): React.ReactNode {
  const keywords = keywordsFor(language);
  const tokenRegex = CODE_TOKEN_RE;
  tokenRegex.lastIndex = 0;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (plain: string) => {
    if (!plain) return;
    const last = parts[parts.length - 1];
    if (typeof last === "string") {
      parts[parts.length - 1] = last + plain;
    } else {
      parts.push(plain);
    }
  };

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushPlain(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.syntax.string }}>
          {token}
        </Span>,
      );
    } else if (keywords[token]) {
      parts.push(
        <Span
          key={match.index}
          selectable
          style={{ color: tokens.syntax.keyword, fontWeight: "600" }}
        >
          {token}
        </Span>,
      );
    } else if (/^\d+$/.test(token)) {
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.syntax.number }}>
          {token}
        </Span>,
      );
    } else {
      pushPlain(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    pushPlain(text.slice(lastIndex));
  }

  return parts;
}

const BASH_COMMANDS: Record<string, true> = {
  pnpm: true,
  npm: true,
  npx: true,
  yarn: true,
  bun: true,
  git: true,
  cargo: true,
  docker: true,
  node: true,
  python: true,
  uv: true,
  cd: true,
  ls: true,
  cat: true,
  rm: true,
  cp: true,
  mv: true,
  mkdir: true,
  grep: true,
  find: true,
  curl: true,
  chmod: true,
  export: true,
  echo: true,
  paseo: true,
  ssh: true,
  sudo: true,
  apt: true,
  brew: true,
};

const BASH_SUBCOMMANDS: Record<string, true> = {
  run: true,
  build: true,
  test: true,
  install: true,
  add: true,
  remove: true,
  commit: true,
  push: true,
  pull: true,
  checkout: true,
  status: true,
  branch: true,
  merge: true,
  rebase: true,
  clone: true,
  diff: true,
  log: true,
  init: true,
  start: true,
  stop: true,
  reload: true,
  restart: true,
};

function renderBashTokens(line: string, tokens: ExtendedThemeTokens, Span: React.ElementType<TextProps> = Text): React.ReactNode {
  if (line.startsWith("#")) {
    return (
      <Span selectable style={{ color: tokens.syntax.comment }}>
        {line}
      </Span>
    );
  }

  let promptPrefix = "";
  let commandStr = line;
  if (line.startsWith("$ ")) {
    promptPrefix = "$ ";
    commandStr = line.slice(2);
  }

  const tokenRegex =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|--?[a-zA-Z0-9_-]+|&&|\|\||\||>|>>|;|[^\s"';|&>]+)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let isFirstWord = true;

  const pushPlain = (plain: string) => {
    if (!plain) return;
    const last = parts[parts.length - 1];
    if (typeof last === "string") {
      parts[parts.length - 1] = last + plain;
    } else {
      parts.push(plain);
    }
  };

  while ((match = tokenRegex.exec(commandStr)) !== null) {
    if (match.index > lastIndex) {
      pushPlain(commandStr.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (
      token === "&&" ||
      token === "||" ||
      token === "|" ||
      token === ">" ||
      token === ">>" ||
      token === ";"
    ) {
      isFirstWord = true;
      parts.push(
        <Span
          key={match.index}
          selectable
          style={{ color: tokens.syntax.keyword, fontWeight: "600" }}
        >
          {token}
        </Span>,
      );
    } else if (token.startsWith("-")) {
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.syntax.property }}>
          {token}
        </Span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.syntax.string }}>
          {token}
        </Span>,
      );
    } else if (/^\d+$/.test(token)) {
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.syntax.number }}>
          {token}
        </Span>,
      );
    } else if (isFirstWord || BASH_COMMANDS[token]) {
      isFirstWord = false;
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.accent, fontWeight: "600" }}>
          {token}
        </Span>,
      );
    } else if (BASH_SUBCOMMANDS[token]) {
      parts.push(
        <Span key={match.index} selectable style={{ color: tokens.syntax.function }}>
          {token}
        </Span>,
      );
    } else {
      pushPlain(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < commandStr.length) {
    pushPlain(commandStr.slice(lastIndex));
  }
  return (
    <Span>
      {promptPrefix ? (
        <Span selectable style={{ color: tokens.foregroundMuted, fontWeight: "600" }}>
          {promptPrefix}
        </Span>
      ) : null}
      {parts}
    </Span>
  );
}

/**
 * Whole-line verdicts in command output. A line that opens with one of these
 * takes its colour, because that is the part a reader scans for.
 */
const LINE_VERDICTS: Array<{
  re: RegExp;
  tone: "success" | "danger" | "warning";
}> = [
  // Check marks and crosses as escapes: the bundle stays ASCII (see
  // `scripts/check-hermes.mjs`).
  { re: /^\s*(?:PASS|OK|DONE|SUCCESS|\u2713|\u2714)\b/i, tone: "success" },
  { re: /^\s*(?:FAIL(?:ED)?|ERROR|ERR|FATAL|\u2715|\u2717|\u00d7)\b/i, tone: "danger" },
  { re: /^\s*(?:WARN(?:ING)?|SKIP(?:PED)?|DEPRECATED)\b/i, tone: "warning" },
];

/** Inline spans worth colouring inside an otherwise plain output line. */
const OUTPUT_TOKENS =
  /(https?:\/\/[^\s]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b[\w.-]+\.[a-z]{1,5}(?::\d+)?\b|\b\d+(?:\.\d+)?(?:ms|s|m|h|%|KB|MB|GB)?\b|\b(?:PASS|OK|DONE|SUCCESS)\b|\b(?:FAIL(?:ED)?|ERROR|FATAL)\b|\b(?:WARN(?:ING)?|SKIPPED)\b)/g;

/**
 * Command output, coloured. Verdict lines take one tone end to end; everything
 * else keeps muted body text with counts, durations, paths, and quoted values
 * lifted out so the numbers are findable.
 */
export function renderTerminalOutput(text: string, tokens: ExtendedThemeTokens): React.ReactNode {
  const lines = terminalLines(text);
  return lines.map((line, lineIdx) => renderTerminalLine(line, lineIdx, tokens, lineIdx < lines.length - 1 ? "\n" : ""));
}

/** Command output split into lines, trailing blank lines dropped. */
export function terminalLines(text: string): string[] {
  return text.replace(/\s+$/, "").split("\n");
}

/** One line of `renderTerminalOutput`, followed by `tail` (its newline, when another line follows). */
export function renderTerminalLine(
  line: string,
  lineIdx: number,
  tokens: ExtendedThemeTokens,
  tail = "",
): React.ReactNode {
  const key = `out-${lineIdx}`;

  const verdict = LINE_VERDICTS.find((v) => v.re.test(line));
  if (verdict) {
    const tone =
      verdict.tone === "success"
        ? tokens.success
        : verdict.tone === "danger"
          ? tokens.danger
          : tokens.warning;
    return (
      <SelectableSpan key={key} selectable style={{ color: tone }}>
        {line}
        {tail}
      </SelectableSpan>
    );
  }

  if (line.startsWith("+")) {
    return (
      <SelectableSpan key={key} selectable style={{ color: tokens.syntax.diffAddMarker }}>
        {line}
        {tail}
      </SelectableSpan>
    );
  }
  if (line.startsWith("-") && !line.startsWith("--")) {
    return (
      <SelectableSpan key={key} selectable style={{ color: tokens.syntax.diffRemoveMarker }}>
        {line}
        {tail}
      </SelectableSpan>
    );
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  OUTPUT_TOKENS.lastIndex = 0;

  while ((match = OUTPUT_TOKENS.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    const spanKey = `${key}-${match.index}`;
    let color = tokens.foreground;

    if (/^https?:\/\//.test(token)) {
      color = tokens.accent;
    } else if (token.startsWith('"') || token.startsWith("'")) {
      color = tokens.syntax.string;
    } else if (/^(?:PASS|OK|DONE|SUCCESS)$/i.test(token)) {
      color = tokens.success;
    } else if (/^(?:FAIL(?:ED)?|ERROR|FATAL)$/i.test(token)) {
      color = tokens.danger;
    } else if (/^(?:WARN(?:ING)?|SKIPPED)$/i.test(token)) {
      color = tokens.warning;
    } else if (/^\d/.test(token)) {
      color = tokens.syntax.number;
    } else {
      color = tokens.syntax.property;
    }

    parts.push(
      <SelectableSpan key={spanKey} selectable style={{ color }}>
        {token}
      </SelectableSpan>,
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return (
    <SelectableSpan key={key} selectable style={{ color: tokens.foregroundMuted }}>
      {parts}
      {tail}
    </SelectableSpan>
  );
}

interface TerminalOutputProps {
  text: string;
  tokens: ExtendedThemeTokens;
  /** The output text's own style (font, size, colour). */
  style?: StyleProp<TextStyle>;
  /** Spread onto the output `Text` (selection markers). */
  textProps?: TextProps;
}

/** Output lines per memoised chunk. */
const OUTPUT_CHUNK_LINES = 200;

interface OutputChunkProps {
  text: string;
  tokens: ExtendedThemeTokens;
  /** A newline joins this chunk to the next one. */
  more: boolean;
}

function OutputChunkBody({ text, tokens, more }: OutputChunkProps) {
  return (
    <>
      {renderTerminalOutput(text, tokens)}
      {more ? "\n" : ""}
    </>
  );
}

const OutputChunk = memo(OutputChunkBody);

/**
 * Command output, folded to its last `FOLD_LINES` lines (S7 design spec §3.1):
 * the end of a log is where the result and the error are, and a running
 * command's tail follows the output as it arrives without the view jumping
 * when the command finishes. "N earlier lines" above the tail mounts the rest
 * a batch per frame (plan §3.2); "Show less" folds it again. Only what is
 * drawn is folded; copying a card copies the full output from its data.
 */
export function TerminalOutput({ text, tokens, style, textProps }: TerminalOutputProps) {
  const lines = useMemo(() => text.replace(/\s+$/, "").split("\n"), [text]);
  const total = lines.length;
  const { shown, expanding, expanded, showAll, showLess } = useBatchedRows(total);
  const from = total - shown;
  // Chunk edges sit on absolute multiples of OUTPUT_CHUNK_LINES, so growing
  // the shown range upwards re-renders only the partial first chunk.
  const chunks: React.ReactNode[] = [];
  let start = from;
  while (start < total) {
    const end = Math.min(total, (Math.floor(start / OUTPUT_CHUNK_LINES) + 1) * OUTPUT_CHUNK_LINES);
    chunks.push(
      <OutputChunk
        key={start === from ? "first" : start}
        text={lines.slice(start, end).join("\n")}
        tokens={tokens}
        more={end < total}
      />,
    );
    start = end;
  }
  const settled = expanded && !expanding;
  return (
    <>
      {settled ? null : (
        <FoldFooter
          total={total}
          shown={shown}
          expanding={expanding}
          expanded={expanded}
          onShowAll={showAll}
          onShowLess={showLess}
          tokens={tokens}
          bare
          earlier
        />
      )}
      <Text selectable {...textProps} style={style}>
        {chunks}
      </Text>
      {settled ? (
        <FoldFooter
          total={total}
          shown={shown}
          expanding={false}
          expanded
          onShowAll={showAll}
          onShowLess={showLess}
          tokens={tokens}
          bare
        />
      ) : null}
    </>
  );
}
