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
  const run = vi.fn(async (_prompt: string, _options: { timeoutMs: number }) => ({ status: "idle", lastMessage: "Updated 中文 title", error: null as string | null }));
  const archive = vi.fn(async () => ({ error: null as string | null }));
  const live = { handler: null as ((event: unknown) => void) | null, unsubscribe: vi.fn() };
  const subscribe = vi.fn((handler: (event: unknown) => void) => {
    live.handler = handler;
    return Object.assign(live.unsubscribe, { ready: Promise.resolve() });
  });
  const create = vi.fn(async () => ({ id: "helper", run, timeline: { subscribe } }));
  const workspace = vi.fn(async () => ({ agents: { create }, archive }));
  const original = { project: { projectKey: "source-project" } as { projectKey: string } | null, agent: { title: "Original", cwd: directory, workspaceId: "source-ws", archivedAt: null as string | null,
    provider: "codex", model: "gpt-5.5" as string | null, thinkingOptionId: "high" as string | null, effectiveThinkingOptionId: "xhigh" as string | null } };
  const refresh = vi.fn(async () => original);
  const timeline = vi.fn(async (_options: { direction: string; cursor?: { epoch: string; seq: number } }) => ({
    error: null,
    hasOlder: false,
    hasNewer: false,
    endCursor: null as { epoch: string; seq: number } | null,
    startCursor: null as { epoch: string; seq: number } | null,
    entries: [
      { item: { type: "user_message", text: "Fix the card title" } },
      { item: { type: "assistant_message", text: "Diagnosed the warning" } },
      { item: { type: "tool_call", text: "PRIVATE_TOOL_OUTPUT" } },
      { item: { type: "user_message", text: "Now change the settings" } },
      { item: { type: "assistant_message", text: "Updated the settings" } },
    ].map((entry, index) => ({ ...entry, seqStart: index + 1 })),
  }));
  const listModels = vi.fn(async (_provider: string) => ({ error: null as string | null, models: [
    { id: "claude-haiku-5-5", thinkingOptions: [{ id: "off", label: "Off" }, { id: "high", label: "High" }] },
  ] }));
  const refreshWorkspace = vi.fn(async (): Promise<{ projectId: string } | null> => ({ projectId: "source-project" }));
  const snapshot = vi.fn(async () => ({ entries: [{ provider: "codex", enabled: true, status: "ready" }, { provider: "claude", enabled: true, status: "ready" }] }));
  const api = { providers: { listModels, snapshot }, agents: { ref: vi.fn(() => ({ refresh, timeline: { refetch: timeline } })) }, workspaces: { create: workspace, ref: () => ({ refresh: refreshWorkspace }) } } as unknown as PaseoApi;
  const values = titleGenerationSettingsSchema.parse({ customModel: true, disableThinking: false, provider: "claude", model: "claude-haiku-5-5", prompt: "Use an actionable title" });
  const read = vi.fn(async () => ({ status: "ready" as const, revision: "1", values }));
  const rename = vi.fn(async () => ({ ok: true, error: null as string | null }));
  const canRename = vi.fn(() => true);
  const delay = vi.fn(async (_ms: number) => {});
  const service = createTitleGenerator({ settings: { read, subscribe: () => () => {} }, rename, directory, canRename, delay });
  const state = (mode: "apply" | "preview" = "apply") => service.request({ agentId: "source", action: "status", mode }, api);
  const start = (mode: "apply" | "preview" = "apply") => service.request({ agentId: "source", action: "start", mode }, api);
  const settle = async (mode: "apply" | "preview" = "apply") => { await expect.poll(() => state(mode).state).not.toBe("running"); return state(mode); };
  return { api, service, directory, run, archive, create, live, subscribe, workspace, original, refresh, refreshWorkspace, timeline, listModels, snapshot, values, read, rename, canRename, delay, state, start, settle };
}

describe("background title generation", () => {
  it.each(["apply", "preview"] as const)("rejects a recycled workspace before reading history or creating a helper (%s)", async (mode) => {
    const f = await fixture();
    f.original.agent.cwd = join(f.directory, "recycled-worktree");
    f.start(mode);
    expect(await f.settle(mode)).toMatchObject({ state: "error", error: expect.stringContaining("directory_missing") });
    expect(f.timeline).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("rechecks the working directory after generation before writing the title", async () => {
    const f = await fixture();
    f.run.mockImplementationOnce(async () => {
      f.original.agent.cwd = join(f.directory, "recycled-during-generation");
      return { status: "idle", lastMessage: "New title", error: null };
    });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("directory_missing") });
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("rejects an unavailable provider without provisioning a helper", async () => {
    const f = await fixture();
    f.snapshot.mockResolvedValue({ entries: [{ provider: "claude", enabled: false, status: "unavailable" }] });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("provider_unavailable") });
    expect(f.workspace).not.toHaveBeenCalled();
  });
  it("streams previews and cleans up without renaming, separately from direct updates", async () => {
    const f = await fixture();
    let finish!: () => void;
    f.run.mockImplementationOnce(() => new Promise((resolve) => {
      f.live.handler!({ agentId: "helper", event: { type: "timeline", provider: "claude", item: { type: "assistant_message", text: "Preview", messageId: "m1" } } });
      finish = () => resolve({ status: "idle", lastMessage: "Preview title", error: null });
    }));
    f.start("preview");
    await expect.poll(() => f.state("preview")).toMatchObject({ state: "running", text: "Preview" });
    expect(f.state()).toEqual({ state: "idle" });
    expect(f.rename).not.toHaveBeenCalled();
    finish();
    expect(await f.settle("preview")).toEqual({ state: "done", title: "Preview title" });
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.rename).not.toHaveBeenCalled();
    expect(f.original.agent.title).toBe("Original");
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.rename).toHaveBeenCalledExactlyOnceWith("source", "Updated 中文 title");
    expect(f.state("preview")).toEqual({ state: "done", title: "Preview title" });
  });

  it("does not rename after a preview failure", async () => {
    const f = await fixture();
    f.run.mockResolvedValue({ status: "error", lastMessage: "Partial title", error: "Provider failed" });
    f.start("preview");
    expect(await f.settle("preview")).toEqual({ state: "error", error: "Provider failed" });
    expect(f.archive).toHaveBeenCalledTimes(1);
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("disables title thinking by default, including existing settings", () => {
    expect(titleGenerationSettingsSchema.parse({}).disableThinking).toBe(true);
    expect(titleGenerationSettingsSchema.parse({ provider: "claude", model: "haiku" }).disableThinking).toBe(true);
  });

  it.each([
    { ids: ["high", "off", "low"], expected: "off" },
    { ids: ["high", "none", "low"], expected: "none" },
    { ids: ["medium", "disabled"], expected: "disabled" },
    { ids: ["high", "low", "medium"], expected: "low" },
    { ids: ["low", "minimal", "high"], expected: "minimal" },
    { ids: ["high", "medium"], expected: "medium" },
    { ids: [], expected: undefined },
  ])("uses a supported off or minimum thinking option: $ids", async ({ ids, expected }) => {
    const f = await fixture();
    f.values.disableThinking = true;
    f.values.thinkingOptionId = "high";
    f.listModels.mockResolvedValue({ error: null, models: [{ id: f.values.model, thinkingOptions: ids.map((id) => ({ id, label: id })) }] });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.listModels).toHaveBeenCalledExactlyOnceWith("claude");
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ config: {
      provider: "claude/claude-haiku-5-5", systemPrompt: expect.any(String), ...(expected ? { thinkingOptionId: expected } : {}),
    } }));
  });

  it("overrides inherited thinking with the source model's supported minimum", async () => {
    const f = await fixture();
    f.values.customModel = false;
    f.values.disableThinking = true;
    f.listModels.mockResolvedValue({ error: null, models: [{ id: f.original.agent.model!, thinkingOptions: [{ id: "low", label: "Low" }, { id: "high", label: "High" }] }] });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.listModels).toHaveBeenCalledExactlyOnceWith("codex");
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ thinkingOptionId: "low" }) }));
  });

  it("does not query the catalog when the thinking override is off", async () => {
    const f = await fixture();
    f.values.thinkingOptionId = "high";
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.listModels).not.toHaveBeenCalled();
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ thinkingOptionId: "high" }) }));
  });

  it.each([true, false])("does not start a helper when the model catalog is unavailable (error: %s)", async (error) => {
    const f = await fixture();
    f.values.disableThinking = true;
    f.listModels.mockResolvedValue({ error: error ? "Catalog unavailable" : null, models: [] });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "error" });
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

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
    registerTitleGeneration({ registerSettings: vi.fn(), handle, on: vi.fn() } as unknown as Parameters<typeof registerTitleGeneration>[0], vi.fn(), () => true);
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

  it("keeps overlapping first and recent rounds only once and excludes tool calls", async () => {
    const f = await fixture();
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages: [
      { role: "user_message", text: "Fix the card title" },
      { role: "assistant_message", text: "Diagnosed the warning" },
      { role: "user_message", text: "Now change the settings" },
      { role: "assistant_message", text: "Updated the settings" },
    ] })}`);
    expect(f.timeline).toHaveBeenCalledWith({ direction: "after", projection: "projected", limit: 12 });
    expect(f.timeline).toHaveBeenCalledWith({ direction: "tail", projection: "projected", limit: 12 });
  });

  it.each([1, 4, 5, 7])("selects the first round and last four of %s rounds, retaining every assistant message", async (count) => {
    const f = await fixture();
    const entries = Array.from({ length: count }, (_, index) => [
      { item: { type: "user_message", text: `Request ${index + 1}` } },
      { item: { type: "assistant_message", text: `Progress ${index + 1}` } },
      { item: { type: "tool_call", text: "PRIVATE_TOOL_OUTPUT" } },
      { item: { type: "reasoning", text: "PRIVATE_REASONING" } },
      { item: { type: "assistant_message", text: `Reply ${index + 1}` } },
    ]).flat().map((entry, index) => ({ ...entry, seqStart: index + 1 }));
    f.timeline.mockResolvedValue({ error: null, hasOlder: false, hasNewer: false, startCursor: null, endCursor: null, entries });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    const messages = entries.filter(({ item }, index) => (Math.floor(index / 5) === 0 || Math.floor(index / 5) >= count - 4) &&
      (item.type === "user_message" || item.type === "assistant_message")).map(({ item }) => ({ role: item.type, text: item.text }));
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages })}`);
  });

  it("pages both ends across tools and split replies without dropping round boundaries", async () => {
    const f = await fixture();
    const entries = Array.from({ length: 7 }, (_, index) => [
      { item: { type: "user_message", text: `Request ${index + 1}` } },
      ...Array.from({ length: 14 }, () => ({ item: { type: "tool_call", text: "PRIVATE_TOOL_OUTPUT" } })),
      { item: { type: "assistant_message", text: `Progress ${index + 1}` } },
      { item: { type: "assistant_message", text: `Reply ${index + 1}` } },
    ]).flat().map((entry, index) => ({ ...entry, seqStart: index + 1 }));
    f.timeline.mockImplementation(async ({ direction, cursor }) => {
      const start = direction === "after" ? cursor?.seq ?? 0 : Math.max(0, (cursor ? cursor.seq - 1 : entries.length) - 12);
      const page = entries.slice(start, start + 12);
      return { error: null, hasOlder: start > 0, hasNewer: start + 12 < entries.length,
        startCursor: { epoch: "timeline", seq: page[0]!.seqStart }, endCursor: { epoch: "timeline", seq: page.at(-1)!.seqStart }, entries: page };
    });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.timeline.mock.calls.some(([options]) => options.direction === "after" && options.cursor)).toBe(true);
    expect(f.timeline.mock.calls.some(([options]) => options.direction === "before" && options.cursor)).toBe(true);
    const messages = entries.filter(({ item }, index) => (Math.floor(index / 17) === 0 || Math.floor(index / 17) >= 3) &&
      (item.type === "user_message" || item.type === "assistant_message")).map(({ item }) => ({ role: item.type, text: item.text }));
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages })}`);
  });

  it("includes a latest user round that has no assistant reply yet", async () => {
    const f = await fixture();
    const entries = Array.from({ length: 7 }, (_, index) => [
      { item: { type: "user_message", text: `Request ${index + 1}` } },
      ...(index === 6 ? [] : [{ item: { type: "assistant_message", text: `Reply ${index + 1}` } }]),
    ]).flat().map((entry, index) => ({ ...entry, seqStart: index + 1 }));
    f.timeline.mockResolvedValue({ error: null, hasOlder: false, hasNewer: false, startCursor: null, endCursor: null, entries });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    const messages = [...entries.slice(0, 2), ...entries.slice(6)].map(({ item }) => ({ role: item.type, text: item.text }));
    expect(f.run.mock.calls[0]?.[0]).toBe(`${f.values.prompt}\n\n${JSON.stringify({ messages })}`);
  });

  it("does not merge distinct rounds that happen to contain identical text", async () => {
    const f = await fixture();
    const entries = Array.from({ length: 6 }, () => [
      { item: { type: "user_message", text: "Same request" } },
      { item: { type: "assistant_message", text: "Same reply" } },
    ]).flat().map((entry, index) => ({ ...entry, seqStart: index + 1 }));
    f.timeline.mockResolvedValue({ error: null, hasOlder: false, hasNewer: false, startCursor: null, endCursor: null, entries });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(JSON.parse(f.run.mock.calls[0]![0].split("\n\n")[1]!).messages).toHaveLength(10);
  });

  it("does not provision a helper when reading the conversation fails", async () => {
    const f = await fixture();
    f.timeline.mockRejectedValueOnce(new Error("Timeline unavailable"));
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "Timeline unavailable" });
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("reports an empty conversation when the daemon advertises more rows without cursors", async () => {
    const f = await fixture();
    f.timeline.mockResolvedValue({ error: null, entries: [], hasOlder: false, hasNewer: true, startCursor: null, endCursor: null });
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "This agent has no conversation to summarize." });
    expect(f.timeline).toHaveBeenCalledTimes(2);
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("still rejects a nonempty page that advertises more rows without a cursor", async () => {
    const f = await fixture();
    f.timeline.mockResolvedValue({ error: null, entries: [{ item: { type: "user_message", text: "Request" }, seqStart: 1 }], hasOlder: false, hasNewer: true, startCursor: null, endCursor: null });
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "Could not read the conversation." });
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

  it("streams the whole title, then saves it a second after the stream ends", async () => {
    const f = await fixture();
    let wake!: () => void;
    f.delay.mockImplementationOnce(() => new Promise<void>((resolve) => (wake = resolve)));
    // No live chunks reached the job: the settled reply still streams whole before the save.
    f.subscribe.mockImplementationOnce(() => { throw new Error("No live timeline"); });
    f.start();
    await expect.poll(() => f.delay.mock.calls.length).toBe(1);
    expect(f.delay).toHaveBeenCalledWith(1000);
    expect(f.state()).toEqual({ state: "running", helperId: "helper", text: "Updated 中文 title" });
    expect(f.rename).not.toHaveBeenCalled();
    wake();
    expect(await f.settle()).toEqual({ state: "done", title: "Updated 中文 title" });
    expect(f.rename).toHaveBeenCalledExactlyOnceWith("source", "Updated 中文 title");
    // The source is read again after the wait, so a manual rename meanwhile still wins.
    expect(f.delay.mock.invocationCallOrder[0]).toBeLessThan(f.refresh.mock.invocationCallOrder[1]!);
  });

  it("does not wait to return a preview", async () => {
    const f = await fixture();
    f.start("preview");
    expect(await f.settle("preview")).toEqual({ state: "done", title: "Updated 中文 title" });
    expect(f.delay).not.toHaveBeenCalled();
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
    f.timeline.mockResolvedValue({ error: null, entries: [], hasOlder: false, hasNewer: false, startCursor: null, endCursor: null });
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
    f.refresh.mockResolvedValueOnce(f.original).mockResolvedValueOnce({ ...f.original, agent: { ...f.original.agent, title: "Edited manually" } });
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

  it.each(["apply", "preview"] as const)("blocks title generation when the source workspace is unavailable (%s)", async (mode) => {
    const f = await fixture();
    f.original.agent.archivedAt = "2026-10-27T00:00:00Z";
    f.refreshWorkspace.mockResolvedValue(null);
    f.start(mode);
    expect(await f.settle(mode)).toEqual({ state: "error", error: expect.stringContaining("workspace_unavailable") });
    expect(f.refreshWorkspace).toHaveBeenCalledTimes(1);
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.original.agent.archivedAt).toBe("2026-10-27T00:00:00Z");
    expect(f.archive).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("reports missing project placement without provisioning a helper", async () => {
    const f = await fixture();
    f.original.project = null;
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "The original agent has no project placement." });
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it("can apply a title when the source was archived during generation", async () => {
    const f = await fixture();
    f.refresh.mockResolvedValueOnce(f.original).mockResolvedValueOnce({ ...f.original, agent: { ...f.original.agent, archivedAt: "2026-10-27T00:00:00Z" } });
    f.start();
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(f.rename).toHaveBeenCalledExactlyOnceWith("source", "Updated 中文 title");
  });

  it("checks rename availability before starting a model", async () => {
    const f = await fixture();
    f.canRename.mockReturnValueOnce(false);
    f.start();
    expect(await f.settle()).toEqual({ state: "error", error: "This host cannot update agent titles." });
    expect(f.workspace).not.toHaveBeenCalled();
  });
});

describe("title after the first reply", () => {
  const FIRST_ROUND = [
    { item: { type: "user_message", text: "  Fix the   card title\nwith details" } },
    { item: { type: "tool_call", text: "PRIVATE_TOOL_OUTPUT" } },
    { item: { type: "assistant_message", text: "Fixed the card title" } },
  ];
  async function first(entries: { item: { type: string; text: string } }[] = FIRST_ROUND) {
    const f = await fixture();
    f.values.afterFirstReply = true;
    f.original.agent.title = "Fix the card title";
    f.timeline.mockResolvedValue({ error: null, hasOlder: false, hasNewer: false, endCursor: null, startCursor: null, entries: entries.map((entry, index) => ({ ...entry, seqStart: index + 1 })) } as never);
    const ended = (outcome: { kind: "completed" } | { kind: "failed"; error: { message: string } } | { kind: "canceled"; reason: string } = { kind: "completed" }, agent: { cwd?: string; provider?: string } = {}) =>
      f.service.afterTurn({ agent: { id: "source", workspaceId: "source-ws", parentAgentId: null, provider: agent.provider ?? "codex", cwd: agent.cwd ?? "/projects/app", title: f.original.agent.title }, outcome }, f.api);
    return { ...f, ended };
  }

  it("is off by default", async () => {
    expect(titleGenerationSettingsSchema.parse({}).afterFirstReply).toBe(false);
    const f = await first();
    f.values.afterFirstReply = false;
    expect(await f.ended()).toBe(false);
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.workspace).not.toHaveBeenCalled();
  });

  it.each(["Fix the card title", "", null])("titles a first round that ended with a reply under a provisional title (%j)", async (title) => {
    const f = await first();
    (f.original.agent as { title: string | null }).title = title;
    expect(await f.ended()).toBe(true);
    expect(f.state()).toMatchObject({ state: "running" });
    expect(await f.settle()).toEqual({ state: "done", title: "Updated 中文 title" });
    expect(f.rename).toHaveBeenCalledExactlyOnceWith("source", "Updated 中文 title");
    expect(f.run.mock.calls[0]![0]).toContain("Fixed the card title");
  });

  it("keeps a title that was named rather than taken from the first prompt", async () => {
    const f = await first();
    f.original.agent.title = "Release checklist";
    expect(await f.ended()).toBe(false);
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.state()).toEqual({ state: "idle" });
  });

  it("keeps a title renamed between the check and the job", async () => {
    const f = await first();
    expect(await f.ended()).toBe(true);
    f.original.agent.title = "Named by hand";
    expect(await f.settle()).toMatchObject({ state: "error", error: expect.stringContaining("title changed") });
    expect(f.workspace).not.toHaveBeenCalled();
    expect(f.rename).not.toHaveBeenCalled();
  });

  it.each([
    ["a second round", [...FIRST_ROUND, { item: { type: "user_message", text: "Next" } }, { item: { type: "assistant_message", text: "Done" } }]],
    ["a second prompt still running", [...FIRST_ROUND, { item: { type: "user_message", text: "Next" } }]],
    ["no reply", FIRST_ROUND.slice(0, 2)],
    ["a blank reply", [FIRST_ROUND[0]!, { item: { type: "assistant_message", text: "  " } }]],
    ["no prompt", []],
  ])("skips %s", async (_name, entries) => {
    const f = await first(entries);
    expect(await f.ended()).toBe(false);
    expect(f.workspace).not.toHaveBeenCalled();
  });

  it("skips a Claude reply that is the provider's error", async () => {
    const f = await first([FIRST_ROUND[0]!, { item: { type: "assistant_message", text: "You've hit your session limit · resets 3pm" } }]);
    expect(await f.ended({ kind: "completed" }, { provider: "claude" })).toBe(false);
    expect(f.workspace).not.toHaveBeenCalled();
  });

  it.each([{ kind: "failed", error: { message: "Provider failed" } }, { kind: "canceled", reason: "user" }] as const)("skips a turn that did not complete ($kind)", async (outcome) => {
    const f = await first();
    expect(await f.ended(outcome)).toBe(false);
    expect(f.read).not.toHaveBeenCalled();
  });

  it("skips the title helpers' own turns by directory and by label", async () => {
    const f = await first();
    expect(await f.ended({ kind: "completed" }, { cwd: f.directory })).toBe(false);
    expect(f.read).not.toHaveBeenCalled();
    (f.original.agent as { labels?: Record<string, string> }).labels = { "better-paseo.purpose": "title-generation" };
    expect(await f.ended()).toBe(false);
    expect(f.timeline).not.toHaveBeenCalled();
    expect(f.workspace).not.toHaveBeenCalled();
  });

  it("starts one job for repeated and concurrent turn ends", async () => {
    const f = await first();
    expect(await Promise.all([f.ended(), f.ended()])).toEqual([true, false]);
    expect(await f.settle()).toMatchObject({ state: "done" });
    expect(await f.ended()).toBe(false);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.rename).toHaveBeenCalledTimes(1);
  });

  it("does not try again in this process after a failed job", async () => {
    const f = await first();
    f.run.mockResolvedValueOnce({ status: "error", lastMessage: "", error: "Provider failed" });
    expect(await f.ended()).toBe(true);
    expect(await f.settle()).toEqual({ state: "error", error: "Provider failed" });
    expect(await f.ended()).toBe(false);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.original.agent.title).toBe("Fix the card title");
  });

  it("shares one job with the menu", async () => {
    const f = await first();
    let finish!: () => void;
    f.run.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ status: "idle", lastMessage: "Menu title", error: null }); }));
    expect(await f.ended()).toBe(true);
    expect(f.start()).toMatchObject({ state: "running" });
    await expect.poll(() => f.create.mock.calls.length).toBe(1);
    finish();
    expect(await f.settle()).toEqual({ state: "done", title: "Menu title" });
    expect(f.create).toHaveBeenCalledTimes(1);

    const g = await first();
    let release!: () => void;
    g.run.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ status: "idle", lastMessage: "Menu title", error: null }); }));
    g.start();
    expect(await g.ended()).toBe(false);
    await expect.poll(() => g.create.mock.calls.length).toBe(1);
    release();
    expect(await g.settle()).toMatchObject({ state: "done" });
    expect(g.create).toHaveBeenCalledTimes(1);
  });

  it("registers a turn hook that returns before the title is written", async () => {
    const on = vi.fn();
    registerTitleGeneration({ registerSettings: vi.fn(() => ({ read: async () => ({ status: "ready", revision: "1", values: titleGenerationSettingsSchema.parse({}) }) })), handle: vi.fn(), on } as unknown as Parameters<typeof registerTitleGeneration>[0], vi.fn(), () => true);
    const [name, handler] = on.mock.calls[0]!;
    expect(name).toBe("agent.turn_ended");
    expect(handler({ agent: { id: "a", cwd: "/x", provider: "codex" }, outcome: { kind: "completed" } }, { paseo: {} })).toBeUndefined();
  });
});
