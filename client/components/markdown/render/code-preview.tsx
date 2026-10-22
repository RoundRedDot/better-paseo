import React, { useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { SyntaxHighlightBlock } from "../../syntax-highlight";
import { MarkdownView } from "../markdown-view";
import type { RenderContext } from "./context";
import { HoverPreview, HoverPreviewBody, HoverPreviewContext, HoverPreviewHeader, useHoverPreview } from "../../../ui/hover-preview";
import { ToolbarButton, ToolbarCopyButton } from "../../../ui/toolbar-button";
import { PreviewLines } from "../../../ui/preview-lines";
import { BlockPlacementContext, type BlockEntry } from "../../../details/contracts";
import { registerBlock, type BlockRegistration } from "../../../details/block-registry";
import { detailsApi } from "../../../details/details-store";
import { useEnhancerPreferences } from "../../../preferences";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import { toolbarLabel } from "../../../i18n/toolbar-strings";

/** A code block owns its window; the window never opens another preview. */
export function MarkdownCodePreview({ code, language, context, closed, showLineNumbers }: {
  code: string;
  language: string;
  context: RenderContext;
  closed: boolean;
  showLineNumbers: boolean;
}) {
  const { tokens, metrics, variant, onRevealPath } = context;
  const placement = useContext(BlockPlacementContext);
  const owner = useContext(HoverPreviewContext);
  const preferences = useEnhancerPreferences();
  const flag = preferences.blockDetails;
  const capabilities = useInputCapabilities();
  const key = useId();
  const id = `${placement?.agentId}:${placement?.at}:code:${key}:preview`;
  const enabled = flag && placement !== null && !owner;
  const preview = useHoverPreview(true, enabled ? id : undefined, { windowOnly: true });
  const [raw, setRaw] = useState(false);
  const lines = useMemo(() => code.split("\n"), [code]);
  const renderContent = () => (
    <>
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
    </>
  );
  const entry = useRef<BlockEntry | null>(null);
  const registration = useRef<BlockRegistration | null>(null);
  entry.current = enabled ? {
    id, agentId: placement!.agentId, at: placement!.at, kind: "code", seq: 0,
    mounted: true, navigable: false, hasBody: true, title: language || toolbarLabel("Code", preferences.language), titleMono: false,
    subtitle: [], icon: "Code", readsImage: false, render: renderContent,
    copies: () => [{ id: "code", label: "Copy code", icon: "Code", text: code }],
    measure: () => new Promise((resolve) => {
      const node = preview.anchorRef.current;
      if (!node) return resolve(null);
      node.measureInWindow((_x, top, _width, height) => resolve({ top, height }));
    }),
  } : null;
  useEffect(() => {
    if (!entry.current) return;
    const handle = registerBlock(entry.current);
    registration.current = handle;
    return () => { handle.release(); registration.current = null; };
  }, [enabled, placement?.agentId, id]);
  useEffect(() => { if (entry.current) registration.current?.update(entry.current); });
  const open = preview.pop ? () => {
    setRaw(false);
    if (enabled && !capabilities.hover) {
      detailsApi.open(placement!.agentId, id, { detent: "full", navigable: false });
    } else {
      preview.pop!();
      preview.maximize();
    }
  } : undefined;
  return (
    <View ref={preview.anchorRef}>
      <SyntaxHighlightBlock code={code} language={language} tokens={tokens}
        compact={metrics.codeCompact} showLineNumbers={showLineNumbers} highlight={closed} scrollX
        onOpenPreview={open} />
      {preview.open ? (
        <HoverPreview preview={preview} tokens={tokens} wrapDisabled={!raw}>
          {renderContent()}
        </HoverPreview>
      ) : null}
    </View>
  );
}
