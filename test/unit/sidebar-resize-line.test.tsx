import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { followPointer, useResizeLine } from "../../client/ui/resize-line";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.unstubAllGlobals());

it("shows the shared line on hover and keeps it visible while resizing", () => {
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
  expect(style.textContent).toContain("[data-bcresize]:hover [data-bcresizetrack]");
  expect(style.textContent).toContain("[data-bcresize]:hover [data-bcresizeindicator]");
  expect(style.textContent).toContain("transition-delay: 100ms");
  expect(style.textContent).toContain("transition-delay: 0s");
  act(() => renderer!.unmount());
});


it("moves the indicator to the pointer and clamps it to the handle", () => {
  const handle = { getBoundingClientRect: () => ({ top: 100, height: 400 }) } as HTMLElement;
  const indicator = { style: { transform: "" } } as HTMLElement;
  followPointer(handle, indicator, 200);
  expect(indicator.style.transform).toBe("translate3d(0, -100px, 0)");
  followPointer(handle, indicator, 600);
  expect(indicator.style.transform).toBe("translate3d(0, 200px, 0)");
});
