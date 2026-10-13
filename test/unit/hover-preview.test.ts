import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "Icon" }));
const state = vi.hoisted(() => ({ hover: true }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ useInputCapabilities: () => ({
  hover: state.hover,
  native: ["ios", "android"].includes((globalThis as { __rnMockOS?: string }).__rnMockOS ?? ""),
}) }));
vi.mock("../../client/web", () => ({ bindPreviewPointer: () => () => {}, openPreviewLayer: () => () => {} }));
import { HoverPreview, HoverPreviewBody, HoverPreviewContext, HoverPreviewHeader, PREVIEW_CLOSE_MS, PREVIEW_OPEN_MS, useHoverPreview } from "../../client/ui/hover-preview";
import { buildThemeTokens } from "../../client/components/theme-tokens";
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
  it("does not schedule previews while disabled and re-enables without remounting", () => {
    updateEnhancerPreferences({ hoverPreview: false });
    mount();
    act(() => preview.enter());
    act(() => preview.leave());
    expect(vi.getTimerCount()).toBe(0);
    expect(preview.open).toBe(false);
    act(() => { updateEnhancerPreferences({ hoverPreview: true }); });
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(true);
  });
  it("cancels a pending preview when disabled", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { updateEnhancerPreferences({ hoverPreview: false }); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => { updateEnhancerPreferences({ hoverPreview: true }); });
    expect(preview.open).toBe(false);
  });
  it.each([false, true])("closes an open preview when disabled (maximized: %s)", (maximized) => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    if (maximized) act(() => preview.maximize());
    act(() => { updateEnhancerPreferences({ hoverPreview: false }); });
    expect(preview.open).toBe(false);
    expect(preview.maximized).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { updateEnhancerPreferences({ hoverPreview: true }); });
    expect(preview.open).toBe(false);
  });
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
    expect(PREVIEW_OPEN_MS).toBe(500);
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
  it("pins a maximized preview, cancels pending dismissal, and resets after closing", () => {
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => preview.maximize());
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    expect(preview.maximized).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => preview.close());
    expect(preview.open).toBe(false);
    expect(preview.maximized).toBe(false);
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(PREVIEW_CLOSE_MS); });
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
  it.each(["ios", "android"])("does not open on hover on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    mount();
    act(() => preview.enter());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    expect(preview.open).toBe(false);
  });
  it.each(["ios", "android"])("opens on a long press on %s and stays until closed", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    mount();
    act(() => preview.press!());
    expect(preview.open).toBe(true);
    act(() => preview.leave());
    act(() => { vi.advanceTimersByTime(5000); });
    expect(preview.open).toBe(true);
    act(() => preview.close());
    expect(preview.open).toBe(false);
  });
  it("offers no long press on web, while disabled, or inside another preview owner", () => {
    mount();
    expect(preview.press).toBeUndefined();
    act(() => renderer.unmount());
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mount(false);
    expect(preview.press).toBeUndefined();
    act(() => renderer.unmount());
    mount(true, true);
    expect(preview.press).toBeUndefined();
    act(() => renderer.unmount());
    updateEnhancerPreferences({ hoverPreview: false });
    mount();
    expect(preview.press).toBeUndefined();
  });
  it("closes a long-pressed preview when the row expands", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
    mount();
    act(() => preview.press!());
    act(() => renderer.update(React.createElement(Probe, { enabled: false })));
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

describe("line wrap in the desktop preview", () => {
  const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
    foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
    statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
  let own!: ReturnType<typeof useHoverPreview>;
  function Panel() {
    own = useHoverPreview(true);
    const header = React.createElement(HoverPreviewHeader, { tokens, children: React.createElement("Toolbar") });
    const body = React.createElement(HoverPreviewBody, { children: React.createElement("Text", null, "a long line") });
    return React.createElement(HoverPreview, { preview: { ...own, open: true }, tokens, children: [header, body] });
  }
  const button = () => renderer.root.find((node) => (node.type as unknown) === "Pressable" &&
    ["Do not wrap lines", "Wrap lines"].includes(node.props.accessibilityLabel));
  const icon = () => button().find((node) => (node.type as unknown) === "Icon").props.name;
  const sideways = () => renderer.root.findAll((node) =>
    (node.type as unknown) === "Animated.ScrollView" && node.props.horizontal === true);

  it("wraps by default and scrolls sideways once wrap is turned off, also when maximized", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(Panel)); });
    expect(button().props.accessibilityLabel).toBe("Do not wrap lines");
    expect(icon()).toBe("WrapText");
    expect(sideways()).toHaveLength(0);

    act(() => button().props.onPress());
    expect(button().props.accessibilityLabel).toBe("Wrap lines");
    expect(icon()).toBe("AlignLeft");
    expect(sideways()).toHaveLength(1);

    // Maximize keeps the reader's choice.
    act(() => own.maximize());
    expect(own.maximized).toBe(true);
    expect(icon()).toBe("AlignLeft");
    expect(sideways()).toHaveLength(1);

    act(() => button().props.onPress());
    expect(icon()).toBe("WrapText");
    expect(sideways()).toHaveLength(0);
  });
});
