import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveToolCallPayload } from "../../client/live-renderers";
import { DEFAULT_PREFERENCES, parsePreferences, storedPart } from "../../client/preferences";
import { resetDisclosureStore } from "../../client/state/disclosure-store";

const state = vi.hoisted(() => ({ enabled: true, waiting: false, childWaiting: false, known: true,
  positions: new Map<string, { order: number; previous?: string }>() }));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
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
  ...await original<object>(), useThemeTokens: () => ({}),
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
function mount(node: React.ReactElement) {
  const renderer = TestRenderer.create(node);
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

beforeEach(() => {
  resetDisclosureStore();
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
  state.enabled = true; state.waiting = false; state.childWaiting = false; state.known = true;
  state.positions = new Map([
    ["r", { order: 1 }], ["b", { order: 2, previous: "r" }], ["e", { order: 3, previous: "b" }],
  ]);
});

describe("opt-in general rollups", () => {
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
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools · 1 failed");
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

  it("counts each call once per pane and shares rollup expansion across panes", async () => {
    const pane = (key: string) => React.createElement(React.Fragment, { key }, tool("r", "Read"), tool("b", "Bash"));
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(pane("left"), pane("right"))); });
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
      : [kind === "error" ? "Called 3 tools · 1 failed" : "Called 3 tools"]);
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
    expect(summaries(r).map((row) => row.props.accessibilityLabel)).toEqual(["Called 7 tools · 1 failed"]);
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r).map((row) => row.props.data.callId)).toEqual(["r", "b", "e", "hub", "activity", "generic", "message"]);
    expect(cards(r)[0]!.props.data.tool).toBe("paseo");
    expect(cards(r)[1]!.props.data.tool).toBe("sub_agent");
    expect(cards(r)[2]!.props.data.status).toBe("failed");
    expect(cards(r)[6]!.props.data.agentStatus.status).toBe("message");
    await act(async () => r.unmount());
  });

  it("shows a singleton as an expandable summary and reports simultaneous running/failure counts", async () => {
    let r!: ReturnType<typeof TestRenderer.create>;
    await act(async () => { r = mount(frame(tool("r", "Bash", "running"))); });
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 1 tool · 1 running");
    expect(cards(r)).toHaveLength(0);
    await act(async () => summaries(r)[0]!.props.onPress());
    expect(cards(r)).toHaveLength(1);
    await act(async () => r.update(frame(tool("r", "Bash", "running"), tool("b", "Bash", "failed"), tool("e", "Bash", "error"))));
    expect(summaries(r)[0]!.props.accessibilityLabel).toBe("Called 3 tools · 1 running · 2 failed");
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
