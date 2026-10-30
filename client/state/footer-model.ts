import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { PaseoApi, PaseoProviderModelsResult } from "@getpaseo/client";
import type { AgentMode } from "@getpaseo/protocol/agent-types";

interface FooterModel {
  modelName: string | null;
  thinkingLabel: string | null;
}

type Providers = Pick<PaseoApi["providers"], "listModels" | "listModes">;

/** A catalog read: loading, ready with its result, or failed. */
type CatalogRead<T> = { status: "loading" } | { status: "ready"; catalog: T } | { status: "failed" };

/**
 * Historical footers mount together. They share one catalog read per client,
 * kind, provider and cwd, and every row shows its result in the same commit.
 * A catalog is kept while some row shows it and dropped with the last one, so
 * the store holds no catalog nobody reads. A failed read is tried again by the
 * next row that mounts.
 */
export function createCatalogStore() {
  const reads = new Map<string, CatalogRead<unknown>>();
  const holders = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => { for (const listener of listeners.get(key) ?? []) listener(); };
  return {
    get: (key: string) => reads.get(key) ?? null,
    subscribe(key: string, listener: () => void) {
      let set = listeners.get(key);
      if (!set) listeners.set(key, set = new Set());
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
    // A spawned agent the client has not loaded has no cwd; the provider-wide
    // catalog still carries its labels.
    retain(key: string, read: () => Promise<unknown>) {
      holders.set(key, (holders.get(key) ?? 0) + 1);
      const current = reads.get(key);
      if (!current || current.status === "failed") {
        const loading: CatalogRead<unknown> = { status: "loading" };
        reads.set(key, loading);
        notify(key);
        void Promise.resolve().then(read).then(
          (catalog) => ({ status: "ready", catalog }) as const,
          () => ({ status: "failed" }) as const,
        ).then((next) => {
          if (reads.get(key) !== loading) return;
          reads.set(key, next);
          notify(key);
        });
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (holders.get(key) ?? 1) - 1;
        if (count > 0) { holders.set(key, count); return; }
        holders.delete(key);
        reads.delete(key);
        notify(key);
      };
    },
  };
}

const catalogStores = new WeakMap<object, ReturnType<typeof createCatalogStore>>();

function catalogStore(providers: object) {
  let store = catalogStores.get(providers);
  if (!store) catalogStores.set(providers, store = createCatalogStore());
  return store;
}

/** The catalog of one kind for a provider and cwd, or null while loading, failed or not asked for. */
function useCatalog<T>(providers: object, kind: string, provider: string | null, cwd: string | null, enabled: boolean,
  read: () => Promise<T>): T | null {
  const store = catalogStore(providers);
  const key = enabled && provider ? JSON.stringify([kind, provider, cwd]) : null;
  const latestRead = useRef(read);
  latestRead.current = read;
  useEffect(() => (key === null ? undefined : store.retain(key, () => latestRead.current())), [store, key]);
  const subscribe = useCallback((listener: () => void) => (key === null ? () => {} : store.subscribe(key, listener)), [store, key]);
  const get = useCallback(() => {
    const current = key === null ? null : store.get(key);
    return current?.status === "ready" ? current.catalog as T : null;
  }, [store, key]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Use the same provider labels and default thinking option as the model picker. */
export function footerModel(
  catalog: PaseoProviderModelsResult,
  modelId: string,
  thinkingOptionId: string | null,
): FooterModel {
  const model = catalog.models?.find((entry) => entry.id === modelId || entry.aliases?.includes(modelId));
  const optionId = thinkingOptionId ?? model?.defaultThinkingOptionId;
  const thinking = optionId
    ? model?.thinkingOptions?.find((entry) => entry.id === optionId)
    : model?.thinkingOptions?.find((entry) => entry.isDefault);
  return { modelName: model?.label ?? null, thinkingLabel: thinking?.label ?? null };
}

export function useFooterModel(
  paseo: { providers: Pick<Providers, "listModels"> },
  provider: string | null,
  modelId: string | null,
  thinkingOptionId: string | null,
  cwd: string | null,
  { requireCwd = true }: { requireCwd?: boolean } = {},
): FooterModel {
  const { providers } = paseo;
  const catalog = useCatalog(providers, "models", provider, cwd, !!modelId && (!requireCwd || cwd !== null),
    () => providers.listModels(provider!, cwd === null ? undefined : { cwd }));
  const labels = catalog && modelId ? footerModel(catalog, modelId, thinkingOptionId) : null;
  const modelName = labels?.modelName ?? null;
  const thinkingLabel = labels?.thinkingLabel ?? null;
  return useMemo(() => ({ modelName, thinkingLabel }), [modelName, thinkingLabel]);
}

export type ProviderMode = Pick<AgentMode, "label" | "icon" | "colorTier">;

/** The composer's label, icon and colour tier for a permission mode. */
export function useProviderMode(
  paseo: { providers: Pick<Providers, "listModes"> },
  provider: string | null,
  modeId: string | null,
  cwd: string | null,
): ProviderMode | null {
  const { providers } = paseo;
  const catalog = useCatalog(providers, "modes", provider, cwd, !!modeId,
    () => providers.listModes(provider!, cwd === null ? undefined : { cwd }));
  const mode = catalog?.modes?.find((entry) => entry.id === modeId);
  return useMemo(() => (mode ? { label: mode.label, icon: mode.icon, colorTier: mode.colorTier } : null),
    [mode?.label, mode?.icon, mode?.colorTier]);
}
