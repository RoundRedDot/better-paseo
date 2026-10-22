/**
 * Previewable rows per agent, in timeline order (stub: slice A implements it).
 */
import type { BlockEntry } from "./contracts";

export interface BlockRegistration {
  update(entry: BlockEntry): void;
  /** The row unmounted: keep the entry as a tombstone. */
  release(): void;
}

export function registerBlock(_entry: BlockEntry): BlockRegistration {
  return { update() {}, release() {} };
}

/** Every known block of the agent, ordered; navigable and not alike. */
export function useBlockList(_agentId: string): readonly BlockEntry[] {
  return EMPTY;
}

export function useBlock(_agentId: string, _id: string | null): BlockEntry | null {
  return null;
}

export function getBlock(_agentId: string, _id: string): BlockEntry | null {
  return null;
}

const EMPTY: readonly BlockEntry[] = [];
