import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import type { PaseoAgent, PaseoAgentListResult, PaseoApi } from "@getpaseo/client";
import "./helpers/quiet-renderer";
import { measureHostTree } from "./helpers/yoga-host-layout";
import { assistantRows } from "../../client/assistant-transform";
import { externalHistoryRows } from "../../client/external-history";
import { segmentReasoning } from "../../client/reasoning/segment";
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
  resolveAssistantSource,
  resolveReasoningSource,
  setTranslationPaseo,
  translationStore,
} from "../../client/translation/store";

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
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  usePaseo: () => mocks.api,
  useRpc: () => mocks.rpc,
}));
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
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { TRANSLATE_ICON, TranslateButton, TranslationBlock, useItemTranslation } from "../../client/translation/ui";

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
  publishTranslationSettings(DEFAULT_TIMELINE_TRANSLATION_SETTINGS, "init-1");
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

describe("timeline translation UI and source state", () => {
  it("preserves single-row identity, links multi-block replies, and keeps external history segments isolated", () => {
    const short = assistantRows("Short reply", "complete");
    expect(short).toHaveLength(1);
    expect(short[0]!.data).toEqual({ text: "Short reply", phase: "complete" });

    const longReply = Array.from({ length: 85 }, (_, i) => `Paragraph ${i}: ${"content ".repeat(30)}\n\n`).join("");
    const split = assistantRows(longReply, "complete", "msg-long-1");
    expect(split.length).toBeGreaterThan(1);
    const leadSource = resolveAssistantSource("agent-1", split[0]!.data);
    const tailSource = resolveAssistantSource("agent-1", split.at(-1)!.data);
    expect(leadSource.isLeadBlock).toBe(true);
    expect(leadSource.isTailBlock).toBe(false);
    expect(tailSource.isLeadBlock).toBe(false);
    expect(tailSource.isTailBlock).toBe(true);
    expect(leadSource.sourceKey).toBe(tailSource.sourceKey);
    expect(leadSource.sourceText).toBe(longReply);

    const extText =
      "First prose[external_agent_tool_call: Read]\nsecret\n[/external_agent_tool_call]Second prose";
    const extRows = externalHistoryRows(extText, "complete", "ext-msg-1")!;
    const assistantSegments = extRows.filter((row) => row.kind === "omp-assistant");
    expect(assistantSegments).toHaveLength(2);
    const seg0 = resolveAssistantSource("agent-1", assistantSegments[0]!.data as never);
    const seg1 = resolveAssistantSource("agent-1", assistantSegments[1]!.data as never);
    expect(seg0.sourceKey).not.toBe(seg1.sourceKey);
    expect(seg0.sourceText).toBe("First prose");
    expect(seg1.sourceText).toBe("Second prose");
    expect(seg1.sourceText).not.toContain("[external_agent_tool_call");
  });

  it("caches translation per session across remounts and invalidates on source or config change", async () => {
    mocks.rpc.mockImplementation(async (input: { action: string }) => {
      if (input.action === "start" || input.action === "status") {
        return {
          state: "done",
          translation: "你好，Paseo",
          targetLanguageCode: "zh-CN",
          provider: "claude",
          model: "claude-sonnet-4-5",
          thinkingMode: "disabled",
          thinkingOptionId: "off",
        };
      }
      return { state: "idle" };
    });

    const props = {
      agentId: "agent-1",
      item: {
        id: "row-1",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text: "Hello Paseo", phase: "complete", sourceId: "msg-1" },
      },
      theme,
      layout: { compact: false, platform: "web" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });

    const btn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply",
    );
    await act(async () => {
      btn.props.onPress();
    });

    let texts = collectTexts(renderer!.root).join("\n");
    expect(texts).toContain("Hello Paseo");
    expect(texts).toContain("你好，Paseo");

    // A remounted row only shows the cache once the raw config is known again.
    act(() => renderer!.unmount());
    const remountConfig = deferred<{ agent: RawAgentConfig }>();
    agentApi.refresh.mockReturnValueOnce(remountConfig.promise);
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("你好，Paseo");
    const waiting = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Loading conversation model...",
    );
    expect(waiting.props.disabled).toBe(true);
    await act(async () => {
      waiting.props.onPress?.();
      remountConfig.resolve({ agent: initialAgent });
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    texts = collectTexts(renderer!.root).join("\n");
    expect(texts).toContain("你好，Paseo");

    // Click Hide -> cached but hidden; click Show -> visible again with 0 extra RPC calls.
    const hideBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Hide",
    );
    await act(async () => {
      hideBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("你好，Paseo");

    const showBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Show translation",
    );
    await act(async () => {
      showBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("你好，Paseo");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    // Changing targetLanguage invalidates the cached translation for that source.
    await act(async () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, targetLanguage: "ja" }, "target-ja");
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("你好，Paseo");

    // Restoring settings to verify source text change invalidates too.
    await act(async () => {
      publishTranslationSettings(DEFAULT_TIMELINE_TRANSLATION_SETTINGS, "target-restored");
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("你好，Paseo");

    const updatedProps = {
      ...props,
      item: { ...props.item, data: { ...props.item.data, text: "Updated Paseo reply" } },
    };
    await act(async () => {
      renderer!.update(React.createElement(LiveAssistantRenderer, updatedProps as never));
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("你好，Paseo");
  });

  it("disables translation while streaming and supports error/retry recovery", async () => {
    const streamingProps = {
      agentId: "agent-1",
      item: {
        id: "row-stream",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text: "Partial...", phase: "streaming", sourceId: "msg-stream" },
      },
      theme,
      layout: { compact: false, platform: "web" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, streamingProps as never));
    });

    const disabledBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Wait until the reply finishes streaming",
    );
    expect(disabledBtn.props.disabled).toBe(true);
    await act(async () => {
      disabledBtn.props.onPress?.();
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    // Complete streaming, simulate error then retry success.
    mocks.rpc
      .mockResolvedValueOnce({ state: "error", error: "Provider offline" })
      .mockResolvedValueOnce({
        state: "done",
        translation: "完成回复",
        targetLanguageCode: "zh-CN",
        provider: "claude",
        model: "claude-sonnet-4-5",
        thinkingMode: "none",
        thinkingOptionId: null,
      });

    await act(async () => {
      renderer!.update(
        React.createElement(LiveAssistantRenderer, {
          ...streamingProps,
          item: {
            ...streamingProps.item,
            data: { text: "Completed text", phase: "complete", sourceId: "msg-stream" },
          },
        } as never),
      );
    });

    const translateBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply",
    );
    await act(async () => {
      translateBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("Provider offline");

    const retryBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Retry",
    );
    await act(async () => {
      retryBtn.props.onPress();
    });
    const finalTexts = collectTexts(renderer!.root).join("\n");
    expect(finalTexts).toContain("Completed text");
    expect(finalTexts).toContain("完成回复");
  });

  it("supports reasoning card translation including auto-expand and inert mobile thoughts", async () => {
    mocks.hover = false;
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mocks.rpc.mockResolvedValue({
      state: "done",
      translation: "一步思考",
      targetLanguageCode: "zh-CN",
      provider: "claude",
      model: "claude-sonnet-4-5",
      thinkingMode: "disabled",
      thinkingOptionId: "off",
    });

    const props = {
      agentId: "agent-1",
      item: {
        id: "thought-1",
        type: "plugin" as const,
        kind: "omp-reasoning",
        version: 1,
        data: { text: "Single short thought", phase: "complete" },
      },
      theme,
      layout: { compact: true, platform: "ios" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveReasoningRenderer, props as never));
    });

    const btn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate thought",
    );
    await act(async () => {
      btn.props.onPress();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("一步思考");

    // Also verify ReasoningCard collapsed with expandable body invokes onActivate cleanly.
    const onActivate = vi.fn();
    const segmentation = segmentReasoning("First step\n\nSecond step", { streaming: false });
    const resolved = resolveReasoningSource("agent-1", "k1", "First step\n\nSecond step");
    expect(resolved.sourceKey).toBe("agent-1:reasoning:k1");

    function Harness() {
      const controller = useItemTranslation({
        sourceKey: resolved.sourceKey,
        sourceKind: "reasoning",
        agentId: "agent-1",
        text: resolved.sourceText,
        streaming: false,
        onActivate,
      });
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(TranslateButton, { controller, tokens: makeTokens("web") }),
        React.createElement(ReasoningCard, {
          segmentation,
          streaming: false,
          durationMs: 1200,
          expanded: false,
          onToggle: () => {},
          tokens: makeTokens("web"),
          compact: false,
          storeKey: "k1",
          copyText: "First step\n\nSecond step",
          translation: controller,
        }),
        React.createElement(TranslationBlock, { controller, tokens: makeTokens("web"), compact: true, quiet: true }),
      );
    }

    await act(async () => {
      renderer!.update(React.createElement(Harness));
    });
    const expandTranslate = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate thought",
    );
    await act(async () => {
      expandTranslate.props.onPress();
    });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect((TRANSLATE_ICON as { svg: string }).svg).toContain('viewBox="0 0 24 24"');
  });

  it("handles unloaded, invalid, error, and external settings transitions without silent fallback", async () => {
    resetTranslationSettingsStoreForTests();
    const props = {
      agentId: "agent-sync",
      item: {
        id: "row-sync",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text: "Sync state check", phase: "complete", sourceId: "msg-sync" },
      },
      theme,
      layout: { compact: false, platform: "web" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });

    // While settings are loading, the button stays disabled and never triggers RPC.
    const loadingBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Loading translation settings...",
    );
    expect(loadingBtn.props.disabled).toBe(true);
    await act(async () => {
      loadingBtn.props.onPress?.();
    });
    expect(mocks.rpc).not.toHaveBeenCalled();

    // Error and invalid states disable the entry point cleanly without falling back to defaults.
    await act(async () => {
      reportTranslationSettings({ status: "error", error: "Daemon offline" });
    });
    expect(getTranslationSettingsState()).toMatchObject({ status: "error", error: "Daemon offline" });
    const errBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Could not load translation settings",
    );
    expect(errBtn.props.disabled).toBe(true);

    await act(async () => {
      reportTranslationSettings({ status: "invalid", error: "Invalid schema", revision: "r2" });
    });
    const invalidBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translation settings are invalid",
    );
    expect(invalidBtn.props.disabled).toBe(true);

    // Ready enables it; subsequent external change turning enabled=false hides it.
    await act(async () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true }, "r3");
    });
    const readyBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply",
    );
    expect(readyBtn.props.disabled).toBe(false);

    await act(async () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "r4");
    });
    expect(
      renderer!.root.findAll((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply"),
    ).toHaveLength(0);
  });

  it("preserves full multi-block source after virtual remounts and refuses incomplete block fallback", async () => {
    const longReply = Array.from({ length: 85 }, (_, i) => `Section ${i}: ${"detail ".repeat(30)}\n\n`).join("");
    const split = assistantRows(longReply, "complete", "msg-first-long");
    expect(split.length).toBeGreaterThan(1);

    // Generate >500 other multi-block replies and clear session cache to simulate heavy scroll + remount.
    for (let i = 0; i < 450; i += 1) {
      assistantRows(longReply, "complete", `msg-other-${i}`);
    }
    translationStore.clearAll();

    mocks.rpc.mockResolvedValue({
      state: "done",
      translation: "完整长译文",
      targetLanguageCode: "zh-CN",
      provider: "claude",
      model: "claude-sonnet-4-5",
      thinkingMode: "none",
      thinkingOptionId: null,
    });

    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(LiveAssistantRenderer, {
          agentId: "agent-long",
          item: {
            id: "row-long-0",
            type: "plugin",
            kind: "omp-assistant",
            version: 1,
            data: split[0]!.data,
          },
          theme,
          layout: { compact: false, platform: "web" },
          timestamp: new Date("2026-11-19T10:00:00Z"),
        } as never),
      );
    });

    const leadBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply",
    );
    await act(async () => {
      leadBtn.props.onPress();
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "start",
        text: longReply,
      }),
    );

    // An incomplete multi-block row without sourceText or messageText must NOT silently translate block 0 alone.
    const incomplete = resolveAssistantSource("agent-long", {
      text: "Only block 0 slice",
      phase: "complete",
      blockIndex: 0,
      sourceId: "msg-incomplete",
    });
    expect(incomplete.sourceAvailable).toBe(false);
    await act(async () => {
      renderer!.update(
        React.createElement(LiveAssistantRenderer, {
          agentId: "agent-long",
          item: {
            id: "row-incomplete",
            type: "plugin",
            kind: "omp-assistant",
            version: 1,
            data: { text: "Only block 0 slice", phase: "complete", blockIndex: 0, sourceId: "msg-incomplete" },
          },
          theme,
          layout: { compact: false, platform: "web" },
          timestamp: new Date("2026-11-19T10:00:01Z"),
        } as never),
      );
    });
    const unavailableBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Full reply text is unavailable for this block",
    );
    expect(unavailableBtn.props.disabled).toBe(true);
  });

  it("preserves collapsed visibility if user hides while translation is still running across done, error, and idle", async () => {
    setTranslationPaseo({
      agents: { ref: () => ({ timeline: { subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }) as never } }) },
    });

    let statusCall = 0;
    let currentOutcome: Record<string, unknown> = {
      state: "done",
      translation: "异步完成译文",
      targetLanguageCode: "zh-CN",
      provider: "claude",
      model: "claude-sonnet-4-5",
      thinkingMode: "none",
      thinkingOptionId: null,
    };
    mocks.rpc.mockImplementation(async (input: { action: string }) => {
      if (input.action === "start") {
        statusCall = 0;
        return { state: "running", helperId: "helper-async", text: "部分..." };
      }
      statusCall += 1;
      return currentOutcome;
    });

    const props = {
      agentId: "agent-async",
      item: {
        id: "row-async-done",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text: "Async message", phase: "complete", sourceId: "msg-async-1" },
      },
      theme,
      layout: { compact: false, platform: "web" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });

    const translateBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply",
    );
    await act(async () => {
      translateBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("部分...");

    // Collapse while request is still in-flight.
    const hideBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Hide",
    );
    await act(async () => {
      hideBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("部分...");

    // Wait for background status poll to finish -> must stay hidden until user expands.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1150));
    });
    expect(statusCall).toBeGreaterThanOrEqual(1);
    expect(translationStore.read("agent-async:assistant:msg-async-1")?.state.state).toBe("done");
    expect(translationStore.read("agent-async:assistant:msg-async-1")?.visible).toBe(false);
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("异步完成译文");

    // Manual re-expand reveals cached translation without calling RPC again.
    const rpcCountBeforeExpand = mocks.rpc.mock.calls.length;
    const showBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Show translation",
    );
    await act(async () => {
      showBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("异步完成译文");
    expect(mocks.rpc.mock.calls.length).toBe(rpcCountBeforeExpand);

    // Repeat with error / idle loss: collapsing while running stays collapsed on error settlement.
    currentOutcome = { state: "idle" };
    const errProps = {
      ...props,
      item: { ...props.item, data: { text: "Async fail message", phase: "complete", sourceId: "msg-async-err" } },
    };
    await act(async () => {
      renderer!.update(React.createElement(LiveAssistantRenderer, errProps as never));
    });
    const startErrBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply",
    );
    await act(async () => {
      startErrBtn.props.onPress();
    });
    const hideErrBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Hide",
    );
    await act(async () => {
      hideErrBtn.props.onPress();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1150));
    });
    expect(translationStore.read("agent-async:assistant:msg-async-err")?.state.state).toBe("error");
    expect(translationStore.read("agent-async:assistant:msg-async-err")?.visible).toBe(false);
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("was lost");

    const showErrBtn = renderer!.root.find(
      (n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Show translation",
    );
    await act(async () => {
      showErrBtn.props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("was lost");
  });

  it("keeps subsequent blocks full-width on multi-block replies and measures Yoga width/height constraints on long replies", async () => {
    const multiBlockReply = [
      "Short intro paragraph introducing the architecture.",
      "",
      "Second paragraph is much longer and spans multiple wrapped lines across narrow mobile and desktop viewports without shrinking its available width when inline translation is enabled.",
      "",
      "Third paragraph continues with code `pnpm test --filter timeline-translation` and detailed verification notes.",
    ].join("\n");

    const singleParagraphLongReply =
      "This single paragraph intentionally runs across many lines on both mobile phones and desktop panels to measure real Yoga text wrapping height and width behavior when a top-right action slot reserves clearance beside the first block without rewriting the Markdown renderer.";

    const makeProps = (text: string, compact: boolean) => ({
      agentId: "agent-layout",
      item: {
        id: "row-layout",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text, phase: "complete", sourceId: `msg-${text.length}` },
      },
      theme,
      layout: { compact, platform: compact ? ("ios" as const) : ("web" as const) },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    });

    // 1. Multi-block long reply across 720 / 390 / 320: blocks 1..N stay 100% baseline width & 0pt height delta.
    for (const width of [720, 390, 320]) {
      const compact = width < 500;
      await act(async () => {
        publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, `off-${width}`);
        if (!renderer) renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, makeProps(multiBlockReply, compact) as never));
        else renderer.update(React.createElement(LiveAssistantRenderer, makeProps(multiBlockReply, compact) as never));
      });
      const baseRootView = renderer!.root.findByType("View" as never);
      const baseFrames = measureHostTree(baseRootView, { width, wrapText: true, wordWrap: true });
      const baseBlockFrames = renderer!.root
        .findAll((n) => (n.type as unknown) === "Text")
        .map((n) => baseFrames.get(n))
        .filter((f): f is NonNullable<typeof f> => f !== undefined);

      await act(async () => {
        publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true }, `on-${width}`);
      });
      const onRootView = renderer!.root.findByType("View" as never);
      const onFrames = measureHostTree(onRootView, { width, wrapText: true, wordWrap: true });
      const onRoot = onFrames.get(onRootView)!;
      expect(onRoot.width).toBeLessThanOrEqual(width);

      // Block 0 action row has zero overlap between block 0 body and top-right button.
      const rowView = renderer!.root.find((n) => (n.type as unknown) === "View" && n.props.testID === "translation-row");
      const directViews = rowView.children
        .map((c) => (typeof c === "string" ? null : c.find((h) => (h.type as unknown) === "View")))
        .filter((h): h is ReactTestInstance => h !== null);
      expect(directViews).toHaveLength(2);
      const bodyFrame = onFrames.get(directViews[0]!)!;
      const actionFrame = onFrames.get(directViews[1]!)!;
      expect(bodyFrame.left + bodyFrame.width).toBeLessThanOrEqual(actionFrame.left + 0.01);
      expect(actionFrame.left + actionFrame.width).toBeLessThanOrEqual(width + 0.01);
      expect(actionFrame.top).toBe(bodyFrame.top);

      // Paragraphs 2 and 3 (blocks 1 and 2) keep exact full width and exact height vs disabled baseline.
      const onBlockFrames = renderer!.root
        .findAll((n) => (n.type as unknown) === "Text")
        .map((n) => onFrames.get(n))
        .filter((f): f is NonNullable<typeof f> => f !== undefined);
      expect(onBlockFrames.slice(1)).toHaveLength(baseBlockFrames.slice(1).length);
      for (let i = 1; i < baseBlockFrames.length; i += 1) {
        expect(onBlockFrames[i]!.width).toBe(baseBlockFrames[i]!.width);
        expect(onBlockFrames[i]!.height).toBe(baseBlockFrames[i]!.height);
      }
      // First block only takes the action clearance (~28pt), while remaining blocks retain 100% baseline width.
      expect(onBlockFrames[1]!.width).toBe(width);
    }

    // 2. Short single-line reply + Long single-paragraph reply: measure non-overlap & concrete Yoga first-block width/height changes.
    const shortSingleLine = "Short reply line.";
    for (const width of [720, 390, 320]) {
      const compact = width < 500;
      await act(async () => {
        publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, `short-off-${width}`);
        renderer!.update(React.createElement(LiveAssistantRenderer, makeProps(shortSingleLine, compact) as never));
      });
      const baseRootView = renderer!.root.findByType("View" as never);
      const baseFrames = measureHostTree(baseRootView, { width, wrapText: true, wordWrap: true });
      const baseRoot = baseFrames.get(baseRootView)!;

      await act(async () => {
        publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true }, `short-on-${width}`);
      });
      const onRootView = renderer!.root.findByType("View" as never);
      const onFrames = measureHostTree(onRootView, { width, wrapText: true, wordWrap: true });
      const onRoot = onFrames.get(onRootView)!;
      expect(onRoot.height).toBe(width === 720 ? 24 : baseRoot.height);
    }

    const expectedLongParagraph: Record<number, { baseHeight: number; onHeight: number; bodyWidth: number }> = {
      720: { baseHeight: 66, onHeight: 88, bodyWidth: 692 },
      390: { baseHeight: 168, onHeight: 168, bodyWidth: 362 },
      320: { baseHeight: 192, onHeight: 216, bodyWidth: 292 },
    };
    for (const width of [720, 390, 320]) {
      const compact = width < 500;
      await act(async () => {
        publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, `sp-off-${width}`);
        renderer!.update(React.createElement(LiveAssistantRenderer, makeProps(singleParagraphLongReply, compact) as never));
      });
      const baseRootView = renderer!.root.findByType("View" as never);
      const baseFrames = measureHostTree(baseRootView, { width, wrapText: true, wordWrap: true });
      const baseRoot = baseFrames.get(baseRootView)!;

      await act(async () => {
        publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true }, `sp-on-${width}`);
      });
      const onRootView = renderer!.root.findByType("View" as never);
      const onFrames = measureHostTree(onRootView, { width, wrapText: true, wordWrap: true });
      const onRoot = onFrames.get(onRootView)!;
      const rowView = renderer!.root.find((n) => (n.type as unknown) === "View" && n.props.testID === "translation-row");
      const directViews = rowView.children
        .map((c) => (typeof c === "string" ? null : c.find((h) => (h.type as unknown) === "View")))
        .filter((h): h is ReactTestInstance => h !== null);
      const bodyFrame = onFrames.get(directViews[0]!)!;
      const actionFrame = onFrames.get(directViews[1]!)!;
      const expected = expectedLongParagraph[width]!;
      expect(bodyFrame.left + bodyFrame.width).toBeLessThanOrEqual(actionFrame.left + 0.01);
      expect(bodyFrame.width).toBe(expected.bodyWidth);
      expect(baseRoot.height).toBe(expected.baseHeight);
      expect(onRoot.height).toBe(expected.onHeight);
    }
  });

  it("invalidates cache when conversation agent provider, model, or thinking config changes before or during flight", async () => {
    setTranslationPaseo({
      agents: { ref: () => ({ timeline: { subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }) as never } }) },
    });

    let round = 0;
    let statusOutcome: Record<string, unknown> | null = null;
    mocks.rpc.mockImplementation(async (input: { action: string }) => {
      if (input.action === "start") {
        round += 1;
        if (round === 3) {
          return { state: "running", helperId: "helper-inflight" };
        }
        return {
          state: "done",
          translation: `译文 #${round}`,
          targetLanguageCode: "zh-CN",
          provider: agentApi.current().provider,
          model: agentApi.current().model,
          thinkingMode: "disabled",
          thinkingOptionId: "off",
        };
      }
      return statusOutcome ?? { state: "running", helperId: "helper-inflight" };
    });

    const props = {
      agentId: "agent-model-switch",
      item: {
        id: "row-model-switch",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text: "Check model switching", phase: "complete", sourceId: "msg-model-switch" },
      },
      theme,
      layout: { compact: false, platform: "web" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });

    // 1. Initial translation under claude / claude-sonnet-4-5 / high.
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("译文 #1");

    // 2. Switching agent model invalidates cache immediately.
    await act(async () => {
      agentApi.setAgent({
        provider: "claude",
        model: "claude-opus-4-1",
        thinkingOptionId: "high",
        effectiveThinkingOptionId: "high",
      });
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("译文 #1");

    // Re-translate under new model -> #2.
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("译文 #2");

    // 3. The effective thinking option can change without a change to the configured option.
    await act(async () => {
      agentApi.setAgent({
        provider: "claude",
        model: "claude-opus-4-1",
        thinkingOptionId: "high",
        effectiveThinkingOptionId: "low",
      });
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("译文 #2");

    // 4. Start an in-flight request (round === 3 -> running), switch agent provider+model mid-flight, then finish stale request.
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    expect(translationStore.read("agent-model-switch:assistant:msg-model-switch")?.state.state).toBe("running");
    expect(JSON.parse(mocks.rpc.mock.lastCall?.[0].configSignature)).toMatchObject({ thinkingOptionId: "low" });

    await act(async () => {
      agentApi.setAgent({
        provider: "codex",
        model: "gpt-5",
        thinkingOptionId: "medium",
        effectiveThinkingOptionId: "medium",
      });
    });
    // Under new codex/gpt-5 config, the in-flight claude entry is no longer current.
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("Translating");

    statusOutcome = {
      state: "done",
      translation: "过时的旧模型译文",
      targetLanguageCode: "zh-CN",
      provider: "claude",
      model: "claude-opus-4-1",
      thinkingMode: "inherited",
      thinkingOptionId: "low",
    };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1150));
    });
    // Even after the old job finishes, it must NOT show under the switched codex/gpt-5 agent.
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("过时的旧模型译文");

    // 5. With customModel=true, changing agent config leaves custom-model translation cache intact.
    await act(async () => {
      publishTranslationSettings(
        { ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, customModel: true, provider: "claude", model: "claude-sonnet-4-5" },
        "custom-on",
      );
    });
    expect(agentApi.subscriptions[0]!.release).toHaveBeenCalledOnce();
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("译文 #4");

    await act(async () => {
      agentApi.setAgent({
        provider: "gemini",
        model: "gemini-3",
        thinkingOptionId: "high",
        effectiveThinkingOptionId: "high",
      });
    });
    expect(collectTexts(renderer!.root).join("\n")).toContain("译文 #4");
  });

  it("displays explicit result notice for unsupported_off and non-overclaiming note for none when disableThinking is enabled", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        state: "done",
        translation: "译文（未关闭思考）",
        targetLanguageCode: "zh-CN",
        provider: "claude",
        model: "claude-sonnet-4-5",
        thinkingMode: "unsupported_off",
        thinkingOptionId: "high",
      })
      .mockResolvedValueOnce({
        state: "done",
        translation: "译文（无开关）",
        targetLanguageCode: "zh-CN",
        provider: "codex",
        model: "gpt-4.1",
        thinkingMode: "none",
        thinkingOptionId: null,
      })
      .mockResolvedValueOnce({
        state: "done",
        translation: "译文（已关闭）",
        targetLanguageCode: "zh-CN",
        provider: "claude",
        model: "claude-opus-4-1",
        thinkingMode: "disabled",
        thinkingOptionId: "off",
      });

    const props = {
      agentId: "agent-thinking-notice",
      item: {
        id: "row-thinking-1",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: { text: "First reply", phase: "complete", sourceId: "msg-th-1" },
      },
      theme,
      layout: { compact: false, platform: "web" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    const unsupportedTexts = collectTexts(renderer!.root).join("\n");
    expect(unsupportedTexts).toContain("译文（未关闭思考）");
    expect(unsupportedTexts).toContain("Thinking was NOT disabled");
    expect(unsupportedTexts).toContain("high");

    // Second message: thinkingMode === "none" with disableThinking=true -> no overclaim.
    await act(async () => {
      renderer!.update(
        React.createElement(LiveAssistantRenderer, {
          ...props,
          item: { ...props.item, data: { text: "Second reply", phase: "complete", sourceId: "msg-th-2" } },
        } as never),
      );
    });
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    const noneTexts = collectTexts(renderer!.root).join("\n");
    expect(noneTexts).toContain("译文（无开关）");
    expect(noneTexts).toContain("exposes no thinking control");
    expect(noneTexts).not.toContain("Thinking was NOT disabled");

    // Third message: thinkingMode === "disabled" -> no failure/unsupported notice.
    await act(async () => {
      renderer!.update(
        React.createElement(LiveAssistantRenderer, {
          ...props,
          item: { ...props.item, data: { text: "Third reply", phase: "complete", sourceId: "msg-th-3" } },
        } as never),
      );
    });
    await act(async () => {
      renderer!.root.find((n) => n.props.accessibilityRole === "button" && n.props.accessibilityLabel === "Translate reply").props.onPress();
    });
    const disabledTexts = collectTexts(renderer!.root).join("\n");
    expect(disabledTexts).toContain("译文（已关闭）");
    expect(disabledTexts).not.toContain("Thinking was NOT disabled");
    expect(disabledTexts).not.toContain("exposes no thinking control");
  });
});
