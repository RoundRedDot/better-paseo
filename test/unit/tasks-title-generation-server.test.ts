import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTitleGenerator, registerTitleGeneration } from "../../server/tasks/title-generation";
import { titleGenerationSettingsSchema, titleModelsRpc } from "../../shared/title-generation";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "title-generation-"));
  directories.push(directory);
  const run = vi.fn(async (_prompt: string, _options: { timeoutMs: number }) => ({ status: "idle", lastMessage: "Updated 中文 title", error: null }));
  const archive = vi.fn(async () => ({ error: null as string | null }));
  const live = { handler: null as ((event: unknown) => void) | null, unsubscribe: vi.fn() };
  const subscribe = vi.fn((handler: (event: unknown) => void) => {
    live.handler = handler;
    return Object.assign(live.unsubscribe, { ready: Promise.resolve() });
  });
  const create = vi.fn(async () => ({ id: "helper", run, timeline: { subscribe } }));
  const workspace = vi.fn(async () => ({ agents: { create }, archive }));
  const original = { agent: { title: "Original", workspaceId: "source-ws", archivedAt: null as string | null,
    provider: "codex", model: "gpt-5.5" as string | null, thinkingOptionId: "high" as string | null, effectiveThinkingOptionId: "xhigh" as string | null } };
  const refresh = vi.fn(async () => original);
  const timeline = vi.fn(async (_options: { direction: string; cursor?: { epoch: string; seq: number } }) => ({
    error: null,
    hasNewer: false,
    endCursor: null as { epoch: string; seq: number } | null,
    entries: [
      { item: { type: "user_message", text: "Fix the card title" } },
      { item: { type: "assistant_message", text: "Diagnosed the warning" } },
      { item: { type: "tool_call", text: "PRIVATE_TOOL_OUTPUT" } },
      { item: { type: "user_message", text: "Now change the settings" } },
      { item: { type: "assistant_message", text: "Updated the settings" } },
    ],
  }));
  const api = { agents: { ref: vi.fn(() => ({ refresh, timeline: { refetch: timeline } })) }, workspaces: { create: workspace, ref: () => ({ refresh: async () => ({ projectId: "source-project" }) }) } } as unknown as PaseoApi;
  const values = titleGenerationSettingsSchema.parse({ customModel: true, provider: "claude", model: "claude-haiku-5-5", prompt: "Use an actionable title" });
  const read = vi.fn(async () => ({ status: "ready" as const, revision: "1", values }));
  const rename = vi.fn(async () => ({ ok: true, error: null as string | null }));
  const canRename = vi.fn(() => true);
  const service = createTitleGenerator({ settings: { read, subscribe: () => () => {} }, rename, directory, canRename });
  const state = () => service.request({ agentId: "source", action: "status" }, api);
  const start = () => service.request({ agentId: "source", action: "start" }, api);
  const settle = async () => { await expect.poll(() => state().state).not.toBe("running"); return state(); };
  return { api, service, directory, run, archive, create, live, subscribe, workspace, original, refresh, timeline, values, read, rename, canRename, state, start, settle };
}

describe("background title generation", () => {
  it("defaults existing settings to following the card agent", () => {
    expect(titleGenerationSettingsSchema.parse({ provider: "claude", model: "haiku" }).customModel).toBe(false);
  });

  it.each(["xhigh", null])("follows the source provider, model and thinking level (effective: %s)", async (effectiveThinkingOptionId) => {
    const f = await fixture();
    f.values.customModel = false;
    f.values.provider = "";
    f.values.model = "";
    f.values.thinkingOptionId = "off";
    f.original.agent.effectiveThinkingOptionId = effectiveThinkingOptionId;
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ config: {
      provider: "codex/gpt-5.5", thinkingOptionId: effectiveThinkingOptionId ?? "high", systemPrompt: expect.any(String),
    } }));
  });

  it("uses the source model default when its thinking level is unset", async () => {
    const f = await fixture();
    f.values.customModel = false;
    f.original.agent.thinkingOptionId = null;
    f.original.agent.effectiveThinkingOptionId = null;
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ config: { provider: "codex/gpt-5.5", systemPrompt: expect.any(String) } }));
  });

  it("reports a missing source model without substituting custom settings", async () => {
    const f = await fixture();
    f.values.customModel = false;
    f.original.agent.model = null;
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("no model") });
    expect(f.workspace).not.toHaveBeenCalled();
  });

  it("exposes each selectable model's thinking options and default in the settings catalog", async () => {
    const handle = vi.fn();
    registerTitleGeneration({ registerSettings: vi.fn(), handle } as unknown as Parameters<typeof registerTitleGeneration>[0], vi.fn(), () => true);
    const models = handle.mock.calls.find(([contract]) => contract.name === titleModelsRpc.name)![1];
    const paseo = { providers: {
      snapshot: async () => ({ entries: [{ provider: "claude", enabled: true }, { provider: "cursor", enabled: false }] }),
      listModels: async () => ({ error: null, models: [
        { id: "haiku", label: "Haiku", thinkingOptions: [{ id: "off", label: "Off", description: "No thinking" }], defaultThinkingOptionId: "off" },
        { id: "old", label: "Old" },
        { id: "hidden", label: "Hidden", isSelectable: false },
      ] }),
    } };
    expect(await models({ provider: "claude" }, { paseo })).toEqual({ providers: ["claude"], models: [
      { id: "haiku", label: "Haiku", thinkingOptions: [{ id: "off", label: "Off" }], defaultThinkingOptionId: "off" },
      { id: "old", label: "Old", thinkingOptions: [], defaultThinkingOptionId: null },
    ], error: null });
  });

  it("keeps existing settings on the model default and forwards an explicitly selected thinking level", async () => {
    const f = await fixture();
    expect(f.values.thinkingOptionId).toBe("");
    f.values.thinkingOptionId = "off";
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ thinkingOptionId: "off" }) }));
  });

  it("returns immediately, deduplicates starts, uses the configured model and updates only after cleanup", async () => {
    const f = await fixture();
    expect(f.state()).toEqual({ state: "idle" });
    expect(f.start()).toEqual({ state: "running" });
    expect(f.start()).toEqual({ state: "running" });
    expect(await f.settle()).toEqual({ state: "done", title: "Updated 中文 title" });
    expect(f.workspace).toHaveBeenCalledExactlyOnceWith({ source: { kind: "directory", path: f.directory, projectId: "source-project" }, background: true, title: "Title generation" });
    expect(f.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ config: { provider: "claude/claude-haiku-5-5", systemPrompt: expect.stringContaining("Do not use tools") } }));
    expect(f.run.mock.calls[0]).toEqual([expect.stringContaining("Use an actionable title"), { timeoutMs: 60_000 }]);
    expect(f.run.mock.calls[0]?.[0]).toContain("Fix the card title");
    expect(f.run.mock.calls[0]?.[0]).not.toContain("PRIVATE_TOOL_OUTPUT");
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.archive.mock.invocationCallOrder[0]).toBeLessThan(f.rename.mock.invocationCallOrder[0]!);
    expect(f.rename).toHaveBeenCalledExactlyOnceWith("source", "Updated 中文 title");
  });

  it("uses the opening messages in order and excludes tool calls", async () => {
    const f = await fixture();
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages: [
      { role: "user_message", text: "Fix the card title" },
      { role: "assistant_message", text: "Diagnosed the warning" },
      { role: "user_message", text: "Now change the settings" },
      { role: "assistant_message", text: "Updated the settings" },
    ] })}`);
    expect(f.timeline).toHaveBeenCalledExactlyOnceWith({ direction: "after", projection: "projected", limit: 12 });
  });

  it("reads across pages, ignores redundant events and stops at eight conversation messages", async () => {
    const f = await fixture();
    const cursor = { epoch: "timeline", seq: 12 };
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user_message" : "assistant_message", text: `Message ${index + 1}`,
    }));
    f.timeline.mockResolvedValueOnce({
      error: null, hasNewer: true, endCursor: cursor,
      entries: [
        { item: { type: messages[0]!.role, text: messages[0]!.text } },
        { item: { type: "reasoning", text: "PRIVATE_REASONING" } },
        ...Array.from({ length: 10 }, () => ({ item: { type: "tool_call", text: "PRIVATE_TOOL_OUTPUT" } })),
      ],
    }).mockResolvedValueOnce({
      error: null, hasNewer: true, endCursor: { epoch: "timeline", seq: 24 },
      entries: [
        ...messages.slice(1).map((message) => ({ item: { type: message.role, text: message.text } })),
      ],
    });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages: messages.slice(0, 8) })}`);
    expect(f.timeline).toHaveBeenCalledTimes(2);
    expect(f.timeline).toHaveBeenLastCalledWith({ direction: "after", projection: "projected", limit: 12, cursor });
  });

  it("uses all available user messages when no assistant reply exists yet", async () => {
    const f = await fixture();
    f.timeline.mockResolvedValueOnce({ error: null, hasNewer: false, endCursor: null, entries: [
      { item: { type: "user_message", text: "First request" } },
      { item: { type: "user_message", text: "Later request" } },
    ] });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages: [
      { role: "user_message", text: "First request" },
      { role: "user_message", text: "Later request" },
    ] })}`);
  });

  it("does not provision a helper when reading a later conversation page fails", async () => {
    const f = await fixture();
    f.timeline.mockResolvedValueOnce({ error: null, hasNewer: true, endCursor: { epoch: "timeline", seq: 12 }, entries: [
      { item: { type: "user_message", text: "First request" } },
    ] }).mockRejectedValueOnce(new Error("Timeline unavailable"));
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "Timeline unavailable" });
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("streams the helper's reply into the running state, then settles on the whole title", async () => {
    const f = await fixture();
    const chunk = (item: Record<string, unknown>) => f.live.handler!({ agentId: "helper", event: { type: "timeline", provider: "claude", item } });
    let finish!: () => void;
    f.run.mockImplementationOnce(() => new Promise((resolve) => {
      chunk({ type: "reasoning", text: "Thinking" });
      chunk({ type: "assistant_message", text: "Updated ", messageId: "m1" });
      finish = () => {
        chunk({ type: "assistant_message", text: "中文 title", messageId: "m1" });
        resolve({ status: "idle", lastMessage: "Updated 中文 title", error: null });
      };
    }));
    f.start();
    await expect.poll(() => f.state()).toEqual({ state: "running", helperId: "helper", text: "Updated " });
    expect(f.subscribe.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]!);
    finish();
    expect(await f.settle()).toEqual({ state: "done", title: "Updated 中文 title" });
    expect(f.live.unsubscribe).toHaveBeenCalledTimes(1);
    // A late chunk cannot reopen the settled job.
    chunk({ type: "assistant_message", text: " again" });
    expect(f.state()).toEqual({ state: "done", title: "Updated 中文 title" });
  });

  it("starts over when the helper begins a different message", async () => {
    const { appendTitleChunk } = await import("../../server/tasks/title-generation");
    const event = (text: string, messageId?: string) => ({ agentId: "helper", event: { type: "timeline", provider: "claude", item: { type: "assistant_message", text, messageId } } }) as Parameters<typeof appendTitleChunk>[1];
    const first = appendTitleChunk({ text: "" }, event("Draft", "m1"))!;
    expect(appendTitleChunk(first, event(" title"))).toEqual({ text: "Draft title", messageId: "m1" });
    expect(appendTitleChunk(first, event("Final", "m2"))).toEqual({ text: "Final", messageId: "m2" });
    expect(appendTitleChunk(first, { agentId: "helper", event: { type: "subscription_restored" }, subscriptionId: "s" })).toBeNull();
  });

  it("still settles when the helper's live timeline is unavailable", async () => {
    const f = await fixture();
    f.subscribe.mockImplementationOnce(() => { throw new Error("No live timeline"); });
    f.start();
    expect(await f.settle()).toEqual({ state: "done", title: "Updated 中文 title" });
  });

  it("requires explicit model configuration and a conversation without provisioning resources", async () => {
    const f = await fixture();
    f.values.model = "";
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("settings first") });
    expect(f.workspace).not.toHaveBeenCalled();
    f.values.model = "claude-haiku-5-5";
    f.timeline.mockResolvedValue({ error: null, entries: [], hasNewer: false, endCursor: null });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("no conversation") });
    expect(f.workspace).not.toHaveBeenCalled();
  });

  it.each(["timeout", "permission", "error"])("archives a %s result and keeps the original title", async (status) => {
    const f = await fixture();
    f.run.mockResolvedValue({ status, lastMessage: "Ignore this result", error: null });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining(status) });
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it.each(["", "Title\nExplanation", "x".repeat(81)])("rejects an invalid generated title without overwriting the original", async (lastMessage) => {
    const f = await fixture();
    f.run.mockResolvedValue({ status: "idle", lastMessage, error: null });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error" });
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("preserves a manual title change while the helper was working", async () => {
    const f = await fixture();
    f.refresh.mockResolvedValueOnce(f.original).mockResolvedValueOnce({ agent: { ...f.original.agent, title: "Edited manually" } });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("title changed") });
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.archive).toHaveBeenCalledTimes(1);
  });

  it("archives after provider startup failure and allows an explicit retry", async () => {
    const f = await fixture();
    f.create.mockRejectedValueOnce(new Error("Provider unavailable"));
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "Provider unavailable" });
    expect(f.archive).toHaveBeenCalledTimes(1);
    f.start();
    expect(await f.settle()).toEqual({ state: "done", title: "Updated 中文 title" });
    expect(f.rename).toHaveBeenCalledTimes(1);
  });

  it("does not rename when background workspaces are unsupported or cleanup fails", async () => {
    const f = await fixture();
    f.workspace.mockRejectedValueOnce(new Error("Update the host to use background workspaces."));
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("Update the host") });
    f.archive.mockResolvedValueOnce({ error: "Archive failed" });
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "Could not archive the title helper: Archive failed" });
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("reports a failed rename after releasing the helper", async () => {
    const f = await fixture();
    f.rename.mockResolvedValueOnce({ ok: false, error: "Agent not found" });
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "Agent not found" });
    expect(f.archive).toHaveBeenCalledTimes(1);
  });

  it("preserves both generation and cleanup errors", async () => {
    const f = await fixture();
    f.create.mockRejectedValueOnce(new Error("Provider offline"));
    f.archive.mockRejectedValueOnce(new Error("Archive offline"));
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("Provider offline; Could not archive the title helper: Archive offline") });
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("checks rename availability and archive state before starting a model", async () => {
    const f = await fixture();
    f.canRename.mockReturnValueOnce(false);
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "This host cannot update agent titles." });
    f.original.agent.archivedAt = "2026-10-27T00:00:00Z";
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("Unarchive") });
    expect(f.workspace).not.toHaveBeenCalled();
  });
});
