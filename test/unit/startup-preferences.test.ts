import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

// contribute() asks the daemon for the stored preferences itself, so iOS and
// Android (no localStorage) do not project the first timeline with the
// defaults and then again once a row mounts the settings hook.

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: () => null }));
// What the host's `useSettings` answers: its react-query cache.
const host = vi.hoisted(() => ({ settings: { status: "loading" } as Record<string, unknown> }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => null,
  useSettings: () => host.settings,
}));
vi.mock("../../client/live-renderers", () => ({
  LiveToolCallRenderer: () => null,
  LiveReasoningRenderer: () => null,
  LiveTodoRenderer: () => null,
  LiveUserMessageRenderer: () => null,
  LiveNoticeRenderer: () => null,
  LiveAssistantRenderer: () => null,
}));
vi.mock("../../client/settings-screen", () => ({ contributeSettingsScreen: () => () => {} }));
vi.mock("../../client/tasks/contribute", () => ({ contributeTasks: () => () => {} }));

type Transform = (input: { item: unknown; phase: string }) => { items: unknown[] } | undefined;
type Registration = { id: string; transform: Transform; removed: boolean };

const TRANSFORMERS = [
  "omp-enhanced-tool-call",
  "omp-enhanced-compaction",
  "omp-enhanced-reasoning",
  "omp-enhanced-todo",
  "omp-enhanced-user-message",
  "omp-enhanced-assistant",
  "omp-enhanced-notification",
  "omp-enhanced-error",
];

function fakeClient(read: () => unknown, readTranslation?: () => unknown) {
  const registrations: Registration[] = [];
  const rpc = vi.fn((contract: { name: string }) => {
    if (contract.name === "settings.presentation.read") return read();
    if (contract.name === "settings.timeline-translation.read" && readTranslation) return readTranslation();
    return Promise.reject(new Error(`unexpected rpc ${contract.name}`));
  });
  // The host's session events: `push` delivers one to every observer.
  const observers = new Set<{ update(message: unknown): void }>();
  const observeEvents = vi.fn(() => ({
    subscribe(observer: { update(message: unknown): void }) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    release: () => Promise.resolve(),
  }));
  const push = (settingsId: string) => {
    for (const observer of observers) {
      observer.update({ type: "status", payload: { status: "plugin_settings_changed", pluginId: "better-paseo", settingsId } });
    }
  };
  const client = {
    rpc,
    paseo: { observeEvents },
    addTimelineTransformer(contribution: { id: string; transform: Transform }) {
      const entry = { id: contribution.id, transform: contribution.transform, removed: false };
      registrations.push(entry);
      return () => {
        entry.removed = true;
      };
    },
    addTimelineRenderer: () => () => {},
    addSlashCommand: () => () => {},
  };
  const active = (id: string) => registrations.filter((entry) => entry.id === id && !entry.removed);
  return { client, rpc, registrations, active, push, observers };
}

const flush = async () => {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
};
const reply = { item: { type: "assistant_message", text: "Hello" }, phase: "complete" };
const prompt = { item: { type: "user_message", text: "Hi", messageId: "m1" }, phase: "complete" };

async function load() {
  vi.resetModules();
  const { default: contribute } = await import("../../index.client");
  const preferences = await import("../../client/preferences");
  const slot = await import("../../client/state/preference-sync-slot");
  // The same module instances as the plugin's: React after the reset.
  const React = await import("react");
  const renderer = await import("react-test-renderer");
  return { contribute, preferences, slot, React, renderer };
}

describe("preferences read while the plugin loads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    host.settings = { status: "loading" };
  });

  it("reprojects interactive replies when handoff changes", async () => {
    const { contribute, preferences } = await load();
    let answer!: (value: unknown) => void;
    const plugin = fakeClient(() => new Promise((resolve) => { answer = resolve; }));
    const cleanup = contribute(plugin.client as never);
    const ui = { item: { type: "assistant_message", text: "```ui\nCard()" }, phase: "streaming" };
    const other = { item: { type: "assistant_message", text: "```ui.json\n{}\n```" }, phase: "complete" };
    const first = plugin.active("omp-enhanced-assistant")[0]!;
    expect(first.transform(ui)).toBeDefined();
    answer({ status: "ready", revision: "r1", values: { liveUiReplies: true } });
    await flush();
    const second = plugin.active("omp-enhanced-assistant")[0]!;
    expect(first.removed).toBe(true);
    expect(second.transform(ui)).toBeUndefined();
    expect(second.transform({ item: { type: "assistant_message", text: "```ui" }, phase: "streaming" })).toBeDefined();
    expect(second.transform({ item: { type: "assistant_message", text: "```ui" }, phase: "complete" })).toBeUndefined();
    expect(second.transform(other)).toBeDefined();
    expect(second.transform(reply)).toBeDefined();
    preferences.updateEnhancerPreferences({ liveUiReplies: false });
    const third = plugin.active("omp-enhanced-assistant")[0]!;
    expect(third.transform(ui)).toBeDefined();
    preferences.updateEnhancerPreferences({ assistantMarkdown: false, liveUiReplies: true });
    expect(plugin.active("omp-enhanced-assistant")[0]!.transform(reply)).toBeUndefined();
    const count = plugin.registrations.length;
    preferences.updateEnhancerPreferences({ liveUiReplies: false });
    expect(plugin.registrations).toHaveLength(count);
    preferences.updateEnhancerPreferences({ assistantMarkdown: true });
    expect(plugin.registrations).toHaveLength(count + 1);
    expect(plugin.active("omp-enhanced-assistant")[0]!.transform(reply)).toBeDefined();
    preferences.updateEnhancerPreferences({ assistantMarkdown: false });
    const beforeBoth = plugin.registrations.length;
    preferences.updateEnhancerPreferences({ assistantMarkdown: true, liveUiReplies: true });
    expect(plugin.registrations).toHaveLength(beforeBoth + 1);
    expect(plugin.active("omp-enhanced-assistant")[0]!.transform(ui)).toBeUndefined();
    cleanup();
    const cleaned = plugin.registrations.length;
    preferences.updateEnhancerPreferences({ liveUiReplies: false });
    expect(plugin.registrations).toHaveLength(cleaned);
  });

  it("asks while contribute runs and applies the record before any row mounts", async () => {
    const { contribute, preferences } = await load();
    let answer!: (value: unknown) => void;
    const plugin = fakeClient(() => new Promise((resolve) => (answer = resolve)));

    const cleanup = contribute(plugin.client as never);
    // Synchronous: every transformer is registered and the read has left.
    expect(plugin.registrations.map((entry) => entry.id)).toEqual(TRANSFORMERS);
    expect(plugin.rpc).toHaveBeenCalledTimes(1);
    const [assistant] = plugin.active("omp-enhanced-assistant");
    expect(assistant!.transform(reply)).toBeDefined();

    answer({ status: "ready", revision: "r3", values: { assistantMarkdown: false, accent: "rose" } });
    await flush();

    expect(preferences.getEnhancerPreferences()).toMatchObject({ assistantMarkdown: false, accent: "rose" });
    // Registered again, so the host projects the timeline with the record.
    expect(assistant!.removed).toBe(true);
    const [again] = plugin.active("omp-enhanced-assistant");
    expect(again).not.toBe(assistant);
    expect(again!.transform(reply)).toBeUndefined();
    // The prompt bubble stays opt-in: the record did not turn it on.
    expect(preferences.DEFAULT_PREFERENCES.enhancedUserBubble).toBe(false);
    expect(plugin.active("omp-enhanced-user-message")[0]!.transform(prompt)).toBeUndefined();

    cleanup();
    expect(plugin.registrations.every((entry) => entry.removed)).toBe(true);
  });

  it("reprojects history when the timeline level changes", async () => {
    const { contribute, preferences } = await load();
    const plugin = fakeClient(() => Promise.resolve({ status: "ready", revision: "r1", values: { timelineLevel: "detailed" } }));
    const cleanup = contribute(plugin.client as never);
    await flush();
    const first = plugin.active("omp-enhanced-tool-call")[0]!;
    const input = { item: { type: "tool_call", name: "Read", callId: "1", status: "completed", error: null, detail: { type: "read", filePath: "a" } }, phase: "complete" };
    expect(first.transform(input)).toMatchObject({ items: [expect.anything()] });
    preferences.updateEnhancerPreferences({ timelineLevel: "simple" });
    expect(first.removed).toBe(true);
    expect(plugin.active("omp-enhanced-tool-call")[0]!.transform(input)).toEqual({ items: [] });
    cleanup();
  });

  it.each(["simple", "standard"] as const)("keeps OMP job status rows in %s", async (level) => {
    const { contribute } = await load();
    const plugin = fakeClient(() => Promise.resolve({ status: "ready", revision: "r1", values: { timelineLevel: level } }));
    const cleanup = contribute(plugin.client as never);
    await flush();
    const transform = plugin.active("omp-enhanced-tool-call")[0]!.transform;
    for (const jobs of [[{ id: "j1", status: "running" }], []]) {
      const item = { type: "tool_call", name: "hub", callId: "hub1", status: "completed", error: null,
        detail: { type: "unknown", input: { op: "jobs" }, output: { details: { jobs } } } };
      expect(transform({ item, phase: "complete" })).toMatchObject({ items: [{ kind: "omp-tool-call" }] });
    }
    cleanup();
  });

  it("leaves local file replies native while enhancing other replies", async () => {
    const { contribute, preferences } = await load();
    preferences.updateEnhancerPreferences({ fileOpeningMode: "paseo" });
    const plugin = fakeClient(() => new Promise(() => {}));
    const cleanup = contribute(plugin.client as never);
    const [assistant] = plugin.active("omp-enhanced-assistant");
    for (const phase of ["streaming", "complete"]) {
      for (const text of ["[Design](docs/WORKFLOW-draft7.md)", "Read `src/main.ts`.",
        "![Image](file:///tmp/screenshot.png)"]) {
        expect(assistant!.transform({ item: { type: "assistant_message", text }, phase })).toBeUndefined();
      }
      const text = "[Docs](https://example.com/notes.md)";
      expect(assistant!.transform({ item: { type: "assistant_message", text }, phase }))
        .toMatchObject({ items: [{ kind: "omp-assistant", data: { text } }] });
    }
    cleanup();
  });

  it("checks imported history prose without treating tool output as links", async () => {
    const { contribute, preferences } = await load();
    const plugin = fakeClient(() => new Promise(() => {}));
    const cleanup = contribute(plugin.client as never);
    const tool = "[external_agent_tool_result]\nRead `src/main.ts` and [file](LICENSE)\n[/external_agent_tool_result]\n";
    const transform = (text: string) => plugin.active("omp-enhanced-assistant")[0]!.transform({
      item: { type: "assistant_message", text, messageId: "imported-1" }, phase: "complete",
    });
    expect(transform(tool)).toMatchObject({ items: [{ kind: "omp-tool-call" }] });
    expect(transform(tool + "Done. [Docs](https://example.com/notes.md)")).toMatchObject({
      items: [{ kind: "omp-tool-call" }, { kind: "omp-assistant" }],
    });
    expect(transform(tool + "Read [License](LICENSE)")).toMatchObject({
      items: [{ kind: "omp-tool-call" }, { kind: "omp-assistant" }],
    });
    preferences.updateEnhancerPreferences({ fileOpeningMode: "paseo" });
    expect(transform(tool)).toMatchObject({ items: [{ kind: "omp-tool-call" }] });
    // Native/plugin rows cannot be mixed: a real prose file link hands the
    // complete original item (including imported markers) to the host.
    expect(transform(tool + "Read [License](LICENSE)")).toBeUndefined();
    expect(transform("Read `src/main.ts`.\n" + tool)).toBeUndefined();
    cleanup();
  });

  it("reprojects stored file-opening choices and cleans up both preference subscriptions", async () => {
    const { contribute, preferences } = await load();
    let answer!: (value: unknown) => void;
    const plugin = fakeClient(() => new Promise((resolve) => (answer = resolve)));
    const cleanup = contribute(plugin.client as never);
    const input = { item: { type: "assistant_message", text: "[Design](docs/WORKFLOW-draft7.md)" }, phase: "complete" };
    const active = () => plugin.active("omp-enhanced-assistant");
    const first = active()[0]!;
    expect(preferences.getEnhancerPreferences().fileOpeningMode).toBe("better-paseo");
    expect(first.transform(input)).toBeDefined();
    answer({ status: "ready", revision: "r1", values: { fileOpeningMode: "paseo" } });
    await flush();
    expect(first.removed).toBe(true);
    expect(active()).toHaveLength(1);
    expect(active()[0]!.transform(input)).toBeUndefined();

    preferences.updateEnhancerPreferences({ fileOpeningMode: "better-paseo" });
    expect(active()).toHaveLength(1);
    expect(active()[0]!.transform(input)).toMatchObject({ items: [{ data: { text: input.item.text } }] });
    preferences.updateEnhancerPreferences({ assistantMarkdown: false });
    preferences.updateEnhancerPreferences({ fileOpeningMode: "paseo" });
    expect(active()).toHaveLength(1);
    expect(active()[0]!.transform({ ...input, item: { ...input.item, text: "Ordinary prose" } })).toBeUndefined();

    cleanup();
    expect(plugin.registrations.every((entry) => entry.removed)).toBe(true);
    const count = plugin.registrations.length;
    preferences.updateEnhancerPreferences({ fileOpeningMode: "better-paseo", assistantMarkdown: true });
    expect(plugin.registrations).toHaveLength(count);
  });

  it("registers nothing again when the record matches the defaults", async () => {
    const { contribute, preferences } = await load();
    const plugin = fakeClient(() =>
      Promise.resolve({ status: "ready", revision: "r1", values: preferences.storedPart(preferences.DEFAULT_PREFERENCES) }),
    );
    const cleanup = contribute(plugin.client as never);
    await flush();
    expect(plugin.registrations).toHaveLength(TRANSFORMERS.length);
    cleanup();
  });

  it("leaves the chat to Paseo while the chat switch is off", async () => {
    const { contribute, preferences } = await load();
    const plugin = fakeClient(() => Promise.resolve({ status: "ready", revision: "r1", values: { chatEnabled: false } }));
    const cleanup = contribute(plugin.client as never);
    await flush();
    for (const id of TRANSFORMERS) expect(plugin.active(id)).toEqual([]);

    // Nested preferences no longer register while the switch is off.
    preferences.updateEnhancerPreferences({ assistantMarkdown: false });
    expect(plugin.active("omp-enhanced-assistant")).toEqual([]);

    preferences.updateEnhancerPreferences({ chatEnabled: true });
    for (const id of TRANSFORMERS) expect(plugin.active(id)).toHaveLength(1);
    cleanup();
    expect(plugin.registrations.every((entry) => entry.removed)).toBe(true);
  });

  it("turns the chat back on from another client after the settings page closed", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { contribute, preferences, slot, React, renderer } = await load();
    const off = { status: "ready", revision: "r1", values: { chatEnabled: false } };
    const on = { status: "ready", revision: "r2", values: { chatEnabled: true } };
    let record: unknown = off;
    const plugin = fakeClient(() => Promise.resolve(record));
    const cleanup = contribute(plugin.client as never);
    await flush();
    for (const id of TRANSFORMERS) expect(plugin.active(id)).toEqual([]);

    // The settings page opens and closes: the last settings hook unmounts.
    const reload = vi.fn(() => Promise.resolve());
    host.settings = { ...off, save: vi.fn(), reset: vi.fn(), reload };
    const Page = () => {
      slot.usePreferenceSettings();
      return null;
    };
    let page!: ReactTestRenderer;
    await renderer.act(async () => {
      page = renderer.create(React.createElement(Page));
    });
    await renderer.act(async () => page.unmount());
    expect(reload).not.toHaveBeenCalled();

    // Another client turns the chat on; no plugin row or page is mounted.
    record = on;
    plugin.push("tasks");
    await flush();
    expect(plugin.rpc).toHaveBeenCalledTimes(1);
    plugin.push("presentation");
    await flush();
    expect(plugin.rpc).toHaveBeenCalledTimes(2);
    expect(preferences.getEnhancerPreferences().chatEnabled).toBe(true);
    for (const id of TRANSFORMERS) expect(plugin.active(id)).toHaveLength(1);

    // The page opens again on the host's stale copy (r1, chat off): the hook
    // reads it again instead of turning the chat back off.
    let settle!: () => void;
    reload.mockImplementation(() => new Promise<void>((resolve) => (settle = resolve)));
    await renderer.act(async () => {
      page = renderer.create(React.createElement(Page));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(preferences.getEnhancerPreferences().chatEnabled).toBe(true);
    host.settings = { ...on, save: vi.fn(), reset: vi.fn(), reload };
    await renderer.act(async () => settle());
    expect(preferences.getEnhancerPreferences().chatEnabled).toBe(true);
    for (const id of TRANSFORMERS) expect(plugin.active(id)).toHaveLength(1);

    // While a hook is mounted the host reads the record for it.
    plugin.push("presentation");
    await flush();
    expect(plugin.rpc).toHaveBeenCalledTimes(2);

    await renderer.act(async () => page.unmount());
    cleanup();
    expect(plugin.observers.size).toBe(0);
  });

  it("reads translation settings again when a hook mounts after another client changed them", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { contribute, slot, React, renderer } = await load();
    const store = await import("../../client/translation/settings-store");
    const reload = vi.fn(() => Promise.resolve());
    const first = { status: "ready", revision: "t1", values: { enabled: true, customModel: true, provider: "codex", model: "gpt-5", targetLanguage: "en" }, save: vi.fn(), reset: vi.fn(), reload };
    // The daemon's record; the plugin's own reads answer when the test lets them.
    let daemon: { status: string; revision: string; values: unknown } = first;
    const answers: (() => void)[] = [];
    const readTranslation = vi.fn(() => {
      const seen = daemon;
      return new Promise((resolve) => answers.push(() => resolve(seen)));
    });
    const answer = async () => {
      await renderer.act(async () => {
        while (answers.length) answers.shift()!();
        await flush();
      });
    };
    const plugin = fakeClient(() => Promise.resolve(null), readTranslation);
    const cleanup = contribute(plugin.client as never);
    await flush();
    host.settings = first;
    // A row's settings slot, reading the host's copy (`useSettings` answers `host.settings`).
    const Row = () => React.createElement(slot.PreferenceSyncSlot);
    let row!: ReactTestRenderer;
    await renderer.act(async () => { row = renderer.create(React.createElement(Row)); });
    await renderer.act(async () => row.unmount());
    expect(store.getTranslationSettingsState()).toMatchObject({ revision: "t1", values: { targetLanguage: "en" } });

    // A selection translated under t1 sits in the session cache.
    const { createSelectionTranslation } = await import("../../client/translation/selection");
    const call = vi.fn(async () => ({ state: "done", translation: "Hello", targetLanguageCode: "en", provider: "codex", model: "gpt-5", thinkingMode: "custom", thinkingOptionId: null }));
    const select = () => createSelectionTranslation({ agentId: "agent-1", kind: "assistant_message", text: "你好", streaming: false,
      translator: { call: call as never, watch: () => () => {} }, configStore: undefined, interfaceLanguage: () => "en" });
    const earlier = select();
    earlier.start();
    await flush();
    expect(earlier.view()).toMatchObject({ status: "done" });
    earlier.dispose();

    // Another client changes the target while no row is mounted; the host
    // marks its copy stale but does not read it until asked.
    const second = { ...first, revision: "t2", values: { ...first.values, targetLanguage: "ja" } };
    daemon = second;
    plugin.push("timeline-translation");
    await flush();
    expect(readTranslation).toHaveBeenCalledOnce();
    // While the record is read again, the old settings neither show the cached result nor send.
    expect(store.getTranslationSettingsState().status).toBe("loading");
    const during = select();
    during.start();
    expect(during.view()).toEqual({ status: "settings-loading" });
    // A row mounts on the host's retained t1 copy before the read answers.
    await renderer.act(async () => { row = renderer.create(React.createElement(Row)); });
    expect(store.getTranslationSettingsState().status).toBe("loading");
    expect(during.view()).toEqual({ status: "settings-loading" });
    expect(call).toHaveBeenCalledOnce();
    await answer();
    expect(store.getTranslationSettingsState()).toMatchObject({ revision: "t2", values: { targetLanguage: "ja" } });
    // The host's copy is older than the record read: it is read again.
    expect(reload).toHaveBeenCalledTimes(1);
    host.settings = second;
    await renderer.act(async () => { row.update(React.createElement(Row)); });
    await flush();
    expect(call).toHaveBeenCalledTimes(2);
    expect(JSON.parse((call.mock.calls[1] as unknown as [{ configSignature: string }])[0].configSignature)).toMatchObject({ targetCode: "ja" });
    during.dispose();

    // The leader can leave before the change is read. Its replacement must
    // not reuse t2 while the missed change is still being read.
    daemon = { ...first, revision: "t3" };
    plugin.push("timeline-translation");
    await flush();
    expect(readTranslation).toHaveBeenCalledTimes(2);
    expect(store.getTranslationSettingsState().status).toBe("loading");
    await renderer.act(async () => row.unmount());
    await renderer.act(async () => { row = renderer.create(React.createElement(Row)); });
    expect(store.getTranslationSettingsState().status).toBe("loading");
    await answer();
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t3" });
    expect(reload).toHaveBeenCalledTimes(2);
    await renderer.act(async () => row.unmount());
    cleanup();
  });

  it("does not reopen cached translation settings after an older read or a failed read", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { React, renderer } = await load();
    const store = await import("../../client/translation/settings-store");
    const reads: { resolve(record: unknown): void; reject(error: Error): void }[] = [];
    const read = vi.fn(() => new Promise((resolve, reject) => { reads.push({ resolve, reject }); }));
    const reload = vi.fn(() => Promise.resolve());
    const cached = {
      status: "ready" as const, revision: "t1", values: store.DEFAULT_TIMELINE_TRANSLATION_SETTINGS,
      saving: false, saveError: null, save: vi.fn(), reset: vi.fn(), reload,
    };
    let current = cached;
    const Report = () => { store.useTranslationSettingsReport(current); return null; };
    const mount = async () => {
      let row!: ReactTestRenderer;
      await renderer.act(async () => { row = renderer.create(React.createElement(Report)); });
      return row;
    };
    const initial = await mount();
    await renderer.act(async () => initial.unmount());
    store.noteTranslationSettingsChanged(read);
    const first = await mount();
    // The host's cached t1 is not shown while the change is read.
    expect(store.getTranslationSettingsState().status).toBe("loading");
    await renderer.act(async () => first.unmount());
    const second = await mount();
    expect(store.getTranslationSettingsState().status).toBe("loading");
    await renderer.act(async () => store.noteTranslationSettingsChanged(read));
    await renderer.act(async () => store.noteTranslationSettingsChanged(read));
    expect(read).toHaveBeenCalledTimes(3);
    await renderer.act(async () => reads[0]!.resolve({ status: "ready", revision: "t1", values: {} }));
    await renderer.act(async () => reads[1]!.reject(new Error("superseded")));
    expect(store.getTranslationSettingsState().status).toBe("loading");
    await renderer.act(async () => reads[2]!.reject(new Error("settings offline")));
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "error", error: "settings offline" });
    await renderer.act(async () => second.unmount());
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "error", error: "settings offline" });
    // The next hook reads again; its cached t1 still does not reopen.
    const third = await mount();
    expect(read).toHaveBeenCalledTimes(4);
    expect(store.getTranslationSettingsState().status).toBe("loading");
    await renderer.act(async () => reads[3]!.resolve({ status: "ready", revision: "t2", values: {} }));
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t2" });
    expect(reload).toHaveBeenCalledOnce();
    current = { ...cached, revision: "t2" };
    await renderer.act(async () => third.update(React.createElement(Report)));
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t2" });
    expect(read).toHaveBeenCalledTimes(4);
    await renderer.act(async () => third.unmount());
  });

  it("observes a failed read and recovers without reopening the host's cached copy", async () => {
    const { React, renderer, slot } = await load();
    const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
    const store = await import("../../client/translation/settings-store");
    const client = new QueryClient();
    const key = ["translation-settings"];
    const cached = { status: "ready" as const, revision: "t1", values: store.DEFAULT_TIMELINE_TRANSLATION_SETTINGS };
    client.setQueryData(key, cached);
    const read = vi.fn<() => Promise<typeof cached>>();
    const actions = { saving: false, saveError: null, save: vi.fn(), reset: vi.fn() };
    const reloadFulfilled = vi.fn();
    function Report() {
      const query = useQuery({ queryKey: key, queryFn: read, retry: false, refetchOnMount: false, gcTime: Infinity });
      const reload = async () => { await query.refetch(); reloadFulfilled(); };
      const result = query.isError ? { status: "error" as const, error: query.error.message } :
        query.isPending ? { status: "loading" as const } : query.data;
      store.useTranslationSettingsReport({ ...actions, reload, ...result });
      return null;
    }
    const mount = async () => {
      let row!: ReactTestRenderer;
      await renderer.act(async () => {
        row = renderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Report)));
      });
      return row;
    };
    const initial = await mount();
    expect(read).not.toHaveBeenCalled();
    // The host invalidates its shared query on a push while an observer is active.
    const current = { ...cached, revision: "t2" };
    // The daemon's record, as the plugin's own settings RPC reads it.
    let daemon: typeof cached = current;
    const daemonRead = vi.fn(async () => daemon);
    read.mockResolvedValueOnce(current);
    await renderer.act(async () => {
      store.noteTranslationSettingsChanged(daemonRead);
      await client.invalidateQueries({ queryKey: key });
    });
    await renderer.act(async () => {
      await vi.waitFor(() => expect(store.getTranslationSettingsState()).toMatchObject({ revision: "t2" }));
    });
    await renderer.act(async () => initial.unmount());
    const confirmed = await mount();
    expect(read).toHaveBeenCalledOnce();
    expect(reloadFulfilled).not.toHaveBeenCalled();
    // The host has already applied a save, then both observers see a push.
    // A refetch with the same data does not change the hook's public state.
    const saved = { ...current, revision: "t3", values: { ...current.values, enabled: false } };
    daemon = saved;
    await renderer.act(async () => { client.setQueryData(key, saved); });
    await renderer.act(async () => {
      await vi.waitFor(() => expect(store.getTranslationSettingsState()).toMatchObject({ revision: "t3" }));
    });
    const confirmRead = vi.fn(async () => saved);
    const plugin = fakeClient(async () => null, confirmRead);
    const stop = slot.watchPreferenceChanges(plugin.client as never);
    read.mockResolvedValueOnce(saved);
    await renderer.act(async () => {
      plugin.push("timeline-translation");
      await client.invalidateQueries({ queryKey: key });
    });
    await renderer.act(async () => confirmed.unmount());
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t3", values: { enabled: false } });
    expect(confirmRead).toHaveBeenCalledOnce();
    const reopened = await mount();
    expect(reloadFulfilled).not.toHaveBeenCalled();
    await renderer.act(async () => reopened.unmount());
    expect(read).toHaveBeenCalledTimes(2);
    stop();
    // A change while unmounted whose read fails, and fails again for the next hook.
    daemon = current;
    const failing = vi.fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("query failed"))
      .mockRejectedValueOnce(new Error("query failed"))
      .mockImplementation(async () => daemon);
    await renderer.act(async () => store.noteTranslationSettingsChanged(failing));
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "error", error: "query failed", revision: null });
    const failed = await mount();
    expect(failing).toHaveBeenCalledTimes(2);
    // The host's cached t3 is not reopened while the record cannot be read.
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "error", error: "query failed", revision: null });
    expect(reloadFulfilled).not.toHaveBeenCalled();
    await renderer.act(async () => failed.unmount());
    read.mockResolvedValueOnce(current);
    const recovered = await mount();
    expect(failing).toHaveBeenCalledTimes(3);
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t2" });
    // The host's copy (t3) is older than the record read: it is read again.
    await renderer.act(async () => {
      await vi.waitFor(() => expect(reloadFulfilled).toHaveBeenCalledOnce());
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(key)).toMatchObject({ revision: "t2" });
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t2" });
    await renderer.act(async () => recovered.unmount());
    client.clear();
  });

  it.each([false, true])("does not retire the latest notification after an intermediate host revision (initial load=%s)", async (initialLoad) => {
    const { React, renderer, slot } = await load();
    const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
    const store = await import("../../client/translation/settings-store");
    const client = new QueryClient();
    const key = ["translation-settings"];
    const first = { status: "ready" as const, revision: "t1", values: store.DEFAULT_TIMELINE_TRANSLATION_SETTINGS };
    const intermediate = { ...first, revision: "t2", values: { ...first.values, targetLanguage: "ja" } };
    const latest = { ...first, revision: "t3", values: { ...first.values, targetLanguage: "en" } };
    let daemon = first;
    const confirm = vi.fn(async () => daemon);
    const plugin = fakeClient(async () => null, confirm);
    const stop = slot.watchPreferenceChanges(plugin.client as never);
    const read = vi.fn<() => Promise<typeof first>>();
    let finishInitial!: (record: typeof first) => void;
    if (initialLoad) {
      read.mockImplementationOnce(() => new Promise((resolve) => { finishInitial = resolve; }));
    } else {
      client.setQueryData(key, first);
    }
    // Keep the invalidations' responses in flight until an explicit reload
    // replaces them, as when the daemon's response has not reached the host.
    const finishPushReads: ((record: typeof first) => void)[] = [];
    read.mockImplementation(() => new Promise((resolve) => { finishPushReads.push(resolve); }));
    const actions = { saving: false, saveError: null, save: vi.fn(), reset: vi.fn() };
    const reload = vi.fn();
    function Report() {
      const query = useQuery({ queryKey: key, queryFn: read, retry: false, refetchOnMount: false, gcTime: Infinity });
      store.useTranslationSettingsReport({
        ...actions,
        ...(query.data ?? { status: "loading" }),
        reload: async () => { reload(); await query.refetch(); },
      });
      return null;
    }
    const mount = async () => {
      let row!: ReactTestRenderer;
      await renderer.act(async () => {
        row = renderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Report)));
      });
      return row;
    };
    // The revisions the store showed (ready or invalid).
    const shown: (string | null)[] = [];
    const stopSpy = store.translationSettingsSync.subscribe(() => {
      const state = store.getTranslationSettingsState();
      if (state.status === "ready" || state.status === "invalid") shown.push(state.revision);
    });
    let row = await mount();
    await renderer.act(async () => {
      if (initialLoad) {
        finishInitial(intermediate);
        await flush();
        expect(client.getQueryData(key)).toMatchObject({ revision: "t2" });
        expect(store.getTranslationSettingsState().status).toBe("loading");
      } else {
        daemon = intermediate;
        plugin.push("timeline-translation");
        void client.invalidateQueries({ queryKey: key });
      }
      daemon = latest;
      plugin.push("timeline-translation");
      // From the latest push on, only t3 may show.
      shown.length = 0;
      expect(store.getTranslationSettingsState().status).toBe("loading");
      void client.invalidateQueries({ queryKey: key });
      if (!initialLoad) client.setQueryData(key, intermediate);
    });
    await renderer.act(async () => {
      await vi.waitFor(() => expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t3" }));
    });
    // The host still holds t2 (a delayed save or its first read), with its
    // invalidation reads in flight.
    expect(client.getQueryData(key)).toMatchObject({ revision: "t2" });
    await renderer.act(async () => row.unmount());
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t3" });

    read.mockResolvedValueOnce(latest);
    row = await mount();
    await renderer.act(async () => {
      await vi.waitFor(() => expect(client.getQueryData(key)).toMatchObject({ revision: "t3" }));
    });
    expect(reload).toHaveBeenCalled();
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t3" });
    await renderer.act(async () => {
      for (const finish of finishPushReads) finish(intermediate);
    });
    expect(store.getTranslationSettingsState()).toMatchObject({ status: "ready", revision: "t3" });
    expect(client.getQueryData(key)).toMatchObject({ revision: "t3" });
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((revision) => revision !== "t3")).toEqual([]);
    stopSpy();
    await renderer.act(async () => row.unmount());
    stop();
    client.clear();
  });

  it("reads a change the host had not answered when the last settings hook unmounts", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { contribute, preferences, slot, React, renderer } = await load();
    const off = { status: "ready", revision: "r1", values: { chatEnabled: false } };
    let record: unknown = off;
    const plugin = fakeClient(() => Promise.resolve(record));
    const cleanup = contribute(plugin.client as never);
    await flush();

    // The settings page is open, with chat off.
    host.settings = { ...off, save: vi.fn(), reset: vi.fn(), reload: vi.fn(() => Promise.resolve()) };
    const Page = () => {
      slot.usePreferenceSettings();
      return null;
    };
    let page!: ReactTestRenderer;
    await renderer.act(async () => {
      page = renderer.create(React.createElement(Page));
    });

    // Another client turns chat on. The host reads it for the open page, so
    // the watcher does not.
    record = { status: "ready", revision: "r2", values: { chatEnabled: true } };
    plugin.push("presentation");
    await flush();
    expect(plugin.rpc).toHaveBeenCalledTimes(1);

    // The page closes before the host's read answers: no hook reports it.
    await renderer.act(async () => page.unmount());
    await flush();
    expect(plugin.rpc).toHaveBeenCalledTimes(2);
    expect(preferences.getEnhancerPreferences().chatEnabled).toBe(true);
    for (const id of TRANSFORMERS) expect(plugin.active(id)).toHaveLength(1);

    cleanup();
  });

  it("leaves a daemon with no record yet to the settings hook", async () => {
    const { contribute, preferences } = await load();
    const plugin = fakeClient(() =>
      Promise.resolve({ status: "ready", revision: "missing", values: { assistantMarkdown: false } }),
    );
    const cleanup = contribute(plugin.client as never);
    await flush();
    expect(preferences.getEnhancerPreferences().assistantMarkdown).toBe(true);
    expect(plugin.registrations).toHaveLength(TRANSFORMERS.length);
    cleanup();
  });

  it("ignores an answer that arrives after the plugin unloaded", async () => {
    const { contribute, preferences } = await load();
    let answer!: (value: unknown) => void;
    const plugin = fakeClient(() => new Promise((resolve) => (answer = resolve)));
    const cleanup = contribute(plugin.client as never);
    cleanup();
    answer({ status: "ready", revision: "r1", values: { assistantMarkdown: false } });
    await flush();
    expect(preferences.getEnhancerPreferences().assistantMarkdown).toBe(true);
  });

  it("still loads when the read throws or fails", async () => {
    const { contribute } = await load();
    for (const read of [
      () => {
        throw new Error("not connected");
      },
      () => Promise.reject(new Error("offline")),
    ]) {
      const plugin = fakeClient(read);
      const cleanup = contribute(plugin.client as never);
      await flush();
      expect(plugin.registrations.map((entry) => entry.id)).toEqual(TRANSFORMERS);
      cleanup();
    }
  });
});
