import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSessionTokensLoader, useSessionTokens } from "../../client/tasks/data/session-tokens";
import type { SessionTokens } from "../../shared/tasks-rpc";
import "./helpers/quiet-renderer";

afterEach(() => {
  setSessionTokensLoader(null);
  vi.useRealTimers();
});

async function mount(agentId: string, active: boolean) {
  let current: SessionTokens | null = null;
  function Probe(props: { agentId: string; active: boolean }) {
    current = useSessionTokens(props.agentId, props.active);
    return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe, { agentId, active }));
  });
  return {
    get current() { return current; },
    update: (next: { agentId: string; active: boolean }) => act(async () => renderer.update(React.createElement(Probe, next))),
    unmount: () => act(() => renderer.unmount()),
  };
}

const flush = () => act(async () => { for (let index = 0; index < 4; index += 1) await Promise.resolve(); });

describe("session tokens hook", () => {
  it("reads while active, again every 5 s, and stops when no longer active", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let total = 1_000;
    const loader = vi.fn(async () => ({ total, cached: 400 }));
    setSessionTokensLoader(loader);
    const hook = await mount("a", true);
    await flush();
    expect(hook.current).toEqual({ total: 1_000, cached: 400 });
    total = 2_000;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await flush();
    expect(hook.current).toEqual({ total: 2_000, cached: 400 });
    expect(loader).toHaveBeenCalledTimes(2);
    // Not running: no figure, no more reads.
    await hook.update({ agentId: "a", active: false });
    expect(hook.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(loader).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it("shows the last figure at once when the card opens again, and none from a failed read", async () => {
    setSessionTokensLoader(async (agentId) => (agentId === "b" ? { total: 7, cached: 0 } : null));
    const first = await mount("b", true);
    await flush();
    first.unmount();
    setSessionTokensLoader(() => new Promise(() => {}));
    const again = await mount("b", true);
    expect(again.current).toEqual({ total: 7, cached: 0 });
    again.unmount();
    setSessionTokensLoader(async () => { throw new Error("older server"); });
    const failed = await mount("c", true);
    await flush();
    expect(failed.current).toBeNull();
    failed.unmount();
  });

  it("never shows the previous agent's figure on the first render after switching", async () => {
    setSessionTokensLoader(async (agentId) => (agentId === "switch-a" ? { total: 11, cached: 1 } : null));
    const seen: Array<SessionTokens | null> = [];
    function Probe(props: { agentId: string }) {
      seen.push(useSessionTokens(props.agentId, true));
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { agentId: "switch-a" })); });
    await flush();
    expect(seen.at(-1)).toEqual({ total: 11, cached: 1 });
    setSessionTokensLoader(() => new Promise(() => {}));
    seen.length = 0;
    await act(async () => renderer.update(React.createElement(Probe, { agentId: "switch-b" })));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((tokens) => tokens === null)).toBe(true);
    act(() => renderer.unmount());
  });

  it("polls once per agent and updates every card showing it together", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let total = 100;
    const loader = vi.fn(async () => ({ total, cached: 0 }));
    setSessionTokensLoader(loader);
    const current: Record<string, SessionTokens | null> = {};
    function Probe(props: { id: string }) {
      current[props.id] = useSessionTokens("shared", true);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        React.createElement(Probe, { id: "card" }), React.createElement(Probe, { id: "details" })));
    });
    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(current).toEqual({ card: { total: 100, cached: 0 }, details: { total: 100, cached: 0 } });
    total = 200;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(current).toEqual({ card: { total: 200, cached: 0 }, details: { total: 200, cached: 0 } });
    act(() => renderer.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
