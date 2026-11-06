import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactTestInstance } from "react-test-renderer";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveTodoPayload, LiveToolCallPayload } from "../../client/live-renderers";
import { measureHostTree, type Frame } from "./helpers/yoga-host-layout";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, useRevealedText: (text: string) => text }));
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined, useRpc: () => () => Promise.resolve(null) }));
vi.mock("../../client/preferences", async (original) => ({ ...await original<object>(),
  useEnhancerPreferences: () => ({ compactRowSpacing: false, uiFont: "system" }) }));
vi.mock("../../client/components/theme-tokens", async (original) => ({ ...await original<object>(),
  useThemeTokens: () => ({ typography: { block: { rowHeight: { desktop: 26, compact: 28 } } } }) }));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() {} }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/ui/path-text", async (original) => ({ ...await original<object>(), usePathContextValue: () => ({ roots: [], mode: "relative" }) }));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: () => React.createElement("View", { testID: "tool", style: { height: 26 } }) }));
// Fixed leaves isolate host spacing from checklist typography and disclosure state.
vi.mock("../../client/components/task-list", () => ({
  TaskList: () => React.createElement("View", { testID: "checklist", style: { height: 120 } }),
  TaskListPanel: () => null,
  useTaskListPanel: () => ({ open: false, close() {} }),
}));
vi.mock("../../client/components/task-activity-row", () => ({
  TaskActivityRow: () => React.createElement("View", { testID: "old-summary", style: { height: 100 } }),
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { LiveTodoRenderer, LiveToolCallRenderer } = await import("../../client/live-renderers");
const { resetHostRowGap, noteRowGap } = await import("../../client/host-row-gap");
const { View } = await import("./helpers/rn-mock");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const completed = ["server", "build", "login", "sync"].map((text) => ({ text, completed: true }));
const at = Date.parse("2026-11-06T03:04:51.298Z");
const frame = { host: { id: "local", label: "Local" }, theme: { colors: {} } as never,
  layout: { compact: false, platform: "web" as const } };

function todo(agentId: string, key: string, timestamp: number, items = completed) {
  const props: PluginTimelineItemProps<LiveTodoPayload> = { ...frame, agentId, timestamp: new Date(timestamp),
    item: { type: "plugin", kind: "omp-todo", version: 1, data: { items, phase: "complete" } } };
  return <LiveTodoRenderer {...props} key={key} />;
}

function tool(agentId: string, timestamp = at) {
  const props: PluginTimelineItemProps<LiveToolCallPayload> = { ...frame, agentId, timestamp: new Date(timestamp),
    item: { type: "plugin", kind: "omp-tool-call", version: 1, data: {
      name: "think", callId: "plan-result", status: "completed", phase: "complete",
      detail: { type: "plain_text", label: "Updating plan", text: JSON.stringify({ TodosUpdated: {
        todos: completed.map((task) => ({ content: task.text, status: "completed" })),
      } }) },
    } } };
  return <LiveToolCallRenderer {...props} key="grok" />;
}

afterEach(() => { resetHostRowGap(); delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

describe("Grok plan host-slot layout", () => {
  it.each([
    ["web", 16, true, 0], ["ios", 16, true, 0],
    ["web", 0, true, 0], ["ios", 0, true, 0],
    ["web", 16, false, 0], ["ios", 16, false, 0],
    ["web", 16, true, 1000], ["ios", 16, true, 1000],
    ["web", 16, true, 5000], ["ios", 16, true, 5000],
  ] as const)("keeps host spacing on %s (gap=%i, Grok=%s, offset=%i)", async (platform, gap, withTool, offset) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    resetHostRowGap();
    if (gap === 0) noteRowGap(0);
    const agent = `layout-${platform}-${gap}-${withTool}-${offset}`;
    // Actual seq order: scp 1807, Grok tool 1809, todo 1812 (two completions), reads 1814/1816.
    // The old expanded summary is a separate state, modeled here independently.
    const items = [todo(agent, "old", at - 60_000, completed.slice(2)), ...(withTool ? [tool(agent, at + offset)] : []),
      todo(agent, "completed-login", at), todo(agent, "completed-sync", at),
      <View key="next" testID="next" style={{ height: 26 }} />];
    const mounted = platform === "web" ? items : [...items].reverse();
    let frames = new Map<ReactTestInstance, Frame>();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<View style={{ flexDirection: platform === "web" ? "column" : "column-reverse" }}>
        {mounted.map((item) => <View key={item.key} testID={`host:${item.key}`} style={{ marginBottom: gap }}>{item}</View>)}
      </View>, { createNodeMock(element) {
        const ref = (element.props as { ref?: unknown }).ref;
        const box = () => [...frames].find(([node]) => node.props.ref === ref)?.[1] ?? { left: 0, top: 0, width: 0, height: 0 };
        return platform === "web" ? { getBoundingClientRect: box } : {
          measureInWindow(callback: (x: number, y: number, width: number, height: number) => void) {
            const b = box(); callback(b.left, b.top, b.width, b.height);
          },
        };
      } });
    });
    try {
      let signature = "";
      for (let pass = 0; pass < 8; pass++) {
        frames = measureHostTree(renderer.root, { width: 600 });
        const next = JSON.stringify([...frames.values()]);
        if (next === signature) break;
        signature = next;
        await act(async () => { for (const [node, box] of frames) node.props.onLayout?.({ nativeEvent: { layout: box } }); });
        expect(pass).toBeLessThan(7);
      }
      const old = renderer.root.findByProps({ testID: "old-summary" });
      const list = renderer.root.findByProps({ testID: "checklist" });
      const oldBox = frames.get(old)!;
      const listBox = frames.get(list)!;
      const unmatchedTool = withTool && offset > 3000;
      expect(listBox.top - oldBox.top - oldBox.height).toBe(unmatchedTool ? 26 + 2 * gap : gap);
      const nextRow = renderer.root.findAllByType("View" as never).find((node) => node.props.testID === "next")!;
      expect(frames.get(nextRow)!.top - listBox.top - listBox.height).toBe(gap);
      expect(renderer.root.findAllByProps({ testID: "checklist" })).toHaveLength(1);
      expect(renderer.root.findAllByProps({ testID: "tool" })).toHaveLength(unmatchedTool ? 1 : 0);
      // The highest slot owns the checklist; none of its top lies under a hidden cell.
      const wrapper = renderer.root.findAllByType("View" as never).find((node) => node.props.testID?.startsWith("host:") &&
        node.findAllByProps({ testID: "checklist" }).length > 0);
      expect(wrapper).toBeDefined();
      expect(listBox.top).toBe(frames.get(wrapper!)!.top);
    } finally { await act(async () => renderer.unmount()); }
  });
});
