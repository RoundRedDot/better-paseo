import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { Tokens } from "../../../vendor/marked";
import { SyntaxHighlightBlock } from "../../syntax-highlight";
import type { RenderContext } from "./context";
import { FadeIn } from "../../../ui/fade-in";
import { codeSurface } from "../../host-font-escape";
import { codeLanguage, fenceClosed } from "./text";
import { MarkdownCodePreview } from "./code-preview";

function lineCount(code: string): number {
  let count = 1;
  for (let index = 0; index < code.length; index++) if (code.charCodeAt(index) === 10) count++;
  return count;
}

/**
 * A fenced (or indented) code block. While its fence is open the lines are
 * coloured locally; the daemon is asked once, when the fence closes or the
 * reply ends (plan §3.1 item 7). Copy, the language label and sideways
 * scrolling come from `SyntaxHighlightBlock`.
 */
export function CodeBlock({
  token,
  context,
  open,
}: {
  token: Tokens.Code;
  context: RenderContext;
  open: boolean;
}) {
  const { styles, tokens, metrics, variant, collapseCode } = context;
  const [expanded, setExpanded] = useState(false);
  const lang = codeLanguage(token.lang);
  // An empty info string is the author asking for no grammar, which the daemon
  // answers as plain text instead of guessing a language.
  const language = lang === "" ? "plaintext" : lang;
  const lines = lineCount(token.text);

  if (collapseCode && variant === "compact" && !expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Show ${lang || "code"}, ${lines} lines`}
        onPress={() => setExpanded(true)}
        style={styles.codeSummary}
      >
        <Icon name="ChevronRight" size={metrics.glyphSize} color={tokens.foregroundMuted} />
        <Text {...(codeSurface as object)} style={styles.codeSummaryText}>
          {`${lang || "code"} · ${lines} ${lines === 1 ? "line" : "lines"}`}
        </Text>
      </Pressable>
    );
  }

  const closed = !open || token.codeBlockStyle === "indented" || fenceClosed(token.raw);

  // A block the reader unfolded fades in like any expanded body (plan §3.7).
  const Frame = collapseCode && variant === "compact" ? FadeIn : View;
  return (
    <Frame style={styles.codeBlock}>
      {["", "md", "markdown", "text", "txt", "plaintext"].includes(lang.toLowerCase()) ? (
        <MarkdownCodePreview code={token.text} language={language} context={context} closed={closed}
          showLineNumbers={metrics.codeLineNumbersFrom > 0 && lines >= metrics.codeLineNumbersFrom} />
      ) : <SyntaxHighlightBlock
        code={token.text}
        language={language}
        tokens={tokens}
        compact={metrics.codeCompact}
        showLineNumbers={metrics.codeLineNumbersFrom > 0 && lines >= metrics.codeLineNumbersFrom}
        highlight={closed}
        scrollX
      />}
    </Frame>
  );
}
