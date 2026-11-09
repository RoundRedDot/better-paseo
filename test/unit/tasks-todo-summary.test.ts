import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { createTodoSummaryStore, summarizePlan, useTodoSummary } from "../../client/tasks/data/todo-summary";

function todo(completed: number, total: number) {
  return { type: "todo", items: Array.from({ length: total }, (_, index) => ({ text: `Task ${index}`, completed: index < completed })) };
}

function fixture() {
  let deliver: (event: unknown) => void = () => {};
  const release = vi.fn();
  const timeline = {
    subscribe: vi.fn((callback: (event: unknown) => void) => {
      deliver = callback;
      return Object.assign(release, { ready: Promise.resolve() });
    }),
    refetch: vi.fn(),
  };
  const api = { agents: { ref: () => ({ timeline }) } } as unknown as Parameters<typeof createTodoSummaryStore>[0];
  return { api, timeline, release, emit: (event: unknown) => deliver({ event }), store: createTodoSummaryStore(api) };
}

describe("task card todo summary", () => {
  it("parses plan steps, keeps checkbox state and bounds the list", () => {
    expect(summarizePlan("# Plan\nExplanation\n1. First\n- [x] Second\n* Third")).toEqual({ source: "plan", completed: 1, total: 3, items: [{ text: "First", completed: false }, { text: "Second", completed: true }, { text: "Third", completed: false }] });
    expect(summarizePlan("# Plan\nOnly prose")).toBeNull();
    expect(summarizePlan(Array.from({ length: 15 }, (_, i) => `${i + 1}. Step`).join("\n"))).toMatchObject({ total: 15, items: expect.arrayContaining([{ text: "Step", completed: false }]) });
    expect(summarizePlan(Array.from({ length: 15 }, () => "* Step").join("\n"))?.items).toHaveLength(12);
  });

  it("uses the latest plan or todo without another subscription", async () => {
    const f = fixture();
    const plan = { type: "tool_call", detail: { type: "plan", text: "# Plan\n1. First\n2. Second" } };
    f.timeline.refetch.mockResolvedValue({ entries: [{ item: todo(1, 1) }, { item: plan }], hasOlder: false });
    const stop = f.store.watch("parent");
    await vi.waitFor(() => expect(f.store.read("parent")).toMatchObject({ source: "plan", total: 2 }));
    f.emit({ type: "timeline", item: todo(0, 3) });
    expect(f.store.read("parent")).toEqual({ completed: 0, total: 3, items: todo(0, 3).items });
    f.emit({ type: "timeline", item: plan });
    expect(f.store.read("parent")).toMatchObject({ source: "plan", total: 2 });
    expect(f.timeline.subscribe).toHaveBeenCalledTimes(1);
    stop();
  });

  it("finds the latest todo across older pages and follows live updates", async () => {
    const f = fixture();
    f.timeline.refetch.mockResolvedValueOnce({ entries: [], hasOlder: true, startCursor: { epoch: "e", seq: 40 } })
      .mockResolvedValueOnce({ entries: [{ item: todo(3, 13) }], hasOlder: false });
    const stop = f.store.watch("parent");
    await vi.waitFor(() => expect(f.store.read("parent")).toEqual({ completed: 3, total: 13, items: todo(3, 13).items }));
    expect(f.timeline.refetch.mock.calls[1]?.[0]).toMatchObject({ direction: "before", cursor: { epoch: "e", seq: 40 } });
    f.emit({ type: "timeline", item: todo(4, 13) });
    expect(f.store.read("parent")).toEqual({ completed: 4, total: 13, items: todo(4, 13).items });
    stop();
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("notifies when task text or status changes without changing counts", async () => {
    const f = fixture();
    f.timeline.refetch.mockResolvedValue({ entries: [{ item: todo(1, 2) }], hasOlder: false });
    const listener = vi.fn();
    f.store.subscribe("parent", listener);
    const stop = f.store.watch("parent");
    await vi.waitFor(() => expect(f.store.read("parent")?.total).toBe(2));
    const changed = todo(1, 2);
    changed.items[1]!.text = "Changed";
    f.emit({ type: "timeline", item: changed });
    expect(f.store.read("parent")?.items[1]?.text).toBe("Changed");
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("lets a motion copy read updates without acquiring or extending a watcher", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const f = fixture();
    f.timeline.refetch.mockResolvedValue({ entries: [{ item: todo(1, 2) }], hasOlder: false });
    const Reader = ({ watch }: { watch: boolean }) => React.createElement("value", { value: useTodoSummary(f.api as never, "parent", true, watch) });
    const tree = (live: boolean) => React.createElement(React.Fragment, null, live ? React.createElement(Reader, { key: "live", watch: true }) : null, React.createElement(Reader, { key: "copy", watch: false }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(tree(true)); });
    await vi.waitFor(() => expect(renderer.root.findAll((node) => (node.type as unknown) === "value")[1]!.props.value?.completed).toBe(1));
    expect(f.timeline.subscribe).toHaveBeenCalledTimes(1);
    await act(async () => { f.emit({ type: "timeline", item: todo(2, 2) }); });
    expect(renderer.root.findAll((node) => (node.type as unknown) === "value")[1]!.props.value.completed).toBe(2);
    await act(async () => renderer.update(tree(false)));
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(renderer.root.find((node) => (node.type as unknown) === "value").props.value.completed).toBe(2);
    await act(async () => renderer.unmount());
    expect(f.timeline.subscribe).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a newer live update with a delayed history response", async () => {
    const f = fixture();
    let finish: (page: unknown) => void = () => {};
    f.timeline.refetch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const stop = f.store.watch("parent");
    await vi.waitFor(() => expect(f.timeline.refetch).toHaveBeenCalled());
    f.emit({ type: "timeline", item: todo(4, 13) });
    finish({ entries: [{ item: todo(3, 13) }], hasOlder: false });
    await Promise.resolve();
    expect(f.store.read("parent")).toEqual({ completed: 4, total: 13, items: todo(4, 13).items });
    stop();
  });

  it("refreshes after reconnect and keeps a shared subscription until the last watcher leaves", async () => {
    const f = fixture();
    f.timeline.refetch.mockResolvedValueOnce({ entries: [{ item: todo(1, 2) }], hasOlder: false })
      .mockResolvedValueOnce({ entries: [{ item: todo(2, 2) }], hasOlder: false });
    const first = f.store.watch("parent");
    const second = f.store.watch("parent");
    await vi.waitFor(() => expect(f.store.read("parent")).toEqual({ completed: 1, total: 2, items: todo(1, 2).items }));
    first();
    expect(f.release).not.toHaveBeenCalled();
    f.emit({ type: "subscription_restored" });
    await vi.waitFor(() => expect(f.store.read("parent")).toEqual({ completed: 2, total: 2, items: todo(2, 2).items }));
    second();
    expect(f.release).toHaveBeenCalledOnce();
  });

  it("does not keep stale progress when a replacement has no todo in the readable window", async () => {
    const f = fixture();
    f.timeline.refetch.mockResolvedValueOnce({ entries: [{ item: todo(1, 2) }], hasOlder: false });
    const stop = f.store.watch("parent");
    await vi.waitFor(() => expect(f.store.read("parent")).toEqual({ completed: 1, total: 2, items: todo(1, 2).items }));
    let seq = 100;
    f.timeline.refetch.mockImplementation(async () => ({ entries: [], hasOlder: true, startCursor: { epoch: "e", seq: seq-- } }));
    f.emit({ type: "replacement" });
    await vi.waitFor(() => expect(f.store.read("parent")).toBeNull());
    expect(f.timeline.refetch).toHaveBeenCalledTimes(26);
    stop();
  });
});
