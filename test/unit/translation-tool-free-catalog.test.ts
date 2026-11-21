import { describe, expect, it, vi } from "vitest";
import { readModelCatalog } from "../../server/model-catalog";
import type { PaseoApi } from "../../server/paseo-types";
import { readToolFreeModelCatalog } from "../../server/translation/tool-free";
import { registerTimelineTranslation } from "../../server/translation/service";
import { translationModelsRpc } from "../../shared/timeline-translation";

const MODELS = [{ id: "m1", label: "Model 1", thinkingOptions: [{ id: "off", label: "Off" }], defaultThinkingOptionId: null }];

function fakePaseo(options: { supportsToolFree?: unknown; entries: Array<Record<string, unknown>> }) {
  const listModels = vi.fn(async () => ({ error: null, models: MODELS }));
  const snapshot = vi.fn(async () => ({ entries: options.entries }));
  const agents = "supportsToolFree" in options ? { supportsToolFree: () => options.supportsToolFree } : {};
  const paseo = { agents, providers: { snapshot, listModels } } as unknown as PaseoApi;
  return { paseo, listModels, snapshot };
}

const ENTRIES = [
  { provider: "claude", label: "Claude", enabled: true, status: "ready", supportsToolFree: true },
  { provider: "codex", label: "Codex", enabled: true, status: "ready" },
  { provider: "opencode", label: "OpenCode", enabled: true, status: "ready", supportsToolFree: false },
  { provider: "custom-claude", label: "Off", enabled: false, status: "ready", supportsToolFree: true },
];

describe("translation model catalog", () => {
  it("lists nothing on a Paseo without tool-free agents, and reads no provider", async () => {
    const { paseo, listModels, snapshot } = fakePaseo({ entries: ENTRIES });
    expect(await readToolFreeModelCatalog(paseo, "claude")).toEqual({
      providers: [], providerLabels: {}, models: [],
      error: expect.stringContaining("needs a Paseo version that runs helper agents with no tools"),
    });
    expect(snapshot).not.toHaveBeenCalled();
    expect(listModels).not.toHaveBeenCalled();
  });

  it.each([false, "true", undefined])("lists nothing when supportsToolFree() answers %j", async (answer) => {
    const { paseo, listModels } = fakePaseo({ supportsToolFree: answer, entries: ENTRIES });
    expect((await readToolFreeModelCatalog(paseo, "")).providers).toEqual([]);
    expect(listModels).not.toHaveBeenCalled();
  });

  it("lists only enabled providers that run tool-free agents", async () => {
    const { paseo, listModels } = fakePaseo({ supportsToolFree: true, entries: ENTRIES });
    expect(await readToolFreeModelCatalog(paseo, "claude")).toEqual({
      providers: ["claude"], providerLabels: { claude: "Claude" }, error: null,
      models: [{ id: "m1", label: "Model 1", thinkingOptions: [{ id: "off", label: "Off" }], defaultThinkingOptionId: null }],
    });
    expect(listModels).toHaveBeenCalledWith("claude");
  });

  it("does not read the models of a saved provider that cannot run tool-free", async () => {
    const { paseo, listModels } = fakePaseo({ supportsToolFree: true, entries: ENTRIES });
    expect(await readToolFreeModelCatalog(paseo, "codex")).toEqual({
      providers: ["claude"], providerLabels: { claude: "Claude" }, models: [],
      error: expect.stringContaining(`"codex" cannot run translation with no tools`),
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it("explains an empty list when no provider runs tool-free agents", async () => {
    const { paseo, listModels } = fakePaseo({ supportsToolFree: true, entries: ENTRIES.filter((entry) => entry.provider !== "claude") });
    expect(await readToolFreeModelCatalog(paseo, "")).toEqual({
      providers: [], providerLabels: {}, models: [], error: expect.stringContaining("No provider on this Paseo"),
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it("leaves the title generation catalog listing every enabled provider", async () => {
    const { paseo } = fakePaseo({ supportsToolFree: true, entries: ENTRIES });
    expect((await readModelCatalog(paseo, "codex")).providers).toEqual(["claude", "codex", "opencode"]);
  });

  it("serves the translation settings' catalog through the tool-free filter", async () => {
    const handlers = new Map<string, (input: unknown, context: { paseo: PaseoApi }) => unknown>();
    const server = {
      registerSettings: () => ({ read: async () => ({ status: "invalid", revision: "r", error: "unused" }) }),
      handle: (contract: { name: string }, handler: (input: unknown, context: { paseo: PaseoApi }) => unknown) => { handlers.set(contract.name, handler); },
    };
    registerTimelineTranslation(server as never, async () => {});
    const handler = handlers.get(translationModelsRpc.name)!;
    const legacy = fakePaseo({ entries: ENTRIES });
    expect(await handler({ provider: "claude" }, { paseo: legacy.paseo })).toMatchObject({ providers: [], models: [] });
    expect(legacy.listModels).not.toHaveBeenCalled();
    const current = fakePaseo({ supportsToolFree: true, entries: ENTRIES });
    expect(await handler({ provider: "" }, { paseo: current.paseo })).toMatchObject({ providers: ["claude"], error: null });
  });
});
