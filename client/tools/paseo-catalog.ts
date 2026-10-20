import type { PaseoCatalogData, PaseoCatalogMode } from "../../shared/contracts";
import { readPaseoResult } from "./paseo-result";

export const CATALOG_TOOLS = {
  list_providers: "providers",
  list_models: "models",
  list_profiles: "profiles",
  inspect_provider: "provider",
} as const;

export type CatalogTool = keyof typeof CATALOG_TOOLS;

/** The daemon's provider catalog answers, read into rows; anything unreadable is dropped, not guessed. */
export function readPaseoCatalog(tool: CatalogTool, input: Record<string, unknown>, output: unknown,
  outputText: string | undefined): PaseoCatalogData {
  const result = readPaseoResult(output, outputText);
  const kind = CATALOG_TOOLS[tool];
  const data: PaseoCatalogData = { kind, provider: text(result?.provider) ?? text(input.provider), arguments: input, result: output };
  if (kind === "providers") data.providers = list(result?.providers, readProvider);
  if (kind === "provider") {
    const provider = result ? readProvider(result) : undefined;
    data.providers = provider ? [provider] : undefined;
    data.features = list(result?.features, (feature) => {
      const label = text(feature.label) ?? text(feature.id);
      if (!label) return undefined;
      const value = typeof feature.value === "boolean" ? feature.value ? "on" : "off" : text(feature.value);
      const option = Array.isArray(feature.options) ? feature.options.map(record)
        .find((entry) => entry?.id === feature.value) : undefined;
      return { label, value: text(option?.label) ?? value };
    });
  }
  if (kind === "models") data.models = list(result?.models, (model) => {
    const id = text(model.id);
    if (!id) return undefined;
    const options = list(model.thinkingOptions, (option) => {
      const label = text(option.label) ?? text(option.id);
      return label ? { label, isDefault: option.isDefault === true || option.id === model.defaultThinkingOptionId } : undefined;
    }) ?? [];
    return { id, label: text(model.label) ?? id, description: text(model.description), isDefault: model.isDefault === true,
      thinking: options.map((option) => option.label), defaultThinking: options.find((option) => option.isDefault)?.label };
  });
  if (kind === "profiles") data.profiles = list(result?.profiles, (profile) => {
    const id = text(profile.id);
    const provider = text(profile.provider);
    if (!id || !provider) return undefined;
    return { id, name: text(profile.name) ?? id, icon: text(profile.icon), provider, model: text(profile.model),
      modeId: text(profile.modeId), thinkingOptionId: text(profile.thinkingOptionId), notes: text(profile.notes) };
  });
  return data;
}

function readProvider(provider: Record<string, unknown>) {
  const id = text(provider.id) ?? text(provider.provider);
  if (!id) return undefined;
  return {
    id, label: text(provider.label) ?? id, description: text(provider.description),
    available: provider.status !== undefined ? provider.status === "available" : provider.enabled !== false,
    modes: list(provider.modes, (mode): PaseoCatalogMode | undefined => {
      const modeId = text(mode.id);
      return modeId ? { id: modeId, label: text(mode.label) ?? modeId, description: text(mode.description),
        icon: text(mode.icon), colorTier: text(mode.colorTier) } : undefined;
    }) ?? [],
  };
}

function list<T>(value: unknown, read: (entry: Record<string, unknown>) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    const row = record(entry);
    const item = row ? read(row) : undefined;
    return item === undefined ? [] : [item];
  });
}

function text(value: unknown): string | undefined { return typeof value === "string" && value ? value : undefined; }
function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
