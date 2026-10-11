import React, { memo, useEffect, useRef } from "react";
import { perfCount, perfOn } from "../../../debug/perf";
import { lexBlock } from "../lex";
import { renderBlocks } from "./blocks";
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

  const tokens = lexBlock(raw);
  return <>{renderBlocks(tokens, context, id, { first, open })}</>;
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
