import type { PaseoApi } from "./paseo-types";

export async function readModelCatalog(paseo: PaseoApi, provider: string) {
  const snapshot = await paseo.providers.snapshot();
  const enabled = snapshot.entries.filter((entry) => entry.enabled);
  const providers = enabled.map((entry) => entry.provider);
  const providerLabels = Object.fromEntries(enabled.flatMap((entry) => entry.label ? [[entry.provider, entry.label]] : []));
  if (!provider) return { providers, providerLabels, models: [], error: null };
  const result = await paseo.providers.listModels(provider);
  if (result.error || !result.models) return { providers, providerLabels, models: [], error: result.error || "The provider did not return a model catalog." };
  return {
    providers, providerLabels,
    models: result.models.filter((model) => model.isSelectable !== false).map((model) => ({
      id: model.id, label: model.label,
      thinkingOptions: (model.thinkingOptions ?? []).map(({ id, label }) => ({ id, label })),
      defaultThinkingOptionId: model.defaultThinkingOptionId ?? null,
    })),
    error: result.error ?? null,
  };
}
