import React, { useCallback, useMemo } from "react";
import type { TextStyle } from "react-native";
import { useHighlightedLines } from "../highlight";
import { PreviewLines } from "../ui/preview-lines";
import { selectionCodeText } from "./selection-actions";
import { diffRows, splitDiffOutput } from "./diff-lines";
import { renderDiffLine, renderTerminalLine, strippedDiffCode, SyntaxHighlightBlock, terminalLines, TerminalOutput } from "./syntax-highlight";
import type { ExtendedThemeTokens } from "./theme-tokens";

interface OutputProps {
  text: string;
  style: TextStyle;
  tokens: ExtendedThemeTokens;
  preview?: boolean;
  running?: boolean;
}

/** A patch keeps the same row colours in the card and in the full preview. */
export function DiffPreview({ text, filename, style, tokens, numbered = true, running = false }: OutputProps & {
  filename?: string;
  numbered?: boolean;
}) {
  const lines = useMemo(() => text.replace(/\n+$/, "").split("\n"), [text]);
  const rows = useMemo(() => diffRows(lines), [lines]);
  const diffBodyCode = useMemo(() => filename ? strippedDiffCode(lines) : undefined, [lines, filename]);
  const highlighted = useHighlightedLines({ code: text, language: "diff", filename, diffBodyCode, dark: tokens.isDark, enabled: !running });
  const backgrounds = useMemo(() => rows.map((row) => row.kind === "add" ? tokens.syntax.diffAddBg
    : row.kind === "remove" ? tokens.syntax.diffRemoveBg : undefined), [rows, tokens]);
  const renderLine = useCallback((line: string, index: number) => renderDiffLine(
    line, rows[index]!, tokens, filename, highlighted.diffLines?.[index], highlighted.lines?.[index], true,
  ), [rows, tokens, filename, highlighted]);
  return <PreviewLines text={text} lines={lines} style={style} tokens={tokens} diff numbered={numbered}
    renderLine={renderLine} lineBackgrounds={backgrounds} />;
}

function OutputPreview({ text, style, tokens }: OutputProps) {
  const lines = useMemo(() => terminalLines(text), [text]);
  const renderLine = useCallback((line: string, index: number) => renderTerminalLine(line, index, tokens), [tokens]);
  return <PreviewLines text={text} lines={lines} style={style} tokens={tokens} renderLine={renderLine} />;
}

/** Only patch ranges use diff rendering; adjacent logs remain terminal output. */
export function ToolOutput({ text, style, tokens, preview = false, running = false }: OutputProps) {
  const sections = useMemo(() => splitDiffOutput(text), [text]);
  return <>{sections.map((section, index) => {
    if (section.diff) {
      return preview
        ? <DiffPreview key={index} text={section.text} filename={section.filename} style={style} tokens={tokens} running={running} />
        : <SyntaxHighlightBlock key={index} code={section.text} language="diff" filename={section.filename}
          tokens={tokens} bare compact showLineNumbers highlight={!running} />;
    }
    return preview
      ? <OutputPreview key={index} text={section.text} style={style} tokens={tokens} />
      : <TerminalOutput key={index} text={section.text} style={style} tokens={tokens} textProps={selectionCodeText} />;
  })}</>;
}
