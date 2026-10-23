import React, { Profiler } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("../../client/preferences", () => ({ useEnhancerPreferences: () => ({ blockDetails: true }) }));
vi.mock("../../client/details/shell/details-shell", () => ({
  DetailsShell: (props: Record<string, unknown>) => React.createElement("Shell", props),
}));

import { DetailsHostSlot } from "../../client/details/shell/details-host-slot";
import type { ExtendedThemeTokens } from "../../client/components/theme-tokens";

const SHELL = "Shell" as never;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("details host slots", () => {
  it("commits non-holders once and hands the shell to the next mounted slot", () => {
    const commits = new Map<string, number>();
    const tokens = {} as ExtendedThemeTokens;
    const tree = (agentId: string, ids: string[]) => React.createElement(React.Fragment, null,
      ...ids.map((itemKey) => React.createElement(Profiler, {
        key: itemKey, id: itemKey,
        onRender: (id: string) => commits.set(id, (commits.get(id) ?? 0) + 1),
      }, React.createElement(DetailsHostSlot, { agentId, itemKey, tokens, compact: false }))),
    );
    const ids = Array.from({ length: 100 }, (_, index) => `slot-${index}`);
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(tree("slots-first", ids)); });
    expect(renderer.root.findAllByType(SHELL)).toHaveLength(1);
    expect(commits.get("slot-0")).toBe(2);
    ids.slice(1).forEach((id) => expect(commits.get(id)).toBe(1));

    act(() => renderer.update(tree("slots-first", ids.slice(1))));
    expect(renderer.root.findAllByType(SHELL)).toHaveLength(1);
    expect(renderer.root.findByType(SHELL).props.agentId).toBe("slots-first");
    // Reusing the slots for another chat must release every old claim.
    act(() => renderer.update(tree("slots-second", ids.slice(1))));
    expect(renderer.root.findAllByType(SHELL)).toHaveLength(1);
    expect(renderer.root.findByType(SHELL).props.agentId).toBe("slots-second");
    act(() => renderer.unmount());
    act(() => { renderer = TestRenderer.create(tree("slots-first", ["new-owner"])); });
    expect(renderer.root.findAllByType(SHELL)).toHaveLength(1);
    act(() => renderer.unmount());
  });
});
