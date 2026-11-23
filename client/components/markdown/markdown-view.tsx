import React, { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
import type { ExtendedThemeTokens } from "../theme-tokens";
import { selectionSurface } from "../selection-actions";
import { codeSurface } from "../host-font-escape";
import { surfaceProps } from "../view-props";
import { perfOn, probeMarkdown } from "../../debug/perf";
import { createBlockCache, splitBlocks, type BlockCache } from "./blocks";
import { blockKind, lexBlock, warmLexer } from "./lex";
import { repairTail } from "./repair";
import type { RenderContext } from "./render/context";
import { MdBlock } from "./render/md-block";
import { buildStyles, variantMetrics, type MarkdownVariant } from "./render/styles";
import { TextZoomContext, useZoomedTokens } from "../../ui/text-zoom";
import { dismissBlockSelection } from "./render/block-selection";
import { SelectionTranslationContext, bindSelectionScopeElement, selectionScopeDataSet } from "../../translation/selection";

export { MARKDOWN_VARIANTS, type MarkdownVariant } from "./render/styles";

/**
 * True inside native details panels and the web drawer: block prose (a view given `size`)
 * reads at the timeline's body size there, the reply's content size without
 * the block size setting or `quiet`'s step down. `quiet` still mutes it.
 */
export const TimelineProseContext = createContext(false);

export interface MarkdownViewProps {
  text: string;
  /** Interpret structured directives in an assistant reply. */
  codexDirectives?: boolean;
  /** Optional inline decoration, leaving Markdown layout and parsing intact. */
  renderText?(text: string): React.ReactNode;
  /** False for a continuation row of the same reply. */
  firstBlock?: boolean;
  /** A new list row continues the preceding tight list's item spacing. */
  listContinuation?: boolean;
  tokens: ExtendedThemeTokens;
  variant: MarkdownVariant;
  /**
   * The reply is still being written: the last block is repaired before it is
   * drawn (unclosed `**`, a lone `-`, a table header without its delimiter)
   * and its open code fence is not sent for highlighting yet.
   */
  streaming?: boolean;
  /** Compact only: fenced code starts folded to a one-line summary. */
  collapseCode?: boolean;
  /** `layout.compact`: the touch layout's wider block gap. */
  compact?: boolean;
  /** One step quieter: muted text a size down (a thought, not the answer). */
  quiet?: boolean;
  /** Whether native double-tap block selection is enabled. */
  blockSelection?: boolean;
  /**
   * Metrics base instead of the reply's content size. Tool and thought prose
   * pass `blockProseBase`, which equals the content size at the default block
   * size and grows with the setting.
   */
  size?: number;
  /** Press on a file path in the prose. */
  onRevealPath?: (path: string) => void;
  /** Debug only: names this message so the perf probes can track it across chunks. */
  probeId?: string;
}

// Off the render path, once the plugin has loaded: see `warmLexer`.
if (typeof setTimeout === "function") setTimeout(warmLexer, 0);

/** Distinguishes mounted views for the flip probe. */
let mountSerial = 0;

interface Split {
  blocks: string[];
  /** The tail as drawn; equals the last block unless the reply streams. */
  tail: string;
}

function split(text: string, cache: BlockCache, streaming: boolean, codex: boolean): Split {
  const blocks = splitBlocks(text, cache, codex);
  const last = blocks[blocks.length - 1] ?? "";
  return { blocks, tail: streaming ? repairTail(last) : last };
}

/**
 * Markdown on marked (plan §3.1). The message is split into blocks once per
 * text change, reusing the blocks a previous call proved final; each block is
 * its own memoised component keyed by position, so while a reply streams only
 * the tail re-renders.
 */
export function MarkdownView({
  text,
  codexDirectives = false,
  renderText,
  firstBlock = true,
  listContinuation = false,
  tokens: given,
  variant,
  streaming = false,
  collapseCode = false,
  compact = false,
  quiet = false,
  blockSelection = true,
  size,
  onRevealPath,
  probeId,
}: MarkdownViewProps) {
  // The phone drawer's pinch zoom, when inside it.
  const tokens = useZoomedTokens(given);
  // One cache per message, owned by this component: never shared with
  // another reply that streams at the same time.
  const cacheRef = useRef<{ codex: boolean; cache: BlockCache } | null>(null);
  if (cacheRef.current === null || cacheRef.current.codex !== codexDirectives) cacheRef.current = { codex: codexDirectives, cache: createBlockCache() };
  const cache = cacheRef.current.cache;
  // The flip probe compares a view with its own previous parse. `probeId`
  // names the message by timestamp, and several replies can share a
  // millisecond (seen on web history-100: 41 "flips" between unrelated
  // replies), so each mounted view counts under its own serial.
  const instanceRef = useRef<{ probeId: string; instance: string } | null>(null);
  if (probeId !== undefined && instanceRef.current?.probeId !== probeId) {
    mountSerial += 1;
    instanceRef.current = { probeId, instance: `${probeId}#${mountSerial}` };
  }
  const instance = probeId === undefined ? undefined : instanceRef.current?.instance;

  const { blocks, tail } = useMemo(() => {
    if (!perfOn()) return split(text, cache, streaming, codexDirectives);
    let result: Split = { blocks: [], tail: "" };
    probeMarkdown(instance, text, (source) => {
      result = split(source, cache, streaming, codexDirectives);
      const last = result.blocks.length - 1;
      const kinds = result.blocks.map((raw, index) => ({
        kind: blockKind(
          index === last ? lexBlock(result.tail, streaming, codexDirectives) : lexBlock(raw, false, codexDirectives),
        ),
      }));
      // A tail the repair held back entirely (a lone `#` or `-`) draws
      // nothing; its first real kind is an appearance, not a flip.
      while (kinds.length > 0 && kinds[kinds.length - 1]?.kind === "empty") kinds.pop();
      return kinds;
    });
    return result;
  }, [text, cache, streaming, instance, codexDirectives]);

  // Sizes follow the host's content size (S7 §2.3); the metrics object is
  // cached per input, so the context — and every finished block — stays put
  // while the reply streams.
  const timelineProse = useContext(TimelineProseContext) && size !== undefined;
  const zoom = useContext(TextZoomContext);
  const scaledSize = size !== undefined && typeof zoom !== "number" ? Math.round(size * zoom.scale) : size;
  const metrics = timelineProse
    ? variantMetrics(variant, tokens.typography.content.size, compact)
    : variantMetrics(variant, scaledSize ?? tokens.typography.content.size, compact, quiet);
  const styles = useMemo(() => buildStyles(tokens, variant, metrics, quiet), [tokens, variant, metrics, quiet]);
  // iOS only: elsewhere prose is the same `Text` either way, and the context
  // must stay put when the reply settles so finished blocks are not redrawn.
  const plainProse = Platform.OS === "ios" && (streaming || renderText !== undefined);
  const context = useMemo<RenderContext>(
    () => ({
      styles,
      tokens,
      metrics,
      variant,
      collapseCode,
      plainProse,
      codexDirectives,
      blockSelection,
      onRevealPath,
      renderText,
    }),
    [styles, tokens, metrics, variant, collapseCode, plainProse, codexDirectives, blockSelection, onRevealPath, renderText],
  );

  // A streamed chunk changes the tail and leaves every block before it as it
  // was: those keep the element drawn before, so a chunk costs the blocks it
  // changed, not one element and one memo check per block of the reply.
  const drawn = useRef<DrawnBlocks | null>(null);
  // Keep logical block boundaries on iOS too: double tapping a paragraph
  // must never select the neighbouring paragraphs of a native prose batch.
  const displayBlocks = useMemo(() =>
    blocks.map((block, index) => index === blocks.length - 1 ? tail : block), [blocks, tail]);
  const nodes = useMemo(() => {
    const before = drawn.current?.context === context && drawn.current.firstBlock === firstBlock ? drawn.current.blocks : null;
    const last = displayBlocks.length - 1;
    const next = displayBlocks.map((raw, index): DrawnBlock => {
      const open = streaming && index === last;
      const previous = before?.[index];
      if (previous && previous.raw === raw && previous.open === open) return previous;
      return {
        raw,
        open,
        node: (
          <MdBlock key={`b${index}`} id={`b${index}`} raw={raw} open={open} first={firstBlock && index === 0} context={context} />
        ),
      };
    });
    drawn.current = { context, firstBlock, blocks: next };
    return next.map((block) => block.node);
  }, [displayBlocks, streaming, context, firstBlock]);

  // On web the selection bar is DOM and reads the conversation a selection
  // belongs to from the surface it was made in.
  // The element itself carries the scope and its translator (React Native Web
  // hands the DOM node to the ref); the attributes only mark it for `closest`.
  const scope = useContext(SelectionTranslationContext);
  const web = Platform.OS === "web";
  const scopeData = web ? selectionScopeDataSet(scope) : null;
  const surface = metrics.mono ? surfaceProps(selectionSurface, codeSurface) : selectionSurface;
  const bindScope = useCallback((node: View | null) => {
    if (!node || !scope) return;
    bindSelectionScopeElement(node, scope);
    return () => bindSelectionScopeElement(node, null);
  }, [scope]);

  return (
    // The terminal variant sets the whole body in the mono face, so the whole
    // reply is a code surface the host's UI font rule must skip.
    <View
      ref={web && scope ? bindScope : undefined}
      onTouchStart={blockSelection ? dismissBlockSelection : undefined}
      {...(scopeData ? surfaceProps(surface, { dataSet: scopeData } as never) : surface)}
      style={[styles.root, !firstBlock && { paddingTop: listContinuation ? metrics.itemGap : metrics.blockGap }]}
    >
      {nodes}
    </View>
  );
}

interface DrawnBlock {
  raw: string;
  open: boolean;
  node: React.ReactNode;
}

interface DrawnBlocks {
  context: RenderContext;
  firstBlock: boolean;
  blocks: DrawnBlock[];
}
