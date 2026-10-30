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

it("keeps catalogs per client and request, retries a failure and drops a catalog nobody shows", async () => {
  const listModels = vi.fn<Parameters<typeof useFooterModel>[0]["providers"]["listModels"]>(async () => catalog);
  const clientA = { providers: { listModels } };
  const clientB = { providers: { listModels } };
  const labels: Record<string, ReturnType<typeof useFooterModel>> = {};
  function Probe({ id, client, cwd }: { id: string; client: typeof clientA; cwd: string }) {
    labels[id] = useFooterModel(client, "codex", "gpt-6.1-sol", "high", cwd);
    return null;
  }
  const tree = (items: Array<{ id: string; client: typeof clientA; cwd: string }>) =>
    React.createElement(React.Fragment, null, ...items.map((item) => React.createElement(Probe, { ...item, key: item.id })));
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(tree([
      { id: "one", client: clientA, cwd: "/workspace" }, { id: "two", client: clientA, cwd: "/workspace" },
      { id: "other-client", client: clientB, cwd: "/workspace" }, { id: "other-cwd", client: clientA, cwd: "/other" },
    ]));
  });
  try {
    expect(listModels).toHaveBeenCalledTimes(3);
    for (const id of ["one", "two", "other-client", "other-cwd"]) expect(labels[id]).toEqual({ modelName: "GPT-6.1-Sol", thinkingLabel: "High" });

    // The last row showing a catalog lets it go: a later row reads it again.
    await act(async () => { renderer.update(tree([{ id: "other-client", client: clientB, cwd: "/workspace" }])); });
    listModels.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { renderer.update(tree([{ id: "other-client", client: clientB, cwd: "/workspace" }, { id: "again", client: clientA, cwd: "/workspace" }])); });
    expect(listModels).toHaveBeenCalledTimes(4);
    expect(labels.again).toEqual({ modelName: null, thinkingLabel: null });
    // A failed read is tried again by the next row to mount.
    await act(async () => { renderer.update(tree([{ id: "other-client", client: clientB, cwd: "/workspace" }, { id: "again", client: clientA, cwd: "/workspace" }, { id: "retry", client: clientA, cwd: "/workspace" }])); });
    expect(listModels).toHaveBeenCalledTimes(5);
    expect(labels.again).toEqual({ modelName: "GPT-6.1-Sol", thinkingLabel: "High" });
    expect(labels.retry).toEqual(labels.again);
  } finally {
    act(() => renderer.unmount());
  }
});
