import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn(async () => ({ state: "idle" as const })));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc }));
vi.mock("../../client/agent-updates", () => ({ useAgentUpdates: () => ({ state: { entries: [] } }) }));

import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";
import { PluginUpdateIndicator } from "../../client/plugin-update-indicator";
import { recordPluginUpdate, resetUpdateIndicatorsForTests } from "../../client/tasks/board/update-indicator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const newer = { state: "done" as const, source: "git" as const, current: "a", latest: "b", matches: false, checkedAt: 1,
  versions: { status: "available" as const, current: "1.0.0", latest: "1.1.0", currentBuild: 1, latestBuild: 2 },
  notes: { status: "missing" as const } };

describe("plugin list update indicator", () => {
  afterEach(() => { resetUpdateIndicatorsForTests(); vi.clearAllMocks(); });

  it("reports the settings indicator per host and retains known updates on failed checks", async () => {
    const first = vi.fn();
    const second = vi.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<><PluginUpdateIndicator hostId="one" onChange={first} /><PluginUpdateIndicator hostId="two" onChange={second} /></>); });
    await act(async () => { recordPluginUpdate("one", newer); });
    expect(first).toHaveBeenLastCalledWith(true);
    expect(second).toHaveBeenLastCalledWith(false);
    await act(async () => { recordPluginUpdate("one", { state: "failed" }); });
    expect(first).toHaveBeenLastCalledWith(true);
    await act(async () => { recordPluginUpdate("one", { ...newer, matches: true }); });
    expect(first).toHaveBeenLastCalledWith(false);
    await act(async () => { renderer.unmount(); });
  });
});
