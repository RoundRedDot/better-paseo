import React from "react";
import { StyleSheet } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import type { PaseoAgent, PaseoAgentListResult, PaseoApi } from "@getpaseo/client";
import type { TranslationJobState } from "../../shared/timeline-translation";
import "./helpers/quiet-renderer";
import { hostChildren, measureHostTree } from "./helpers/yoga-host-layout";
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
  resetTranslationStoreForTests,
  translationStore,
} from "../../client/translation/store";
import { clearTranslationSettingsTarget, registerTranslationSettingsOpener, translationSettingsTarget, TranslationSettingsParentCloseContext } from "../../client/translation/navigation";
import {
  createSelectionTranslation,
  SelectionTranslationContext,
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
      fail(error: Error) { for (const observer of observers) observer.error?.(error); },
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
    useRpc: (definition?: { name: string }) => {
      const rpc = ReactModule.useContext(HostContext)?.rpc ?? mocks.rpc;
      return definition?.name === "file.home" ? readHome : rpc;
    },
  };
});
const readHome = vi.hoisted(() => vi.fn(async () => ({ home: "/Users/me" })));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const ReactModule = await import("react");
  return {
    Modal: Object.assign((props: { children?: React.ReactNode; onOpenChange(open: boolean): void }) => ReactModule.createElement("Modal", { onRequestClose: () => props.onOpenChange(false) }, props.children), {
      Content: (props: { children?: React.ReactNode; scrollable?: boolean }) => ReactModule.createElement("SheetContent", props, props.children),
    }),
    Icon: (props: Record<string, unknown>) => ReactModule.createElement("Icon", props),
    copyText: vi.fn(async () => true),
    useToast: () => ({ show() {}, error: mocks.toastError }),
  };
});
vi.mock("../../client/ui/use-input-capabilities", () => ({
  noteHover: vi.fn(),
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
vi.mock("../../client/timeline-tail", () => ({ useTextItemTailKey: () => ({ key: "reply-tail", previous: null }),
  useNoteTimelineItem: () => {}, useIsTimelineTail: () => false, useTimelineTailAt: () => null }));
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
import { MessageTranslateButton } from "../../client/translation/message-button";
import { WholeReplyTranslateButton } from "../../client/translation/reply-whole";
import { replyTranslationKey } from "../../client/translation/reply-pending";
import { InlineTranslateButtonWithTokens } from "../../client/translation/inline";
import { ToolbarCopyButton, ToolbarMetricsContext } from "../../client/ui/toolbar-button";
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { segmentReasoning } from "../../client/reasoning/segment";
import { DisclosureHeader } from "../../client/ui/disclosure-header";
import { BlockPlacementContext } from "../../client/details/contracts";
import { getBlock } from "../../client/details/block-registry";
import { SelectionTranslationPanel, SHOW_ORIGINAL_ICON, TRANSLATE_ICON } from "../../client/translation/ui";
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

const CONFIGURED = { ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, mode: "openai", endpoint: "https://api.example.test/v1", endpointModel: "test-model" };

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
  publishTranslationSettings(CONFIGURED, "init-1");
  resetTranslationStoreForTests();
});

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

function doneState(translation: string, extra: Record<string, unknown> = {}) {
  return {
    state: "done" as const,
    translation,
    targetLanguageCode: "zh-CN",
    origin: "https://api.example.test",
    model: "test-model",
    ...extra,
  };
}

const translator = () => ({ call: mocks.rpc as never });

it.each(["web", "ios", "android"] as const)("%s inline translation spinner follows the toolbar icon size", async (platform) => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
  for (const iconSize of [13, 21]) {
    const draw = (loading: boolean) => React.createElement(ToolbarMetricsContext.Provider, {
      value: { button: iconSize * 2, icon: iconSize },
      children: React.createElement(InlineTranslateButtonWithTokens, {
        state: { active: loading, view: loading ? { status: "running", targetCode: "zh-CN" } : null, toggle() {} },
        tokens: makeTokens(), testID: "sized-translate", timeline: true,
      }),
    });
    await act(async () => { renderer = TestRenderer.create(draw(false)); });
    const translate = renderer!.root.find((node) => String(node.type) === "Icon" && node.props.icon === TRANSLATE_ICON);
    expect(translate.props.size).toBe(iconSize);
    await act(async () => { renderer!.update(draw(true)); });
    const mark = renderer!.root.find((node) => String(node.type) === "View" && node.props.testID === "running-mark");
    expect(mark.props.style.width).toBe(iconSize);
    expect(mark.props.style.height).toBe(iconSize);
    await act(async () => { renderer!.unmount(); });
    renderer = undefined;
  }
});

describe.each(["web", "ios", "android"] as const)("%s whole-message translation", (platform) => {
  it("hides the action when translation is disabled", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "off");
    await act(async () => { renderer = TestRenderer.create(React.createElement(MessageTranslateButton, {
      agentId: "agent-1", kind: "assistant_message", text: "Hello", streaming: false, theme, testID: "whole-translate",
    })); });
    expect(renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.testID === "whole-translate")).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends the entire message only when pressed", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    const text = "First line.\n\nSecond **paragraph** with `file.ts`.";
    await act(async () => { renderer = TestRenderer.create(React.createElement(MessageTranslateButton, {
      agentId: "agent-1", kind: "user_message", text, streaming: false, theme, testID: "whole-translate",
    })); });
    expect(mocks.rpc).not.toHaveBeenCalled();
    const stopPropagation = vi.fn();
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "whole-translate").props.onPress({ stopPropagation }));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ agentId: "agent-1", sourceKind: "user_message", text });
    const spinner = () => renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "whole-translate-spinner");
    expect(spinner()).toHaveLength(1);
    expect(renderer!.root.findAll((node) => node.props.testID === "selection-translation-panel")).toHaveLength(0);
    await act(async () => pending.resolve(doneState("完整译文")));
    expect(spinner()).toHaveLength(0);
    if (platform !== "web") expect(JSON.stringify(renderer!.toJSON())).toContain("完整译文");
  });

  it("keeps the pressed text while a reply streams and waits for completion", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    mocks.rpc.mockResolvedValue(doneState("译文"));
    const props = { agentId: "agent-1", kind: "assistant_message" as const, text: "First chunk", streaming: true, theme, testID: "whole-translate" };
    await act(async () => { renderer = TestRenderer.create(React.createElement(MessageTranslateButton, props)); });
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "whole-translate").props.onPress({ stopPropagation() {} }));
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => renderer!.update(React.createElement(MessageTranslateButton, { ...props, text: "First chunk and more", streaming: false })));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ text: "First chunk", sourceKind: "assistant_message" });
  });

  it.runIf(platform !== "web")("keeps the sheet open while Retry runs", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const retried = deferred<TranslationJobState>();
    mocks.rpc.mockRejectedValueOnce(new Error("provider down")).mockReturnValueOnce(retried.promise);
    await act(async () => { renderer = TestRenderer.create(React.createElement(MessageTranslateButton, {
      agentId: "agent-1", kind: "user_message", text: "Hello", streaming: false, theme, testID: "whole-translate",
    })); });
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "whole-translate").props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("provider down"));
    const modals = () => renderer!.root.findAll((node) => String(node.type) === "Modal");
    expect(modals()).toHaveLength(1);
    const retry = renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Retry");
    await act(async () => retry.props.onPress());
    expect(modals()).toHaveLength(1);
    await act(async () => retried.resolve(doneState("你好")));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("你好"));
    expect(modals()).toHaveLength(1);
    await act(async () => modals()[0]!.props.onRequestClose());
    expect(modals()).toHaveLength(0);
  });
});

// A pointer (here an iPad's) reaches a closed thought's actions by hovering its row; touch shows them once opened.
it.each([
  { label: "a closed thought", text: "First thought.\n\nSecond **paragraph**.", expanded: false },
  { label: "a one-line thought with nothing to open", text: "Short thought.", expanded: true },
])("shows a thought's translation failure under the header of $label", async ({ text, expanded }) => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  mocks.rpc.mockRejectedValueOnce(new Error("provider down"));
  await act(async () => { renderer = TestRenderer.create(React.createElement(ReasoningCard, {
    segmentation: segmentReasoning(text), streaming: false, durationMs: null, expanded,
    onToggle: vi.fn(), tokens: makeTokens(), storeKey: "translation-thought-closed", copyText: text,
    translation: { agentId: "agent-1", theme },
  })); });
  await act(async () => renderer!.root.findByType(DisclosureHeader).findAll((node) => typeof node.props.onHoverIn === "function")[0]!.props.onHoverIn());
  await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reasoning-translate").props.onPress({ stopPropagation() {} }));
  const status = () => renderer!.root.findAll((node) => String(node.type) === "Text" && node.props.testID === "inline-translation-status");
  await vi.waitFor(() => expect(status()).toHaveLength(1));
  expect(collectTexts(status()[0]!).join("")).toContain("provider down");
});

it("translates the thought inside its preview and restores the source", async () => {
  const text = "First thought.\n\nSecond paragraph.";
  mocks.rpc.mockResolvedValueOnce(doneState("完整思考译文"));
  await act(async () => { renderer = TestRenderer.create(React.createElement(ReasoningCard, {
    segmentation: segmentReasoning(text), streaming: false, durationMs: null, expanded: false,
    onToggle: vi.fn(), tokens: makeTokens(), storeKey: "thought-preview", copyText: text,
    translation: { agentId: "agent-1", theme },
  })); });
  const previewContent = renderer!.root.findByType(DisclosureHeader).props.previewContent();
  await act(async () => { renderer!.update(previewContent); });
  const button = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reasoning-preview-translate");
  await act(async () => button().props.onPress({ stopPropagation() {} }));
  expect(mocks.rpc).toHaveBeenCalledWith(expect.objectContaining({ text, sourceKind: "reasoning" }));
  expect(JSON.stringify(renderer!.toJSON())).toContain("完整思考译文");
  await act(async () => button().props.onPress({ stopPropagation() {} }));
  expect(JSON.stringify(renderer!.toJSON())).toContain("First thought");
});

describe.each(["web", "ios", "android"] as const)("%s thought translation", (platform) => {

  it("honors the setting and translates the same complete thought as copy", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    mocks.hover = false;
    const text = "First thought.\n\nSecond **paragraph**.";
    const card = React.createElement(ReasoningCard, {
      segmentation: segmentReasoning(text), streaming: false, durationMs: null, expanded: true,
      onToggle: vi.fn(), tokens: makeTokens(), storeKey: "translation-thought", copyText: text,
      translation: { agentId: "agent-1", theme },
    });
    publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "thought-off");
    await act(async () => { renderer = TestRenderer.create(card); });
    expect(renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.testID === "reasoning-translate")).toHaveLength(0);
    await act(async () => { publishTranslationSettings(CONFIGURED, "thought-on"); });
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    const button = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reasoning-translate");
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ agentId: "agent-1", sourceKind: "reasoning", text });
    expect(renderer!.root.findAll((node) => node.props.testID === "inline-translation-status")).toHaveLength(0);
    expect(button().findAll((node) => String(node.type) === "View" && node.props.testID === "reasoning-translate-spinner")).toHaveLength(1);
    await act(async () => pending.resolve(doneState("译文")));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("译文"));
    expect(button().findAll((node) => node.props.testID === "reasoning-translate-spinner")).toHaveLength(0);
    expect(renderer!.root.findByType(DisclosureHeader).props.actionsActive).toBe(true);
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reasoning-translate").props.onPress({ stopPropagation() {} }));
    expect(renderer!.root.findByType(DisclosureHeader).props.actionsActive).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain("First thought");
  });
});

it("uses each message's own host for whole-message translation", async () => {
  publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, mode: "openai", endpoint: "https://api.example.test/v1", endpointModel: "model" }, "custom");
  const other = createMockAgentApi();
  const firstRpc = vi.fn().mockResolvedValue(doneState("first"));
  const secondRpc = vi.fn().mockResolvedValue(doneState("second"));
  const message = { agentId: "same-agent", kind: "assistant_message" as const, text: "Same message", streaming: false, theme };
  await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
    React.createElement(HostContext.Provider, { value: { api: agentApi.api, rpc: firstRpc } }, React.createElement(MessageTranslateButton, { ...message, testID: "first-translation" })),
    React.createElement(HostContext.Provider, { value: { api: other.api, rpc: secondRpc } }, React.createElement(MessageTranslateButton, { ...message, testID: "second-translation" })))); });
  const press = (id: string) => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === id).props.onPress({ stopPropagation() {} });
  await act(async () => press("first-translation"));
  await vi.waitFor(() => expect(firstRpc).toHaveBeenCalledOnce());
  expect(secondRpc).not.toHaveBeenCalled();
  await act(async () => renderer!.root.find((node) => typeof node.type === "function" && node.type.name === "WebMessageTranslation").props.close());
  await act(async () => press("second-translation"));
  await vi.waitFor(() => expect(secondRpc).toHaveBeenCalledOnce());
  expect(renderer!.root.find((node) => typeof node.type === "function" && node.type.name === "WebMessageTranslation").props.view.result.translation).toBe("second");
});

function selection(text: string, overrides: Partial<Parameters<typeof createSelectionTranslation>[0]> = {}) {
  return createSelectionTranslation({
    agentId: "agent-1",
    kind: "assistant_message",
    text,
    streaming: false,
    translator: translator(),
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
  it("sends nothing until Translate, then exactly the selected text under the configured endpoint", async () => {
    mocks.rpc.mockResolvedValue(doneState("你好"));
    const job = selection("Hello there");
    await settle();
    expect(job.view()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();

    job.start();
    expect(job.view()).toMatchObject({ status: "running", modelInfo: { provider: "https://api.example.test/v1", model: "test-model" } });
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    const input = mocks.rpc.mock.calls[0]![0];
    expect(input).toMatchObject({
      action: "start", agentId: "agent-1", text: "Hello there", sourceKind: "assistant_message", interfaceLanguage: "en",
    });
    expect(JSON.parse(input.configSignature)).toEqual({
      enabled: true, targetCode: "en", endpoint: "https://api.example.test/v1", endpointModel: "test-model", prompt: CONFIGURED.prompt,
    });
    expect(job.view()).toMatchObject({ status: "done", result: { translation: "你好" }, modelInfo: { provider: "https://api.example.test", model: "test-model" } });
    // The conversation's own provider and model are never read.
    expect(agentApi.refresh).not.toHaveBeenCalled();
    expect(agentApi.list).not.toHaveBeenCalled();
    job.dispose();
  });

  it.each([
    ["no endpoint", { endpoint: "" }],
    ["no model", { endpointModel: "" }],
  ])("sends nothing with %s and says what to set", async (_label, patch) => {
    // Settings migrated from the helper translator: enabled, a provider and model, no endpoint.
    publishTranslationSettings({ ...CONFIGURED, customModel: true, provider: "codex", model: "gpt-5", ...patch }, "unconfigured");
    mocks.rpc.mockResolvedValue(doneState("好"));
    const job = selection("Fine");
    job.start();
    await settle();
    expect(job.view()).toEqual({ status: "unconfigured" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    publishTranslationSettings(CONFIGURED, "configured");
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
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

    publishTranslationSettings(CONFIGURED, "on");
    const streaming = selection("Partial", { streaming: true, kind: "reasoning", waitForStreaming: true });
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

  it("turns stale instead of re-sending when settings change, and errors offer retry", async () => {
    mocks.rpc.mockResolvedValueOnce(doneState("一")).mockRejectedValueOnce(new Error("quota")).mockResolvedValue(doneState("二"));
    const job = selection("One", { agentId: "agent-model-switch" });
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    // The conversation switching models does not touch an endpoint translation.
    agentApi.setAgent({ model: "claude-opus-4-5", updatedAt: "2026-11-19T10:05:00.000Z" });
    expect(job.view()?.status).toBe("done");
    publishTranslationSettings({ ...CONFIGURED, endpointModel: "other-model" }, "model");
    expect(job.view()).toEqual({ status: "stale" });
    publishTranslationSettings({ ...CONFIGURED, endpointModel: "other-model", targetLanguage: "ja" }, "ja");
    expect(job.view()).toEqual({ status: "stale" });
    await settle();
    expect(mocks.rpc).toHaveBeenCalledOnce();

    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("error"));
    expect(job.view()).toMatchObject({ status: "error", error: "quota" });
    expect(JSON.parse(mocks.rpc.mock.calls[1]![0].configSignature)).toMatchObject({ endpointModel: "other-model", targetCode: "ja" });
    job.start();
    await vi.waitFor(() => expect(job.view()?.status).toBe("done"));
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    job.dispose();
  });

});

const assistantProps = (data: Record<string, unknown>, platform: "web" | "ios" | "android" = "web", agentId = "agent-1") => ({
  agentId,
  item: { id: "row-1", type: "plugin" as const, kind: "omp-assistant", version: 1, data },
  theme,
  layout: { compact: platform !== "web", platform },
  timestamp: new Date("2026-11-19T10:00:00Z"),
});

const textContent = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textContent).join("");

/** The first laid-out text box with visible text: an inline run is part of its block's box. */
function firstTextBlock(node: ReactTestInstance): ReactTestInstance | null {
  for (const child of hostChildren(node)) {
    if (String(child.type) === "Text") {
      if (/\S/.test(textContent(child))) return child;
      continue;
    }
    const found = firstTextBlock(child);
    if (found) return found;
  }
  return null;
}

const markdownRoots = () => renderer!.root.findAll((node) =>
  String(node.type) === "View" && Boolean(node.props.dataSet?.bcselection));

describe("timeline translation", () => {
  // Laid out with Yoga from the rendered styles, so the button is checked
  // against where the text actually lands, not against the offset formula.
  const alignment = () => {
    const frames = measureHostTree(renderer!.root, { width: 640 });
    const slot = renderer!.root.find((node) => String(node.type) === "View" && node.props.testID === "reply-translation-slot");
    const button = renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate");
    const root = markdownRoots()[0]!;
    const text = firstTextBlock(root)!;
    const slotFrame = frames.get(slot)!;
    const buttonFrame = frames.get(button)!;
    const textFrame = frames.get(text)!;
    const rootFrame = frames.get(root)!;
    const style = StyleSheet.flatten(text.props.style);
    const line = Number(style.lineHeight);
    // A table cell pads its own line box, and the mock ScrollView leaves its
    // content container (a table's corner room) out of the Yoga tree: add the
    // padding a native or web content container lays out above the text.
    let padding = Number(style.paddingTop ?? style.paddingVertical ?? style.padding ?? 0);
    for (let node = text.parent; node && node !== root; node = node.parent) {
      if (String(node.type) !== "ScrollView") continue;
      const content = StyleSheet.flatten(node.props.contentContainerStyle) ?? {};
      padding += Number(content.paddingTop ?? content.paddingVertical ?? content.padding ?? 0);
    }
    return {
      first: textContent(text),
      offset: buttonFrame.top + buttonFrame.height / 2 - (textFrame.top + padding + line / 2),
      slotHeight: slotFrame.height,
      rightInset: slotFrame.left + slotFrame.width - buttonFrame.left - buttonFrame.width,
      gutter: slotFrame.left - (rootFrame.left + rootFrame.width),
    };
  };

  it.each([
    { label: "first row", text: "First line for alignment", data: {}, size: 15, variant: "document" as const },
    { label: "reply that opens with a rule (reported 2026-11-20)", text: "---\n\nFirst line for alignment\n\nSecond paragraph", data: {}, size: 15, variant: "document" as const },
    { label: "reply that opens with two rules", text: "---\n\n***\n\nFirst line for alignment", data: {}, size: 15, variant: "document" as const },
    { label: "rule-led reply on Android", text: "---\n\nFirst line for alignment", data: {}, size: 17, variant: "document" as const, platform: "android" as const },
    { label: "h1 first", text: "# First line for alignment\n\nBody", data: {}, size: 15, variant: "document" as const },
    { label: "h2 first", text: "## First line for alignment\n\nBody", data: {}, size: 15, variant: "document" as const },
    { label: "h3 first in compact", text: "### First line for alignment", data: {}, size: 15, variant: "compact" as const },
    { label: "h1 first in terminal", text: "# First line for alignment", data: {}, size: 20, variant: "terminal" as const },
    { label: "quote first", text: "> First line for alignment\n\nafter", data: {}, size: 15, variant: "document" as const },
    { label: "quote opening with a heading", text: "> ## First line for alignment\n> body", data: {}, size: 15, variant: "document" as const },
    { label: "list first", text: "- First line for alignment\n- second", data: {}, size: 15, variant: "document" as const },
    { label: "continued block", text: "First line for alignment", data: { blockIndex: 1 }, size: 15, variant: "document" as const },
    { label: "continued block that opens with a rule", text: "---\n\nFirst line for alignment", data: { blockIndex: 1 }, size: 15, variant: "document" as const },
    { label: "continued block that opens with a heading", text: "## First line for alignment\n\nBody", data: { blockIndex: 1 }, size: 15, variant: "document" as const },
    { label: "heading after a rule", text: "---\n\n### First line for alignment", data: {}, size: 15, variant: "document" as const },
    { label: "continued list at a larger font size", text: "- First line for alignment", data: { blockIndex: 1, listContinuation: true }, size: 24, variant: "compact" as const },
    { label: "terminal continuation", text: "First line for alignment", data: { blockIndex: 1 }, size: 20, variant: "terminal" as const },
    // Framed blocks: the first line is the header row (measured -12 and -20 px in Chrome before).
    { label: "code block with a language bar", text: "```ts\nconst first = 1;\n```\n\nafter", data: {}, size: 15, variant: "document" as const, first: "TypeScript" },
    { label: "code block in compact", text: "```python\nprint(1)\n```", data: {}, size: 15, variant: "compact" as const, first: "Python" },
    { label: "code block on Android", text: "```ts\nconst first = 1;\n```", data: {}, size: 17, variant: "document" as const, platform: "android" as const, first: "TypeScript" },
    { label: "plain text fence without a header", text: "```\nfirst plain line\n```", data: {}, size: 15, variant: "document" as const, first: "first plain line" },
    { label: "unlabelled diff fence", text: "```\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```", data: {}, size: 15, variant: "document" as const, first: "Diff" },
    { label: "Markdown fence preview", text: "```md\n# inner\n```", data: {}, size: 15, variant: "document" as const, first: "Markdown" },
    { label: "code block after a rule", text: "---\n\n```ts\nconst first = 1;\n```", data: {}, size: 15, variant: "document" as const, first: "TypeScript" },
    { label: "continued code block", text: "```ts\nconst first = 1;\n```", data: { blockIndex: 1 }, size: 15, variant: "document" as const, first: "TypeScript" },
    { label: "table", text: "| First | b |\n|---|---|\n| 1 | 2 |\n\nafter", data: {}, size: 15, variant: "document" as const, first: "First" },
    { label: "table at a larger size in terminal", text: "| First | b |\n|---|---|\n| 1 | 2 |", data: {}, size: 22, variant: "terminal" as const, first: "First" },
    { label: "table on Android", text: "| First | b |\n|---|---|\n| 1 | 2 |", data: {}, size: 17, variant: "document" as const, platform: "android" as const, first: "First" },
    { label: "insight", text: "`✦ Insight ─────────────────`\n- point\n`─────────────────`", data: {}, size: 15, variant: "document" as const, first: "Insight" },
  ])("centers the translation button on the first line of a $label", async ({ text, data, size, variant, ...rest }) => {
    const platform = "platform" in rest ? rest.platform : "web";
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    // Code blocks ask the daemon for colours; leave that request pending.
    mocks.rpc.mockImplementation(() => new Promise(() => {}));
    updateEnhancerPreferences({ markdownVariant: variant });
    const props = { ...assistantProps({ text, phase: "complete", ...data }, platform),
      theme: { ...theme, typography: { fontSize: { content: size } } } };
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never)); });
    const result = alignment();
    if ("first" in rest) expect(result.first).toBe(rest.first);
    // A terminal heading carries its hashes, and a list item's marker shares its first line.
    else expect(result.first).toMatch(/^(#+ )?First line for alignment$|^[•◦‣]$/);
    expect(result.slotHeight).toBe(32);
    expect(Math.abs(result.offset)).toBeLessThanOrEqual(0.5);
    // The button keeps its own gutter beside the text instead of covering it.
    expect(result.gutter).toBeGreaterThanOrEqual(0);
    expect(result.rightInset).toBe(0);
  });

  it("follows the translation's first line while loading and after it lands", async () => {
    updateEnhancerPreferences({ markdownVariant: "document" });
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
      assistantProps({ text: "First line for alignment", phase: "complete" }) as never)); });
    const press = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate").props.onPress({ stopPropagation() {} });
    await act(async () => press());
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(renderer!.root.findAll((node) => node.props.testID === "inline-translation-status")).toHaveLength(0);
    expect(renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "reply-translate-spinner")).toHaveLength(1);
    expect(Math.abs(alignment().offset)).toBeLessThanOrEqual(0.5);
    await act(async () => pending.resolve(doneState("---\n\n# First line for alignment\n\n正文")));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("正文"));
    expect(alignment().first).toBe("First line for alignment");
    expect(Math.abs(alignment().offset)).toBeLessThanOrEqual(0.5);
    expect(alignment().rightInset).toBe(0);
  });

  it("offers explicit translation without sending text until pressed", async () => {
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
    expect(labels.filter((label) => /translat/i.test(label))).toEqual(["Translate", "Translate"]);
    expect(renderer!.root.findAll((node) => node.props?.testID === "translation-row")).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(agentApi.list).not.toHaveBeenCalled();
  });

  it.each([
    ["standalone reply", {}, "![Image](file:///Users/me/shots/tool-output.png)"],
    ["split reply", { blockIndex: 1 }, "![Image](file:///Users/me/shots/tool-output.png) ![Image](file:///tmp/second.png)"],
  ] as const)("hides the translation slot for an image-only %s", async (_label, data, image) => {
    const dataUri = "data:image/png;base64,AAAA";
    mocks.rpc.mockResolvedValue({ dataUri, width: 40, height: 30, bytes: 3, error: null });
    const slot = () => renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "reply-translation-slot");
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ ...data, text: image, phase: "complete" }, "ios") as never));
    });
    const text = collectTexts(renderer!.root).join(" ");
    expect(text).toContain("~/shots/tool-output.png");
    if ("blockIndex" in data) expect(text).toContain("/tmp/second.png");
    expect(mocks.rpc).toHaveBeenCalledWith({ cwd: "", path: "/Users/me/shots/tool-output.png" });
    expect(renderer!.root.findAll((node) => String(node.type) === "Image" && node.props.source?.uri === dataUri)).not.toHaveLength(0);
    expect(slot()).toHaveLength(0);
    await act(async () => {
      renderer!.update(React.createElement(LiveAssistantRenderer,
        assistantProps({ ...data, text: `Here is the result. ${image}`, phase: "complete" }, "ios") as never));
    });
    expect(slot()).toHaveLength(1);
  });

  it("translates one reply block in place and toggles back without changing its neighbor", async () => {
    mocks.rpc.mockResolvedValue(doneState("译文一"));
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      React.createElement(LiveAssistantRenderer, assistantProps({ text: "First block", phase: "complete" }) as never),
      React.createElement(LiveAssistantRenderer, assistantProps({ text: "Second block", phase: "complete" }) as never))); });
    const buttons = () => renderer!.root.findAll((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate");
    expect(buttons()).toHaveLength(2);
    await act(async () => buttons()[0]!.props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("译文一"));
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ text: "First block" });
    expect(JSON.stringify(renderer!.toJSON())).toContain("Second block");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("First block");
    expect(buttons()[0]!.props.accessibilityLabel).toBe("Show original");
    await act(async () => buttons()[0]!.props.onPress({ stopPropagation() {} }));
    expect(JSON.stringify(renderer!.toJSON())).toContain("First block");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("译文一");
    await act(async () => buttons()[0]!.props.onPress({ stopPropagation() {} }));
    expect(JSON.stringify(renderer!.toJSON())).toContain("译文一");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("shows a restore glyph, label and tip only while the translation is shown", async () => {
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
      assistantProps({ text: "Glyph block", phase: "complete" }) as never)); });
    const button = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate");
    const state = () => {
      const pressable = button();
      const fill = renderer!.root.find((node) => String(node.type) === "View" && node.props.testID === "reply-translate-fill");
      const icon = fill.find((node) => String(node.type) === "Icon");
      return { label: pressable.props.accessibilityLabel, glyph: icon.props.icon };
    };
    expect(state()).toEqual({ label: "Translate", glyph: TRANSLATE_ICON });
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    expect(button().props.accessibilityLabel).toBe("Translate");
    expect(button().findAll((node) => String(node.type) === "View" && node.props.testID === "reply-translate-spinner")).toHaveLength(1);
    await act(async () => pending.resolve(doneState("译文")));
    await vi.waitFor(() => expect(state()).toEqual({ label: "Show original", glyph: SHOW_ORIGINAL_ICON }));
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Glyph block");
    expect(state()).toEqual({ label: "Translate", glyph: TRANSLATE_ICON });
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    expect(state()).toEqual({ label: "Show original", glyph: SHOW_ORIGINAL_ICON });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    { language: "en" as const, initial: "Translate", restored: "Show original" },
    { language: "zh" as const, initial: "翻译", restored: "显示原文" },
  ])("shows the $language hover tooltip and rounded rectangle in both states", async ({ language, initial, restored }) => {
    updateEnhancerPreferences({ language });
    mocks.rpc.mockResolvedValue(doneState("译文"));
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
      assistantProps({ text: "Tooltip source", phase: "complete" }) as never)); });
    const button = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate");
    const checkHover = (label: string) => {
      vi.useFakeTimers();
      act(() => button().props.onHoverIn());
      act(() => { vi.advanceTimersByTime(400); });
      expect(collectTexts(renderer!.root)).toContain(label);
      expect(StyleSheet.flatten(button().props.style)).toMatchObject({ width: 24, height: 24, borderRadius: 6 });
      expect(StyleSheet.flatten(button().props.style).backgroundColor).toBeDefined();
      act(() => button().props.onHoverOut());
      vi.useRealTimers();
    };
    checkHover(initial);
    const stopPropagation = vi.fn();
    await act(async () => button().props.onPress({ stopPropagation }));
    await vi.waitFor(() => expect(button().props.accessibilityLabel).toBe(restored));
    expect(stopPropagation).toHaveBeenCalledOnce();
    checkHover(restored);
    await act(async () => button().props.onPress({ stopPropagation }));
    checkHover(initial);
  });

  it("names the restore action in Chinese too", async () => {
    updateEnhancerPreferences({ language: "zh" });
    mocks.rpc.mockResolvedValue(doneState("译文"));
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
      assistantProps({ text: "Glyph block", phase: "complete" }) as never)); });
    const button = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate");
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(button().props.accessibilityLabel).toBe("显示原文"));
    expect(renderer!.root.findAll((node) => String(node.type) === "Icon" && node.props.icon === SHOW_ORIGINAL_ICON)).toHaveLength(1);
  });

  it("dims every row of a reply while its footer translates the whole message", async () => {
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    const at = new Date("2026-11-19T10:00:00Z");
    const other = { ...assistantProps({ text: "Earlier reply", phase: "complete" }), timestamp: new Date("2026-11-19T09:00:00Z") };
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      React.createElement(LiveAssistantRenderer, other as never),
      // A long reply split into rows: they share the source item's timestamp.
      React.createElement(LiveAssistantRenderer, assistantProps({ text: "Split one", phase: "complete", blockIndex: 0 }) as never),
      React.createElement(LiveAssistantRenderer, assistantProps({ text: "Split two", phase: "complete", blockIndex: 1, messageText: "Split one\n\nSplit two" }) as never),
      React.createElement(WholeReplyTranslateButton, { agentId: "agent-1", text: "Split one\n\nSplit two",
        theme, replyKey: replyTranslationKey("agent-1", at.getTime()) }))); });
    // The wrapper that holds each row's Markdown, keyed by the text it shows.
    const dimmed = () => renderer!.root.findAll((node) => String(node.type) === "View"
      && StyleSheet.flatten(node.props.style)?.opacity === 0.55).map((node) => textContent(node));
    expect(dimmed()).toEqual([]);
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "footer-translate").props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(dimmed()).toHaveLength(2);
    expect(dimmed().join("|")).toMatch(/Split one.*\|.*Split two/);
    expect(dimmed().join("|")).not.toContain("Earlier reply");
    await act(async () => pending.resolve(doneState("整条译文")));
    expect(dimmed()).toEqual([]);
    expect(JSON.stringify(renderer!.toJSON())).toContain("整条译文");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Split one");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Split two");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Earlier reply");
    const footer = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "footer-translate");
    expect(footer().props.accessibilityLabel).toBe("Show original");
    await act(async () => footer().props.onPress({ stopPropagation() {} }));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Split one");
    expect(JSON.stringify(renderer!.toJSON())).toContain("Split two");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("整条译文");
    await act(async () => footer().props.onPress({ stopPropagation() {} }));
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(JSON.stringify(renderer!.toJSON())).toContain("整条译文");
  });

  it("keeps the whole translation when its footer remounts", async () => {
    mocks.rpc.mockResolvedValue(doneState("持久译文"));
    const key = replyTranslationKey("agent-1", new Date("2026-11-19T10:00:00Z").getTime());
    const row = React.createElement(LiveAssistantRenderer, assistantProps({ text: "Remount original", phase: "complete" }) as never);
    const footer = () => React.createElement(WholeReplyTranslateButton, { agentId: "agent-1", text: "Remount original", theme, replyKey: key });
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, row, footer())); });
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "footer-translate").props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("持久译文"));
    await act(async () => renderer!.update(React.createElement(React.Fragment, null, row)));
    expect(JSON.stringify(renderer!.toJSON())).toContain("持久译文");
    await act(async () => renderer!.update(React.createElement(React.Fragment, null, row, footer())));
    await vi.waitFor(() => expect(renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "footer-translate").props.accessibilityLabel).toBe("Show original"));
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("does not retain a whole translation across settings changes while the footer is unmounted", async () => {
    mocks.rpc.mockResolvedValue(doneState("旧译文"));
    const key = replyTranslationKey("agent-1", new Date("2026-11-19T10:00:00Z").getTime());
    const row = React.createElement(LiveAssistantRenderer, assistantProps({ text: "Settings original", phase: "complete" }) as never);
    const footer = React.createElement(WholeReplyTranslateButton, { agentId: "agent-1", text: "Settings original", theme, replyKey: key });
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, row, footer)); });
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "footer-translate").props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("旧译文"));
    await act(async () => renderer!.update(React.createElement(React.Fragment, null, row)));
    await act(async () => { publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, targetLanguage: "ja" }); });
    expect(JSON.stringify(renderer!.toJSON())).toContain("Settings original");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("旧译文");
  });

  it("retries a failed whole reply translation without hiding the original", async () => {
    mocks.rpc.mockResolvedValueOnce({ state: "error", error: "offline" }).mockResolvedValueOnce(doneState("完整译文"));
    const at = new Date("2026-11-19T10:00:00Z");
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      React.createElement(LiveAssistantRenderer, assistantProps({ text: "Whole original", phase: "complete" }) as never),
      React.createElement(WholeReplyTranslateButton, { agentId: "agent-1", text: "Whole original", theme,
        replyKey: replyTranslationKey("agent-1", at.getTime()) }))); });
    const footer = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "footer-translate");
    await act(async () => footer().props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(footer().props.accessibilityLabel).toBe("Retry"));
    expect(JSON.stringify(renderer!.toJSON())).toContain("Whole original");
    await act(async () => footer().props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("完整译文"));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("keeps the original visible during translation and offers retry on failure", async () => {
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(doneState("译文"));
    await act(async () => { renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
      assistantProps({ text: "Waiting block", phase: "complete" }) as never)); });
    const button = () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate");
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(JSON.stringify(renderer!.toJSON())).toContain("Waiting block");
    expect(renderer!.root.findAll((node) => node.props.testID === "inline-translation-status")).toHaveLength(0);
    expect(button().findAll((node) => String(node.type) === "View" && node.props.testID === "reply-translate-spinner")).toHaveLength(1);
    await act(async () => pending.resolve({ state: "error", error: "offline" } as never));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("Translation failed"));
    expect(button().findAll((node) => node.props.testID === "reply-translate-spinner")).toHaveLength(0);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Waiting block");
    await act(async () => button().props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("译文"));
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("does not apply an old translation after the source block changes", async () => {
    const pending = deferred<ReturnType<typeof doneState>>();
    mocks.rpc.mockReturnValueOnce(pending.promise);
    const row = (text: string) => React.createElement(LiveAssistantRenderer, assistantProps({ text, phase: "complete" }) as never);
    await act(async () => { renderer = TestRenderer.create(row("Old source")); });
    await act(async () => renderer!.root.find((node) => String(node.type) === "Pressable" && node.props.testID === "reply-translate").props.onPress({ stopPropagation() {} }));
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    await act(async () => renderer!.update(row("New source")));
    await act(async () => pending.resolve(doneState("Old translation")));
    expect(JSON.stringify(renderer!.toJSON())).toContain("New source");
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Old translation");
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

it("binds detached details to their own web host while preserving the source scope", async () => {
  updateEnhancerPreferences({ blockDetails: true });
  const secondHost = createMockAgentApi();
  const observed = vi.fn();
  await act(async () => {
    renderer = TestRenderer.create(<HostContext.Provider value={{ api: agentApi.api, rpc: mocks.rpc }}>
      <SelectionTranslationScope agentId="source-agent" kind="reasoning" streaming>
        <BlockPlacementContext.Provider value={{ agentId: "source-agent", at: 100, kind: "tool" }}>
          <DisclosureHeader expanded={false} onToggle={() => {}} tokens={makeTokens()} verb="Details"
            previewKey="web:detached" previewContent={() => <SelectionTranslationContext.Consumer>{(scope) => { observed(scope); return null; }}</SelectionTranslationContext.Consumer>} />
        </BlockPlacementContext.Provider>
      </SelectionTranslationScope>
    </HostContext.Provider>);
  });
  const entry = getBlock("source-agent", "web:detached")!;
  await act(async () => {
    renderer!.unmount();
    renderer = TestRenderer.create(<HostContext.Provider value={{ api: secondHost.api, rpc: mocks.rpc }}>{entry.render()}</HostContext.Provider>);
  });
  expect(observed).toHaveBeenLastCalledWith(expect.objectContaining({ agentId: "source-agent", kind: "reasoning", streaming: true,
    lent: expect.objectContaining({ paseo: secondHost.api }) }));
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

  it.each(["tool_output", "reasoning"] as const)("translates a quoted selection in detached %s details", async (kind) => {
    updateEnhancerPreferences({ blockDetails: true });
    mocks.rpc.mockResolvedValue(doneState("译文"));
    await act(async () => {
      renderer = TestRenderer.create(<SelectionTranslationScope agentId="agent-1" kind={kind} streaming={false}>
        <BlockPlacementContext.Provider value={{ agentId: "agent-1", at: 100, kind: "tool" }}>
          <DisclosureHeader expanded={false} onToggle={() => {}} tokens={makeTokens("ios")} verb="Details"
            previewKey={`detached:${kind}`} previewContent={() => <MarkdownView text={"> Selected **quote**."} tokens={makeTokens("ios")} variant="document" />} />
        </BlockPlacementContext.Provider>
      </SelectionTranslationScope>);
    });
    const entry = getBlock("agent-1", `detached:${kind}`)!;
    expect(entry).not.toBeNull();
    await act(async () => { renderer!.unmount(); renderer = TestRenderer.create(<>{entry.render()}</>); });
    select(0);
    expect(button("Copy selected block")).toHaveLength(1);
    expect(button("Translate selected block")).toHaveLength(1);
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ text: "Selected quote.", agentId: "agent-1", sourceKind: kind });
  });

  it.each(["unscoped", "disabled"] as const)("does not offer translation in detached %s details", async (mode) => {
    updateEnhancerPreferences({ blockDetails: true });
    if (mode === "disabled") publishTranslationSettings({ ...CONFIGURED, enabled: false }, "off");
    const header = <DisclosureHeader expanded={false} onToggle={() => {}} tokens={makeTokens("ios")} verb="Details"
      previewKey={`detached:${mode}`} previewContent={() => <MarkdownView text={"> Quote."} tokens={makeTokens("ios")} variant="document" />} />;
    await act(async () => {
      renderer = TestRenderer.create(<BlockPlacementContext.Provider value={{ agentId: "agent-1", at: 100, kind: "tool" }}>
        {mode === "unscoped" ? header : <SelectionTranslationScope agentId="agent-1" kind="tool_output" streaming={false}>{header}</SelectionTranslationScope>}
      </BlockPlacementContext.Provider>);
    });
    const entry = getBlock("agent-1", `detached:${mode}`)!;
    await act(async () => { renderer!.unmount(); renderer = TestRenderer.create(<>{entry.render()}</>); });
    select(0);
    expect(button("Copy selected block")).toHaveLength(1);
    expect(button("Translate selected block")).toHaveLength(0);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("translates exactly the selected block in a popup and closes with the selection", async () => {
    const firstToken = deferred<TranslationJobState>();
    const reply = deferred<TranslationJobState>();
    mocks.rpc.mockReturnValueOnce(firstToken.promise).mockReturnValueOnce(reply.promise);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "First paragraph.\n\nSecond **paragraph**.", phase: "complete" }, platform) as never));
    });
    expect(button("Translate selected block")).toHaveLength(0);
    select(1);
    expect(button("Copy selected block")).toHaveLength(1);
    const menu = renderer!.root.findByProps({ testID: "markdown-block-menu" });
    expect(StyleSheet.flatten(menu.props.style)).toMatchObject({ minHeight: 34, borderWidth: StyleSheet.hairlineWidth });
    for (const label of ["Copy selected block", "Translate selected block"]) {
      expect(StyleSheet.flatten(button(label)[0]!.props.style)).toMatchObject({ paddingHorizontal: 8 });
    }
    const separator = renderer!.root.findByProps({ testID: "translation-menu-separator" });
    expect(StyleSheet.flatten(separator.props.style)).toMatchObject({ width: StyleSheet.hairlineWidth, height: 12 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.rpc.mock.calls[0]![0]).toMatchObject({ text: "Second paragraph.", agentId: "agent-1", sourceKind: "assistant_message" });
    const spinner = () => button("Translate selected block").flatMap((node) => node.findAll((child) => String(child.type) === "View" && child.props.testID === "selected-block-translate-spinner"));
    expect(spinner()).toHaveLength(1);
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(0);

    await act(async () => firstToken.resolve({ state: "running", text: "第" }));
    expect(spinner()).toHaveLength(1);
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(0);

    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2), { timeout: 2500 });
    const translation = "---\n\n第二段。\n\n---\n\n末尾";
    await act(async () => reply.resolve(doneState(translation)));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("第二段。"));
    expect(renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "markdown-block-menu")).toHaveLength(0);
    expect(button("Copy translation")).toHaveLength(1);
    await act(async () => button("Show original")[0]!.props.onPress());
    expect(renderer!.root.findByProps({ testID: "selection-translation-panel" }).findByType(MarkdownView).props.text).toBe("Second paragraph.");
    await act(async () => button("Show translation")[0]!.props.onPress());
    expect(renderer!.root.findByProps({ testID: "selection-translation-panel" }).findByType(MarkdownView).props.text).toBe("第二段。\n\n---\n\n末尾");
    expect(renderer!.root.findByType(ToolbarCopyButton).props.text).toBe(translation);
    await act(async () => button("Show raw text")[0]!.props.onPress());
    expect(renderer!.root.findAll((node) => String(node.type) === "Text"
      && node.props.testID === "selection-translation-source")[0]!.props.children).toBe(translation);
    await act(async () => button("Show original")[0]!.props.onPress());
    expect(renderer!.root.findAll((node) => String(node.type) === "Text"
      && node.props.testID === "selection-translation-source")[0]!.props.children).toBe("Second paragraph.");
    expect(renderer!.root.findByType(ToolbarCopyButton).props.text).toBe("Second paragraph.");
    await act(async () => button("Render Markdown")[0]!.props.onPress());
    await act(async () => button("Show translation")[0]!.props.onPress());
    const copyButton = button("Copy translation")[0]!;
    const retryButton = button("Retry")[0]!;
    const copyIcon = copyButton.find((node) => String(node.type) === "Icon");
    const retryIcon = retryButton.find((node) => String(node.type) === "Icon");
    const settingsIcon = button("Translation settings")[0]!.find((node) => String(node.type) === "Icon");
    expect([copyIcon.props.size, retryIcon.props.size]).toEqual([settingsIcon.props.size, settingsIcon.props.size]);
    expect(retryIcon.props.name).toBe("RefreshCw");
    expect(collectTexts(retryButton)).not.toContain("Retry");
    vi.useFakeTimers();
    try {
      act(() => copyButton.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(400); });
      expect(collectTexts(renderer!.root)).toContain("Copy translation");
      act(() => copyButton.props.onHoverOut());
      act(() => retryButton.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(400); });
      expect(collectTexts(renderer!.root)).toContain("Retry");
      const retryTip = renderer!.root.find((node) => String(node.type) === "Text" && node.props.children === "Retry");
      let tipSlot = retryTip.parent;
      while (tipSlot && !JSON.stringify(tipSlot.props.style ?? null).includes('"bottom":"100%"')) tipSlot = tipSlot.parent;
      expect(tipSlot?.props.style.flat(Infinity)).toEqual(expect.arrayContaining([
        expect.objectContaining({ bottom: "100%" }), expect.objectContaining({ right: 0 }),
      ]));
      act(() => retryButton.props.onHoverOut());
      const settingsButton = button("Translation settings")[0]!;
      act(() => settingsButton.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(400); });
      expect(collectTexts(renderer!.root)).toContain("Translation settings");
      act(() => settingsButton.props.onHoverOut());
    } finally {
      vi.useRealTimers();
    }
    expect(collectTexts(renderer!.root.findByProps({ testID: "translation-model" })).join(" ")).toBe("test-model");
    const header = renderer!.root.find((node) => String(node.type) === "View" && node.props.testID === "translation-header");
    expect(header.props.style).toMatchObject({ minHeight: 36, alignItems: "center" });
    const footer = renderer!.root.findByProps({ testID: "translation-footer" });
    expect(footer.findAll((node) => node.props.testID === "translation-language").length).toBeGreaterThan(0);
    expect(footer.findAll((node) => node.props.testID === "translation-model").length).toBeGreaterThan(0);
    expect(header.findAll((node) => node.props.testID === "translation-language")).toHaveLength(0);
    const divider = renderer!.root.find((node) => String(node.type) === "View" && node.props.testID === "translation-header-divider");
    expect(divider.props.style.flat()).toEqual(expect.arrayContaining([expect.objectContaining({ height: 0.5 })]));
    expect(renderer!.root.findAll((node) => node.props.testID === "translation-sheet-header-cover")).toHaveLength(0);
    expect(collectTexts(header).join(" ")).not.toContain("Translation ·");
    expect(collectTexts(header).join(" ")).not.toContain("Claude ·");
    expect(panelText()).not.toContain("Thinking was NOT disabled");
    // Touching translated prose must not cancel the source block and unmount the modal.
    const body = renderer!.root.find((node) => String(node.type) === "SheetContent");
    expect(body.props.scrollable).toBe(false);
    const scroll = body.find((node) => String(node.type) === "ScrollView" && node.props.testID === "selection-translation-body");
    const panel = body.findByProps({ testID: "selection-translation-panel" });
    const frames = measureHostTree(panel, { width: 390 });
    expect(frames.get(scroll)!.top).toBeCloseTo(frames.get(divider)!.top + frames.get(divider)!.height);
    expect(scroll.props.style.flat()).toEqual(expect.arrayContaining([expect.objectContaining({ overflow: "hidden" })]));
    expect(scroll.props.contentContainerStyle).toMatchObject({ paddingTop: 6 });
    expect(scroll.findByType(MarkdownView)).toBeTruthy();
    expect(scroll.findAll((node) => node.props.testID === "translation-header")).toHaveLength(0);
    expect(scroll.findAll((node) => node.props.testID === "translation-header-divider")).toHaveLength(0);
    expect(body.findAll((node) => node.props.testID === "markdown-block-selection")).toHaveLength(0);
    const translatedMarkdown = body.findByType(MarkdownView);
    const markdownRoot = translatedMarkdown.find((node) => String(node.type) === "View");
    expect(markdownRoot.props.onTouchStart).toBeUndefined();
    expect(renderer!.root.findAll((node) => String(node.type) === "View" && node.props.testID === "markdown-block-highlight")).toHaveLength(1);

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
    expect(mocks.rpc.mock.calls.map(([request]) => request.action)).toEqual(["start", "status"]);
  });

  it("opens translation settings and dismisses the selection", async () => {
    const open = vi.fn();
    const release = registerTranslationSettingsOpener(agentApi.api, open);
    mocks.rpc.mockResolvedValue(doneState("好"));
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "Hello", phase: "complete" }, platform) as never));
    });
    select(0);
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    await act(async () => button("Translation settings")[0]!.props.onPress());
    expect(open).toHaveBeenCalledWith("chat-presentation");
    expect(translationSettingsTarget()).toBe(true);
    clearTranslationSettingsTarget();
    expect(renderer!.root.findAllByProps({ testID: "markdown-block-highlight" })).toHaveLength(0);
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(0);
    release();
  });

  it("closes the containing sheet before opening translation settings", async () => {
    const order: string[] = [];
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return 1; });
    const release = registerTranslationSettingsOpener(agentApi.api, () => order.push("settings"));
    try {
      mocks.rpc.mockResolvedValue(doneState("好"));
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TranslationSettingsParentCloseContext.Provider,
          { value: () => order.push("sheet") },
          React.createElement(LiveAssistantRenderer, assistantProps({ text: "Hello", phase: "complete" }, platform) as never)));
      });
      select(0);
      await act(async () => button("Translate selected block")[0]!.props.onPress());
      await act(async () => button("Translation settings")[0]!.props.onPress());
      expect(order).toEqual(["sheet"]);
      expect(renderer!.root.findAllByProps({ testID: "markdown-block-highlight" })).toHaveLength(0);
      expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(0);
      expect(frames).toHaveLength(1);
      act(() => frames[0]!(0));
      expect(order).toEqual(["sheet", "settings"]);
    } finally {
      vi.unstubAllGlobals();
      clearTranslationSettingsTarget();
      release();
    }
  });

  it("translates a selection from a streaming reply and shows errors with retry", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("provider down")).mockResolvedValue(doneState("好的"));
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "Done part.\n\nStill writing", phase: "streaming" }, platform) as never));
    });
    select(0);
    await act(async () => button("Translate selected block")[0]!.props.onPress());
    await vi.waitFor(() => expect(panelText()).toContain("provider down"));
    expect(mocks.rpc).toHaveBeenCalledOnce();

    // Settling the reply does not resend the selected block.
    await act(async () => {
      renderer!.update(React.createElement(LiveAssistantRenderer,
        assistantProps({ text: "Done part.\n\nStill writing", phase: "complete" }, platform) as never));
    });
    await vi.waitFor(() => expect(panelText()).toContain("provider down"));
    expect(mocks.rpc.mock.calls[0]![0].text).toBe("Done part.");
    const retried = deferred<TranslationJobState>();
    mocks.rpc.mockReturnValueOnce(retried.promise);
    await act(async () => button("Retry")[0]!.props.onPress());
    // The sheet stays up while Retry runs instead of closing and opening again.
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(1);
    expect(panelText()).toContain("Translating...");
    expect(renderer!.root.findAll((node) => node.props.testID === "markdown-block-menu")).toHaveLength(0);
    await act(async () => retried.resolve(doneState("好的")));
    await vi.waitFor(() => expect(JSON.stringify(renderer!.toJSON())).toContain("好的"));
    expect(renderer!.root.findAll((node) => String(node.type) === "Modal")).toHaveLength(1);
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
