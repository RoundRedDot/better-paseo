import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveToolCallPayload } from "../../client/live-renderers";
import { DEFAULT_PREFERENCES, parsePreferences, storedPart } from "../../client/preferences";
import { resetDisclosureStore } from "../../client/state/disclosure-store";

const state = vi.hoisted(() => ({ enabled: true, waiting: false, childWaiting: false, known: true,
  positions: new Map<string, { order: number; previous?: string }>() }));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: (props: object) => React.createElement("Icon", props) }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: (id: string, selector: (agent: { attentionReason: string | null }) => unknown) => selector({
    attentionReason: (id === "child-agent" ? state.childWaiting : state.waiting) ? "permission" : null,
  }),
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
}));
vi.mock("../../client/preferences", async (original) => ({ ...await original<object>(),
  useEnhancerPreferences: () => ({ toolCallRollups: state.enabled, compactRowSpacing: true, uiFont: "system" }),
}));
vi.mock("../../client/state/tool-rollup-order", () => ({
  useToolRollupPosition: (_: string, id: string) => state.known ? state.positions.get(id) ?? null : null,
}));
vi.mock("../../client/state/agent-message-senders", () => ({
  useAgentMessageSender: () => ({ event: "message", sender: { id: "child-agent" }, text: "Agent update" }),
}));
vi.mock("../../client/components/theme-tokens", async (original) => ({
  ...await original<object>(), useThemeTokens: () => ({ foregroundMuted: "muted", danger: "danger" }),
}));
vi.mock("../../client/components/selection-actions", () => ({ useSelectionActions() {} }));
vi.mock("../../client/components/tool-callouts", () => ({ ToolCallout: (props: object) => React.createElement("ToolCallout", props) }));
vi.mock("../../client/ui/running-dot", () => ({ RunningDot: () => null }));
vi.mock("../../client/components/hub-live", () => ({ TimelineTailHub: () => null }));
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/ui/path-text", async (original) => ({
  ...await original<object>(), usePathContextValue: () => ({ roots: [], mode: "relative" }),
}));
vi.mock("../../client/image-file", async (original) => ({ ...await original<object>(), useImageFile: () => null }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { LiveToolCallRenderer } = await import("../../client/live-renderers");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mounted = new Set<ReturnType<typeof TestRenderer.create>>();
function mount(node: React.ReactElement, options?: Parameters<typeof TestRenderer.create>[1]) {
  const renderer = TestRenderer.create(node, options);
  mounted.add(renderer);
  return renderer;
}
afterEach(async () => {
  await act(async () => { for (const renderer of mounted) renderer.unmount(); });
  mounted.clear();
});

function tool(id: string, name: string, status = "completed", extra: Partial<LiveToolCallPayload> = {}) {
  const detail = name === "Read" ? { type: "read", filePath: `/src/${id}.ts`, content: "source text" }
    : name === "Edit" ? { type: "edit", filePath: `/src/${id}.ts`, unifiedDiff: "@@ -1 +1 @@\n-old\n+new" }
      : { type: "shell", command: `echo ${id}`, output: "ok" };
  return React.createElement(LiveToolCallRenderer, {
    key: id, agentId: "rollup-agent", timestamp: new Date(1),
    host: { id: "local", label: "Local" }, theme: { colors: {} } as never,
    layout: { compact: false, platform: "web" },
    item: { type: "plugin", kind: "omp-tool-call", version: 1,
      data: { callId: id, name, status, phase: status === "running" ? "streaming" : "complete", detail, ...extra } },
  } satisfies PluginTimelineItemProps<LiveToolCallPayload> & { key: string });
}
const frame = (...rows: React.ReactNode[]) => React.createElement(React.Fragment, null, ...rows);
const cards = (r: ReturnType<typeof TestRenderer.create>) => r.root.findAll((node) => node.type as unknown === "ToolCallout");
const summaries = (r: ReturnType<typeof TestRenderer.create>) => r.root.findAll((node) =>
  node.type as unknown === "Pressable" && /^Called /.test(node.props.accessibilityLabel ?? ""));

/** Explicit Fabric measurements, including zero-height collapsed slots. */
function measuredColumns(columns: number[], visible = () => true, deliver = (callback: () => void) => callback(), windows?: object[]) {
  let next = 0;
  return { createNodeMock(element: React.ReactElement) {
    const props = element.props as { dataSet?: { bcroot?: unknown; bcrollupempty?: string } };
    if (!props.dataSet || !("bcroot" in props.dataSet)) return null;
    const window = windows?.[next];
    const left = columns[next++];
    if (left === undefined) throw new Error("Missing fixture column");
    return { closest: (selector: string) => selector === '[data-testid="agent-chat-scroll"]' ? window : null,
      measureInWindow(callback: (x: number, y: number, width: number, height: number) => void) {
      deliver(() => callback(left, 100, visible() ? 600 : 0, visible() ? 28 : 0));
    } };
  } };
}

const pane = (id: string, ids: string[]) => React.createElement("Pane", { key: id, id }, ...ids.map((id) => tool(id, "Bash")));
const paneOf = (r: ReturnType<typeof TestRenderer.create>, id: string) => r.root.findAll((node) => node.type as unknown === "Pane" && node.props.id === id)[0]!;
const paneSummaries = (r: ReturnType<typeof TestRenderer.create>, id: string) => paneOf(r, id).findAll((node) =>
  node.type as unknown === "Pressable" && /^Called /.test(node.props.accessibilityLabel ?? ""));
const paneCards = (r: ReturnType<typeof TestRenderer.create>, id: string) => paneOf(r, id).findAll((node) => node.type as unknown === "ToolCallout");

beforeEach(() => {
  resetDisclosureStore();
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  state.enabled = true; state.waiting = false; state.childWaiting = false; state.known = true;
  state.positions = new Map([
    ["r", { order: 1 }], ["b", { order: 2, previous: "r" }], ["e", { order: 3, previous: "b" }],
  ]);
});

describe("opt-in general rollups", () => {
  it.each([
    [["r", "b", "e"], ["b", "e"]],
    [["r"], ["b", "e"]],
    [["r", "b", "e"], ["r", "b", "e"]],
  ])("uses actual viewport identities for stacked windows %j / %j", async (left, right) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const top = {}, bottom = {};
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left", left), pane("right", right)),
      measuredColumns(Array(left.length + right.length).fill(0), undefined, undefined,
        [...left.map(() => top), ...right.map(() => bottom)])); });
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe(`Called ${left.length} ${left.length === 1 ? "tool" : "tools"}`);
    expect(paneSummaries(r, "right")[0]!.props.accessibilityLabel).toBe(`Called ${right.length} tools`);
    expect(cards(r)).toHaveLength(0);
    await act(async () => paneSummaries(r, "right")[0]!.props.onPress());
    expect(paneCards(r, "right").map((row) => row.props.data.callId)).toEqual(right);
    expect(paneCards(r, "left").map((row) => row.props.data.callId)).toEqual(left[0] === right[0] ? left : []);
  });

  it("deduplicates source copies within a verified viewport without hiding either pane's window", async () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const viewport = {};
    const rows = React.createElement("Pane", { id: "left" }, tool("r", "Bash"), tool("b", "Bash"), tool("e", "Bash"),
      React.cloneElement(tool("b", "Bash"), { key: "b-copy" }));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(rows, measuredColumns([0, 0, 0, 0], undefined, undefined, Array(4).fill(viewport))); });
    expect(paneSummaries(r, "left").map((row) => row.props.accessibilityLabel)).toEqual(["Called 3 tools"]);
    await act(async () => paneSummaries(r, "left")[0]!.props.onPress());
    expect(paneCards(r, "left").map((row) => row.props.data.callId)).toEqual(["r", "b", "e"]);
  });

  it("keeps failed tool summaries neutral and retains rich-card failure status on expansion", async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(tool("r", "Bash", "failed", { error: "compile failed" }))); });
    const summary = summaries(r)[0]!;
    expect(summary.props.accessibilityLabel).toBe("Called 1 tool");
    const icon = summary.findAll((node) => node.type as unknown === "Icon")[0]!;
    expect(icon.props.name).toBe("Wrench");
    expect(icon.props.color).toBe("muted");
    const label = summary.findAll((node) => node.type as unknown === "Text")[0]!;
    expect(label.props.style.color).toBe("muted");
    await act(async () => summary.props.onPress());
    expect(cards(r)[0]!.props.data.status).toBe("failed");
    expect(cards(r)[0]!.props.data.error).toBe("compile failed");
  });
  it("gives disjoint measured windows their own head without any duplicate call IDs", async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left", ["r"]), pane("right", ["b", "e"])), measuredColumns([0, 700, 700])); });
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe("Called 1 tool");
    expect(paneSummaries(r, "right")[0]!.props.accessibilityLabel).toBe("Called 2 tools");
    await act(async () => paneSummaries(r, "right")[0]!.props.onPress());
    expect(paneCards(r, "right").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    expect(paneCards(r, "left")).toHaveLength(0);
  });

  it("uses asynchronously delivered native bounds after an initially unmeasured render", async () => {
    const pending: (() => void)[] = [];
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left", ["r", "b", "e"]), pane("right", ["b", "e"])),
      measuredColumns([0, 0, 0, 700, 700], () => true, (callback) => { pending.push(callback); })); });
    expect(paneCards(r, "right").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    await act(async () => { for (const callback of pending.splice(0)) callback(); });
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(paneSummaries(r, "right")[0]!.props.accessibilityLabel).toBe("Called 2 tools");
    expect(cards(r)).toHaveLength(0);
    await act(async () => r.unmount());
    await act(async () => { for (const callback of pending.splice(0)) callback(); }); // Late callbacks cannot restore detached entries.
  });
  it("keeps a local head in asymmetric pane windows, through expansion and virtualized head changes", async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left", ["r", "b", "e"]), pane("right", ["b", "e"])),
      measuredColumns([0, 0, 0, 700, 700, 700, 0])); });
    expect(paneSummaries(r, "left").map((row) => row.props.accessibilityLabel)).toEqual(["Called 3 tools"]);
    expect(paneSummaries(r, "right").map((row) => row.props.accessibilityLabel)).toEqual(["Called 2 tools"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => paneSummaries(r, "right")[0]!.props.onPress());
    expect(paneCards(r, "right").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    expect(paneCards(r, "left")).toHaveLength(0);
    // The right window now includes r. Both panes share its disclosure choice.
    await act(async () => r.update(frame(pane("left", ["r", "b", "e"]), pane("right", ["r", "b", "e"]))));
    expect(paneSummaries(r, "right")[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(cards(r)).toHaveLength(0);
    await act(async () => paneSummaries(r, "left")[0]!.props.onPress());
    expect(paneCards(r, "left")).toHaveLength(3);
    expect(paneCards(r, "right")).toHaveLength(3);
    await act(async () => r.update(frame(pane("left", ["b", "e"]), pane("right", ["r", "b", "e"]))));
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe("Called 2 tools");
    expect(paneCards(r, "left").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    await act(async () => r.update(frame(pane("left", ["r", "b", "e"]), pane("right", ["r", "b", "e"]))));
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    await act(async () => r.update(pane("right", ["r", "b", "e"])));
    expect(paneSummaries(r, "right")[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(paneCards(r, "right")).toHaveLength(3);
  });

  it.each(["unmeasured", "same-column"])("keeps ambiguous duplicate copies visible with %s panes", async (kind) => {
    let r!: ReturnType<typeof TestRenderer.create>;
    const rows = () => frame(pane("left", ["r", "b", "e"]), pane("right", ["b", "e"]));
    await act(async () => { r = mount(rows(), kind === "same-column" ? measuredColumns(Array(8).fill(0)) : undefined); });
    expect(paneCards(r, "right").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    expect(paneCards(r, "left").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe("Called 1 tool");
    // Losing duplicate copies restores normal grouping rather than pinning a fallback.
    await act(async () => r.update(pane("left", ["r", "b", "e"])));
    expect(paneSummaries(r, "left")[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(paneCards(r, "left")).toHaveLength(0);
    state.enabled = false;
    await act(async () => r.update(pane("left", ["r", "b", "e"])));
    expect(paneSummaries(r, "left")).toHaveLength(0);
    expect(paneCards(r, "left").map((row) => row.props.data.callId)).toEqual(["r", "b", "e"]);
  });

  it("leaves unrelated single-window runs grouped during an ambiguous duplicate fallback", async () => {
    state.positions.set("x", { order: 10 });
    state.positions.set("y", { order: 11, previous: "x" });
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left", ["r", "b", "e", "x", "y"]), pane("right", ["b", "e"]))); });
    expect(paneCards(r, "right").map((row) => row.props.data.callId)).toEqual(["b", "e"]);
    expect(paneSummaries(r, "left").map((row) => row.props.accessibilityLabel)).toEqual(["Called 1 tool", "Called 2 tools"]);
  });

  it("retains measured scopes when collapsed slots have no box", async () => {
    let visible = true;
    const rows = () => frame(pane("left", ["r", "b", "e"]), pane("right", ["r", "b", "e"]));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(rows(), measuredColumns([0, 0, 0, 700, 700, 700], () => visible)); });
    visible = false;
    state.positions.set("b", { order: 2, previous: "r" }); // Recompute after a source refresh while slots are hidden.
    await act(async () => r.update(rows()));
    expect(paneSummaries(r, "left").map((row) => row.props.accessibilityLabel)).toEqual(["Called 3 tools"]);
    expect(paneSummaries(r, "right").map((row) => row.props.accessibilityLabel)).toEqual(["Called 3 tools"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => paneSummaries(r, "right")[0]!.props.onPress());
    expect(paneCards(r, "left")).toHaveLength(3);
    expect(paneCards(r, "right")).toHaveLength(3);
  });

  it("keeps same-window duplicate source slots inspectable and preserves legacy deduplication when Off", async () => {
    state.positions.delete("b"); // The SDK source index refuses an ambiguous repeated source call ID.
    const rows = () => frame(pane("left", ["r", "b", "e"]), React.createElement("Pane", { key: "duplicate", id: "duplicate" }, tool("b", "Bash")));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(rows(), measuredColumns(Array(8).fill(0))); });
    expect(paneCards(r, "left").map((row) => row.props.data.callId)).toEqual(["b"]);
    expect(paneCards(r, "duplicate").map((row) => row.props.data.callId)).toEqual(["b"]);
    state.enabled = false;
    await act(async () => r.update(rows()));
    expect(summaries(r)).toHaveLength(0);
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "e"]);
  });
  it("defaults Off for missing/invalid settings and persists an explicit boolean", () => {
    expect(DEFAULT_PREFERENCES.toolCallRollups).toBe(false);
    expect(parsePreferences({}).toolCallRollups).toBe(false);
    expect(parsePreferences({ toolCallRollups: "true" }).toolCallRollups).toBe(false);
    expect(storedPart(parsePreferences({ toolCallRollups: true })).toolCallRollups).toBe(true);
  });

  it.each([false, true])("expands mixed tools in original slots and preserves individual detail disclosure (compact=%s)", async (compact) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = compact ? "ios" : "web";
    let r!: ReturnType<typeof TestRenderer.create>;
    const rows = [tool("r", "Read"), tool("b", "Bash"), tool("e", "Edit")].map((row) =>
      React.cloneElement(row, { layout: { compact, platform: compact ? "ios" : "web" } }));
    await act(async () => { r = mount(frame(...rows)); });
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(["Called 3 tools"]);
    expect(cards(r)).toHaveLength(0);
    const emptyMarkers = () => r.root.findAll((node) => node.type as unknown === "View" && node.props.dataSet?.bcrollupempty === "true");
    expect(emptyMarkers()).toHaveLength(compact ? 0 : 2);
    // Only collapsed general members get the web shim marker. Native uses
    // the same disclosure/grouping and leaves host geometry to the host.
    for (const row of emptyMarkers()) expect(row.props.style).toBeUndefined();
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(emptyMarkers()).toHaveLength(0);
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "e"]);
    expect(cards(r).every((row) => row.props.groupCalls === undefined)).toBe(true);
    await act(async () => cards(r)[1]!.props.onExpandedChange(true));
    expect(cards(r)[1]!.props.expanded).toBe(true);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r)[1]!.props.expanded).toBe(true);
    await act(async () => r.unmount());
  });

  it("follows live additions, running completion and failures within one rollup, and remounts without duplicate cards", async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(tool("r", "Read"), tool("b", "Bash", "running"))); });
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 2 tools · 1 running");
    await act(async () => summaries(r)[0]!.props.onPress());
    await act(async () => r.update(frame(tool("r", "Read"), tool("b", "Bash"), tool("e", "Edit", "running"))));
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools · 1 running");
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "e"]);
    await act(async () => summaries(r)[0]!.props.onPress());
    await act(async () => r.update(frame(tool("r", "Read"), tool("b", "Bash", "failed", { error: "compile failed" }), tool("e", "Edit"))));
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "e"]);
    expect(cards(r)[1]!.props.data.error).toBe("compile failed");
    await act(async () => r.update(frame(tool("b", "Bash"), tool("e", "Edit"))));
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 2 tools");
    await act(async () => r.update(frame(tool("r", "Read"), tool("b", "Bash"), tool("e", "Edit"))));
    expect(summaries(r)).toHaveLength(1);
    await act(async () => r.unmount());
  });

  it("uses source order with inverted mounts and never bridges native or unmounted boundaries", async () => {
    state.positions.set("e", { order: 4 }); // Source assistant update between b and e; no plugin row.
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(tool("e", "Edit"), tool("b", "Bash"), tool("r", "Read"))); });
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(["Called 1 tool", "Called 2 tools"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => r.update(frame(tool("e", "Edit"), tool("r", "Read"))));
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(["Called 1 tool", "Called 1 tool"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it("counts each call once per measured pane and shares rollup expansion across panes", async () => {
    const pane = (key: string) => React.createElement(React.Fragment, { key }, tool("r", "Read"), tool("b", "Bash"));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left"), pane("right")), measuredColumns([0, 0, 700, 700])); });
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(["Called 2 tools", "Called 2 tools"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "r", "b"]);
    await act(async () => r.unmount());
  });

  it.each(["waiting", "unknown", "question", "plan", "canceled", "rejected", "error"])("rolls up %s with no category or permission gate (unknown order stays standalone)", async (kind) => {
    state.waiting = kind === "waiting";
    state.known = kind !== "unknown";
    const extra = kind === "question" ? { questionData: { questions: [{ question: "Choose" }] } }
      : kind === "plan" ? { detail: { type: "plan", text: "Approve?" } }
        : kind === "rejected" ? { approved: false, detail: { type: "plan", text: "Rejected plan" } }
        : kind === "error" ? { error: "failed despite completed status" } : {};
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(tool("r", "Read"),
      tool("b", "Bash", kind === "canceled" ? "canceled" : "completed", extra), tool("e", "Edit"))); });
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(kind === "unknown" ? []
      : ["Called 3 tools"]);
    expect(cards(r)).toHaveLength(kind === "unknown" ? 3 : 0);
    await act(async () => r.unmount());
  });

  it("rolls mixed Paseo/subagent/hub/activity/generic/agent-message/failed tools into one summary", async () => {
    const rows = [
      tool("r", "mcp__paseo__create_agent", "completed", { detail: { type: "unknown", input: { provider: "codex", prompt: "Work" }, output: { agentId: "child-agent" } } }),
      tool("b", "Task", "completed", { detail: { type: "sub_agent", description: "Review", result: "Done" } }),
      tool("e", "Bash", "failed", { error: "compile failed" }),
      tool("hub", "hub", "completed", { detail: { type: "unknown", input: { op: "ps" }, output: { jobs: [] } } }),
      tool("activity", "task_notification", "completed", { detail: { type: "plain_text", text: "Background task finished" } }),
      tool("generic", "mcp__custom__run", "completed", { detail: { type: "unknown", input: {}, output: "done" } }),
      tool("message", "agent_message", "completed", { detail: { type: "plain_text", text: "Agent update" } }),
    ];
    state.positions = new Map(rows.map((row, index) => [row.key!, { order: index + 1, previous: rows[index - 1]?.key ?? undefined }]));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(...rows)); });
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(["Called 7 tools"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "e", "hub", "activity", "generic", "message"]);
    expect(cards(r)[0]!.props.data.tool).toBe("paseo");
    expect(cards(r)[1]!.props.data.tool).toBe("sub_agent");
    expect(cards(r)[2]!.props.data.status).toBe("failed");
    expect(cards(r)[6]!.props.data.agentStatus.status).toBe("message");
    await act(async () => r.unmount());
  });

  it("shows a singleton as an expandable summary and keeps running counts without failure labels", async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(tool("r", "Bash", "running"))); });
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 1 tool · 1 running");
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r)).toHaveLength(1);
    await act(async () => r.update(frame(tool("r", "Bash", "running"), tool("b", "Bash", "failed"), tool("e", "Bash", "error"))));
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools · 1 running");
    await act(async () => r.unmount());
  });

  it("keeps only the card owning active child permission controls visible, still counted in the rollup", async () => {
    state.waiting = true;
    state.childWaiting = true;
    const permission = { agentMessage: { event: "permission-required" as const, sender: { id: "child-agent" },
      text: '<permission-request>{"requestId":"req","request":{"kind":"tool","title":"Allow command?"}}</permission-request>' } };
    const rows = (answered = false) => frame(tool("r", "Read"),
      tool("b", "agent_message", "completed", { ...permission, phase: answered ? "streaming" : "complete" }), tool("e", "Edit"));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(rows()); });
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["b"]);
    expect(cards(r)[0]!.props.expanded).toBe(true);
    state.childWaiting = false;
    await act(async () => r.update(rows(true)));
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools");
    expect(cards(r)).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it("keeps Off behavior and changes an existing timeline immediately on toggle", async () => {
    state.enabled = false;
    const rows = () => frame(tool("r", "Read"), tool("b", "Bash"));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(rows()); });
    expect(cards(r)).toHaveLength(2);
    state.enabled = true;
    await act(async () => r.update(rows()));
    expect(summaries(r)).toHaveLength(1);
    state.enabled = false;
    await act(async () => r.update(rows()));
    expect(summaries(r)).toHaveLength(0);
    expect(cards(r)).toHaveLength(2);
    await act(async () => r.unmount());
  });
});
