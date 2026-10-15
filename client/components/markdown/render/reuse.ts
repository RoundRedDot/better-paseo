import type React from "react";

/**
 * What the open tail drew last, by node key, and what this draw keeps for the
 * next one. A streamed chunk lands at the end of the tail: a list item, a
 * quoted paragraph or a table row before it has the same source as last time
 * and keeps its element, so React skips it and a native renderer lays out
 * only the part that grew.
 */
export interface NodeReuse {
  before: ReadonlyMap<string, DrawnNode>;
  next: Map<string, DrawnNode>;
}

interface DrawnNode {
  /** The node's source text and options: differs whenever the node does. */
  source: string;
  /** What it was drawn from besides the render context, worked out once on demand. */
  tokens: () => string;
  node: React.ReactNode;
}

/**
 * The node drawn for `key` last time when it was drawn from the same source
 * and the same tokens, else a new draw. The tokens are compared too: marked
 * reads an unchanged list item differently once a sibling arrives (a task
 * marker lands back in its text). They are serialised only when the sources
 * agree, so the part a chunk changed costs a string compare.
 */
export function reuseNode(
  reuse: NodeReuse | undefined,
  key: string,
  source: string,
  tokens: () => unknown,
  draw: () => React.ReactNode,
): React.ReactNode {
  if (!reuse) return draw();
  const previous = reuse.before.get(key);
  const serialised = once(() => JSON.stringify(tokens()));
  const drawn = previous && previous.source === source && previous.tokens() === serialised()
    ? previous
    : { source, tokens: serialised, node: draw() };
  reuse.next.set(key, drawn);
  return drawn.node;
}

function once(compute: () => string): () => string {
  let value: string | undefined;
  return () => (value ??= compute());
}

const NO_NODES: NodeReuse["before"] = new Map();

/**
 * The reuse for one draw of a component that keeps `drawn` across draws:
 * none unless `open`, and nothing from before when the context changed.
 */
export function nextReuse<Context>(
  drawn: { current: { context: Context; nodes: NodeReuse["next"] } | null },
  context: Context,
  open: boolean,
): NodeReuse | undefined {
  const reuse = open
    ? { before: drawn.current?.context === context ? drawn.current.nodes : NO_NODES, next: new Map() }
    : undefined;
  drawn.current = reuse ? { context, nodes: reuse.next } : null;
  return reuse;
}
