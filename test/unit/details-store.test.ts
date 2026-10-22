import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockEntry, DetailsState } from "../../client/details/contracts";
import { registerBlock } from "../../client/details/block-registry";
import { MARKER_LINGER_MS, claimHostLease, detailsApi, useDetails, useMarkerPhase } from "../../client/details/details-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(id: string, agentId: string, options: Partial<BlockEntry> = {}): BlockEntry {
  return {
    id,
    agentId,
    at: 1,
    kind: "tool",
    seq: 0,
    navigable: true,
    hasBody: true,
    mounted: true,
    title: id,
    titleMono: false,
    subtitle: [],
    icon: "file",
    readsImage: false,
    render: () => null,
    copies: () => [],
    ...options,
  };
}

describe("details store", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("opens, changes fields, steps over inert entries, and stops at the ends", () => {
    const agentId = "details-api";
    const openFirst = vi.fn();
    const openNext = vi.fn();
    const registrations = [
      registerBlock(entry("first", agentId, { seq: 1, onOpen: openFirst })),
      registerBlock(entry("merged-member", agentId, { seq: 2, navigable: false })),
      registerBlock(entry("inert", agentId, { seq: 3, hasBody: false })),
      registerBlock(entry("next", agentId, { seq: 4, onOpen: openNext })),
    ];
    let state!: DetailsState;
    function StateProbe() {
      state = useDetails(agentId);
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(StateProbe)); });

    act(() => { detailsApi.open(agentId, "first", { detent: "full", form: "side" }); });
    expect(state.openId).toBe("first");
    expect(state.detent).toBe("full");
    expect(state.form).toBe("side");
    expect(openFirst).toHaveBeenCalledTimes(1);
    act(() => { detailsApi.open(agentId, "first"); });
    expect(openFirst).toHaveBeenCalledTimes(1);

    act(() => { detailsApi.step(agentId, 1); });
    expect(state.openId).toBe("next");
    expect(state.lingerId).toBe("first");
    expect(openNext).toHaveBeenCalledTimes(1);
    act(() => { detailsApi.step(agentId, 1); });
    expect(state.openId).toBe("next");
    act(() => { detailsApi.step(agentId, -1); });
    expect(state.openId).toBe("first");

    act(() => {
      detailsApi.setDetent(agentId, "fit");
      detailsApi.setFullscreen(agentId, true);
      detailsApi.setForm(agentId, "floating");
    });
    expect(state).toMatchObject({ detent: "fit", fullscreen: true, form: "floating" });
    act(() => { detailsApi.close(agentId); });
    expect(state.openId).toBeNull();
    expect(state.lingerId).toBe("first");

    act(() => { renderer.unmount(); });
    registrations.forEach((registration) => registration.release());
  });

  it("keeps the current marker on and lingers only the previous row for 1.2 seconds", () => {
    vi.useFakeTimers();
    const agentId = "details-markers";
    const renders = { a: 0, b: 0, other: 0 };
    const phases: Record<string, string> = {};

    function Marker({ id }: { id: keyof typeof renders }) {
      phases[id] = useMarkerPhase(agentId, id);
      renders[id] += 1;
      return React.createElement("Marker", { phase: phases[id] });
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(React.Fragment, null,
        React.createElement(Marker, { id: "a" }),
        React.createElement(Marker, { id: "b" }),
        React.createElement(Marker, { id: "other" }),
      ));
    });
    const initial = { ...renders };

    act(() => { detailsApi.open(agentId, "a"); });
    expect(phases.a).toBe("on");
    expect(renders.a).toBe(initial.a + 1);
    expect(renders.b).toBe(initial.b);
    expect(renders.other).toBe(initial.other);

    const afterA = { ...renders };
    act(() => { detailsApi.open(agentId, "b"); });
    expect(phases.a).toBe("linger");
    expect(phases.b).toBe("on");
    expect(renders.a).toBe(afterA.a + 1);
    expect(renders.b).toBe(afterA.b + 1);
    expect(renders.other).toBe(initial.other);
    expect(MARKER_LINGER_MS).toBe(1200);

    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS - 1); });
    expect(phases.a).toBe("linger");
    act(() => { vi.advanceTimersByTime(1); });
    expect(phases.a).toBe("off");
    expect(phases.b).toBe("on");
    expect(renders.other).toBe(initial.other);

    act(() => { detailsApi.close(agentId); });
    expect(phases.b).toBe("linger");
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    expect(phases.b).toBe("off");
    expect(renders.other).toBe(initial.other);
    act(() => { renderer.unmount(); });
  });

  it("hands the host lease to the next claimant and notifies subscribers", () => {
    const agentId = "details-lease";
    const first = claimHostLease(agentId, "slot-1");
    const second = claimHostLease(agentId, "slot-2");
    const changed = vi.fn();
    second.subscribe(changed);

    expect(first.held()).toBe(true);
    expect(second.held()).toBe(false);
    first.release();
    expect(first.held()).toBe(false);
    expect(second.held()).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    second.release();
    expect(second.held()).toBe(false);
  });
});
