import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactTestInstance } from "react-test-renderer";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveTodoPayload, LiveToolCallPayload } from "../../client/live-renderers";
import { measureHostTree, type Frame } from "./helpers/yoga-host-layout";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: object) => React.createElement("Icon", props), useRevealedText: (text: string) => text,
  copyText: () => Promise.resolve(true), useToast: () => ({ show() {}, error() {}, success() {} }),
}));
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined, useRpc: () => () => Promise.resolve(null) }));
vi.mock("../../client/preferences", async (original) => ({ ...await original<object>(),
  useEnhancerPreferences: () => ({ compactRowSpacing: false, uiFont: "system", hoverPreviews: false, blockDetails: false }) }));
vi.mock("../../client/components/theme-tokens", async (original) => {
  const module = await original<typeof import("../../client/components/theme-tokens")>();
  const tokens = module.buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
    foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
    statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" } as never);
  return { ...module, useThemeTokens: () => tokens };
});
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() {}, selectionSurface: {} }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/web", async (original) => ({ ...await original<object>(), bindRowHover: () => () => {}, bindPreviewPointer: () => () => {} }));
vi.mock("../../client/ui/path-text", async (original) => ({ ...await original<object>(), usePathContextValue: () => ({ roots: [], mode: "relative" }) }));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: () => React.createElement("View", { style: { height: 26 } }) }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { LiveTodoRenderer, LiveToolCallRenderer } = await import("../../client/live-renderers");
const { TaskList } = await import("../../client/components/task-list");
const { TaskActivityRow } = await import("../../client/components/task-activity-row");
const { DisclosureHeader } = await import("../../client/ui/disclosure-header");
const { View } = await import("./helpers/rn-mock");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

it("settles real checklist rows while cached cell heights change the web virtual window", async () => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  const agentId = "virtual-todo-feedback-web";
  const items = ["server", "build", "login", "sync"].map((text) => ({ text, completed: true }));
  const base = { agentId, host: { id: "local", label: "Local" }, theme: { colors: {} } as never,
    layout: { compact: false, platform: "web" as const } };
  const todo = (key: string, at: number, tasks = items) => {
    const props: PluginTimelineItemProps<LiveTodoPayload> = { ...base, timestamp: new Date(at),
      item: { type: "plugin", kind: "omp-todo", version: 1, data: { items: tasks, phase: "complete" } } };
    return <LiveTodoRenderer key={key} {...props} />;
  };
  const toolProps: PluginTimelineItemProps<LiveToolCallPayload> = { ...base, timestamp: new Date(2000),
    item: { type: "plugin", kind: "omp-tool-call", version: 1, data: {
      name: "think", callId: "plan", status: "completed", phase: "complete", detail: {
        type: "plain_text", label: "Updating plan", text: JSON.stringify({ TodosUpdated: {
          todos: items.map((task) => ({ content: task.text, status: "completed" })),
        } }),
      },
    } } };
  const rows = Array.from({ length: 48 }, (_, index) => <View key={`filler-${index}`} style={{ height: 26 }} />);
  rows[18] = todo("old", 1000, items.slice(2));
  rows[19] = <LiveToolCallRenderer key="grok" {...toolProps} />;
  rows[20] = todo("todo-1", 2000);
  rows[21] = todo("todo-2", 2000);
  let offset = 0;
  const sizes = rows.map(() => 120);
  const mounted = new Set<number>();
  const grokMountedStates = new Set<boolean>();
  let frames = new Map<ReactTestInstance, Frame>();
  let boxes = new Map<unknown, Frame>();
  let renderer!: ReturnType<typeof TestRenderer.create>;
  // Same feedback contract as the host: retain offscreen sizes; resizing a
  // committed cell recomputes the range (8-row overscan) at a fixed scroll offset.
  const tree = () => {
    const tops: number[] = [];
    let top = 0;
    for (const size of sizes) { tops.push(top); top += size; }
    const first = tops.findIndex((y, index) => y + sizes[index]! >= offset);
    const last = tops.findIndex((y) => y >= offset + 200);
    mounted.clear();
    const children = rows.flatMap((row, index) => {
      if (index < Math.max(0, first - 8) || index > (last < 0 ? rows.length - 1 : last) + 8) return [];
      mounted.add(index);
      return <View key={row.key} testID={`cell-${index}`} style={{ marginBottom: 16 }}>{row}</View>;
    });
    grokMountedStates.add(mounted.has(19));
    return <View>{children}</View>;
  };
  await act(async () => { renderer = TestRenderer.create(tree(), { createNodeMock(element) {
    const ref = (element.props as { ref?: unknown }).ref;
    const box = () => boxes.get(ref) ?? { left: 0, top: 0, width: 0, height: 0 };
    return { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: box };
  } }); });
  let updates = 0;
  const settle = async () => {
    let previous = "";
    const history: string[] = [];
    for (let pass = 0; pass < 30; pass++) {
      frames = measureHostTree(renderer.root, { width: 600 });
      boxes = new Map([...frames].filter(([node]) => node.props.ref).map(([node, box]) => [node.props.ref, box]));
      const signature = JSON.stringify([...frames.values()]);
      history.push(JSON.stringify({ mounted: [...mounted], sizes: sizes.slice(18, 22) }));
      if (signature === previous) return;
      previous = signature;
      await act(async () => {
        for (const [node, box] of frames) node.props.onLayout?.({ nativeEvent: { layout: box } });
        for (const [node, box] of frames) {
          if (typeof node.props.testID !== "string" || !node.props.testID.startsWith("cell-")) continue;
          sizes[Number(node.props.testID.slice(5))] = box.height + 16;
        }
        renderer.update(tree()); updates++;
      });
    }
    throw new Error(`virtual row resize feedback did not settle at offset ${offset}: ${history.slice(-6).join("\n")}`);
  };
  try {
    for (offset = 0; offset <= 2100; offset += 10) await settle();
    for (offset = 2100; offset >= 0; offset -= 10) await settle();
    offset = sizes.slice(0, 18).reduce((sum, size) => sum + size, 0);
    await act(async () => renderer.update(tree()));
    await settle();
    expect(renderer.root.findAllByType(TaskList)).not.toHaveLength(0);
    const old = renderer.root.findByType(TaskActivityRow);
    await act(async () => old.findByType(DisclosureHeader).props.onToggle());
    await settle();
    expect(renderer.root.findAllByType(TaskList)).toHaveLength(2);
    await act(async () => old.findByType(DisclosureHeader).props.onToggle());
    await settle();
    expect(renderer.root.findAllByType(TaskList)).toHaveLength(1);
    await act(async () => old.findByType(DisclosureHeader).props.onToggle());
    await settle();
    for (offset = 0; offset <= 2100; offset += 50) await settle();
    for (offset = 2100; offset >= 0; offset -= 50) await settle();
    offset = sizes.slice(0, 18).reduce((sum, size) => sum + size, 0);
    await act(async () => renderer.update(tree()));
    await settle();
    const remountedOld = renderer.root.findByType(TaskActivityRow);
    await act(async () => remountedOld.findByType(DisclosureHeader).props.onToggle());
    await settle();
    expect(renderer.root.findAllByType(TaskList)).not.toHaveLength(0);
    expect(grokMountedStates).toEqual(new Set([true, false]));
    expect(updates).toBeLessThan(3000);
  } finally { await act(async () => renderer.unmount()); }
});
