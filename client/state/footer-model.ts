import { useEffect, useState } from "react";
import type { PaseoApi, PaseoProviderModelsResult } from "@getpaseo/client";

interface FooterModel {
  modelName: string | null;
  thinkingLabel: string | null;
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
    paseo.providers.listModels(provider, { cwd }).then((catalog) => {
      if (!cancelled) setResult({ key, value: footerModel(catalog, modelId, thinkingOptionId) });
    }).catch(() => {
      if (!cancelled) setResult(null);
    });
    return () => { cancelled = true; };
  }, [paseo, provider, modelId, thinkingOptionId, cwd, key]);
  return result?.key === key ? result.value : { modelName: null, thinkingLabel: null };
}
