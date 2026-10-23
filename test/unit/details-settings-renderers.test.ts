import React from "react";
import { describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

(globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  usePaseo: () => ({ agents: { ref: () => ({ refresh: async () => null }) } }),
  useRpc: () => async () => null,
}));
vi.mock("../../client/ui/chat-composer", async () => {
  const ReactModule = await import("react");
  return { ChatComposerContext: ReactModule.createContext(null) };
});
vi.mock("../../client/preferences", () => ({
  useEnhancerPreferences: () => ({
    uiFont: "host", selectionActions: false, compactRowSpacing: true, compactReplySpacing: true,
    toolDetail: "collapsed", markdownVariant: "document", pathDisplay: "relative", previewWrap: true,
  }),
}));
vi.mock("../../client/components/theme-tokens", () => ({
  useThemeTokens: () => ({
    fontUi: "system", fontMono: "monospace", foreground: "#111", foregroundMuted: "#666",
    typography: { block: { rowHeight: { compact: 22, desktop: 26 }, caption: { size: 11 } } },
  }),
}));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: () => null }));
vi.mock("../../client/components/reasoning-trace", () => ({ ReasoningCard: () => null }));
vi.mock("../../client/components/task-list", () => ({
  TaskList: () => null, TaskListPanel: () => null,
  useTaskListPanel: () => ({ anchorRef: { current: null }, open: false, popped: false, placed: false, maximized: false, close() {} }),
}));
vi.mock("../../client/components/task-activity-row", () => ({ TaskActivityRow: () => null }));
vi.mock("../../client/components/user-message", () => ({ UserMessage: () => null, TurnUsageRow: () => null }));
vi.mock("../../client/components/notice-callout", () => ({ NoticeCallout: () => null }));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() {} }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/state/disclosure-store", () => ({ useDisclosure: () => [false, () => {}] }));
vi.mock("../../client/reasoning/segment", () => ({ createReasoningSegmenter: () => ({ update: () => ({}) }) }));
vi.mock("../../client/reasoning/key", () => ({ useReasoningKey: () => "thought-key" }));
vi.mock("../../client/reasoning/observed", () => ({ observeReasoning() {}, observedDurationMs: () => null }));
vi.mock("../../client/state/todo-timeline", () => ({
  HOST_ITEM_GAP: 16, deriveTodoActivities: () => [], todoTaskStatus: () => "pending", useLatestTodoItems: () => null,
  useTodoTimeline: () => ({ role: "full", previous: [], emptyGaps: { above: 0, below: 0 }, measureEmptyGaps() {} }),
}));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/components/turn-footer", () => ({ AssistantFooter: () => null }));
vi.mock("../../client/components/system-card", () => ({ SystemCard: () => null }));
vi.mock("../../client/components/markdown/markdown-view", () => ({ MarkdownView: () => null }));
vi.mock("../../client/timeline-tail", () => ({ useTextItemTailKey: () => "reply-key" }));
vi.mock("../../client/timeline-order", () => ({
  useHasEntryAfter: () => false, useNextEntryIsRow: () => false, useTimelineEntry() {},
  useTimelineToolGroup: () => ({ group: null, anythingBelow: false, rowBelow: false, copiesBelow: 0, copiesBelowHeight: 0 }),
}));
vi.mock("../../client/host-row-gap", () => ({ useHostStacksRows: () => false }));
vi.mock("../../client/ui/path-text", async () => {
  const ReactModule = await import("react");
  return { PathContext: ReactModule.createContext(null), usePathContextValue: () => ({ roots: [], cwd: null, mode: "relative" }) };
});
vi.mock("../../client/image-file", () => ({ isImagePath: () => false, useImageFile: () => null }));
vi.mock("../../client/web", () => ({ toolRollupWindow: () => null }));
vi.mock("../../client/tools/classify", () => ({ classifyTool: () => ({ title: "Read", tool: "read", status: "completed", filePath: null }) }));
vi.mock("../../client/tools/disclosure", () => ({ defaultToolExpanded: () => false, toolDisclosureKey: () => "tool-key" }));
vi.mock("../../client/debug/perf", () => ({ probeCard: () => ({ node: null, viewProps: {} }), textItemKey: () => "text-key" }));
vi.mock("../../client/ui/use-revealed-text", () => ({ useRevealedText: (text: string) => text }));
vi.mock("../../client/state/latest-prompt", () => ({ useIsLatestPrompt: () => false }));
vi.mock("../../client/state/turn-footers", () => ({ useTurnFooter: () => null }));
vi.mock("../../client/state/agent-message-senders", () => ({ useAgentMessageSender: () => null }));
vi.mock("../../client/state/footer-model", () => ({ useFooterModel: () => ({ modelName: null, thinkingLabel: null }) }));
vi.mock("../../client/system-envelope", () => ({ parseSystemEnvelope: () => null }));
vi.mock("../../client/details/shell/details-host-slot", async () => {
  const ReactModule = await import("react");
  const { BlockPlacementContext } = await import("../../client/details/contracts");
  return {
    DetailsHostSlot: (props: Record<string, unknown>) => ReactModule.createElement(
      "DetailsHostSlotProbe",
      { ...props, placement: ReactModule.useContext(BlockPlacementContext) },
    ),
  };
});

import {
  LiveAssistantRenderer,
  LiveNoticeRenderer,
  LiveReasoningRenderer,
  LiveTodoRenderer,
  LiveToolCallRenderer,
  LiveUserMessageRenderer,
} from "../../client/live-renderers";

const timestamp = new Date(1_700_000_000_123);
const theme = { colors: {} };
const layout = { platform: "web", compact: false };

function rendererFor(Component: React.ComponentType<any>, data: Record<string, unknown>) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Component, {
      agentId: "agent-1", item: { type: "plugin", kind: "test", version: 1, data },
      timestamp, theme, layout, host: { id: "host-1" }, composer: null,
    }));
  });
  const slot = renderer.root.find((node) => (node.type as unknown) === "DetailsHostSlotProbe");
  const props = { ...slot.props };
  act(() => renderer.unmount());
  return { props };
}

describe("timeline renderer details placement", () => {
  it.each([
    ["tool", LiveToolCallRenderer, { name: "Read", status: "completed", callId: "call-1" }],
    ["thought", LiveReasoningRenderer, { text: "thinking", phase: "complete" }],
    ["todo", LiveTodoRenderer, { items: [], phase: "complete" }],
    ["activity", LiveAssistantRenderer, { text: "reply", messageText: "reply", phase: "complete" }],
    ["activity", LiveNoticeRenderer, { level: "info", message: "notice" }],
    ["activity", LiveUserMessageRenderer, { text: "prompt", messageId: "prompt-1" }],
  ] as const)("provides placement and a host slot for %s rows", (kind, Component, data) => {
    const slot = rendererFor(Component, data);
    expect(slot.props.placement).toEqual({ agentId: "agent-1", at: timestamp.getTime(), kind });
    expect(slot.props.agentId).toBe("agent-1");
    expect(slot.props.itemKey).toEqual(expect.any(String));
    expect(slot.props.compact).toBe(false);
  });
});
