import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const state = vi.hoisted(() => ({ hover: true }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ useInputCapabilities: () => ({ hover: state.hover }) }));
vi.mock("../../client/web", () => ({ bindPreviewPointer: () => () => {}, openPreviewLayer: () => () => {} }));
import { HoverPreviewContext, PREVIEW_CLOSE_MS, PREVIEW_OPEN_MS, useHoverPreview } from "../../client/ui/hover-preview";
import { HOVER_DELAYS, HOVER_DELAY_MS, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let preview!: ReturnType<typeof useHoverPreview>;
let renderer: ReturnType<typeof TestRenderer.create>;
function Probe({ enabled = true }: { enabled?: boolean }) {
  preview = useHoverPreview(enabled);
  return null;
}
function mount(enabled = true, nested = false) {
  act(() => {
    renderer = TestRenderer.create(React.createElement(HoverPreviewContext.Provider, { value: nested }, React.createElement(Probe, { enabled })));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  resetEnhancerPreferences();
  state.hover = true;
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
});
afterEach(() => {
  act(() => renderer?.unmount());
  vi.useRealTimers();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("hover preview lifetime", () => {
  it.each(HOVER_DELAYS)("uses the configured %s delay", (hoverDelay) => {
    updateEnhancerPreferences({ hoverDelay });
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(HOVER_DELAY_MS[hoverDelay] - 1); });
    expect(preview.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview.open).toBe(true);
  });
  it("uses an updated preference on the next hover without remounting", () => {
    mount();
    act(() => { updateEnhancerPreferences({ hoverDelay: "2s" }); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(1999); });
    expect(preview.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview.open).toBe(true);
  });
  it("opens after a rest without changing disclosure state", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS - 1); });
    expect(preview.open).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(preview.open).toBe(true);
  });
  it("stays open across the gap and while the pointer is inside the panel", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS - 1); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
    expect(preview.open).toBe(false);
  });
  it("cancels a pending opening when the pointer leaves early", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(preview.open).toBe(false);
  });
  it("closes immediately when the row expands and cancels timers on unmount", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => renderer.update(React.createElement(Probe, { enabled: false })));
    expect(preview.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["ios", "android"])("does not open on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
  });
  it("does not open on touch-only web or inside another preview owner", () => {
    state.hover = false;
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
    act(() => renderer.unmount());
    state.hover = true;
    mount(true, true);
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
  });
});
