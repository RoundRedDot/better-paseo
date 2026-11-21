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

const entries = [
  { provider: "opencode", label: "OpenCode", enabled: true },
  { provider: "deepseek", label: "DeepSeek", enabled: true },
  { provider: "disabled", enabled: false },
];

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
    const paseo = { providers: { snapshot: async () => ({ entries }), listModels } } as unknown as PaseoApi;
    const result = await catalogHandler()({ provider: "deepseek" }, { paseo });
    expect(result).toEqual({
      providers: [], providerLabels: {}, models: [], uncheckedProviders: [], reason: "host_unsupported", limitations: [],
      error: "Translation needs a Paseo version that can generate text with no tools, and this Paseo does not provide it.",
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it("lists only providers the host supports, with the models it can use", async () => {
    const getTextCapability = vi.fn(async (provider: string) => capability(provider, provider === "opencode"));
    const paseo = { providers: { snapshot: async () => ({ entries }), getTextCapability, generateText: vi.fn() } } as unknown as PaseoApi;
    const result = await catalogHandler()({ provider: "opencode" }, { paseo });
    expect(result).toEqual({
      providers: ["opencode"],
      providerLabels: { opencode: "OpenCode" },
      models: [{ id: "mock/mock-model", label: "Mock", thinkingOptions: [{ id: "off", label: "off" }, { id: "high", label: "high" }], defaultThinkingOptionId: null }],
      error: null, reason: null, uncheckedProviders: [], limitations: ["provider_runtime_builtin_hooks_unobserved"],
    });
    // Disabled providers are not probed.
    expect(getTextCapability.mock.calls.map(([provider]) => provider)).toEqual(["opencode", "deepseek"]);
  });

  it("explains a saved provider the host refuses", async () => {
    const paseo = { providers: { snapshot: async () => ({ entries }), generateText: vi.fn(),
      getTextCapability: async (provider: string) => capability(provider, provider === "opencode") } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "deepseek" }, { paseo })).toMatchObject({
      providers: ["opencode"], models: [], error: "deepseek cannot translate with no tools on this Paseo. Choose another provider.",
    });
  });

  it("reports a complete answer with no qualifying provider as no error", async () => {
    const paseo = { providers: { snapshot: async () => ({ entries }), generateText: vi.fn(),
      getTextCapability: async (provider: string) => capability(provider, false, provider === "opencode" ? "isolation_unverified" : "unsupported") } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toEqual({
      providers: [], providerLabels: {}, models: [], error: null, reason: null, uncheckedProviders: [], limitations: [],
    });
  });

  it("keeps the providers that answered when another check fails, and names the failed one", async () => {
    // Regression: one failed check discarded every result and read as "no provider".
    const paseo = { providers: { snapshot: async () => ({ entries }), generateText: vi.fn(),
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
      const partial = { providers: { snapshot: async () => ({ entries }), generateText: vi.fn(),
        getTextCapability: async (provider: string) => provider === "deepseek" ? capability(provider, false, code) : capability(provider, true) } } as unknown as PaseoApi;
      expect(await catalogHandler()({ provider: "opencode" }, { paseo: partial })).toMatchObject({
        providers: ["opencode"], models: [{ id: "mock/mock-model" }], error: null, reason: null, uncheckedProviders: ["deepseek"],
      });
      const none = { providers: { snapshot: async () => ({ entries }), generateText: vi.fn(),
        getTextCapability: async (provider: string) => capability(provider, false, code) } } as unknown as PaseoApi;
      expect(await catalogHandler()({ provider: "" }, { paseo: none })).toMatchObject({
        providers: [], reason: "check_failed", uncheckedProviders: ["opencode", "deepseek"],
      });
    },
  );

  it("says the list could not be checked when every check fails, instead of no provider", async () => {
    const paseo = { providers: { snapshot: async () => ({ entries }), generateText: vi.fn(),
      getTextCapability: async () => { throw new Error("connection lost"); } } } as unknown as PaseoApi;
    expect(await catalogHandler()({ provider: "" }, { paseo })).toMatchObject({
      providers: [], reason: "check_failed", uncheckedProviders: ["opencode", "deepseek"],
      error: expect.stringContaining("could not check opencode, deepseek"),
    });
  });
});
