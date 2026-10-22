import { useCallback, useSyncExternalStore } from "react";
import type { BlockEntry } from "./contracts";
import { cachedBlockMeasurement, orderBlocks, rememberBlockMeasurement } from "./navigation";

export const BLOCK_REGISTRY_LIMIT = 500;

export interface BlockRegistration {
  update(entry: BlockEntry): void;
  /** The row unmounted: keep the entry as a tombstone. */
  release(): void;
}

interface StoredBlock {
  entry: BlockEntry;
  owners: Set<object>;
  age: number;
}

interface AgentRegistry {
  entries: Map<string, StoredBlock>;
  list: readonly BlockEntry[];
  listListeners: Set<() => void>;
  entryListeners: Map<string, Set<() => void>>;
}

const registries = new Map<string, AgentRegistry>();
const EMPTY: readonly BlockEntry[] = [];
let sequence = 0;

function registryFor(agentId: string): AgentRegistry {
  let registry = registries.get(agentId);
  if (!registry) {
    registry = { entries: new Map(), list: EMPTY, listListeners: new Set(), entryListeners: new Map() };
    registries.set(agentId, registry);
  }
  return registry;
}

function notify(listeners: Set<() => void> | undefined): void {
  listeners?.forEach((listener) => listener());
}

function publish(registry: AgentRegistry, changedIds: readonly string[]): void {
  registry.list = orderBlocks(Array.from(registry.entries.values(), (record) => record.entry));
  notify(registry.listListeners);
  changedIds.forEach((id) => notify(registry.entryListeners.get(id)));
}

function sameEntry(a: BlockEntry, b: BlockEntry): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as (keyof BlockEntry)[];
  const bKeys = Object.keys(b) as (keyof BlockEntry)[];
  return aKeys.length === bKeys.length && aKeys.every((key) => Object.is(a[key], b[key]));
}

function preserveMeasurement(previous: BlockEntry, next: BlockEntry): void {
  const top = cachedBlockMeasurement(previous);
  if (top !== undefined) rememberBlockMeasurement(next, { top, height: 0 });
}

function pruneOldTombstones(registry: AgentRegistry): string[] {
  const removed: string[] = [];
  while (registry.entries.size > BLOCK_REGISTRY_LIMIT) {
    const oldest = Array.from(registry.entries.entries())
      .filter(([, record]) => record.owners.size === 0)
      .sort((a, b) => a[1].age - b[1].age)[0];
    if (!oldest) break;
    registry.entries.delete(oldest[0]);
    removed.push(oldest[0]);
  }
  return removed;
}

/** Register one mounted row. Repeated registrations of the same id share one list entry. */
export function registerBlock(entry: BlockEntry): BlockRegistration {
  const registry = registryFor(entry.agentId);
  const owner = {};
  const previous = registry.entries.get(entry.id);
  const mountedEntry = { ...entry, mounted: true };
  if (previous) {
    // A tombstone mounting again: its row is back on screen and can be placed.
    if (previous.owners.size === 0) scheduleOrderMeasure(entry.agentId);
    previous.owners.add(owner);
    if (!sameEntry(previous.entry, mountedEntry)) {
      preserveMeasurement(previous.entry, mountedEntry);
      previous.entry = mountedEntry;
      const removed = pruneOldTombstones(registry);
      publish(registry, [entry.id, ...removed]);
    }
  } else {
    registry.entries.set(entry.id, { entry: mountedEntry, owners: new Set([owner]), age: sequence++ });
    const removed = pruneOldTombstones(registry);
    publish(registry, [entry.id, ...removed]);
    scheduleOrderMeasure(entry.agentId);
  }

  let active = true;
  return {
    update(next) {
      if (!active || next.agentId !== entry.agentId || next.id !== entry.id) return;
      const record = registry.entries.get(entry.id);
      if (!record || !record.owners.has(owner)) return;
      const updated = { ...next, mounted: true };
      if (sameEntry(record.entry, updated)) return;
      preserveMeasurement(record.entry, updated);
      record.entry = updated;
      publish(registry, [entry.id]);
    },
    release() {
      if (!active) return;
      active = false;
      const record = registry.entries.get(entry.id);
      if (!record || !record.owners.delete(owner) || record.owners.size > 0) return;
      const tombstone = { ...record.entry, mounted: false };
      preserveMeasurement(record.entry, tombstone);
      record.entry = tombstone;
      record.age = sequence++;
      const pruned = pruneOldTombstones(registry);
      publish(registry, [entry.id, ...pruned]);
    },
  };
}

export function getBlockList(agentId: string): readonly BlockEntry[] {
  return registries.get(agentId)?.list ?? EMPTY;
}

export function getBlock(agentId: string, id: string): BlockEntry | null {
  return registries.get(agentId)?.entries.get(id)?.entry ?? null;
}

/** Resolve one mounted row's asynchronous measurement and refresh list ordering. */
export async function measureBlockForOrder(agentId: string, id: string): Promise<void> {
  const registry = registries.get(agentId);
  const entry = getBlock(agentId, id);
  if (!registry || !entry?.mounted || !entry.measure) return;
  const box = await entry.measure();
  if (getBlock(agentId, id) !== entry) return;
  rememberBlockMeasurement(entry, box);
  registry.list = orderBlocks(Array.from(registry.entries.values(), (record) => record.entry));
  notify(registry.listListeners);
}

/**
 * Rows sharing a timestamp (a replayed history, a burst of calls in one
 * millisecond) are ordered by where they sit on screen. Registration order
 * cannot stand in for it: the native list is inverted, so its rows mount
 * newest first and a tie would read backwards there.
 *
 * Positions are only comparable within one moment of one list, so every
 * mounted row of a tie is measured together, and each top is moved into the
 * list's content coordinates by the list's scroll position at that moment
 * (`orderShift`). That keeps a row measured now comparable with a tombstone
 * measured before a scroll. The shell lends the shift while a panel is open,
 * which is when the order is shown and stepped through; without it nothing
 * is measured and the order stays as it was.
 */
const orderShifts = new Map<string, () => number | null>();
const orderTimers = new Map<string, ReturnType<typeof setTimeout>>();
const orderRunning = new Map<string, boolean>();
/** Registrations arrive a row at a time while a list mounts: one measure for the lot. */
export const ORDER_MEASURE_MS = 120;

/** The host list's scroll position, for the order's measurements; null when the list is gone. */
export function setOrderShift(agentId: string, shift: (() => number | null) | null): void {
  if (!shift) {
    orderShifts.delete(agentId);
    const timer = orderTimers.get(agentId);
    if (timer !== undefined) clearTimeout(timer);
    orderTimers.delete(agentId);
    return;
  }
  orderShifts.set(agentId, shift);
  void measureBlocksForOrder(agentId);
}

function scheduleOrderMeasure(agentId: string): void {
  if (!orderShifts.has(agentId) || orderTimers.has(agentId)) return;
  orderTimers.set(agentId, setTimeout(() => {
    orderTimers.delete(agentId);
    void measureBlocksForOrder(agentId);
  }, ORDER_MEASURE_MS));
}

/** The mounted rows whose timestamp ties with another known row's. */
function tiedMounted(registry: AgentRegistry): BlockEntry[] {
  const all = Array.from(registry.entries.values(), (record) => record.entry).sort((a, b) => a.at - b.at);
  return all.filter((entry, index) => entry.mounted && entry.measure !== undefined && (
    (index > 0 && entry.at - all[index - 1]!.at <= 1) ||
    (index < all.length - 1 && all[index + 1]!.at - entry.at <= 1)
  ));
}

/** Measures every tied mounted row of the agent in one go and orders the list by it. */
export async function measureBlocksForOrder(agentId: string): Promise<void> {
  const registry = registries.get(agentId);
  const shift = orderShifts.get(agentId);
  if (!registry || !shift) return;
  if (orderRunning.get(agentId)) {
    scheduleOrderMeasure(agentId);
    return;
  }
  const tied = tiedMounted(registry);
  if (tied.length === 0) return;
  orderRunning.set(agentId, true);
  try {
    const boxes = await Promise.all(tied.map((entry) => entry.measure!().catch(() => null)));
    const offset = shift();
    if (offset === null || orderShifts.get(agentId) !== shift) return;
    let changed = false;
    tied.forEach((entry, index) => {
      const box = boxes[index];
      // The row may have rendered (a new entry object) while it was measured.
      const current = getBlock(agentId, entry.id);
      if (!box || box.height <= 0 || !current?.mounted) return;
      const top = Math.round(box.top + offset);
      if (cachedBlockMeasurement(current) === top) return;
      rememberBlockMeasurement(current, { top, height: box.height });
      changed = true;
    });
    if (!changed) return;
    registry.list = orderBlocks(Array.from(registry.entries.values(), (record) => record.entry));
    notify(registry.listListeners);
  } finally {
    orderRunning.set(agentId, false);
  }
}

function subscribeList(agentId: string, listener: () => void): () => void {
  const listeners = registryFor(agentId).listListeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function subscribeEntry(agentId: string, id: string | null, listener: () => void): () => void {
  if (id === null) return () => {};
  const registry = registryFor(agentId);
  let listeners = registry.entryListeners.get(id);
  if (!listeners) {
    listeners = new Set();
    registry.entryListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) registry.entryListeners.delete(id);
  };
}

/** Every known block for an agent, in stable timeline order. */
export function useBlockList(agentId: string): readonly BlockEntry[] {
  const subscribe = useCallback((listener: () => void) => subscribeList(agentId, listener), [agentId]);
  const snapshot = useCallback(() => getBlockList(agentId), [agentId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** A selector subscription: only the requested entry changing rerenders its row. */
export function useBlock(agentId: string, id: string | null): BlockEntry | null {
  const subscribe = useCallback((listener: () => void) => subscribeEntry(agentId, id, listener), [agentId, id]);
  const snapshot = useCallback(() => id === null ? null : getBlock(agentId, id), [agentId, id]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
