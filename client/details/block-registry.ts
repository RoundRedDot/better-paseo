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
