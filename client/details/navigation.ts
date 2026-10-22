import type { BlockEntry, BlockKind } from "./contracts";

const KIND_ORDER: Record<BlockKind, number> = {
  thought: 1,
  activity: 2,
  todo: 2,
  tool: 3,
  code: 3,
};

const measuredTops = new WeakMap<BlockEntry, number>();

/** Cache the latest completed asynchronous measurement for synchronous ordering. */
export function rememberBlockMeasurement(entry: BlockEntry, box: { top: number; height: number } | null): void {
  if (box === null || !Number.isFinite(box.top)) measuredTops.delete(entry);
  else measuredTops.set(entry, box.top);
}

export function cachedBlockMeasurement(entry: BlockEntry): number | undefined {
  return measuredTops.get(entry);
}

/** Timeline order, with measured screen position resolving timestamps within one millisecond. */
export function orderBlocks(entries: readonly BlockEntry[]): BlockEntry[] {
  return [...entries].sort((a, b) => {
    const timeDelta = a.at - b.at;
    if (Math.abs(timeDelta) > 1) return timeDelta;

    const aTop = measuredTops.get(a);
    const bTop = measuredTops.get(b);
    if (aTop !== undefined && bTop !== undefined && aTop !== bTop) return aTop - bTop;

    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.seq - b.seq;
  });
}

function navigable(entries: readonly BlockEntry[]): BlockEntry[] {
  return entries.filter((entry) => entry.navigable && entry.hasBody);
}

export function neighbour(list: readonly BlockEntry[], id: string, direction: -1 | 1): BlockEntry | null {
  const entries = navigable(list);
  const index = entries.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  return entries[index + direction] ?? null;
}

/** One-based position among navigable entries; zero means the id is not in that sequence. */
export function indexOf(list: readonly BlockEntry[], id: string): { index: number; count: number } {
  const entries = navigable(list);
  return { index: Math.max(0, entries.findIndex((entry) => entry.id === id) + 1), count: entries.length };
}
