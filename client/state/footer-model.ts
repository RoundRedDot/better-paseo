import { useEffect, useState } from "react";
import type { PaseoApi, PaseoProviderModelsResult } from "@getpaseo/client";

interface FooterModel {
  modelName: string | null;
  thinkingLabel: string | null;
}

// Historical footers mount together. Share their catalog read without retaining
// catalogs after completion or adding a request for every reply on screen.
const catalogReads = new WeakMap<object, Map<string, Promise<PaseoProviderModelsResult>>>();

function readCatalog(providers: Pick<PaseoApi["providers"], "listModels">, provider: string, cwd: string) {
  let reads = catalogReads.get(providers);
  if (!reads) catalogReads.set(providers, reads = new Map());
  const key = JSON.stringify([provider, cwd]);
  const existing = reads.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(() => providers.listModels(provider, { cwd }));
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
  paseo: { providers: Pick<PaseoApi["providers"], "listModels"> },
  provider: string | null,
  modelId: string | null,
  thinkingOptionId: string | null,
  cwd: string | null,
): FooterModel {
  const key = JSON.stringify([provider, modelId, thinkingOptionId, cwd]);
  const [result, setResult] = useState<{ key: string; value: FooterModel } | null>(null);
  useEffect(() => {
    if (!provider || !modelId || cwd === null) return;
    let cancelled = false;
    readCatalog(paseo.providers, provider, cwd).then((catalog) => {
      if (!cancelled) setResult({ key, value: footerModel(catalog, modelId, thinkingOptionId) });
    }).catch(() => {
      if (!cancelled) setResult(null);
    });
    return () => { cancelled = true; };
  }, [paseo, provider, modelId, thinkingOptionId, cwd, key]);
  return result?.key === key ? result.value : { modelName: null, thinkingLabel: null };
}
