import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { providerFamilyRpc } from "../../shared/provider-family-rpc";

const builtins = new Set(["claude", "copilot", "opencode", "pi", "omp"]);
const REFRESH_MS = 30_000;
type ReadFamily = (input: { provider: string }) => Promise<{ codex: boolean }>;

export function createProviderFamilyStore() {
  const values = new Map<string, boolean>();
  const pending = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  const watches = new Map<string, { count: number; active: boolean; timer?: ReturnType<typeof setTimeout>; read: ReadFamily }>();
  const listeners = new Set<() => void>();
  return {
    get(provider: string): boolean | undefined { return values.get(provider); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(provider: string, read: ReadFamily, refresh = false): Promise<void> {
      const existing = pending.get(provider);
      if (existing) return existing;
      if (!refresh && values.has(provider)) return Promise.resolve();
      const request = read({ provider }).then((result) => {
        failed.delete(provider);
        if (values.get(provider) !== result.codex) {
          values.set(provider, result.codex);
          for (const listener of listeners) listener();
        }
      }).catch(() => {
        if (!failed.has(provider)) console.error("Could not determine provider family.");
        failed.add(provider);
      }).finally(() => { pending.delete(provider); });
      pending.set(provider, request);
      return request;
    },
    watch(provider: string, read: ReadFamily) {
      let entry = watches.get(provider);
      if (!entry) {
        entry = { count: 0, active: true, read };
        watches.set(provider, entry);
        const current = entry;
        const refresh = (force: boolean) => {
          void this.load(provider, current.read, force).then(() => {
            if (current.active) current.timer = setTimeout(() => refresh(true), REFRESH_MS);
          });
        };
        refresh(false);
      }
      entry.count++;
      entry.read = read;
      const current = entry;
      return () => {
        current.count--;
        if (current.count === 0) {
          current.active = false;
          if (current.timer) clearTimeout(current.timer);
          watches.delete(provider);
        }
      };
    },
  };
}

const stores = new WeakMap<object, ReturnType<typeof createProviderFamilyStore>>();
function storeFor(host: object) {
  let store = stores.get(host);
  if (!store) { store = createProviderFamilyStore(); stores.set(host, store); }
  return store;
}

/** Built-ins resolve immediately; custom provider ancestry is read on the daemon. */
export function useCodexProvider(provider: string | null | undefined): boolean {
  const host = usePaseo();
  const read = useRpc(providerFamilyRpc);
  const store = useMemo(() => storeFor(host), [host]);
  const snapshot = useCallback(() => provider ? store.get(provider) : undefined, [provider, store]);
  const result = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  useEffect(() => {
    if (provider && provider !== "codex" && !builtins.has(provider)) return store.watch(provider, read);
  }, [provider, read, store]);
  return provider === "codex" || result === true;
}
