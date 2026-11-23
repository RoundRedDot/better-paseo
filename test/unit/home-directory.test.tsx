import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const state = vi.hoisted(() => ({ host: {}, read: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => state.host,
  useRpc: () => state.read,
}));
import { useHomeDirectory } from "../../client/state/home-directory";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("reads once per daemon and keeps their home directories separate", async () => {
  state.read.mockResolvedValueOnce({ home: "/home/alice" }).mockResolvedValueOnce({ home: "/remote/bob" });
  function Probe() { return React.createElement("span", null, useHomeDirectory() ?? "loading"); }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(React.Fragment, null, React.createElement(Probe), React.createElement(Probe))); });
  expect(state.read).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(renderer.toJSON())).toContain("/home/alice");
  state.host = {};
  await act(async () => { renderer.update(React.createElement(Probe)); });
  expect(state.read).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(renderer.toJSON())).toContain("/remote/bob");
  act(() => renderer.unmount());
});
