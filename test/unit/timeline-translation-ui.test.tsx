import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import type { PaseoAgent, PaseoAgentListResult, PaseoApi } from "@getpaseo/client";
import "./helpers/quiet-renderer";
import { DEFAULT_PREFERENCES, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import {
  DEFAULT_TIMELINE_TRANSLATION_SETTINGS,
  getTranslationSettingsState,
  publishTranslationSettings,
  reportTranslationSettings,
  resetTranslationSettingsStoreForTests,
} from "../../client/translation/settings-store";
import {
  createTranslationAgentConfigStore,
  resetTranslationStoreForTests,
  translationStore,
} from "../../client/translation/store";
import {
  createSelectionTranslation,
  selectionScopeForElement,
  selectionScopeFromDataset,
  selectionSourceKey,
} from "../../client/translation/selection";

type RawAgentConfig = Pick<PaseoAgent, "provider" | "model" | "thinkingOptionId" | "effectiveThinkingOptionId" | "updatedAt">;
type AgentListObserver = Parameters<NonNullable<PaseoAgentListResult["subscription"]>["subscribe"]>[0];

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastError: vi.fn(),
  hover: true,
  api: null as PaseoApi | null,
}));

const initialAgent: RawAgentConfig = {
  provider: "claude",
  model: "claude-sonnet-4-5",
  thinkingOptionId: "high",
  effectiveThinkingOptionId: "high",
  updatedAt: "2026-11-19T10:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createMockAgentApi() {
  let agent = initialAgent;
  const subscriptions: Array<ReturnType<typeof makeSubscription>> = [];
  function makeSubscription() {
    const snapshot = { subscriptionId: "agent-directory", entries: [] } as unknown as Parameters<AgentListObserver["snapshot"]>[0];
    const observers = new Set<AgentListObserver>();
    const unobserve = vi.fn();
    return {
      subscribe(observer: AgentListObserver) {
        observers.add(observer);
        observer.snapshot(snapshot);
        return () => { observers.delete(observer); unobserve(); };
      },
      release: vi.fn(async () => { observers.clear(); }),
      unobserve,
      reconnect() { for (const observer of observers) observer.snapshot(snapshot); },
      update(agentId: string, config: RawAgentConfig) {
        for (const observer of observers) {
          observer.update({ type: "agent_update", payload: { kind: "upsert", agent: { ...config, id: agentId } } } as Parameters<AgentListObserver["update"]>[0]);
        }
      },
    };
  }
  const refresh = vi.fn(async (_agentId: string): Promise<{ agent: RawAgentConfig } | null> => ({ agent }));
  const list = vi.fn(async (_options: { signal?: AbortSignal }) => {
    const subscription = makeSubscription();
    subscriptions.push(subscription);
    return { subscription };
  });
  const api = { agents: { list, ref: (agentId: string) => ({ refresh: () => refresh(agentId) }) } } as unknown as PaseoApi;
  return {
    api, list, refresh, subscriptions,
    current: () => agent,
    setAgent(next: Partial<RawAgentConfig>, agentId = "agent-model-switch") {
      agent = { ...agent, ...next };
      for (const subscription of subscriptions) subscription.update(agentId, agent);
    },
  };
}

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", async () => {
  const ReactModule = await import("react");
  // A pane's host: its own API object and RPC caller, as the plugin host provides per daemon.
  const HostContext = ReactModule.createContext<{ api: PaseoApi; rpc: typeof mocks.rpc } | null>(null);
  return {
    HostContext,
    useAgent: () => undefined,
    usePaseo: () => ReactModule.useContext(HostContext)?.api ?? mocks.api,
    useRpc: () => ReactModule.useContext(HostContext)?.rpc ?? mocks.rpc,
  };
});
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const ReactModule = await import("react");
  return {
    Icon: (props: Record<string, unknown>) => ReactModule.createElement("Icon", props),
    copyText: vi.fn(async () => true),
    useToast: () => ({ show() {}, error: mocks.toastError }),
  };
});
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: (compact = false) => ({
    hover: mocks.hover,
    touch: !mocks.hover,
    compact,
    native: false,
  }),
}));
vi.mock("../../client/ui/chat-composer", async () => {
  const ReactModule = await import("react");
  return { ChatComposerContext: ReactModule.createContext(null) };
});
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/details/shell/details-host-slot", () => ({ DetailsHostSlot: () => null }));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/components/turn-footer", () => ({ AssistantFooter: () => null }));
vi.mock("../../client/timeline-tail", () => ({ useTextItemTailKey: () => "reply-tail" }));
vi.mock("../../client/timeline-order", () => ({
  useHasEntryAfter: () => false,
  useNextEntryIsRow: () => false,
  useTimelineEntry() {},
  useTimelineToolGroup: () => ({ position: "solo", inGroup: false }),
}));
vi.mock("../../client/host-row-gap", () => ({ useHostStacksRows: () => false }));

import { LiveAssistantRenderer, LiveReasoningRenderer } from "../../client/live-renderers";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { SelectionTranslationScope } from "../../client/translation/ui";
import * as pluginClient from "@getpaseo/plugin/client";

const HostContext = (pluginClient as unknown as { HostContext: React.Context<{ api: PaseoApi; rpc: typeof mocks.rpc } | null> }).HostContext;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f7",
    surface2: "#ededef",
    border: "#e2e2e6",
    foreground: "#18181b",
    foregroundMuted: "#62626b",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d92d20",
  },
};

function makeTokens(platform: "web" | "ios" = "web") {
  return buildThemeTokens(theme.colors, { ...DEFAULT_PREFERENCES, language: "en" }, { platform });
}

function collectTexts(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => {
      const ch = node.props.children;
      if (typeof ch === "string") return ch;
      if (Array.isArray(ch)) return ch.filter((c) => typeof c === "string").join("");
      return "";
    })
    .filter(Boolean);
}

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let agentApi: ReturnType<typeof createMockAgentApi>;

beforeEach(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  mocks.hover = true;
  agentApi = createMockAgentApi();
  mocks.api = agentApi.api;
  mocks.rpc.mockReset();
  mocks.toastError.mockReset();
  resetEnhancerPreferences();
  updateEnhancerPreferences({ language: "en", assistantMarkdown: true });
  resetTranslationSettingsStoreForTests();
  publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true }, "init-1");
  resetTranslationStoreForTests();
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("timeline translation agent configuration", () => {
  it("shares one feed per host and one initial refresh per visible agent", async () => {
    const config = createTranslationAgentConfigStore(agentApi.api);
    const retireReply = config.subscribe("agent-1", vi.fn());
    const retireThought = config.subscribe("agent-1", vi.fn());
    const retireOther = config.subscribe("agent-2", vi.fn());
    expect(config.read("agent-1")).toEqual({ status: "loading" });
    expect(agentApi.refresh).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(config.read("agent-1").status).toBe("ready"));
    expect(agentApi.list).toHaveBeenCalledOnce();
    expect(agentApi.refresh.mock.calls).toEqual([["agent-1"], ["agent-2"]]);

    const otherApi = createMockAgentApi();
    otherApi.setAgent({ effectiveThinkingOptionId: "low" });
    const otherHost = createTranslationAgentConfigStore(otherApi.api);
    const retireHost = otherHost.subscribe("agent-1", vi.fn());
    await vi.waitFor(() => expect(otherHost.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "low" } }));
    expect(config.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "high" } });

    const feed = agentApi.subscriptions[0]!;
    retireReply();
    retireThought();
    expect(feed.release).not.toHaveBeenCalled();
    retireOther();
    expect(feed.unobserve).toHaveBeenCalledOnce();
    expect(feed.release).toHaveBeenCalledOnce();
    expect(otherApi.subscriptions[0]!.release).not.toHaveBeenCalled();
    retireHost();
  });

  it("refreshes on reconnect and keeps live configuration ahead of late reads", async () => {
    const config = createTranslationAgentConfigStore(agentApi.api);
    const listener = vi.fn();
    const retire = config.subscribe("agent-1", listener);
    await vi.waitFor(() => expect(config.read("agent-1").status).toBe("ready"));
    const feed = agentApi.subscriptions[0]!;
    const delayed = deferred<{ agent: RawAgentConfig }>();
    agentApi.refresh.mockReturnValueOnce(delayed.promise);
    feed.reconnect();
    expect(config.read("agent-1")).toEqual({ status: "loading" });
    expect(agentApi.refresh).toHaveBeenCalledTimes(2);

    const beforeUpdate = listener.mock.calls.length;
    agentApi.setAgent({ effectiveThinkingOptionId: "low", updatedAt: "2026-11-19T10:01:00.000Z" }, "agent-1");
    expect(config.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "low" } });
    feed.update("agent-1", initialAgent);
    delayed.resolve({ agent: initialAgent });
    await delayed.promise;
    expect(config.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "low" } });
    expect(listener).toHaveBeenCalledTimes(beforeUpdate + 1);

    agentApi.setAgent({ effectiveThinkingOptionId: null, thinkingOptionId: "off" }, "other-agent");
    feed.reconnect();
    await vi.waitFor(() => expect(config.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "off" } }));
    expect(agentApi.list).toHaveBeenCalledOnce();
    retire();
  });

  it("releases a late feed after the last row leaves and ignores refreshes from retired entries", async () => {
    const firstFeed = await agentApi.list({});
    const opening = deferred<typeof firstFeed>();
    agentApi.list.mockClear().mockReturnValueOnce(opening.promise);
    const config = createTranslationAgentConfigStore(agentApi.api);
    const retire = config.subscribe("agent-1", vi.fn());
    retire();
    expect(agentApi.list.mock.calls[0]?.[0].signal?.aborted).toBe(true);

    const oldRefresh = deferred<{ agent: RawAgentConfig }>();
    agentApi.refresh.mockReturnValueOnce(oldRefresh.promise);
    const retireOld = config.subscribe("agent-1", vi.fn());
    await vi.waitFor(() => expect(agentApi.refresh).toHaveBeenCalledOnce());
    opening.resolve(firstFeed);
    await opening.promise;
    expect(firstFeed.subscription.release).toHaveBeenCalledOnce();
    expect(agentApi.refresh).toHaveBeenCalledOnce();

    retireOld();
    agentApi.setAgent({ effectiveThinkingOptionId: "medium" });
    const retireNew = config.subscribe("agent-1", vi.fn());
    await vi.waitFor(() => expect(config.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "medium" } }));
    oldRefresh.resolve({ agent: initialAgent });
    await oldRefresh.promise;
    expect(config.read("agent-1")).toMatchObject({ config: { thinkingOptionId: "medium" } });
    retireNew();
  });
});


function doneState(translation: string, extra: Record<string, unknown> = {}) {
  return {
    state: "done" as const,
    translation,
    targetLanguageCode: "zh-CN",
    provider: "claude",
    model: "claude-sonnet-4-5",
    thinkingMode: "disabled" as const,
    thinkingOptionId: "off",
    ...extra,
  };
}

const translator = () => ({ call: mocks.rpc as never, watch: () => () => {} });

function selection(text: string, overrides: Partial<Parameters<typeof createSelectionTranslation>[0]> = {}) {
  return createSelectionTranslation({
    agentId: "agent-1",
    kind: "assistant_message",
    text,
    streaming: false,
    translator: translator(),
    configStore: createTranslationAgentConfigStore(agentApi.api),
    interfaceLanguage: () => "en",
    ...overrides,
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe("selection translation", () => {
  it("sends nothing until Translate, then exactly the selected text with the observed model", async () => {
    mocks.rpc.mockResolvedValue(doneState("你好"));
    const job = selection("Hello there");
    await settle();
    expect(job.view()).toBeNull();
    expect(agentApi.refresh).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();

    job.start();
    expect(job.view()).toEqual({ status: "config-loading" });
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const input = mocks.rpc.mock.calls[0]![0];
    expect(input).toMatchObject({
      action: "start", agentId: "agent-1", text: "Hello there", sourceKind: "assistant_message", interfaceLanguage: "en",
    });
    expect(JSON.parse(input.configSignature)).toMatchObject({ provider: "claude", model: "claude-sonnet-4-5", thinkingOptionId: "high" });
    expect(job.view()).toMatchObject({ status: "done", result: { translation: "你好" } });
    job.dispose();
  });

  it("uses the custom model without reading the conversation model", async () => {
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, customModel: true, provider: "codex", model: "gpt-5" }, "custom");
    mocks.rpc.mockResolvedValue(doneState("好"));
    const job = selection("Fine");
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(agentApi.list).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.rpc.mock.calls[0]![0].configSignature)).toMatchObject({ provider: "codex", model: "gpt-5" });
    job.dispose();
  });

  it("explains settings, disabled, streaming and missing-translator states without sending or falling back", async () => {
    mocks.rpc.mockResolvedValue(doneState("好"));
    resetTranslationSettingsStoreForTests();
    const job = selection("Wait");
    job.start();
    expect(job.view()).toEqual({ status: "settings-loading" });
    reportTranslationSettings({ status: "invalid", error: "bad", revision: "r1" });
    expect(job.view()).toEqual({ status: "settings-invalid", error: "bad" });
    reportTranslationSettings({ status: "error", error: "offline" });
    expect(job.view()).toMatchObject({ status: "settings-error", error: "offline" });
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "off");
    expect(job.view()).toEqual({ status: "disabled" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    job.dispose();

    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true }, "on");
    const streaming = selection("Partial", { streaming: true, kind: "reasoning" });
    streaming.start();
    expect(streaming.view()).toEqual({ status: "streaming", kind: "reasoning" });
    await settle();
    expect(mocks.rpc).not.toHaveBeenCalled();
    // The press stands: once the source settles, the same selection is sent.
    streaming.setStreaming(false);
    await vi.waitFor(() => expect(streaming.view()?.status).toBe("done"));
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ text: "Partial", sourceKind: "reasoning" });
    streaming.dispose();

    const orphan = selection("No host", { translator: undefined });
    orphan.start();
    expect(orphan.view()).toEqual({ status: "unavailable" });
    orphan.dispose();
  });

  it("keeps one selection's result away from another and reuses the same selection's cache", async () => {
    const first = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockImplementationOnce(() => first.promise).mockResolvedValue(doneState("第二段"));
    const one = selection("First paragraph");
    one.start();
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    // The reader moves to another selection while the first job runs.
    one.dispose();
    const two = selection("Second paragraph");
    two.start();
    await vi.waitFor(() => expect(two.view()?.status).toBe("done"));
    first.resolve(doneState("第一段"));
    await settle();
    expect(two.view()).toMatchObject({ result: { translation: "第二段" } });
    const host = {};
    expect(selectionSourceKey(host, "agent-1", "assistant_message", "First paragraph"))
      .not.toBe(selectionSourceKey(host, "agent-1", "assistant_message", "Second paragraph"));
    expect(selectionSourceKey(host, "agent-1", "assistant_message", "Same"))
      .not.toBe(selectionSourceKey(host, "agent-2", "assistant_message", "Same"));
    expect(selectionSourceKey(host, "agent-1", "assistant_message", "Same"))
      .not.toBe(selectionSourceKey({}, "agent-1", "assistant_message", "Same"));
    two.dispose();

    // Selecting the first paragraph again shows its finished job without another request.
    const again = selection("First paragraph");
    again.start();
    await vi.waitFor(() => expect(again.view()?.status).toBe("done"));
    expect(again.view()).toMatchObject({ result: { translation: "第一段" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    // Retry asks for a new job.
    again.start();
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(3));
    again.dispose();
  });

  it("turns stale instead of re-sending when settings or the model change, and errors offer retry", async () => {
    mocks.rpc.mockResolvedValueOnce(doneState("一")).mockRejectedValueOnce(new Error("quota")).mockResolvedValue(doneState("二"));
    const job = selection("One", { agentId: "agent-model-switch" });
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    agentApi.setAgent({ model: "claude-opus-4-5", updatedAt: "2026-11-19T10:05:00.000Z" });
    expect(job.view()).toEqual({ status: "stale" });
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, targetLanguage: "ja" }, "ja");
    expect(job.view()).toEqual({ status: "stale" });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledOnce();

    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("error"));
    expect(job.view()).toMatchObject({ status: "error", error: "quota" });
    expect(JSON.parse(mocks.rpc.mock.calls[1]![0].configSignature)).toMatchObject({ model: "claude-opus-4-5", targetCode: "ja" });
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    job.dispose();
  });

  it("reports a model read failure and reads again on retry", async () => {
    agentApi.refresh.mockResolvedValueOnce(null);
    mocks.rpc.mockResolvedValue(doneState("好"));
    const job = selection("Model");
    job.start();
    await vi.waitFor(() => expect(job.view()).toEqual({ status: "config-error" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(agentApi.refresh).toHaveBeenCalledTimes(2);
    job.dispose();
    // Disposing releases the model feed it held.
    expect(agentApi.subscriptions[0]!.release).toHaveBeenCalled();
  });


});

const assistantProps = (data: Record<string, unknown>, platform: "web" | "ios" | "android" = "web", agentId = "agent-1") => ({
  agentId,
  item: { id: "row-1", type: "plugin" as const, kind: "omp-assistant", version: 1, data },
  theme,
  layout: { compact: platform !== "web", platform },
  timestamp: new Date("2026-11-19T10:00:00Z"),
});

const markdownRoots = () => renderer!.root.findAll((node) =>
  String(node.type) === "View" && Boolean(node.props.dataSet?.bcselection));

describe("timeline rows offer translation only through selection", () => {
  it("draws replies and thoughts without per-block translate buttons or inline results", async () => {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        React.createElement(LiveAssistantRenderer, assistantProps({ text: "Hello Paseo", phase: "complete" }) as never),
        React.createElement(LiveReasoningRenderer, {
          ...assistantProps({ text: "Thinking about it", phase: "complete" }),
          item: { id: "t", type: "plugin", kind: "omp-reasoning", version: 1, data: { text: "Thinking about it", phase: "complete" } },
        } as never)));
    });
    const labels = renderer!.root.findAll((node) => typeof node.props?.accessibilityLabel === "string")
      .map((node) => node.props.accessibilityLabel as string);
    expect(labels.filter((label) => /translat/i.test(label))).toEqual([]);
    expect(renderer!.root.findAll((node) => node.props?.testID === "translation-row")).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(agentApi.list).not.toHaveBeenCalled();
  });

  it("binds a web reply's prose element to its conversation and its own pane's host", async () => {
    const elements: object[] = [];
    const nodeMock = { createNodeMock: () => { const element = {}; elements.push(element); return element; } };
    const otherHost = createMockAgentApi();
    const otherRpc = vi.fn();
    // Two panes on two hosts show the same agent id.
    const panes = (phase: string) => React.createElement(React.Fragment, null,
      React.createElement(LiveAssistantRenderer, assistantProps({ text: "Hello Paseo", phase }) as never),
      React.createElement(HostContext.Provider, { value: { api: otherHost.api, rpc: otherRpc } },
        React.createElement(LiveAssistantRenderer, assistantProps({ text: "Hello Paseo", phase }) as never)));
    await act(async () => {
      renderer = TestRenderer.create(panes("streaming"), nodeMock);
    });
    const roots = markdownRoots();
    expect(roots.map((node) => selectionScopeFromDataset(node.props.dataSet))).toEqual([
      { agentId: "agent-1", kind: "assistant_message", streaming: true },
      { agentId: "agent-1", kind: "assistant_message", streaming: true },
    ]);
    const bound = () => elements.map((element) => selectionScopeForElement(element)).filter(Boolean);
    expect(bound().map((scope) => scope!.lent!.paseo)).toEqual([agentApi.api, otherHost.api]);
    await bound()[1]!.lent!.translator.call({ action: "status", jobId: "x" });
    expect(otherRpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(bound().every((scope) => scope!.streaming)).toBe(true);

    await act(async () => {
      renderer!.update(panes("complete"));
    });
    expect(bound().map((scope) => scope!.streaming)).toEqual([false, false]);
    act(() => renderer!.unmount());
    renderer = undefined;
    expect(bound()).toEqual([]);
  });

  it("leaves system cards and unscoped prose untranslatable", async () => {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        React.createElement(MarkdownView, { text: "Tool output", tokens: makeTokens("web"), variant: "document" }),
        React.createElement(SelectionTranslationScope, { agentId: "agent-1", kind: "assistant_message", streaming: false, enabled: false } as never,
          React.createElement(MarkdownView, { text: "System", tokens: makeTokens("web"), variant: "document" }))));
    });
    expect(markdownRoots()).toHaveLength(2);
    expect(markdownRoots().map((node) => selectionScopeFromDataset(node.props.dataSet))).toEqual([null, null]);
    expect(markdownRoots().map((node) => node.props.ref)).toEqual([undefined, undefined]);
  });

  it("does not redraw rows when translation jobs change", async () => {
    let commits = 0;
    mocks.rpc.mockResolvedValue(doneState("好"));
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(React.Profiler, { id: "rows", onRender: () => { commits += 1; } },
        React.createElement(LiveAssistantRenderer, assistantProps({ text: "Hello Paseo", phase: "complete" }) as never)));
    });
    const before = commits;
    const job = selection("Hello Paseo");
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    await settle();
    expect(commits).toBe(before);
    job.dispose();
  });
});

describe.each(["ios", "android"] as const)("%s double-tapped block menu", (platform) => {
  const frames = () => renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "markdown-block-selection");
  const button = (label: string) => renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === label);
  const touch = (timestamp: number) => ({ stopPropagation: vi.fn(), nativeEvent: { timestamp, pageX: 10, pageY: 10, touches: [{}] } });
  function select(index: number) {
    for (const time of [100, 230]) {
      act(() => frames()[index]!.props.onTouchStart(touch(time)));
      act(() => frames()[index]!.props.onTouchEnd(touch(time + 30)));
    }
  }
  const panelText = () => collectTexts(renderer!.root.find((node) => node.props.testID === "selection-translation-panel")).join("\n");

  beforeEach(() => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    mocks.hover = false;
  });

  it("translates exactly the selected block in a popup and closes with the selection", async () => {
    const reply = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockImplementationOnce(() => reply.promise);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "First paragraph.\n\nSecond **paragraph**.", phase: "complete" }, platform) as never));
    });
    expect(button("Translate selected block")).toHaveLength(0);
    select(1);
    expect(button("Copy selected block")).toHaveLength(1);
    const separator = renderer!.root.findByProps({ testID: "translation-menu-separator" });
    expect(separator.props.style.flat()).toEqual(expect.arrayContaining([expect.objectContaining({ width: 0.5 })]));
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ text: "Second paragraph.", agentId: "agent-1", sourceKind: "assistant_message" });
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(1);
    expect(panelText()).toContain("Translating...");

    await act(async () => reply.resolve(doneState("第二段。", { thinkingMode: "unsupported_off", thinkingOptionId: "low" })));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("第二段。"));
    expect(button("Copy translation")).toHaveLength(1);
    expect(panelText()).not.toContain("Thinking was NOT disabled");
    // Prose in the popup is not itself translatable.
    const popupScope = renderer!.root.find((node) => node.props.testID === "selection-translation-panel")
      .findAll((node) => node.props.testID === "markdown-block-selection");
    for (const block of popupScope) expect(block.findAll((node) => node.props.accessibilityLabel === "Translate selected block")).toHaveLength(0);

    // Closing the popup ends the selection with it.
    const modal = renderer!.root.find((node) => String(node.type) === "Modal");
    await act(async () => modal.props.onRequestClose());
    expect(renderer!.root.findAll((node) => node.props.testID === "markdown-block-highlight")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(0);

    // Another block never shows this result; the same block reuses it.
    select(0);
    expect(renderer!.root.findAll((node) => node.props.testID === "selection-translation-panel")).toHaveLength(0);
    select(1);
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    expect(JSON.stringify(renderer!.toJSON())).toContain("第二段。");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("waits for a streaming reply and shows errors with retry", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("provider down")).mockResolvedValue(doneState("好的"));
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "Done part.\n\nStill writing", phase: "streaming" }, platform) as never));
    });
    select(0);
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    expect(panelText()).toContain("Wait until the reply finishes streaming");
    await settle();
    expect(mocks.rpc).not.toHaveBeenCalled();

    // The reply settles: the press stands and the selected block is sent.
    await act(async () => {
      renderer!.update(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "Done part.\n\nStill writing", phase: "complete" }, platform) as never));
    });
    await vi.waitFor(() => expect(panelText()).toContain("provider down"));
    expect(mocks.rpc.mock.calls[0]![0].text).toBe("Done part.");
    await act(async () => button("Retry")[0]!.props.onPress());
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("好的"));
  });

  it("offers no Translate outside a conversation or when translation is off", async () => {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(MarkdownView, { text: "Settings preview.", tokens: makeTokens("ios"), variant: "document" }));
    });
    select(0);
    expect(button("Copy selected block")).toHaveLength(1);
    expect(button("Translate selected block")).toHaveLength(0);
    act(() => renderer!.unmount());

    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "off");
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "Reply.", phase: "complete" }, platform) as never));
    });
    select(0);
    expect(button("Translate selected block")).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ testID: "translation-menu-separator" })).toHaveLength(0);
  });
});
