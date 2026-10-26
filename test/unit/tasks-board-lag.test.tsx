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
    act(() => vi.advanceTimersByTime(179));
    expect(seen.at(-1)).toBe(2);
    act(() => vi.advanceTimersByTime(1));
    expect(seen.at(-1)).toBe(4);

    // Closing the panel shows the latest at once, and the wait it cut short sends nothing later.
    act(() => renderer!.update(<Probe value={5} lag />));
    act(() => renderer!.update(<Probe value={6} lag={false} />));
    expect(seen.at(-1)).toBe(6);
    const renders = seen.length;
    act(() => vi.advanceTimersByTime(500));
    expect(seen.length).toBe(renders);
    act(() => renderer!.unmount());
  });
});
