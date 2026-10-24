import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));

import { firstPromptStoreFor } from "../../client/tasks/data/first-prompt";
import { useSearchFirstPrompts } from "../../client/tasks/data/search-first-prompts";
import { setSubagentTimelineLoader } from "../../client/tasks/data/subagent-timeline";
import { filterLanes } from "../../client/tasks/data";
import { EMPTY_FILTERS, LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../../client/tasks/model";
import { sampleCards } from "../../client/tasks/sample-cards";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeCard = (id: string, closed = false): TaskCard => ({ ...sampleCards()[0]!, id, closed });
const lanesFor = (cards: TaskCard[]) => Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id), hasMore: false, loading: false }])) as Record<LaneId, LaneModel>;
const page = (text: string) => ({ error: null, entries: [
  { item: { type: "user_message", text } },
  { item: { type: "assistant_message", text: "only in an assistant reply" } },
  { item: { type: "user_message", text: "only in a later prompt" } },
] });

let renderer: ReturnType<typeof TestRenderer.create> | null = null;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = null; setSubagentTimelineLoader(null); vi.useRealTimers(); });

function mount(refetch: (id: string) => Promise<unknown>, initialCards: TaskCard[], initialQuery = "dragonfruit") {
  const api = { agents: { ref: (id: string) => ({ timeline: { refetch: () => refetch(id) } }) } };
  let current!: ReturnType<typeof useSearchFirstPrompts>;
  let lanes = lanesFor(initialCards);
  let query = initialQuery;
  function Probe() { current = useSearchFirstPrompts(api as never, lanes, query); return null; }
  act(() => { renderer = TestRenderer.create(<Probe />); });
  return {
    api,
    get current() { return current; },
    update(cards: TaskCard[], nextQuery = query) {
      lanes = lanesFor(cards); query = nextQuery;
      act(() => renderer!.update(<Probe />));
    },
    shown() { return LANE_ORDER.flatMap((id) => filterLanes(lanes, { ...EMPTY_FILTERS, query }, current.messages)[id].cards.map((card) => card.id)); },
  };
}

describe("first-message search", () => {
  it("reads only loaded sessions, shares details' cache, and never searches later messages", async () => {
    const read = vi.fn(async (id: string) => page(id === "cached" ? "Cached Dragonfruit" : "First line\nFresh Dragonfruit"));
    const cached = makeCard("cached", true);
    const closed = makeCard("closed", true);
    const loaded = makeCard("loaded");
    const mounted = mount(read, [cached, closed, loaded], "");
    await act(async () => { await firstPromptStoreFor(mounted.api as never).request("cached"); });
    read.mockClear();
    mounted.update([cached, closed, loaded], "dragonfruit");
    expect(mounted.current.coverage).toEqual({ pending: 1, unavailable: 1, failed: 0 });
    expect(mounted.shown()).toEqual(["cached"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(read.mock.calls).toEqual([["loaded"]]);
    expect(mounted.shown()).toEqual(["cached", "loaded"]);
    expect(mounted.current.coverage).toEqual({ pending: 0, unavailable: 1, failed: 0 });
    expect(firstPromptStoreFor(mounted.api as never).read("loaded")).toMatchObject({ state: "ready", text: "First line\nFresh Dragonfruit" });
    mounted.update([cached, closed, loaded], "only in");
    expect(mounted.shown()).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrency and stops queued reads when search is cleared", async () => {
    const finish: Array<() => void> = [];
    const read = vi.fn(() => new Promise((resolve) => finish.push(() => resolve(page("Dragonfruit")))));
    const cards = Array.from({ length: 10 }, (_, index) => makeCard(`task-${index}`));
    const mounted = mount(read, cards);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(read).toHaveBeenCalledTimes(4);
    mounted.update([...cards, makeCard("extra")]);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(read).toHaveBeenCalledTimes(4);
    mounted.update(cards, "");
    await act(async () => { finish.forEach((resolve) => resolve()); await vi.advanceTimersByTimeAsync(500); });
    expect(read).toHaveBeenCalledTimes(4);
    expect(mounted.current.coverage).toEqual({ pending: 0, unavailable: 0, failed: 0 });
    expect(mounted.current.messages.size).toBe(0);
  });

  it("reports a failed read and retries after clearing search; late results use the current query", async () => {
    let resolve!: (value: unknown) => void;
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const cards = [makeCard("loaded")];
    const mounted = mount(read, cards);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(mounted.current.coverage.failed).toBe(1);
    mounted.update(cards, "");
    mounted.update(cards, "dragonfruit");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    mounted.update(cards, "different query");
    await act(async () => { resolve(page("Dragonfruit")); });
    expect(mounted.shown()).toEqual([]);
    mounted.update(cards, "dragonfruit");
    expect(mounted.shown()).toEqual(["loaded"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads a provider subagent's own first message and skips one whose parent is closed", async () => {
    const load = vi.fn(async () => ({ error: null, rows: [{ type: "user_message", text: "Subagent Dragonfruit" }] }));
    setSubagentTimelineLoader(load);
    const parent = makeCard("loaded-parent");
    const closedParent = makeCard("closed-parent", true);
    const child = (id: string, parentId: string): TaskCard => ({ ...makeCard(id), subagent: { subtitle: null }, parent: { id: parentId, title: "Parent", missing: false, archived: false } });
    const mounted = mount(async () => page("Parent message"), [parent, closedParent, child("loaded-sub", parent.id), child("closed-sub", closedParent.id)]);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(load.mock.calls).toEqual([[{ subagentId: "loaded-sub", parentAgentId: parent.id, direction: "after", limit: 8 }]]);
    expect(mounted.shown()).toEqual(["loaded-sub"]);
    expect(mounted.current.coverage.unavailable).toBe(2);
  });
});
