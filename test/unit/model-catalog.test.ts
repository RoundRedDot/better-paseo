import { describe, expect, it, vi } from "vitest";
import type { PaseoApi } from "../../server/paseo-types";
import { readModelCatalog } from "../../server/model-catalog";
import { modelSelection } from "../../shared/model-catalog";
import { titleModelsRpc } from "../../shared/title-generation";
import { translationModelsRpc } from "../../shared/timeline-translation";

describe("shared model catalog", () => {
  it("uses the same catalog contract and keeps selectable models in provider order", async () => {
    const listModels = vi.fn(async () => ({ error: null, models: [
      { id: "hidden", label: "Hidden", isSelectable: false },
      { id: "first", label: "First", thinkingOptions: [{ id: "high", label: "High" }, { id: "low", label: "Low" }], defaultThinkingOptionId: "high" },
      { id: "second", label: "Second" },
    ] }));
    const paseo = { providers: { snapshot: async () => ({ entries: [{ provider: "claude", label: "Claude", enabled: true }, { provider: "disabled", enabled: false }] }), listModels } } as unknown as PaseoApi;
    const catalog = await readModelCatalog(paseo, "claude");
    // The translation catalog adds its own fields to the shared contract.
    expect(translationModelsRpc.output.parse(catalog)).toMatchObject(titleModelsRpc.output.parse(catalog));
    expect(catalog.providers).toEqual(["claude"]);
    expect(catalog.models.map((model) => model.id)).toEqual(["first", "second"]);
    expect(modelSelection(catalog.models[0], "high")).toEqual({ model: "first", thinkingOptionId: "high" });
    expect(modelSelection(catalog.models[0], "")).toEqual({ model: "first", thinkingOptionId: "low" });
    expect(modelSelection(catalog.models[0], "ultra")).toEqual({ model: "first", thinkingOptionId: "low" });
    expect(modelSelection(catalog.models[1], "high")).toEqual({ model: "second", thinkingOptionId: "" });
    expect(listModels).toHaveBeenCalledOnce();
  });

  it("reports catalog errors without inventing a model", async () => {
    const paseo = { providers: { snapshot: async () => ({ entries: [{ provider: "claude", enabled: true }] }), listModels: async () => ({ error: "Unavailable", models: null }) } } as unknown as PaseoApi;
    expect(await readModelCatalog(paseo, "claude")).toMatchObject({ models: [], error: "Unavailable" });
  });
});
