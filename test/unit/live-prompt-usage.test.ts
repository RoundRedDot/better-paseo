import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

(globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({
  agent: { status: "idle", updatedAt: "0" },
  usage: null as unknown,
  listeners: new Set<() => void>(),
  refresh: vi.fn(),
  api: {} as unknown,
}));

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", async () => {
  const ReactModule = await import("react");
  return {
    useAgent: (_id: string, selector: (agent: typeof runtime.agent) => unknown) => ReactModule.useSyncExternalStore(
      (listener) => { runtime.listeners.add(listener); return () => { runtime.listeners.delete(listener); }; },
      () => selector(runtime.agent),
    ),
    usePaseo: () => runtime.api,
    useRpc: () => async () => null,
  };
});
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
vi.mock("../../client/components/user-message", async () => {
  const ReactModule = await import("react");
  return {
    UserMessage: ({ footer }: { footer?: React.ReactNode }) => ReactModule.createElement("PromptProbe", null, footer),
    TurnUsageRow: (props: Record<string, unknown>) => ReactModule.createElement("UsageProbe", props),
  };
});
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
vi.mock("../../client/tools/classify", () => ({ classifyTool: () => ({ title: "Read", tool: "read", status: "completed", filePath: null }) }));
vi.mock("../../client/tools/disclosure", () => ({ defaultToolExpanded: () => false, toolDisclosureKey: () => "tool-key" }));
vi.mock("../../client/debug/perf", () => ({ probeCard: () => ({ node: null, viewProps: {} }), textItemKey: () => "text-key" }));
vi.mock("../../client/ui/use-revealed-text", () => ({ useRevealedText: (text: string) => text }));
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


import { LiveUserMessageRenderer } from "../../client/live-renderers";

const theme = { colors: {} };
const layout = { platform: "web", compact: false };
const first = { inputTokens: 1_000, outputTokens: 200 };
const second = { inputTokens: 9_000, outputTokens: 900 };

function setAgent(status: string, usage: unknown) {
  runtime.agent = { status, updatedAt: String(Number(runtime.agent.updatedAt) + 1) };
  runtime.usage = usage;
  for (const listener of [...runtime.listeners]) listener();
}

function prompt(agentId: string, messageId: string, at: number) {
  return React.createElement(LiveUserMessageRenderer, {
    key: messageId, agentId, timestamp: new Date(at), theme, layout, host: { id: "host-1" }, composer: null,
    item: { type: "plugin", kind: "omp-user-message", version: 1, data: { text: messageId, messageId } },
  } as never);
}

const flush = () => act(async () => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); });

afterEach(() => { runtime.listeners.clear(); });

describe("live prompt usage", () => {
  it("keeps a finished turn's figures when its row remounts after a newer prompt, without borrowing the newer turn's", async () => {
    runtime.api = { agents: { ref: () => ({ refresh: runtime.refresh }) } };
    runtime.refresh.mockReset().mockImplementation(async () => ({ agent: { lastUsage: runtime.usage } }));
    runtime.agent = { status: "idle", updatedAt: "0" };
    runtime.usage = first;
    const agentId = "prompt-usage-agent";
    const now = Date.now();
    const older = prompt(agentId, "older", now - 2_000);
    const newer = prompt(agentId, "newer", now - 1_000);
    const usageOf = (renderer: TestRenderer.ReactTestRenderer) =>
      renderer.root.findAll((node) => (node.type as unknown) === "UsageProbe").map((node) => node.props.usage as unknown);

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, older)); });
    await flush();
    expect(usageOf(renderer)).toEqual([first]);

    // A newer prompt starts its own turn, which reports other figures.
    setAgent("running", second);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, older, newer)); });
    await flush();
    expect(usageOf(renderer)).toEqual([first, second]);

    // The older row scrolls away and back: it no longer reads the agent, yet keeps its figures.
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, newer)); });
    const reads = runtime.refresh.mock.calls.length;
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, older, newer)); });
    await flush();
    expect(usageOf(renderer)).toEqual([first, second]);
    expect(runtime.refresh).toHaveBeenCalledTimes(reads);
    act(() => renderer.unmount());
  });
});
