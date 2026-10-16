import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveToolCallPayload } from "../../client/live-renderers";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  useRevealedText: (text: string) => text,
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
}));
vi.mock("../../client/preferences", async (original) => ({
  ...await original<object>(),
  useEnhancerPreferences: () => ({ compactRowSpacing: true, uiFont: "system" }),
}));
vi.mock("../../client/components/theme-tokens", async (original) => ({
  ...await original<object>(),
  useThemeTokens: () => ({}),
}));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() {} }));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: (props: { data: { callId: string } }) => {
  const renders = (globalThis as { toolRenders?: Map<string, number> }).toolRenders ??= new Map();
  renders.set(props.data.callId, (renders.get(props.data.callId) ?? 0) + 1);
  return React.createElement("ToolCallout", props);
} }));
const regroups = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../client/tools/group", async (original) => {
  const actual = await original<typeof import("../../client/tools/group")>();
  return { ...actual, groupAdjacentTools: (...args: Parameters<typeof actual.groupAdjacentTools>) => {
    regroups.count += 1;
    return actual.groupAdjacentTools(...args);
  } };
});
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/state/disclosure-store", async (original) => ({
  ...await original<object>(),
  useDisclosure: () => [false, () => {}],
}));
vi.mock("../../client/ui/path-text", async (original) => ({
  ...await original<object>(),
  usePathContextValue: () => ({ roots: [], mode: "relative" }),
}));
vi.mock("../../client/image-file", async (original) => ({
  ...await original<object>(),
  useImageFile: () => null,
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { StyleSheet } = await import("./helpers/rn-mock");
const { LiveToolCallRenderer } = await import("../../client/live-renderers");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function tool(callId: string, at: number, status = "running", path: string | null = "src/a.ts", agentId = "group-agent", diff?: string) {
  const props: PluginTimelineItemProps<LiveToolCallPayload> = {
    agentId,
    host: { id: "local", label: "Local" },
    layout: { compact: false, platform: "web" },
    theme: { colors: {} } as never,
    timestamp: new Date(at),
    item: { type: "plugin", kind: "omp-tool-call", version: 1, data: {
      name: "Edit", callId, status, phase: status === "running" ? "streaming" : "complete",
      detail: { type: "edit", filePath: path ?? undefined, unifiedDiff: diff },
    } },
  };
  return React.createElement(LiveToolCallRenderer, { ...props, key: callId });
}

function margins(renderer: ReturnType<typeof TestRenderer.create>) {
  return renderer.root.findAll((node) => (node.type as unknown) === "View")
    .map((view) => StyleSheet.flatten(view.props.style).marginBottom);
}


const timeline = await import("../../client/timeline-order");

function cards(renderer: ReturnType<typeof TestRenderer.create>) {
  return renderer.root.findAll((node) => (node.type as unknown) === "ToolCallout");
}

describe("live tool groups", () => {
  it.each([1, 2])("renders each current singleton result once across %i panes", async (panes) => {
    const renders = ((globalThis as { toolRenders?: Map<string, number> }).toolRenders ??= new Map());
    const frame = (at: number, diff?: string) => React.createElement(React.Fragment, null,
      ...Array.from({ length: panes }, (_, index) => React.createElement(React.Fragment, { key: index },
        tool("single-result", at, "running", "src/single.ts", "singleton-agent", diff))));
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(frame(11000)); });
    try {
      const diff = "@@ -1 +1 @@\n-old\n+latest";
      await act(async () => { renderer.update(frame(11001, diff)); });
      renders.clear();
      const latest = `${diff}\n+newest`;
      await act(async () => { renderer.update(frame(11002, latest)); });
      expect(cards(renderer)).toHaveLength(panes);
      for (const card of cards(renderer)) {
        expect(card.props.data.diff).toBe(latest);
        expect(card.props.groupCalls).toBeUndefined();
      }
      expect(Object.fromEntries(renders)).toEqual({ "single-result": panes });
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("rebuilds a batch of historical tool rows once after mounting and unmounting", async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      tool(`batch-${index}`, 100_000 + index, "completed", `src/${index}.ts`, "batch-agent"));
    let renderer!: ReturnType<typeof TestRenderer.create>;
    regroups.count = 0;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, ...rows)); });
    expect(cards(renderer)).toHaveLength(100);
    expect(regroups.count).toBeLessThanOrEqual(2);
    regroups.count = 0;
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, ...rows.slice(50))); });
    expect(cards(renderer)).toHaveLength(50);
    expect(regroups.count).toBeLessThanOrEqual(2);
    await act(async () => renderer.unmount());
  });

  it("shows one row, updates member status without moving the group, and restores rows after unmount", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("first", 1000), tool("second", 1001))); });
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.groupCalls.map((call: { callId: string }) => call.callId)).toEqual(["first", "second"]);
    expect(margins(renderer)).toEqual([undefined, undefined]);
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("first", 1005, "completed"), tool("second", 1001))); });
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.groupCalls[0].status).toBe("completed");
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, tool("second", 1001))); });
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.data.callId).toBe("second");
    expect(cards(renderer)[0]!.props.groupCalls).toBeUndefined();
    expect(margins(renderer)).toEqual([undefined]);
    await act(async () => renderer.unmount());
  });

  it("breaks a group at a thought and does not combine agents", async () => {
    const { registerTimelineEntry } = timeline;
    const forget = registerTimelineEntry("group-agent", 1001, "thought");
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("first", 1000), tool("second", 1002), tool("other", 1003, "running", "src/a.ts", "other-agent"))); });
    expect(cards(renderer)).toHaveLength(3);
    expect(cards(renderer).every((card) => card.props.groupCalls === undefined)).toBe(true);
    await act(async () => { renderer.unmount(); forget(); });
  });

  it("keeps same-timestamp call order when a result changes", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("first", 2000), tool("second", 2000))); });
    await act(async () => { renderer.update(React.createElement(React.Fragment, null,
      tool("first", 2001, "completed"), tool("second", 2000))); });
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.groupCalls.map((call: { callId: string }) => call.callId)).toEqual(["first", "second"]);
    await act(async () => renderer.unmount());
  });

  it("counts each call once when the chat is mounted in two panes", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const pane = (key: string) => React.createElement(React.Fragment, { key }, tool("first", 3000), tool("second", 3001));
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, pane("left"), pane("right"))); });
    expect(cards(renderer)).toHaveLength(2);
    expect(cards(renderer).map((card) => card.props.groupCalls.length)).toEqual([2, 2]);
    await act(async () => { renderer.update(pane("right")); });
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.groupCalls).toHaveLength(2);
    await act(async () => renderer.unmount());
  });

  it("compensates a merged row when a different operation follows in the same millisecond", async () => {
    // Calls in one millisecond are ordered by where they are drawn: here, the
    // order their views are created.
    let created = 0;
    const createNodeMock = () => {
      const y = 100 * ++created;
      return { measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) => callback(0, y, 300, 40) };
    };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("first", 4000), tool("second", 4000), tool("next", 4000, "running", "src/b.ts")), { createNodeMock }); });
    expect(margins(renderer)).toEqual([-12, undefined, undefined]);
    await act(async () => renderer.unmount());
  });

  it("streams a result into one run without waking other runs, agents or spacing subscribers", async () => {
    const renders = ((globalThis as { toolRenders?: Map<string, number> }).toolRenders ??= new Map());
    let spacingRenders = 0;
    function Spacing() {
      spacingRenders += 1;
      timeline.useHasEntryAfter("group-agent", 5000, "tool");
      timeline.useNextEntryIsRow("group-agent", 5000, "reply");
      return null;
    }
    const rows = [
      tool("a1", 5000), tool("a2", 5001), tool("b1", 5002, "running", "src/b.ts"), tool("b2", 5003, "running", "src/b.ts"),
      tool("x1", 5000, "running", "src/a.ts", "other-agent"), tool("x2", 5001, "running", "src/a.ts", "other-agent"),
      React.createElement(Spacing, { key: "spacing" }),
    ];
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, ...rows)); });
    expect(cards(renderer).map((card) => card.props.data.callId)).toEqual(["a1", "b1", "x1"]);
    renders.clear();
    spacingRenders = 0;
    regroups.count = 0;
    rows[3] = tool("b2", 5003, "completed", "src/b.ts", "group-agent", "@@ -1 +1 @@\n-old\n+new");
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, ...rows)); });
    // Patched in place: no agent is regrouped and only b's header hears of it.
    expect(regroups.count).toBe(0);
    expect(Object.fromEntries(renders)).toEqual({ b1: 1 });
    expect(spacingRenders).toBe(0);
    const header = cards(renderer)[1]!;
    expect(header.props.groupCalls.map((call: { callId: string; status: string }) => `${call.callId}:${call.status}`))
      .toEqual(["b1:running", "b2:completed"]);
    await act(async () => renderer.unmount());
  });

  it("regroups when a streaming call learns its path", async () => {
    const rows = [tool("p1", 6000), tool("p2", 6001, "running", null)];
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, ...rows)); });
    expect(cards(renderer)).toHaveLength(2);
    regroups.count = 0;
    rows[1] = tool("p2", 6001, "running", "src/a.ts");
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, ...rows)); });
    expect(regroups.count).toBe(1);
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.groupCalls.map((call: { callId: string }) => call.callId)).toEqual(["p1", "p2"]);
    rows[1] = tool("p2", 6001, "running", "src/other.ts");
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, ...rows)); });
    expect(cards(renderer).map((card) => card.props.groupCalls)).toEqual([undefined, undefined]);
    await act(async () => renderer.unmount());
  });

  it("splits a run around an item mounting between members and merges it again once it leaves", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("s1", 7000), tool("s2", 7002), tool("s3", 7003))); });
    expect(cards(renderer)).toHaveLength(1);
    let forget!: () => void;
    await act(async () => { forget = timeline.registerTimelineEntry("group-agent", 7001, "reply"); });
    expect(cards(renderer).map((card) => card.props.groupCalls?.length)).toEqual([undefined, 2]);
    await act(async () => forget());
    expect(cards(renderer).map((card) => card.props.groupCalls?.length)).toEqual([3]);
    await act(async () => renderer.unmount());
  });

  it("delivers a result reaching both panes to both headers, counting the call once", async () => {
    const pane = (key: string, status: string) => React.createElement(React.Fragment, { key },
      tool("d1", 8000), tool("d2", 8001, status));
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, pane("left", "running"), pane("right", "running"))); });
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, pane("left", "completed"), pane("right", "completed"))); });
    expect(cards(renderer)).toHaveLength(2);
    for (const card of cards(renderer)) {
      expect(card.props.groupCalls.map((call: { status: string }) => call.status)).toEqual(["running", "completed"]);
    }
    await act(async () => renderer.unmount());
  });

  it("takes a remounted head back into its run in timeline order", async () => {
    const first = tool("r1", 9000, "completed");
    const second = tool("r2", 9001, "completed");
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, first, second)); });
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, second)); });
    expect(cards(renderer)[0]!.props.groupCalls).toBeUndefined();
    await act(async () => { renderer.update(React.createElement(React.Fragment, null, tool("r1", 9000, "completed"), second)); });
    expect(cards(renderer)).toHaveLength(1);
    expect(cards(renderer)[0]!.props.groupCalls.map((call: { callId: string }) => call.callId)).toEqual(["r1", "r2"]);
    expect(margins(renderer)).toEqual([undefined, undefined]);
    await act(async () => renderer.unmount());
  });

  it("keeps a newest run's gap and gives it up once something arrives below its last member", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null,
      tool("t1", 10_000, "completed"), tool("t2", 10_001, "completed"))); });
    expect(margins(renderer)).toEqual([undefined, undefined]);
    let forget!: () => void;
    await act(async () => { forget = timeline.registerTimelineEntry("group-agent", 10_002, "reply"); });
    expect(margins(renderer)).toEqual([-12, undefined]);
    await act(async () => forget());
    expect(margins(renderer)).toEqual([undefined, undefined]);
    await act(async () => renderer.unmount());
  });
});
