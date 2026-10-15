import React, { memo, useEffect, useRef } from "react";
import { perfCount, perfOn } from "../../../debug/perf";
import type { Token } from "../../../vendor/marked";
import { lexBlock } from "../lex";
import { renderBlocks } from "./blocks";
import { nextReuse, type NodeReuse } from "./reuse";
import type { RenderContext } from "./context";

export interface MdBlockProps {
  /** The block's source; for the streaming tail, already repaired. */
  raw: string;
  /** The tail of a reply that is still streaming. */
  open: boolean;
  first: boolean;
  context: RenderContext;
  /** Key prefix for the nodes inside, unique within the message. */
  id: string;
}

/**
 * One block of a message. Memoised on its source, its open state and the
 * render context, so a block that is finished renders once and then never
 * again while the rest of the reply streams in (plan §3.1 item 3).
 */
function MdBlockBody({ raw, open, first, context, id }: MdBlockProps) {
  // Debug only: a block rendering again after it rendered as a finished
  // (non-tail) block is the cost this component exists to remove.
  const finishedBefore = useRef(false);
  if (perfOn()) {
    perfCount("md.blockRender");
    if (finishedBefore.current && !open) perfCount("md.finalRerender");
  }
  useEffect(() => {
    finishedBefore.current = !open;
  });

  const tokens = lexBlock(raw, open);
  // While the block is the open tail, the parts a chunk left alone keep what
  // was drawn for them. A link definition or a footnote changes how text
  // before it reads, so a block holding one is drawn whole every time.
  const drawn = useRef<{ context: RenderContext; nodes: NodeReuse["next"] } | null>(null);
  const reuse = nextReuse(drawn, context, open && !hasReferences(tokens, raw));
  return <>{renderBlocks(tokens, context, id, { first, open, reuse })}</>;
}

/** marked keeps the block's link definitions beside its tokens, wherever they sit. */
function hasReferences(tokens: readonly Token[], raw: string): boolean {
  const links = (tokens as { links?: Record<string, unknown> }).links;
  if (links) for (const _ in links) return true;
  return raw.includes("[^");
}

function sameBlock(prev: MdBlockProps, next: MdBlockProps): boolean {
  return (
    prev.raw === next.raw &&
    prev.open === next.open &&
    prev.first === next.first &&
    prev.context === next.context &&
    prev.id === next.id
  );
}

export const MdBlock = memo(MdBlockBody, sameBlock);
