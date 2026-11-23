import { useEffect, useMemo, useSyncExternalStore } from "react";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { homeDirectoryRpc } from "../../shared/file-rpc";

function createStore() {
  let home: string | undefined;
  let pending = false;
  const listeners = new Set<() => void>();
  return {
    get: () => home,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(read: () => Promise<{ home: string }>) {
      if (home !== undefined || pending) return;
      pending = true;
      void read().then((result) => {
        home = result.home;
        for (const listener of listeners) listener();
      }).catch((error: unknown) => console.error("Could not read daemon home directory", error))
        .finally(() => { pending = false; });
    },
  };
}

const stores = new WeakMap<object, ReturnType<typeof createStore>>();

export function useHomeDirectory(): string | undefined {
  const host = usePaseo();
  const read = useRpc(homeDirectoryRpc);
  const store = useMemo(() => {
    let current = stores.get(host);
    if (!current) { current = createStore(); stores.set(host, current); }
    return current;
  }, [host]);
  const home = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => { store.load(() => read({})); }, [store, read]);
  return home;
}
