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
  publishTranslationSettings,
  resetTranslationSettingsStoreForTests,
} from "../../client/translation/settings-store";
import {
  resetTranslationStoreForTests,
  resolveAssistantSource,
  resolveReasoningSource,
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

  it("never overlaps text or adds block spacing at rest across desktop and mobile widths", async () => {
    const props = {
      agentId: "agent-layout",
      item: {
        id: "row-layout",
        type: "plugin" as const,
        kind: "omp-assistant",
        version: 1,
        data: {
          text: "First paragraph of the assistant reply explaining how layout works on narrow mobile viewports.",
          phase: "complete",
          sourceId: "msg-layout",
        },
      },
      theme,
      layout: { compact: true, platform: "ios" as const },
      timestamp: new Date("2026-11-19T10:00:00Z"),
    };

    // Baseline height without translation enabled.
    await act(async () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false });
      renderer = TestRenderer.create(React.createElement(LiveAssistantRenderer, props as never));
    });
    const baselineFrames = measureHostTree(renderer!.root.findByType("View" as never), {
      width: 390,
      wrapText: true,
      wordWrap: true,
    });
    const baselineRoot = baselineFrames.get(renderer!.root.findByType("View" as never))!;

    // Enable translation (idle state): button sits at top-right without adding vertical block height or overlapping prose.
    await act(async () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true });
    });
    for (const width of [720, 390, 320]) {
      await act(async () => {
        renderer!.update(
          React.createElement(LiveAssistantRenderer, {
            ...props,
            layout: { compact: width < 500, platform: width < 500 ? "ios" : "web" },
          } as never),
        );
      });
      const rootView = renderer!.root.findByType("View" as never);
      const frames = measureHostTree(rootView, { width, wrapText: true, wordWrap: true });
      const rootFrame = frames.get(rootView)!;
      expect(rootFrame.width).toBeLessThanOrEqual(width);

      if (width === 390) {
        expect(rootFrame.height).toBeGreaterThanOrEqual(baselineRoot.height);
        expect(rootFrame.height).toBeLessThanOrEqual(baselineRoot.height + 24);
      }

      const rowView = renderer!.root.find((n) => (n.type as unknown) === "View" && n.props.testID === "translation-row");
      const directViews = rowView.children
        .map((c) => (typeof c === "string" ? null : c.find((h) => (h.type as unknown) === "View")))
        .filter((h): h is ReactTestInstance => h !== null);
      expect(directViews).toHaveLength(2);
      const bodyFrame = frames.get(directViews[0]!)!;
      const actionFrame = frames.get(directViews[1]!)!;
      expect(bodyFrame.left + bodyFrame.width).toBeLessThanOrEqual(actionFrame.left + 0.01);
      expect(actionFrame.left + actionFrame.width).toBeLessThanOrEqual(width + 0.01);
      expect(actionFrame.top).toBe(bodyFrame.top);
    }
  });
});
