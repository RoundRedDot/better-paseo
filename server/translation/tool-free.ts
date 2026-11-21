import { readModelCatalog } from "../model-catalog";
import type { PaseoApi } from "../paseo-types";
import type { ModelCatalog } from "../../shared/model-catalog";

/**
 * Translation helpers run with no tools at all, enforced by the host. Text
 * from a conversation reaches a helper only after three pieces of host
 * evidence agree, each read through the public plugin API:
 *
 * 1. `paseo.agents.supportsToolFree()` returns true: the daemon sent
 *    `server_info.features.toolFreeAgents` on the plugin's own connection;
 * 2. the provider's snapshot entry reports `supportsToolFree === true`;
 * 3. the helper the daemon created reports `toolFree === true`.
 *
 * Hosts from before tool-free agents (Paseo 0.16 and older) have no
 * `supportsToolFree()`, and their client parses daemon messages with schemas
 * that strip unknown fields, so the provider and agent fields read as
 * `undefined` there. Anything other than `true` counts as no evidence; there
 * is no fallback to an ordinary agent or to another provider.
 */

/** The SDK surface tool-free agents add; the plugin's SDK types (0.16) predate it. */
interface ToolFreeAgentActions {
  supportsToolFree?: () => unknown;
}

/** Whether this host runs tool-free agents; false on hosts without the method. */
export function hostSupportsToolFree(paseo: PaseoApi): boolean {
  const agents = paseo.agents as PaseoApi["agents"] & ToolFreeAgentActions;
  return typeof agents.supportsToolFree === "function" && agents.supportsToolFree() === true;
}

/** The request's tool policy: no preapproved tools, and no tools at all. */
export function toolFreePolicy(): { preapproved: []; toolFree: true } {
  return { preapproved: [], toolFree: true };
}

const HOST_UNSUPPORTED = "Translation needs a Paseo version that runs helper agents with no tools.";

export function assertToolFreeHost(paseo: PaseoApi): void {
  if (hostSupportsToolFree(paseo)) return;
  throw new Error(`${HOST_UNSUPPORTED} This Paseo does not report that support, so nothing was sent.`);
}

interface ProviderEntry {
  provider: string;
  enabled?: boolean;
  status?: string;
}

/** The provider's ready snapshot entry, which must enforce tool-free agents. */
export function assertToolFreeProvider(entries: readonly ProviderEntry[], provider: string): void {
  const entry = entries.find((candidate) => candidate.provider === provider);
  if (!entry || !entry.enabled || entry.status !== "ready") {
    throw new Error(`Translation provider "${provider}" is unavailable.`);
  }
  if (!supportsToolFree(entry)) {
    throw new Error(
      `Translation provider "${provider}" cannot run with no tools on this Paseo, so nothing was sent. Choose a provider that supports tool-free agents in translation settings.`,
    );
  }
}

function supportsToolFree(entry: ProviderEntry): boolean {
  return (entry as { supportsToolFree?: unknown }).supportsToolFree === true;
}

/**
 * The translation settings' provider and model lists: only providers that
 * run tool-free agents on a host that supports them. Title generation keeps
 * reading `readModelCatalog` itself.
 */
export async function readToolFreeModelCatalog(paseo: PaseoApi, provider: string): Promise<ModelCatalog> {
  const none = { providers: [], providerLabels: {}, models: [] };
  if (!hostSupportsToolFree(paseo)) return { ...none, error: `${HOST_UNSUPPORTED} This Paseo does not report that support.` };
  const snapshot = await paseo.providers.snapshot();
  const supported = new Set(snapshot.entries.filter((entry) => entry.enabled && supportsToolFree(entry)).map((entry) => entry.provider));
  if (supported.size === 0) return { ...none, error: "No provider on this Paseo can run translation with no tools." };
  const catalog = await readModelCatalog(paseo, supported.has(provider) ? provider : "");
  const providers = catalog.providers.filter((id) => supported.has(id));
  const providerLabels = Object.fromEntries(Object.entries(catalog.providerLabels).filter(([id]) => supported.has(id)));
  if (provider && !supported.has(provider)) {
    return { providers, providerLabels, models: [], error: `Provider "${provider}" cannot run translation with no tools. Choose another provider.` };
  }
  return { ...catalog, providers, providerLabels };
}

interface HelperHandle {
  current(): unknown;
}

/** The daemon's own report on the helper it created: tool-free, on the requested provider. */
export function assertToolFreeHelper(helper: HelperHandle, provider: string): void {
  const handle = helper as HelperHandle & { toolFree?: unknown };
  const agent = helper.current() as { toolFree?: unknown; provider?: unknown } | null | undefined;
  if (agent?.toolFree !== true || handle.toolFree !== true) {
    throw new Error(
      "Paseo did not confirm that the translation helper runs with no tools, so nothing was sent.",
    );
  }
  if (agent.provider !== provider) {
    throw new Error(
      `The translation helper started on provider "${String(agent.provider)}" instead of "${provider}", so nothing was sent.`,
    );
  }
}

/**
 * The agent a failed tool-free create left behind: the host created it but
 * did not report it tool-free (`TOOL_FREE_AGENT_UNVERIFIED`). The caller
 * deletes it; it never receives a prompt.
 */
export function unverifiedToolFreeAgentId(error: unknown): string | null {
  const failure = error as { code?: unknown; agentId?: unknown } | null;
  if (failure?.code !== "TOOL_FREE_AGENT_UNVERIFIED") return null;
  return typeof failure.agentId === "string" && failure.agentId ? failure.agentId : null;
}
