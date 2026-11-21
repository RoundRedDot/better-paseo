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

export interface ProviderTextListEntry {
  provider: string;
  label: string;
}

export interface ProviderTextApi {
  /** The providers with a route, from the host's registry: nothing is checked or warmed. */
  listTextProviders(): Promise<{ serverId: string | null; providers: ProviderTextListEntry[] }>;
  getTextCapability(provider: string): Promise<ProviderTextCapability>;
  generateText(input: ProviderTextGenerateInput): Promise<{ serverId: string | null; result: ProviderTextResult }>;
}

interface MaybeProviderTextActions {
  listTextProviders?: unknown;
  getTextCapability?: unknown;
  generateText?: unknown;
}

/** The host's one-shot text API, or null on hosts that do not provide it. */
export function providerTextApi(paseo: PaseoApi): ProviderTextApi | null {
  const providers = paseo.providers as PaseoApi["providers"] & MaybeProviderTextActions;
  // `listTextProviders` came last: a host without it predates the provider list that warms nothing.
  if (typeof providers.listTextProviders !== "function" || typeof providers.getTextCapability !== "function" || typeof providers.generateText !== "function") return null;
  return {
    listTextProviders: () => (providers.listTextProviders as ProviderTextApi["listTextProviders"]).call(providers),
    getTextCapability: (provider) => (providers.getTextCapability as ProviderTextApi["getTextCapability"]).call(providers, provider),
    generateText: (input) => (providers.generateText as ProviderTextApi["generateText"]).call(providers, input),
  };
}

export const HOST_UNSUPPORTED =
  "Translation needs a Paseo version that can generate text with no tools, and this Paseo does not provide it.";

/** Where the text got: said once, by the step that knows. */
export const NOT_SENT = "The text was not sent.";
export const REACHED_HOST_ONLY = "The text reached the plugin on your Paseo host but was not sent to the model.";
export const MAY_HAVE_REACHED_MODEL = "The text may have reached the model service.";

/** The host SDK's code for a host that does not know the provider list request. */
const PROVIDER_TEXT_LIST_UNSUPPORTED = "PROVIDER_TEXT_LIST_UNSUPPORTED";

export const PROVIDER_LIST_FAILED =
  "Paseo could not read this host's providers for translation with no tools. Refresh to try again.";

function checkFailed(providers: readonly string[]): string {
  return `Paseo could not check ${providers.join(", ")} for translation with no tools. The list may be incomplete; refresh to try again.`;
}

/** A refusal before the text was sent to the model; the caller says where the text got. */
export class TranslationRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationRefusal";
  }
}

function refusalReason(provider: string, error: ProviderTextError | null): string {
  switch (error?.code) {
    case "isolation_unverified":
      return `Paseo cannot run ${provider} for translation without loading your OpenCode plugins, MCP servers or other extensions.`;
    case "unsupported":
      return `${provider} cannot translate with no tools on this Paseo.`;
    case "remote_server_refused":
      return `${provider} is set to send text somewhere its translation credential does not allow, so Paseo will not send it.`;
    case "version_unsupported":
      return `${provider} runs a version Paseo has not validated for translation with no tools.`;
    case "provider_unavailable":
      return `${provider} is unavailable on this Paseo.`;
    default:
      return `${provider} cannot translate with no tools right now${error?.message ? ` (${error.message})` : ""}.`;
  }
}

/**
 * Codes that say the provider cannot do this here, as opposed to a check that could not finish.
 * `route_unverified` is not one: the host also uses it for a runtime that was not ready in time.
 */
const DEFINITE_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "unsupported",
  "isolation_unverified",
  "version_unsupported",
  "remote_server_refused",
]);

function isDefiniteRefusal(error: ProviderTextError | null): boolean {
  return error !== null && DEFINITE_REFUSAL_CODES.has(error.code);
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
  if (!capability.supported) throw new TranslationRefusal(refusalReason(provider, capability.error));
  return capability;
}

/** Describes a failed generation by whether the text may have left the host. */
export function generationFailure(error: ProviderTextError): Error {
  // The host held the text but did not send it on.
  if (error.promptSent === "no") return new Error(`${error.message}. ${REACHED_HOST_ONLY}`);
  return new Error(`${error.message}. ${MAY_HAVE_REACHED_MODEL}`);
}

/**
 * The translation settings' provider and model lists: enabled providers that
 * report one-shot text generation on this host, with the models it can use.
 * Title generation keeps reading `readModelCatalog`.
 */
export async function readTranslationModelCatalog(paseo: PaseoApi, provider: string): Promise<TranslationCatalog> {
  const none = { providers: [], providerLabels: {}, models: [], reason: null, uncheckedProviders: [], limitations: [] };
  const api = providerTextApi(paseo);
  if (!api) return { ...none, error: HOST_UNSUPPORTED, reason: "host_unsupported" };
  // Never `providers.snapshot()`: on a cold catalog it warms every enabled provider, which can
  // start an unrelated OpenCode runtime with the user's plugins and MCP servers.
  let enabled: ProviderTextListEntry[];
  try {
    enabled = (await api.listTextProviders()).providers;
  } catch (error) {
    // Only the SDK's own code says the host lacks the request; a lost connection or a timeout is
    // a read that can be retried. Either way nothing was sent.
    if ((error as { code?: unknown } | null)?.code === PROVIDER_TEXT_LIST_UNSUPPORTED)
      return { ...none, error: HOST_UNSUPPORTED, reason: "host_unsupported" };
    return { ...none, error: PROVIDER_LIST_FAILED, reason: "list_failed" };
  }
  // Each provider is checked on its own: one failed check neither hides the others nor reads as
  // "no provider qualifies".
  const settled = await Promise.allSettled(enabled.map((entry) => api.getTextCapability(entry.provider)));
  const capabilities: ProviderTextCapability[] = [];
  const unchecked: string[] = [];
  settled.forEach((result, index) => {
    // The host also answers a check that timed out or failed as {supported:false}; only a
    // definite refusal counts as checked.
    if (result.status === "fulfilled" && (result.value.supported || isDefiniteRefusal(result.value.error)))
      capabilities.push(result.value);
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
      return { providers, providerLabels, models: [], ...partial, limitations: [], error: checkFailed([provider]), reason: "check_failed" };
    const refused = capabilities.find((capability) => capability.provider === provider);
    return { providers, providerLabels, models: [], ...partial, limitations: [], reason: null, error: `${refusalReason(provider, refused?.error ?? null)} Choose another provider.` };
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
    limitations: selected?.limitations ?? [],
    ...partial,
  };
}
