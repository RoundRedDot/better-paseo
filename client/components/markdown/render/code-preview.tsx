import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { SyntaxHighlightBlock } from "../../syntax-highlight";
import { MarkdownView } from "../markdown-view";
import type { RenderContext } from "./context";
import { HoverPreview, HoverPreviewBody, HoverPreviewHeader, useHoverPreview } from "../../../ui/hover-preview";
import { ToolbarButton, ToolbarCopyButton } from "../../../ui/toolbar-button";
import { PreviewLines } from "../../../ui/preview-lines";

/** A code block owns its window; the window never opens another preview. */
export function MarkdownCodePreview({ code, language, context, closed, showLineNumbers }: {
  code: string;
  language: string;
  context: RenderContext;
  closed: boolean;
  showLineNumbers: boolean;
}) {
  const { tokens, metrics, variant, onRevealPath } = context;
  const preview = useHoverPreview(true, undefined, { windowOnly: true });
  const [raw, setRaw] = useState(false);
  const lines = useMemo(() => code.split("\n"), [code]);
  const open = preview.pop ? () => {
    setRaw(false);
    preview.pop!();
    preview.maximize();
  } : undefined;
  return (
    <View ref={preview.anchorRef}>
      <SyntaxHighlightBlock code={code} language={language} tokens={tokens}
        compact={metrics.codeCompact} showLineNumbers={showLineNumbers} highlight={closed} scrollX
        onOpenPreview={open} />
      {preview.open ? (
        <HoverPreview preview={preview} tokens={tokens} wrapDisabled={!raw}>
          <HoverPreviewHeader tokens={tokens} icon="FileText" streaming={!closed} left={
            <ToolbarButton icon={raw ? "FileText" : "Code"} label={raw ? "Render Markdown" : "Show raw text"}
              onPress={() => setRaw((value) => !value)} tokens={tokens} />
          }>
            <ToolbarCopyButton text={code} label="Copy code" tokens={tokens} />
          </HoverPreviewHeader>
          <HoverPreviewBody key={raw ? "raw" : "markdown"}>
            {raw ? (
              <PreviewLines text={code} lines={lines} tokens={tokens}
                style={{ color: tokens.foreground, fontFamily: tokens.fontMono,
                  fontSize: tokens.typography.mono.size, lineHeight: tokens.typography.mono.lineHeight }} />
            ) : (
              <MarkdownView text={code} tokens={tokens} variant={variant} streaming={!closed}
                size={metrics.bodySize} onRevealPath={onRevealPath} />
            )}
          </HoverPreviewBody>
        </HoverPreview>
      ) : null}
    </View>
  );
}
