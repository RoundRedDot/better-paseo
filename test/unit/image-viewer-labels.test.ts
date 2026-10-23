import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

// The viewer's toolbar speaks in the reader's language, as the block details
// toolbar does, and a pointer resting on a button shows its name, as on every
// other preview toolbar. The buttons themselves look as before.

vi.mock("react-native", async () => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  return import("./helpers/rn-mock");
});
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: rn.View,
    ScrollView: rn.ScrollView,
    TextInput: rn.TextInput,
    copyText: clipboard.copyText,
    useToast: () => ({ show: clipboard.show, error: clipboard.error }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
const device = vi.hoisted(() => ({ touchFirst: false }));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  noteHover() {},
  useInputCapabilities: () => ({
    hover: !device.touchFirst,
    touch: device.touchFirst,
    compact: false,
    native: false,
  }),
}));
const web = vi.hoisted(() => ({ rowHover: [] as Array<[unknown, () => void, () => void]> }));
vi.mock("../../client/web", () => ({
  bindRowHover: (node: unknown, enter: () => void, leave: () => void) => {
    web.rowHover.push([node, enter, leave]);
    return () => {};
  },
  bindPreviewMaximize: () => () => {},
  dropSelectionIn: () => {},
  bindPreviewPointer: () => () => {},
  openPreviewLayer: () => () => {},
  watchNextPointerMove: () => () => {},
  bindDetailsEscape: () => () => {},
  bindTouchDismiss: () => () => {},
  openToolbarDetailsLayer: () => () => {},
  suppressTouchCallout: () => {},
}));
import { StyleSheet } from "react-native";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ImageViewer } from "../../client/components/image-viewer";
import { TOOLBAR_TOOLTIP_MS } from "../../client/ui/toolbar-button";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
});
const PATH = "/tmp/shots/a.png";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetEnhancerPreferences();
  device.touchFirst = false;
  web.rowHover = [];
});
afterEach(() => {
  vi.useRealTimers();
});

function render() {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(React.createElement(ImageViewer, {
      open: true, onClose() {}, uri: "data:image/png;base64,AAAA", width: 40, height: 30,
      label: PATH, path: PATH, tokens, onReveal() {},
    }));
  });
  return renderer;
}

/** The toolbar's buttons, in order. */
function buttons(renderer: ReturnType<typeof TestRenderer.create>): ReactTestInstance[] {
  const modal = renderer.root.find((node) => (node.type as unknown) === "Modal");
  return modal.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button");
}

const labels = (renderer: ReturnType<typeof TestRenderer.create>) =>
  buttons(renderer).map((node) => node.props.accessibilityLabel as string);

/** Strings drawn in a Text anywhere under the modal: the hover names. */
function shownNames(renderer: ReturnType<typeof TestRenderer.create>): string[] {
  const modal = renderer.root.find((node) => (node.type as unknown) === "Modal");
  return modal.findAll((node) => (node.type as unknown) === "Text")
    .flatMap((node) => React.Children.toArray(node.props.children))
    .filter((child): child is string => typeof child === "string");
}

function iconColor(button: ReactTestInstance): string | undefined {
  const icon = button.find((node) => typeof node.type === "string" && typeof node.props.name === "string");
  return icon.props.color as string | undefined;
}

describe("the image viewer's spoken labels", () => {
  it("speaks English with English settings", () => {
    updateEnhancerPreferences({ language: "en" });
    const renderer = render();
    expect(labels(renderer)).toEqual(["Zoom in", "Zoom out", "Reset zoom", "Open in default app", "Close the image"]);
    act(() => renderer.unmount());
  });

  it("speaks Chinese with Chinese settings on a hover device", () => {
    updateEnhancerPreferences({ language: "zh" });
    const renderer = render();
    expect(labels(renderer)).toEqual(["放大", "缩小", "复原缩放", "用默认应用打开", "关闭图片"]);
    act(() => renderer.unmount());
  });

  it("speaks Chinese for the touch copy button and its check", async () => {
    device.touchFirst = true;
    updateEnhancerPreferences({ language: "zh" });
    const renderer = render();
    expect(labels(renderer)).toEqual(["放大", "缩小", "复原缩放", "复制路径", "关闭图片"]);
    await act(async () => {
      buttons(renderer)[3]!.props.onPress();
    });
    expect(clipboard.copyText).toHaveBeenCalledWith(PATH);
    expect(labels(renderer)[3]).toBe("已复制");
    act(() => renderer.unmount());
  });
});

describe("the image viewer's hover names", () => {
  it.each([
    ["en", ["Zoom in", "Zoom out", "Open in default app", "Close the image"]],
    ["zh", ["放大", "缩小", "用默认应用打开", "关闭图片"]],
  ] as const)("names an enabled button after a resting pointer (%s)", (language, names) => {
    updateEnhancerPreferences({ language });
    const renderer = render();
    const enabled = buttons(renderer).filter((node) => !node.props.disabled);
    expect(enabled).toHaveLength(names.length);
    enabled.forEach((button, index) => {
      expect(shownNames(renderer)).toEqual([]);
      act(() => button.props.onHoverIn());
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(shownNames(renderer)).toEqual([names[index]]);
      act(() => button.props.onHoverOut());
    });
    act(() => renderer.unmount());
  });

  it("names the disabled reset button too, through its outer slot", () => {
    updateEnhancerPreferences({ language: "zh" });
    const renderer = render();
    const reset = buttons(renderer)[2]!;
    expect(reset.props.disabled).toBe(true);
    const [, enter] = web.rowHover.at(-1)!;
    act(() => enter());
    act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
    expect(shownNames(renderer)).toEqual(["复原缩放"]);
    act(() => renderer.unmount());
  });

  it("keeps the buttons' look: 24 square on web, surface2, muted icon turning foreground on hover", () => {
    const renderer = render();
    const zoomIn = buttons(renderer)[0]!;
    const style = StyleSheet.flatten(zoomIn.props.style) as Record<string, unknown>;
    expect(style).toMatchObject({ width: 24, height: 24, backgroundColor: tokens.v2.surface2 });
    expect(iconColor(zoomIn)).toBe(tokens.foregroundMuted);
    act(() => zoomIn.props.onHoverIn());
    expect(iconColor(buttons(renderer)[0]!)).toBe(tokens.foreground);
    const reset = StyleSheet.flatten(buttons(renderer)[2]!.props.style) as Record<string, unknown>;
    expect(reset.opacity).toBe(0.5);
    act(() => renderer.unmount());
  });
});
