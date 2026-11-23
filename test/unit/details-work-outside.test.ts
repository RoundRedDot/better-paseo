import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => import("./helpers/rn-mock"));
import { bindWorkOutsideClick } from "../../client/details/shell/web-layer";
import { closeDetailsIfCurrent, detailsApi, useDetails } from "../../client/details/details-store";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class DocumentStub extends EventTarget {}
function setup() {
  const document = new DocumentStub();
  const panel = {};
  let shown = true;
  const layer = { ownerDocument: document, getClientRects: () => shown ? [1] : [], contains: (target: unknown) => target === panel };
  const fire = (type: string, target: object, x = 10, y = 10, button = 0, path: object[] = [target]) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries({ target, clientX: x, clientY: y, button, composedPath: () => path })) {
      Object.defineProperty(event, key, { value });
    }
    document.dispatchEvent(event);
    return event;
  };
  return { layer, document, panel, fire, hide: () => { shown = false; } };
}

beforeEach(() => { vi.useFakeTimers(); (globalThis as { __rnMockOS?: string }).__rnMockOS = "web"; });
afterEach(() => { vi.useRealTimers(); delete (globalThis as { __rnMockOS?: string }).__rnMockOS; });

describe("work details outside click", () => {
  it("keeps panel and selected row clicks, and closes after a click elsewhere without consuming it", () => {
    const ui = setup();
    const close = vi.fn();
    const release = bindWorkOutsideClick(ui.layer, "work-1", close);
    const selected = { getAttribute: (name: string) => name === "data-bcworkdetails" ? "work-1" : null };
    const child = {};
    ui.fire("pointerdown", ui.panel);
    ui.fire("click", ui.panel);
    ui.fire("pointerdown", child);
    ui.fire("click", child, 10, 10, 0, [child, selected]);
    vi.runAllTimers();
    expect(close).not.toHaveBeenCalled();
    const outside = {};
    ui.fire("pointerdown", outside);
    const click = ui.fire("click", outside);
    expect(click.defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(close).toHaveBeenCalledOnce();
    release();
  });

  it("does not close for a text-selection drag, secondary click, hidden panel or after cleanup", () => {
    const ui = setup();
    const close = vi.fn();
    const release = bindWorkOutsideClick(ui.layer, "work-1", close);
    const target = {};
    ui.fire("pointerdown", target, 10, 10);
    ui.fire("click", target, 40, 10);
    ui.fire("pointerdown", target, 10, 10, 2);
    ui.fire("click", target, 10, 10, 2);
    ui.hide();
    ui.fire("pointerdown", target);
    ui.fire("click", target);
    vi.runAllTimers();
    expect(close).not.toHaveBeenCalled();
    release();
    ui.fire("pointerdown", target);
    ui.fire("click", target);
    vi.runAllTimers();
    expect(close).not.toHaveBeenCalled();
    const next = setup();
    const releaseNext = bindWorkOutsideClick(next.layer, "work-1", close);
    next.fire("pointerdown", target);
    next.fire("click", target);
    releaseNext();
    vi.runAllTimers();
    expect(close).not.toHaveBeenCalled();
  });

  it("does not close a different detail opened by the outside click", () => {
    const ui = setup();
    const agentId = "outside-switch";
    let openId: string | null = null;
    function Probe() { openId = useDetails(agentId).openId; return null; }
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Probe)); detailsApi.open(agentId, "work-1"); });
    const release = bindWorkOutsideClick(ui.layer, "work-1", () => closeDetailsIfCurrent(agentId, "work-1"));
    const target = {};
    ui.fire("pointerdown", target);
    ui.fire("click", target);
    act(() => { detailsApi.open(agentId, "work-2"); });
    act(() => { vi.advanceTimersByTime(0); });
    expect(openId).toBe("work-2");
    release();
    act(() => { detailsApi.close(agentId); renderer.unmount(); });
  });
});
