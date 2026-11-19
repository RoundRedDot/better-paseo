import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
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
  resetTranslationStoreForTests,
  resolveAssistantSource,
  resolveReasoningSource,
  setTranslationPaseo,
  translationStore,
} from "../../client/translation/store";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toastError: vi.fn(),
  hover: true,
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  usePaseo: () => ({
    agents: {
      ref: () => ({
        refresh: async () => null,
        timeline: {
          subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
        },
      }),
    },
  }),
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

beforeEach(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  mocks.hover = true;
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

    // Unmount and remount -> cached translation still shows without calling RPC again.
    act(() => renderer!.unmount());
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
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
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, targetLanguage: "ja" });
    });
    expect(collectTexts(renderer!.root).join("\n")).not.toContain("你好，Paseo");

    // Restoring settings to verify source text change invalidates too.
    await act(async () => {
      publishTranslationSettings(DEFAULT_TIMELINE_TRANSLATION_SETTINGS);
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

    // 2. Long single-paragraph reply: measure non-overlap & concrete Yoga first-block width/height trade-off.
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
      expect(bodyFrame.left + bodyFrame.width).toBeLessThanOrEqual(actionFrame.left + 0.01);
      expect(bodyFrame.width).toBeLessThan(baseRoot.width);
      expect(onRoot.height).toBeGreaterThanOrEqual(baseRoot.height);
    }
  });
});
