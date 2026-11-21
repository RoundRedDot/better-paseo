import type { PaseoApi } from "../paseo-types";
import type { TranslationCatalog } from "../../shared/timeline-translation";

/**
 * Translation sends text only through the host's one-shot text generation
 * (`paseo.providers.generateText`), which runs one prompt with no agent,
 * session or tools. It runs only when the host reports that the provider
 * supports it (`getTextCapability`); otherwise nothing is sent. There is no
 * fallback to a helper agent or to another provider.
 *
 * The plugin's SDK types (0.16) predate the API, so it is read from the host's
 * object at run time. Hosts without it, or without
 * `features.providerTextGeneration`, refuse.
 */

export interface ProviderTextError {
  code: string;
  message: string;
  promptSent: "no" | "possibly";
}

export interface ProviderTextModel {
  id: string;
  label: string;
  thinkingOptionIds: string[];
}

export interface ProviderTextCapability {
  provider: string;
  serverId: string | null;
  supported: boolean;
  runtimeVersion: string | null;
  models: ProviderTextModel[];
  limitations: string[];
  error: ProviderTextError | null;
}

export type ProviderTextResult =
  | { status: "ok"; text: string; model: string; thinkingOptionId: string | null; runtimeVersion: string }
  | { status: "error"; error: ProviderTextError };

export interface ProviderTextGenerateInput {
  provider: string;
  model: string;
  thinkingOptionId?: string;
  prompt: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderTextApi {
  getTextCapability(provider: string): Promise<ProviderTextCapability>;
  generateText(input: ProviderTextGenerateInput): Promise<{ serverId: string | null; result: ProviderTextResult }>;
}

interface MaybeProviderTextActions {
  getTextCapability?: unknown;
  generateText?: unknown;
}

/** The host's one-shot text API, or null on hosts that do not provide it. */
export function providerTextApi(paseo: PaseoApi): ProviderTextApi | null {
  const providers = paseo.providers as PaseoApi["providers"] & MaybeProviderTextActions;
  if (typeof providers.getTextCapability !== "function" || typeof providers.generateText !== "function") return null;
  return {
    getTextCapability: (provider) => (providers.getTextCapability as ProviderTextApi["getTextCapability"]).call(providers, provider),
    generateText: (input) => (providers.generateText as ProviderTextApi["generateText"]).call(providers, input),
  };
}

export const HOST_UNSUPPORTED =
  "Translation needs a Paseo version that can generate text with no tools. This Paseo does not provide it, so nothing was sent.";

function checkFailed(providers: readonly string[]): string {
  return `Paseo could not check ${providers.join(", ")} for translation with no tools. The list may be incomplete; refresh to try again.`;
}

/** A refusal before anything was sent: the message says so. */
export class TranslationRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationRefusal";
  }
}

function refusalReason(provider: string, error: ProviderTextError | null): string {
  switch (error?.code) {
    case "isolation_unverified":
      return `Paseo cannot run ${provider} for translation without loading your OpenCode plugins, MCP servers or other extensions`;
    case "unsupported":
      return `${provider} cannot translate with no tools on this Paseo`;
    case "version_unsupported":
      return `${provider} runs a version Paseo has not validated for translation with no tools`;
    case "provider_unavailable":
      return `${provider} is unavailable on this Paseo`;
    default:
      return `${provider} cannot translate with no tools right now${error?.message ? ` (${error.message})` : ""}`;
  }
}

/** The provider's capability, or a refusal that says nothing was sent. */
export async function requireTextCapability(api: ProviderTextApi, provider: string): Promise<ProviderTextCapability> {
  let capability: ProviderTextCapability;
  try {
    capability = await api.getTextCapability(provider);
  } catch {
    // The SDK rejects only when the host lacks the feature or the connection; nothing was sent.
    throw new TranslationRefusal(HOST_UNSUPPORTED);
  }
  if (!capability.supported) throw new TranslationRefusal(`${refusalReason(provider, capability.error)}, so nothing was sent.`);
  return capability;
}

/** Describes a failed generation by whether the text may have left the host. */
export function generationFailure(error: ProviderTextError): Error {
  if (error.promptSent === "no") return new TranslationRefusal(`${error.message}. Nothing was sent.`);
  return new Error(`${error.message}. The text may have reached the provider.`);
}

interface SnapshotEntry {
  provider: string;
  label?: string;
  enabled?: boolean;
  status?: string;
}

/** The provider's ready snapshot entry, or a refusal naming why it cannot be used. */
export function requireReadyProvider(entries: readonly SnapshotEntry[], provider: string): void {
  const entry = entries.find((candidate) => candidate.provider === provider);
  if (!entry) throw new TranslationRefusal(`Translation provider "${provider}" is not configured on this Paseo, so nothing was sent.`);
  if (!entry.enabled) throw new TranslationRefusal(`Translation provider "${provider}" is disabled, so nothing was sent.`);
  if (entry.status !== "ready") throw new TranslationRefusal(`Translation provider "${provider}" is not ready (${entry.status ?? "unknown"}), so nothing was sent.`);
}

/**
 * The translation settings' provider and model lists: enabled providers that
 * report one-shot text generation on this host, with the models it can use.
 * Title generation keeps reading `readModelCatalog`.
 */
export async function readTranslationModelCatalog(paseo: PaseoApi, provider: string): Promise<TranslationCatalog> {
  const none = { providers: [], providerLabels: {}, models: [], reason: null, uncheckedProviders: [] };
  const api = providerTextApi(paseo);
  if (!api) return { ...none, error: HOST_UNSUPPORTED, reason: "host_unsupported" };
  const snapshot = await paseo.providers.snapshot();
  const enabled = (snapshot.entries as readonly SnapshotEntry[]).filter((entry) => entry.enabled);
  // Each provider is checked on its own: one failed check neither hides the others nor reads as
  // "no provider qualifies".
  const settled = await Promise.allSettled(enabled.map((entry) => api.getTextCapability(entry.provider)));
  const capabilities: ProviderTextCapability[] = [];
  const unchecked: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") capabilities.push(result.value);
    else unchecked.push(enabled[index]!.provider);
  });
  const supported = capabilities.filter((capability) => capability.supported);
  const providers = supported.map((capability) => capability.provider);
  const providerLabels = Object.fromEntries(
    enabled.flatMap((entry) => entry.label && providers.includes(entry.provider) ? [[entry.provider, entry.label]] : []),
  );
  const partial = { uncheckedProviders: unchecked };
  if (unchecked.length > 0 && supported.length === 0)
    return { ...none, ...partial, error: checkFailed(unchecked), reason: "check_failed" };
  // A complete answer with no qualifying provider is not an error; the settings say so.
  if (supported.length === 0) return { ...none, error: null };
  const selected = supported.find((capability) => capability.provider === provider);
  if (provider && !selected) {
    if (unchecked.includes(provider))
      return { providers, providerLabels, models: [], ...partial, error: checkFailed([provider]), reason: "check_failed" };
    const refused = capabilities.find((capability) => capability.provider === provider);
    return { providers, providerLabels, models: [], ...partial, reason: null, error: `${refusalReason(provider, refused?.error ?? null)}. Choose another provider.` };
  }
  return {
    providers,
    providerLabels,
    models: (selected?.models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
      thinkingOptions: model.thinkingOptionIds.map((id) => ({ id, label: id })),
      defaultThinkingOptionId: null,
    })),
    error: null,
    reason: null,
    ...partial,
  };
}
