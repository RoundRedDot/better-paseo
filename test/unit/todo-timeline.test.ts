import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { LiveTodoPayload } from "../../client/live-renderers";
import { deriveTodoActivities, type TodoTask } from "../../client/state/todo-timeline";

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
vi.mock("../../client/state/preference-sync-slot", () => ({ PreferenceSyncSlot: () => null }));
vi.mock("../../client/components/task-list", () => ({
  TaskList: (props: object) => React.createElement("TaskList", props),
}));
vi.mock("../../client/components/task-activity-row", () => ({
  TaskActivityRow: (props: object) => React.createElement("TaskActivityRow", props),
}));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { StyleSheet } = await import("./helpers/rn-mock");
const { LiveTodoRenderer } = await import("../../client/live-renderers");
const { noteRowGap, resetHostRowGap } = await import("../../client/host-row-gap");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = ReturnType<typeof TestRenderer.create>;

/**
 * One host `todo_list` stream item as the plugin receives it. The host splits
 * one update into an item per change ("completed A", "started B"), all with
 * the update's timestamp and the whole list (paseo `types/stream.ts`
 * `appendTodoList`); `key` stands for the host's distinct item ids.
 */
function todo(agentId: string, key: string, at: number, items: TodoTask[]) {
  const props: PluginTimelineItemProps<LiveTodoPayload> = {
    agentId,
    host: { id: "local", label: "Local" },
    layout: { compact: false, platform: "web" },
    theme: { colors: {} } as never,
    timestamp: new Date(at),
    item: { type: "plugin", kind: "omp-todo", version: 1, data: { items: items as never, phase: "complete" } },
  };
  return React.createElement(LiveTodoRenderer, { ...props, key });
}

const created: TodoTask[] = [
  { id: "1", text: "Read the code", status: "pending", completed: false, activeForm: "Reading the code" },
  { id: "2", text: "Fix the bug", status: "pending", completed: false, activeForm: "Fixing the bug" },
  { id: "3", text: "Run the tests", status: "pending", completed: false, activeForm: "Running the tests" },
];
const firstDone: TodoTask[] = [
  { ...created[0]!, status: "completed", completed: true },
  { ...created[1]!, status: "in_progress" },
  created[2]!,
];
const secondDone: TodoTask[] = [
  firstDone[0]!,
  { ...created[1]!, status: "completed", completed: true },
  { ...created[2]!, status: "in_progress" },
];

function lists(renderer: Renderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === "TaskList");
}

function rows(renderer: Renderer) {
  return renderer.root.findAll((node) => (node.type as unknown) === "TaskActivityRow");
}

function rootMargins(renderer: Renderer) {
  return renderer.root.children
    .map((child) => (typeof child === "string" ? null : child.findAll((node) => (node.type as unknown) === "View")[0]))
    .map((view) => (view ? StyleSheet.flatten(view.props.style)?.marginBottom : null));
}

function rootStyles(renderer: Renderer) {
  return renderer.root.children
    .map((child) => (typeof child === "string" ? null : child.findAll((node) => (node.type as unknown) === "View")[0]))
    .map((view) => {
      const style = view ? StyleSheet.flatten(view.props.style) : undefined;
      return [style?.marginTop ?? 0, style?.marginBottom ?? 0];
    });
}

/**
 * Item roots drawn at these boxes, in mount order, as the web reads them. The
 * drawing item's own box does not follow its margins here, which is what the
 * renderer must not be fooled by.
 */
function drawnAt(...boxes: Array<{ top: number; height: number }>) {
  let index = 0;
  return () => {
    const box = boxes[index++] ?? { top: 0, height: 0 };
    return { getBoundingClientRect: () => ({ left: 0, width: 600, ...box }) };
  };
}

describe("deriveTodoActivities", () => {
  it("reads a first list as created and later ones as added, started and completed", () => {
    expect(deriveTodoActivities(null, created)).toEqual([{ type: "created", count: 3 }]);
    expect(deriveTodoActivities(created, firstDone)).toEqual([
      { type: "completed", task: "Read the code" },
      { type: "started", task: "Fix the bug" },
    ]);
    expect(deriveTodoActivities(firstDone, [...firstDone, { id: "4", text: "Ship", completed: false }])).toEqual([
      { type: "added", task: "Ship" },
    ]);
  });

  it("matches tasks without ids by position and text, as the host does", () => {
    const before = [{ text: "a", completed: false }, { text: "b", completed: false }];
    const after = [{ text: "a", completed: true }, { text: "b", completed: false }];
    expect(deriveTodoActivities(before, after)).toEqual([{ type: "completed", task: "a" }]);
  });
});

describe("live todo timeline", () => {
  it("draws one checklist for an update the host split in two", () => {
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("split-agent", "u2-completed", 2000, firstDone),
        todo("split-agent", "u2-started", 2000, firstDone)));
    });
    expect(lists(renderer)).toHaveLength(1);
    expect(rows(renderer)).toHaveLength(0);
    // The sibling draws nothing. It cannot give back the gap the host hangs
    // under it (no height to take a negative margin from), so it asks for
    // none; unmeasured, the checklist takes nothing back for it either.
    expect(rootMargins(renderer)).toEqual([undefined, undefined]);
    act(() => renderer.unmount());
  });

  it("takes back the gaps of empty siblings drawn under the checklist", () => {
    // The web mounts top-down: the first item draws, its siblings hang below.
    resetHostRowGap();
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("below-agent", "u2-a", 2000, firstDone),
        todo("below-agent", "u2-b", 2000, firstDone),
        todo("below-agent", "u2-c", 2000, firstDone)),
      { createNodeMock: drawnAt({ top: 100, height: 120 }, { top: 236, height: 0 }, { top: 252, height: 0 }) });
    });
    expect(lists(renderer)).toHaveLength(1);
    expect(rootStyles(renderer)).toEqual([[0, -32], [0, 0], [0, 0]]);
    act(() => renderer.unmount());
  });

  it("takes back the gaps of empty siblings drawn over the checklist", () => {
    // An inverted list mounts bottom-up: the item that draws sits under them.
    resetHostRowGap();
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("above-agent", "u2-a", 2000, firstDone),
        todo("above-agent", "u2-b", 2000, firstDone),
        todo("above-agent", "u2-c", 2000, firstDone)),
      { createNodeMock: drawnAt({ top: 300, height: 120 }, { top: 268, height: 0 }, { top: 284, height: 0 }) });
    });
    expect(rootStyles(renderer)).toEqual([[-32, 0], [0, 0], [0, 0]]);
    act(() => renderer.unmount());
  });

  it("takes back no more than the row's own height", () => {
    resetHostRowGap();
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("short-agent", "u1", 1000, created),
        todo("short-agent", "u2-a", 2000, firstDone),
        todo("short-agent", "u2-b", 2000, firstDone),
        todo("short-agent", "u2-c", 2000, firstDone),
        todo("short-agent", "u3", 3000, secondDone)),
      { createNodeMock: drawnAt(
        { top: 0, height: 28 },
        { top: 44, height: 28 }, { top: 88, height: 0 }, { top: 104, height: 0 },
        { top: 120, height: 120 },
      ) });
    });
    expect(rows(renderer)).toHaveLength(2);
    expect(rootStyles(renderer)).toEqual([
      [0, 0],
      [0, -28],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    act(() => renderer.unmount());
  });

  it("takes nothing back on a host that stacks rows and hangs no gap under them", () => {
    resetHostRowGap();
    noteRowGap(0);
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("stacked-agent", "u2-a", 2000, firstDone),
        todo("stacked-agent", "u2-b", 2000, firstDone)),
      { createNodeMock: drawnAt({ top: 100, height: 120 }, { top: 220, height: 0 }) });
    });
    expect(rootStyles(renderer)).toEqual([[0, 0], [0, 0]]);
    act(() => renderer.unmount());
    resetHostRowGap();
  });

  it("keeps the full checklist on the newest update and folds earlier ones to a row", () => {
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("history-agent", "u1", 1000, created),
        todo("history-agent", "u2-completed", 2000, firstDone),
        todo("history-agent", "u2-started", 2000, firstDone),
        todo("history-agent", "u3-completed", 3000, secondDone),
        todo("history-agent", "u3-started", 3000, secondDone)));
    });
    expect(lists(renderer)).toHaveLength(1);
    expect(lists(renderer)[0]!.props.data.tasks.map((task: { status: string }) => task.status))
      .toEqual(["completed", "completed", "in_progress"]);
    expect(rows(renderer).map((row) => row.props.activities)).toEqual([
      [{ type: "created", count: 3 }],
      [{ type: "completed", task: "Read the code" }, { type: "started", task: "Fix the bug" }],
    ]);
    act(() => renderer.unmount());
  });

  it("folds the previous checklist when a new update arrives", () => {
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("live-agent", "u1", 1000, created)));
    });
    expect(lists(renderer)).toHaveLength(1);
    act(() => {
      renderer.update(React.createElement(React.Fragment, null,
        todo("live-agent", "u1", 1000, created),
        todo("live-agent", "u2-completed", 2000, firstDone),
        todo("live-agent", "u2-started", 2000, firstDone)));
    });
    expect(lists(renderer)).toHaveLength(1);
    expect(rows(renderer)).toHaveLength(1);
    expect(rows(renderer)[0]!.props.activities).toEqual([{ type: "created", count: 3 }]);
    act(() => renderer.unmount());
  });

  it("shows the in-progress task by its active form", () => {
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("active-agent", "u1", 1000, firstDone)));
    });
    expect(lists(renderer)[0]!.props.data.tasks.map((task: { title: string }) => task.title))
      .toEqual(["Read the code", "Fixing the bug", "Run the tests"]);
    act(() => renderer.unmount());
  });

  it("forgets a list the host rewrote in place", () => {
    // The host grows its "created" item in place while tasks are only being
    // added: same item, new timestamp, longer list.
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("grow-agent", "u1", 1000, created.slice(0, 1))));
    });
    act(() => {
      renderer.update(React.createElement(React.Fragment, null,
        todo("grow-agent", "u1", 1100, created)));
    });
    act(() => {
      renderer.update(React.createElement(React.Fragment, null,
        todo("grow-agent", "u1", 1100, created),
        todo("grow-agent", "u2-completed", 2000, firstDone),
        todo("grow-agent", "u2-started", 2000, firstDone)));
    });
    expect(rows(renderer).map((row) => row.props.activities)).toEqual([[{ type: "created", count: 3 }]]);
    act(() => renderer.unmount());
  });

  it("keeps agents apart", () => {
    let renderer!: Renderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        todo("agent-a", "a1", 1000, firstDone),
        todo("agent-b", "b1", 1000, firstDone)));
    });
    expect(lists(renderer)).toHaveLength(2);
    act(() => renderer.unmount());
  });
});
