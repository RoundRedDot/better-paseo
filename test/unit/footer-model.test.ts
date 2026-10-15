import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";
import type { PaseoProviderModelsResult } from "@getpaseo/client";
import { footerModel, useFooterModel } from "../../client/state/footer-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog: PaseoProviderModelsResult = {
  provider: "codex",
  fetchedAt: "2026-10-15T00:00:00Z", requestId: "test",
  models: [{ provider: "codex", id: "gpt-6.1-sol", aliases: ["sol"], label: "GPT-6.1-Sol",
    defaultThinkingOptionId: "medium", thinkingOptions: [
      { id: "medium", label: "Medium", isDefault: true }, { id: "high", label: "High" },
    ] }],
};

describe("footer model metadata", () => {
  it("uses the provider's display labels for the selected model and thinking level", () => {
    expect(footerModel(catalog, "gpt-6.1-sol", "high")).toEqual({ modelName: "GPT-6.1-Sol", thinkingLabel: "High" });
    expect(footerModel(catalog, "sol", "medium")).toEqual({ modelName: "GPT-6.1-Sol", thinkingLabel: "Medium" });
  });
  it("resolves the model's default only when thinking has not been explicitly selected", () => {
    expect(footerModel(catalog, "gpt-6.1-sol", null).thinkingLabel).toBe("Medium");
    expect(footerModel(catalog, "gpt-6.1-sol", "unknown").thinkingLabel).toBeNull();
  });
  it("omits labels absent from the catalog rather than inventing names", () => {
    expect(footerModel(catalog, "missing", "high")).toEqual({ modelName: null, thinkingLabel: null });
    expect(footerModel({ ...catalog, models: undefined }, "gpt-6.1-sol", null).modelName).toBeNull();
  });
});

it("shares the workspace catalog read and applies the latest thinking selection", async () => {
  let finishFirst!: (result: PaseoProviderModelsResult) => void;
  const listModels = vi.fn<Parameters<typeof useFooterModel>[0]["providers"]["listModels"]>()
    .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
  const paseo = { providers: { listModels } };
  let labels!: ReturnType<typeof useFooterModel>;
  function Probe({ level }: { level: string }) {
    labels = useFooterModel(paseo, "codex", "gpt-6.1-sol", level, "/workspace");
    return null;
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { level: "medium" })); });
  try {
    expect(labels.modelName).toBeNull();
    await act(async () => { renderer.update(React.createElement(Probe, { level: "high" })); });
    expect(labels.modelName).toBeNull();
    await act(async () => { finishFirst(catalog); });
    expect(labels.thinkingLabel).toBe("High");
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledWith("codex", { cwd: "/workspace" });
  } finally {
    act(() => renderer.unmount());
  }
});
