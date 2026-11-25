import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { useResizeLine } from "../../client/ui/resize-line";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

it("shows the shared line only while the handle is marked as resizing", () => {
  const style = { id: "", textContent: "", remove: vi.fn() };
  vi.stubGlobal("document", {
    getElementById: () => null,
    createElement: () => style,
    head: { appendChild() {} },
  });
  function Probe() {
    useResizeLine("#111");
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Probe />); });
  expect(style.textContent).toContain("[data-bcresize][data-bcresizing] [data-bcresizetrack]");
  expect(style.textContent).not.toContain(":hover");
  act(() => renderer!.unmount());
});
