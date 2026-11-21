import { describe, expect, it, vi } from "vitest";
import { registerTimelineTranslation } from "../../server/translation/service";
import type { PaseoApi } from "../../server/paseo-types";
import { translationModelsRpc } from "../../shared/timeline-translation";

function catalogHandler() {
  const handlers = new Map<string, (input: unknown, context: { paseo: PaseoApi }) => unknown>();
  const server = {
    registerSettings: () => ({ read: async () => ({ status: "invalid", revision: "r", error: "unused" }) }),
    handle: (contract: { name: string }, handler: (input: unknown, context: { paseo: PaseoApi }) => unknown) => { handlers.set(contract.name, handler); },
  };
  registerTimelineTranslation(server as never);
  return handlers.get(translationModelsRpc.name)!;
}

/** What the host lists: enabled providers with a route. Disabled ones are not listed. */
const listed = { serverId: "srv-1", providers: [{ provider: "opencode", label: "OpenCode" }, { provider: "deepseek", label: "DeepSeek" }] };
const listTextProviders = async () => listed;
/** Translation must never read the provider snapshot: on a cold catalog it warms every provider. */
const snapshot = () => { throw new Error("Translation must not read providers.snapshot()"); };

function capability(provider: string, supported: boolean, code = "unsupported") {
  return {
    provider, serverId: "srv-1", supported, runtimeVersion: supported ? "2.2.6" : null,
    models: supported ? [{ id: "mock/mock-model", label: "Mock", thinkingOptionIds: ["off", "high"] }] : [],
    limitations: supported ? ["provider_runtime_builtin_hooks_unobserved"] : [], error: supported ? null : { code, message: "refused", promptSent: "no" },
  };
}

describe("translation model catalog", () => {
  it("offers nothing on a host without one-shot text generation, and never reads models another way", async () => {
    const listModels = vi.fn();
    const paseo = { providers: { snapshot, listTextProviders, listModels } } as unknown as PaseoApi;
    const result = await catalogHandler()({ provider: "deepseek" }, { paseo });
    expect(result).toEqual({
      providers: [], providerLabels: {}, models: [], uncheckedProviders: [], reason: "host_unsupported", limitations: [],
      error: "Translation needs a Paseo version that can generate text with no tools, and this Paseo does not provide it.",
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it("offers nothing on a host whose text API predates the provider list that warms nothing", async () => {
    const paseo = { providers: { snapshot, getTextCapability: vi.fn(), generateText: vi.fn() } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toMatchObject({ providers: [], reason: "host_unsupported" });
  });

  it("offers nothing when the SDK refuses the list for a host that does not know it", async () => {
    // Regression: the rejection surfaced as a failed settings read instead of an unsupported host.
    const getTextCapability = vi.fn();
    const refused = Object.assign(new Error("Update the host to list one-shot text generation providers."), { code: "PROVIDER_TEXT_LIST_UNSUPPORTED" });
    const paseo = { providers: { snapshot, getTextCapability, generateText: vi.fn(),
      listTextProviders: async () => { throw refused; } } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toMatchObject({
      providers: [], reason: "host_unsupported",
      error: "Translation needs a Paseo version that can generate text with no tools, and this Paseo does not provide it.",
    });
    expect(getTextCapability).not.toHaveBeenCalled();
  });

  it.each([
    ["a lost connection", Object.assign(new Error("Daemon connection lost"), { code: "DAEMON_CONNECTION_LOST" })],
    ["a timeout", Object.assign(new Error("Daemon request timed out"), { code: "DAEMON_REQUEST_TIMEOUT" })],
    // The message alone says nothing: only the code marks an unsupported host.
    ["an uncoded error that reads like an unsupported host", new Error("Update the host to list one-shot text generation providers.")],
  ])("says the provider list could not be read, not that the host is unsupported, on %s", async (_name, error) => {
    const paseo = { providers: { snapshot, getTextCapability: vi.fn(), generateText: vi.fn(),
      listTextProviders: async () => { throw error; } } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toMatchObject({
      providers: [], reason: "list_failed",
      error: "Paseo could not read this host's providers for translation with no tools. Refresh to try again.",
    });
  });

  it("lists only providers the host supports, with the models it can use", async () => {
    const getTextCapability = vi.fn(async (provider: string) => capability(provider, provider === "opencode"));
    const paseo = { providers: { snapshot, listTextProviders, getTextCapability, generateText: vi.fn() } } as unknown as PaseoApi;
    const result = await catalogHandler()({ provider: "opencode" }, { paseo });
    expect(result).toEqual({
      providers: ["opencode"],
      providerLabels: { opencode: "OpenCode" },
      models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions: [{ id: "off", label: "off" }, { id: "high", label: "high" }], defaultThinkingOptionId: null }],
      error: null, reason: null, uncheckedProviders: [], limitations: ["provider_runtime_builtin_hooks_unobserved"],
    });
    // Only listed providers are probed.
    expect(getTextCapability.mock.calls.map(([provider]) => provider)).toEqual(["opencode", "deepseek"]);
  });

  it("explains a saved provider the host refuses", async () => {
    const paseo = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
      getTextCapability: async (provider: string) => capability(provider, provider === "opencode") } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "deepseek" }, { paseo })).toMatchObject({
      providers: ["opencode"], models: [], error: "deepseek cannot translate with no tools on this Paseo. Choose another provider.",
    });
  });

  it("reports a complete answer with no qualifying provider as no error", async () => {
    const paseo = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
      getTextCapability: async (provider: string) => capability(provider, false, provider === "opencode" ? "isolation_unverified" : "unsupported") } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toEqual({
      providers: [], providerLabels: {}, models: [], error: null, reason: null, uncheckedProviders: [], limitations: [],
    });
  });

  it("keeps the providers that answered when another check fails, and names the failed one", async () => {
    // Regression: one failed check discarded every result and read as "no provider".
    const paseo = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
      getTextCapability: async (provider: string) => {
        if (provider === "deepseek") throw new Error("connection lost");
        return capability(provider, true);
      } } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "opencode" }, { paseo })).toMatchObject({
      providers: ["opencode"], models: [{ id: "mock/mock-model" }], error: null, reason: null, uncheckedProviders: ["deepseek"],
    });
  });

  it.each(["timeout", "generation_failed", "provider_unavailable", "route_unverified", "some_future_code"])(
    "counts a check the host answered as failed (%s) as unchecked, not as no provider",
    async (code) => {
      // Regression: the host reports a capability timeout or internal error as a normal
      // {supported:false,error} answer, which read as "checked, not supported".
      const partial = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
        getTextCapability: async (provider: string) => provider === "deepseek" ? capability(provider, false, code) : capability(provider, true) } } as unknown as PaseoApi;
      expect(await catalogHandler()({ provider: "opencode" }, { paseo: partial })).toMatchObject({
        providers: ["opencode"], models: [{ id: "mock/mock-model" }], error: null, reason: null, uncheckedProviders: ["deepseek"],
      });
      const none = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
        getTextCapability: async (provider: string) => capability(provider, false, code) } } as unknown as PaseoApi;
      expect(await catalogHandler()({ provider: "" }, { paseo: none })).toMatchObject({
        providers: [], reason: "check_failed", uncheckedProviders: ["opencode", "deepseek"],
      });
    },
  );

  it("explains a provider whose gateway is not the one its credential allows", async () => {
    const paseo = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
      getTextCapability: async (provider: string) => capability(provider, provider === "opencode", "remote_server_refused") } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "deepseek" }, { paseo })).toMatchObject({
      providers: ["opencode"], uncheckedProviders: [],
      error: "deepseek is set to send text somewhere its translation credential does not allow, so Paseo will not send it. Choose another provider.",
    });
  });

  it("says the list could not be checked when every check fails, instead of no provider", async () => {
    const paseo = { providers: { snapshot, listTextProviders, generateText: vi.fn(),
      getTextCapability: async () => { throw new Error("connection lost"); } } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toMatchObject({
      providers: [], reason: "check_failed", uncheckedProviders: ["opencode", "deepseek"],
      error: expect.stringContaining("could not check opencode, deepseek"),
    });
  });
});
