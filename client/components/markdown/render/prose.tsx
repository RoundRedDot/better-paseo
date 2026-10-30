import React, { useContext, useMemo, type ElementType } from "react";
import { Platform, processColor, StyleSheet, type TextProps, type TextStyle } from "react-native";
import type { Token } from "../../../vendor/marked";
import { ProseSpan, ProseText } from "../../../ui/prose-text";
import { PathContext } from "../../../ui/path-text";
import { useCopy } from "../../../ui/use-copy";
import { useInputCapabilities } from "../../../ui/use-input-capabilities";
import { formatPath } from "../../../paths/format-path";
import { openLink } from "../../open-link";
import { space } from "../../theme-tokens";
import type { RenderContext } from "./context";
import { MARKER_GAP } from "./styles";
import { BlockSelectionContext } from "./block-selection";
import { renderInline } from "./inline";
import { escapeProse, nativeBlockSource, nativeProseSource, type NativeProseSource } from "./native-prose-source";
import { resolveLocalLink } from "./local-path";

// Paseo 0.12 registers this Fabric component and its view config before rendering plugins.
// Use the host's native view without bundling a second Markdown runtime or native library.
const NativeProse = "EnrichedMarkdownText" as unknown as ElementType;
const NativeListProse = "EnrichedMarkdown" as unknown as ElementType;
const FLAGS = { latexMath: false, hardSoftBreaks: true, preserveBlankLines: true };
const GROUP_FLAGS = { ...FLAGS, preserveBlankLines: false };

interface Props extends TextProps {
  context: RenderContext;
  tokens?: readonly Token[];
  text?: string;
  prefix?: string;
  bold?: boolean;
  blockTokens?: readonly Token[];
  gap?: number;
}

/** A paragraph, heading or list body; code fences and tables keep their existing renderers. */
export function MarkdownProse({ context, tokens, text, prefix, bold, style, ...rest }: Props) {
  if (Platform.OS !== "ios" || context.plainProse) {
    const body = text === undefined ? renderInline(tokens, context, "p", bold) : context.renderText ? context.renderText(text) : text;
    return <ProseText style={style} {...rest}>{prefix
      ? [<ProseSpan key="prefix" style={context.styles.headingHash}>{prefix}</ProseSpan>, body]
      : body}</ProseText>;
  }
  return <IOSProse context={context} tokens={tokens} text={text} prefix={prefix} style={style} {...rest} />;
}

export function NativeProseGroup({ context, tokens, inQuote = false }: {
  context: RenderContext; tokens: readonly Token[]; inQuote?: boolean;
}) {
  return <IOSProse context={context} style={inQuote ? context.styles.quoteText : context.styles.paragraph}
    blockTokens={tokens} gap={inQuote ? space.xs : context.metrics.blockGap} />;
}

function nativeStyle(style: TextProps["style"], context: RenderContext, gap = 0) {
  const base = StyleSheet.flatten(style) ?? {};
  const { styles, tokens, metrics } = context;
  const color = (value: TextStyle["color"]) => processColor(value ?? base.color ?? tokens.foreground);
  return {
    paragraph: {
      fontFamily: base.fontFamily ?? tokens.fontUi ?? "System", fontSize: base.fontSize ?? metrics.bodySize,
      fontWeight: String(base.fontWeight ?? "400"), color: color(base.color),
      lineHeight: base.lineHeight ?? metrics.bodyLineHeight, textAlign: base.textAlign ?? "left",
      marginTop: 0, marginBottom: gap,
    },
    strong: { fontWeight: String(styles.strong.fontWeight ?? "600"), color: color(styles.strong.color) },
    em: { fontStyle: "italic" },
    strikethrough: { color: color(styles.strike.color) },
    link: { color: color(styles.link.color), underline: true, backgroundColor: processColor("transparent") },
    code: { fontFamily: styles.codeSpan.fontFamily, fontSize: styles.codeSpan.fontSize,
      color: color(styles.codeSpan.color), backgroundColor: processColor("transparent"), borderColor: processColor("transparent") },
    list: { fontFamily: base.fontFamily ?? tokens.fontUi ?? "System", fontSize: base.fontSize ?? metrics.bodySize,
      fontWeight: String(base.fontWeight ?? "400"), color: color(base.color), lineHeight: base.lineHeight ?? metrics.bodyLineHeight,
      marginTop: 0, marginBottom: gap, marginLeft: metrics.indentStep,
      markerMinWidth: metrics.markerWidth - MARKER_GAP, gapWidth: MARKER_GAP, itemSpacing: metrics.itemGap,
      bulletColor: processColor(tokens.foregroundMuted), bulletSize: 6,
      markerColor: processColor(tokens.foregroundMuted), markerFontWeight: "400" },
  };
}

function IOSProse({ context, tokens, text, prefix, style, blockTokens, gap, ...rest }: Props) {
  const selection = useContext(BlockSelectionContext);
  const source = useMemo<NativeProseSource>(() => blockTokens ? nativeBlockSource(blockTokens) : text === undefined
    ? nativeProseSource(tokens ?? []) : { markdown: escapeProse(text), links: [] }, [tokens, text, blockTokens]);
  const markdown = prefix ? escapeProse(prefix) + source.markdown : source.markdown;
  const markdownStyle = useMemo(() => nativeStyle(style, context, gap), [style, context, gap]);
  // The host uses the GFM container for lists; its native block layout owns wrapping.
  const Component = blockTokens?.some((token) => token.type === "list") ? NativeListProse : NativeProse;
  const props = { ...rest, markdown, markdownStyle, style: [style, { backgroundColor: "transparent" }],
    selectable: !selection?.selected, isGFM: true, allowFontScaling: rest.allowFontScaling ?? true, allowTrailingMargin: false,
    enableLinkPreview: false, enableBlockContextMenu: false, streamingAnimation: false,
    md4cFlags: blockTokens ? GROUP_FLAGS : FLAGS,
    selectionMenuConfig: { copyAsMarkdown: false, copyImageUrl: false, copyLabel: "Copy" } };
  // Ordinary prose carries no clipboard controllers, effects, or path-context subscriptions.
  return source.links.some((link) => link.kind !== "url")
    ? <IOSProseWithPaths component={Component} nativeProps={props} source={source} context={context} />
    : <Component {...props} onLinkPress={({ nativeEvent }: LinkEvent) => {
      selection?.cancel();
      const link = source.links[linkIndex(nativeEvent.url)];
      if (link?.kind === "url") openLink(link.target);
    }} />;
}

interface LinkEvent { nativeEvent: { url: string } }
function linkIndex(url: string): number {
  return /^bc-prose:\/\/\d+$/.test(url) ? Number(url.slice("bc-prose://".length)) : -1;
}

function IOSProseWithPaths({ component: Component, nativeProps, source, context }: {
  component: ElementType; nativeProps: Record<string, unknown>; source: NativeProseSource; context: RenderContext;
}) {
  const selection = useContext(BlockSelectionContext);
  const paths = useContext(PathContext);
  const capabilities = useInputCapabilities();
  const { copy } = useCopy();
  return <Component {...nativeProps} onLinkPress={({ nativeEvent }: LinkEvent) => {
    selection?.cancel();
    const link = source.links[linkIndex(nativeEvent.url)];
    if (!link) return;
    if (link.kind === "url") { openLink(link.target); return; }
    const absolutePath = link.kind === "file" ? resolveLocalLink(link.target, paths.cwd) : formatPath(link.target, paths).absolutePath;
    const reveal = context.onRevealPath ?? paths.reveal;
    if ((capabilities.touch && !capabilities.hover) || !reveal) {
      void copy(absolutePath, { feedback: "toast", label: "Copy path" });
    } else reveal(absolutePath);
  }} />;
}
