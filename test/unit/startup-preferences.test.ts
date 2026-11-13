import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactTestRenderer } from "react-test-renderer";
import "./helpers/quiet-renderer";

// contribute() asks the daemon for the stored preferences itself, so iOS and
// Android (no localStorage) do not project the first timeline with the
// defaults and then again once a row mounts the settings hook.

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
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

function fakeClient(read: () => unknown) {
  const registrations: Registration[] = [];
  const rpc = vi.fn((contract: { name: string }) => {
    if (contract.name === "settings.presentation.read") return read();
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
    expect(second.transform(other)).toBeDefined();
    expect(second.transform(reply)).toBeDefined();
    preferences.updateEnhancerPreferences({ liveUiReplies: false });
    const third = plugin.active("omp-enhanced-assistant")[0]!;
    expect(third.transform(ui)).toBeDefined();
    preferences.updateEnhancerPreferences({ assistantMarkdown: false, liveUiReplies: true });
    expect(plugin.active("omp-enhanced-assistant")[0]!.transform(reply)).toBeUndefined();
    cleanup();
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
