import React, { useMemo, useRef } from "react";
import { View } from "react-native";
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

export { MARKDOWN_VARIANTS, type MarkdownVariant } from "./render/styles";

export interface MarkdownViewProps {
  text: string;
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

function split(text: string, cache: BlockCache, streaming: boolean): Split {
  const blocks = splitBlocks(text, cache);
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
  tokens,
  variant,
  streaming = false,
  collapseCode = false,
  compact = false,
  quiet = false,
  onRevealPath,
  probeId,
}: MarkdownViewProps) {
  // One cache per message, owned by this component: never shared with
  // another reply that streams at the same time.
  const cacheRef = useRef<BlockCache | null>(null);
  if (cacheRef.current === null) cacheRef.current = createBlockCache();
  const cache = cacheRef.current;
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
    if (!perfOn()) return split(text, cache, streaming);
    let result: Split = { blocks: [], tail: "" };
    probeMarkdown(instance, text, (source) => {
      result = split(source, cache, streaming);
      const last = result.blocks.length - 1;
      const kinds = result.blocks.map((raw, index) => ({
        kind: blockKind(
          index === last ? lexBlock(result.tail, streaming) : lexBlock(raw),
        ),
      }));
      // A tail the repair held back entirely (a lone `#` or `-`) draws
      // nothing; its first real kind is an appearance, not a flip.
      while (kinds.length > 0 && kinds[kinds.length - 1]?.kind === "empty") kinds.pop();
      return kinds;
    });
    return result;
  }, [text, cache, streaming, instance]);

  // Sizes follow the host's content size (S7 §2.3); the metrics object is
  // cached per input, so the context — and every finished block — stays put
  // while the reply streams.
  const metrics = variantMetrics(variant, tokens.typography.content.size, compact, quiet);
  const styles = useMemo(() => buildStyles(tokens, variant, metrics, quiet), [tokens, variant, metrics, quiet]);
  const context = useMemo<RenderContext>(
    () => ({
      styles,
      tokens,
      metrics,
      variant,
      collapseCode,
      onRevealPath,
    }),
    [styles, tokens, metrics, variant, collapseCode, onRevealPath],
  );

  const last = blocks.length - 1;
  return (
    // The terminal variant sets the whole body in the mono face, so the whole
    // reply is a code surface the host's UI font rule must skip.
    <View
      {...(metrics.mono ? surfaceProps(selectionSurface, codeSurface) : selectionSurface)}
      style={styles.root}
    >
      {blocks.map((raw, index) => (
        <MdBlock
          key={`b${index}`}
          id={`b${index}`}
          raw={index === last ? tail : raw}
          open={streaming && index === last}
          first={index === 0}
          context={context}
        />
      ))}
    </View>
  );
}
