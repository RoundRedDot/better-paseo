import { useEffect, useState } from "react";
import type { PaseoApi, PaseoProviderModelsResult } from "@getpaseo/client";
import type { AgentMode } from "@getpaseo/protocol/agent-types";

interface FooterModel {
  modelName: string | null;
  thinkingLabel: string | null;
}

// Historical footers mount together. Share their catalog read without retaining
// catalogs after completion or adding a request for every reply on screen.
const catalogReads = new WeakMap<object, Map<string, Promise<unknown>>>();

type Providers = Pick<PaseoApi["providers"], "listModels" | "listModes">;

// A spawned agent the client has not loaded has no cwd; the provider-wide
// catalog still carries its labels.
function readCatalog<T>(providers: object, kind: string, provider: string, cwd: string | null, read: () => Promise<T>): Promise<T> {
  let reads = catalogReads.get(providers);
  if (!reads) catalogReads.set(providers, reads = new Map());
  const key = JSON.stringify([kind, provider, cwd]);
  const existing = reads.get(key);
  if (existing) return existing as Promise<T>;
  const request = Promise.resolve().then(read);
  reads.set(key, request);
  const clear = () => { if (reads.get(key) === request) reads.delete(key); };
  void request.then(clear, clear);
  return request;
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
  const key = JSON.stringify([provider, modelId, thinkingOptionId, cwd]);
  const [result, setResult] = useState<{ key: string; value: FooterModel } | null>(null);
  useEffect(() => {
    if (!provider || !modelId || (requireCwd && cwd === null)) return;
    let cancelled = false;
    const { providers } = paseo;
    readCatalog(providers, "models", provider, cwd,
      () => providers.listModels(provider, cwd === null ? undefined : { cwd })).then((catalog) => {
      if (!cancelled) setResult({ key, value: footerModel(catalog, modelId, thinkingOptionId) });
    }).catch(() => {
      if (!cancelled) setResult(null);
    });
    return () => { cancelled = true; };
  }, [paseo, provider, modelId, thinkingOptionId, cwd, requireCwd, key]);
  return result?.key === key ? result.value : { modelName: null, thinkingLabel: null };
}

export type ProviderMode = Pick<AgentMode, "label" | "icon" | "colorTier">;

/** The composer's label, icon and colour tier for a permission mode. */
export function useProviderMode(
  paseo: { providers: Pick<Providers, "listModes"> },
  provider: string | null,
  modeId: string | null,
  cwd: string | null,
): ProviderMode | null {
  const key = JSON.stringify([provider, modeId, cwd]);
  const [result, setResult] = useState<{ key: string; value: ProviderMode | null } | null>(null);
  useEffect(() => {
    if (!provider || !modeId) return;
    let cancelled = false;
    const { providers } = paseo;
    readCatalog(providers, "modes", provider, cwd,
      () => providers.listModes(provider, cwd === null ? undefined : { cwd })).then((catalog) => {
      const mode = catalog.modes?.find((entry) => entry.id === modeId);
      if (!cancelled) setResult({ key, value: mode ? { label: mode.label, icon: mode.icon, colorTier: mode.colorTier } : null });
    }).catch(() => {
      if (!cancelled) setResult(null);
    });
    return () => { cancelled = true; };
  }, [paseo, provider, modeId, cwd, key]);
  return result?.key === key ? result.value : null;
}
