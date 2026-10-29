import { beforeEach, describe, expect, it, vi } from "vitest";

// contribute() asks the daemon for the stored preferences itself, so iOS and
// Android (no localStorage) do not project the first timeline with the
// defaults and then again once a row mounts the settings hook.

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => null,
  useSettings: () => ({ status: "loading" }),
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
  "omp-enhanced-error",
];

function fakeClient(read: () => unknown) {
  const registrations: Registration[] = [];
  const rpc = vi.fn((contract: { name: string }) => {
    if (contract.name === "settings.presentation.read") return read();
    return Promise.reject(new Error(`unexpected rpc ${contract.name}`));
  });
  const client = {
    rpc,
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
  return { client, rpc, registrations, active };
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
  return { contribute, preferences };
}

describe("preferences read while the plugin loads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
