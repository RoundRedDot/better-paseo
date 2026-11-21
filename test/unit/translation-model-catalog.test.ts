import { describe, expect, it, vi } from "vitest";
import { registerTimelineTranslation } from "../../server/translation/service";
import type { PaseoApi } from "../../server/paseo-types";
import { translationModelsRpc } from "../../shared/timeline-translation";

describe("translation model catalog", () => {
  it("lists enabled providers and their models on a host without a tool-free API", async () => {
    const handlers = new Map<string, (input: unknown, context: { paseo: PaseoApi }) => unknown>();
    const server = {
      registerSettings: () => ({ read: async () => ({ status: "invalid", revision: "r", error: "unused" }) }),
      handle: (contract: { name: string }, handler: (input: unknown, context: { paseo: PaseoApi }) => unknown) => { handlers.set(contract.name, handler); },
    };
    registerTimelineTranslation(server as never, async () => {});
    const listModels = vi.fn(async () => ({ error: null, models: [{ id: "m1", label: "Model 1" }] }));
    const paseo = { providers: {
      snapshot: async () => ({ entries: [
        { provider: "deepseek", label: "DeepSeek", enabled: true },
        { provider: "disabled", enabled: false },
      ] }),
      listModels,
    } } as unknown as PaseoApi;
    const result = await handlers.get(translationModelsRpc.name)!({ provider: "deepseek" }, { paseo });
    expect(result).toMatchObject({ providers: ["deepseek"], models: [{ id: "m1" }], error: null });
    expect(listModels).toHaveBeenCalledWith("deepseek");
  });
});
