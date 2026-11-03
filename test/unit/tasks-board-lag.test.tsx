import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => import("./helpers/rn-mock"));

describe("useLaggedWhile", () => {
  afterEach(() => vi.useRealTimers());

  it("holds a change while lagging, sends the latest one after the wait, and follows at once otherwise", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const { useLaggedWhile } = await import("../../client/tasks/board/desktop-board");
    const seen: number[] = [];
    function Probe(props: { value: number; lag: boolean }) {
      seen.push(useLaggedWhile(props.value, props.lag, 180));
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Probe value={1} lag={false} />);
    });
    act(() => renderer!.update(<Probe value={2} lag={false} />));
    expect(seen.at(-1)).toBe(2);

    act(() => renderer!.update(<Probe value={3} lag />));
    act(() => renderer!.update(<Probe value={4} lag />));
    expect(seen.at(-1)).toBe(2);
    act(() => { vi.advanceTimersByTime(179); });
    expect(seen.at(-1)).toBe(2);
    act(() => { vi.advanceTimersByTime(1); });
    expect(seen.at(-1)).toBe(4);

    // Closing the panel shows the latest at once, and the wait it cut short sends nothing later.
    act(() => renderer!.update(<Probe value={5} lag />));
    act(() => renderer!.update(<Probe value={6} lag={false} />));
    expect(seen.at(-1)).toBe(6);
    const renders = seen.length;
    act(() => { vi.advanceTimersByTime(500); });
    expect(seen.length).toBe(renders);
    act(() => renderer!.unmount());
  });
});

describe("useOffscreenLanes", () => {
  afterEach(() => vi.useRealTimers());

  type Lanes = Parameters<typeof import("../../client/tasks/board/desktop-board").useOffscreenLanes>[0];
  const IDS = ["needs_input", "running", "review", "done", "archived"] as const;
  /** Lanes holding `count` cards each, named by lane and index. */
  function lanes(counts: Partial<Record<(typeof IDS)[number], number>>): Lanes {
    return Object.fromEntries(
      IDS.map((id) => [id, { id, cards: Array.from({ length: counts[id] ?? 0 }, (_, index) => ({ id: `${id}-${index}` })) }]),
    ) as unknown as Lanes;
  }

  async function mount(first: Lanes, wanted: string, on = true) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const { useOffscreenLanes } = await import("../../client/tasks/board/desktop-board");
    const seen: Lanes[] = [];
    function Probe(props: { lanes: Lanes; wanted: string }) {
      seen.push(useOffscreenLanes(props.lanes, props.wanted, { on, churnLimit: 6 }));
      return null;
    }
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<Probe lanes={first} wanted={wanted} />);
    });
    return { seen, update: (next: Lanes, nextWanted = wanted) => act(() => renderer!.update(<Probe lanes={next} wanted={nextWanted} />)), unmount: () => act(() => renderer!.unmount()) };
  }

  it("shows a switch's many new cards in the lanes in view at once and in the others 800 ms later", async () => {
    const before = lanes({ review: 3, done: 3 });
    const after = lanes({ review: 8, done: 9 });
    const probe = await mount(before, "|needs_input|running|review|");
    probe.update(after);
    expect(probe.seen.at(-1)!.review).toBe(after.review);
    expect(probe.seen.at(-1)!.done).toBe(before.done);
    act(() => { vi.advanceTimersByTime(799); });
    expect(probe.seen.at(-1)!.done).toBe(before.done);
    act(() => { vi.advanceTimersByTime(1); });
    expect(probe.seen.at(-1)).toBe(after);
    // Nothing waits any more: no later render.
    const renders = probe.seen.length;
    act(() => { vi.advanceTimersByTime(2000); });
    expect(probe.seen.length).toBe(renders);
    probe.unmount();
  });

  it("gives a small change, which the lanes may animate, to every lane at once", async () => {
    const before = lanes({ running: 2, done: 3 });
    // A card finishes: it leaves Running for Done, out of view.
    const after = { ...before, running: { ...before.running, cards: before.running.cards.slice(1) }, done: { ...before.done, cards: [before.running.cards[0]!, ...before.done.cards] } } as Lanes;
    const probe = await mount(before, "|needs_input|running|");
    probe.update(after);
    expect(probe.seen.at(-1)).toBe(after);
    probe.unmount();
  });

  it("keeps the record while lanes wait, and gives a lane its latest once it is wanted", async () => {
    const before = lanes({ review: 3, done: 3, archived: 2 });
    const after = lanes({ review: 3, done: 9, archived: 8 });
    const probe = await mount(before, "|review|");
    probe.update(after);
    const held = probe.seen.at(-1)!;
    expect(held.done).toBe(before.done);
    // The same lanes again: the same record, so the lane motion sees no change.
    probe.update(after);
    expect(probe.seen.at(-1)).toBe(held);
    // Scrolled into view (or focused): Done takes its cards at once; Archived still waits.
    probe.update(after, "|review|done|");
    expect(probe.seen.at(-1)!.done).toBe(after.done);
    expect(probe.seen.at(-1)!.archived).toBe(before.archived);
    act(() => { vi.advanceTimersByTime(800); });
    expect(probe.seen.at(-1)).toBe(after);
    probe.unmount();
  });

  it("follows every change at once when off (the web)", async () => {
    const before = lanes({ done: 1 });
    const after = lanes({ done: 9 });
    const probe = await mount(before, "", false);
    probe.update(after);
    expect(probe.seen.at(-1)).toBe(after);
    probe.unmount();
  });
});
