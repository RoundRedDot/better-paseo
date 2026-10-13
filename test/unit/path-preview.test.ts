import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  return import("./helpers/rn-mock");
});
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async () => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: rn.View,
    copyText: clipboard.copyText,
    useToast: () => ({ show: clipboard.show, error: clipboard.error }),
  };
});
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined }));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: () => ({ hover: true, touch: false, compact: false, native: false }),
}));
const pointer = vi.hoisted(() => ({ enter: null as null | (() => void) }));
vi.mock("../../client/web", () => ({
  bindRowHover: () => () => {},
  bindPreviewMaximize: () => () => {},
  dropSelectionIn: () => {},
  bindPreviewPointer: (_node: unknown, enter: () => void) => {
    pointer.enter = enter;
    return () => {};
  },
  openPreviewLayer: () => () => {},
}));
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { PathText } from "../../client/ui/path-text";
import { PREVIEW_OPEN_MS } from "../../client/ui/hover-preview";
import { resetEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetEnhancerPreferences();
  pointer.enter = null;
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a path's desktop preview", () => {
  it("has the preview toolbar: copy the path, and maximize", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(PathText, { path: "/tmp/project/a.ts", tokens })); });
    act(() => pointer.enter?.());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
    const panel = renderer.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview");
    const button = (label: string) => panel.findAll((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
    expect(panel.findAllByProps({ testID: "hover-preview-header" }).length).toBeGreaterThan(0);
    expect(button("Maximize preview")).toHaveLength(1);

    await act(async () => button("Copy path")[0]!.props.onPress());
    expect(clipboard.copyText).toHaveBeenCalledWith("/tmp/project/a.ts");

    act(() => button("Maximize preview")[0]!.props.onPress());
    expect(button("Close preview")).toHaveLength(1);
    act(() => renderer.unmount());
  });
});
