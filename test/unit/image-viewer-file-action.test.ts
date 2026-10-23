import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

// The viewer's file button does what it says. On a pointer device it opens the
// file in its default app (`file.reveal`, on the daemon's machine); on a
// touch-first device that would open it on the desktop, so the button copies
// the absolute path instead, and is drawn and labelled as a copy.

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
vi.mock("../../client/web", () => ({
  bindRowHover: () => () => {},
  bindPreviewMaximize: () => () => {},
  dropSelectionIn: () => {},
  bindPreviewPointer: () => () => {},
  openPreviewLayer: () => () => {},
  watchNextPointerMove: () => () => {},
}));
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ImageViewer } from "../../client/components/image-viewer";
import { ImagePreview } from "../../client/components/image-preview";
import { ToolCallout } from "../../client/components/tool-callouts";
import { classifyTool } from "../../client/tools/classify";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
});
const PATH = "/tmp/shots/a.png";
const file = { dataUri: "data:image/png;base64,AAAA", width: 40, height: 30, bytes: 1024, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetEnhancerPreferences();
  device.touchFirst = false;
});

function render(element: React.ReactElement) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

/** The viewer's toolbar buttons, by their accessibility labels. */
function viewerButtons(renderer: ReturnType<typeof TestRenderer.create>): string[] {
  const modal = renderer.root.find((node) => (node.type as unknown) === "Modal");
  return modal
    .findAll((node) => (node.type as unknown) === "Pressable" && typeof node.props.accessibilityLabel === "string")
    .map((node) => node.props.accessibilityLabel as string);
}

function viewerButton(renderer: ReturnType<typeof TestRenderer.create>, label: string): ReactTestInstance {
  const modal = renderer.root.find((node) => (node.type as unknown) === "Modal");
  return modal.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
}

/** The icon names drawn inside a node (the host `Icon` is a View with `name`). */
function iconsIn(node: ReactTestInstance): string[] {
  return node
    .findAll((child) => typeof child.type === "string" && typeof child.props.name === "string")
    .map((child) => child.props.name as string);
}

async function press(node: ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
  });
}

function openViewer(renderer: ReturnType<typeof TestRenderer.create>) {
  const thumbnail = renderer.root.find((node) =>
    (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Open the image full screen");
  act(() => thumbnail.props.onPress());
}

describe("the image viewer's file button", () => {
  it("opens the file in its default app on a hover device", async () => {
    const onReveal = vi.fn();
    const renderer = render(React.createElement(ImageViewer, {
      open: true, onClose() {}, uri: file.dataUri, width: 40, height: 30, label: PATH, path: PATH, tokens, onReveal,
    }));
    expect(viewerButtons(renderer)).toContain("Open in default app");
    expect(viewerButtons(renderer)).not.toContain("Copy path");
    const button = viewerButton(renderer, "Open in default app");
    expect(iconsIn(button)).toEqual(["ExternalLink"]);
    await press(button);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(clipboard.copyText).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it("copies the absolute path on a touch-first device, and says so", async () => {
    device.touchFirst = true;
    const onReveal = vi.fn();
    const renderer = render(React.createElement(ImageViewer, {
      open: true, onClose() {}, uri: file.dataUri, width: 40, height: 30, label: PATH, path: PATH, tokens, onReveal,
    }));
    expect(viewerButtons(renderer)).toContain("Copy path");
    expect(viewerButtons(renderer)).not.toContain("Open in default app");
    expect(iconsIn(viewerButton(renderer, "Copy path"))).toEqual(["Copy"]);
    await press(viewerButton(renderer, "Copy path"));
    expect(clipboard.copyText).toHaveBeenCalledWith(PATH);
    expect(clipboard.show).toHaveBeenCalledWith("Copied path");
    expect(onReveal).not.toHaveBeenCalled();
    // The button confirms in place too: the toast may sit under the modal.
    expect(iconsIn(viewerButton(renderer, "Copied"))).toEqual(["Check"]);
    act(() => renderer.unmount());
  });

  it("says the copy in the settings page's language", async () => {
    device.touchFirst = true;
    updateEnhancerPreferences({ language: "zh" });
    const renderer = render(React.createElement(ImageViewer, {
      open: true, onClose() {}, uri: file.dataUri, width: 40, height: 30, label: PATH, path: PATH, tokens,
    }));
    // The button is spoken in Chinese too (image-viewer-labels.test.ts).
    await press(viewerButton(renderer, "复制路径"));
    expect(clipboard.show).toHaveBeenCalledWith("已复制路径");
    act(() => renderer.unmount());
  });

  it("shows no file button without a path on touch or a reveal on hover", () => {
    const renderer = render(React.createElement(ImageViewer, {
      open: true, onClose() {}, uri: file.dataUri, width: 40, height: 30, label: PATH, tokens,
    }));
    expect(viewerButtons(renderer)).toEqual(["Zoom in", "Zoom out", "Reset zoom", "Close the image"]);
    act(() => renderer.unmount());
  });
});

describe("an image's viewer from the timeline", () => {
  // A reply's local image hands the preview a bare `file.reveal`; on touch it
  // must not open the file on the desktop.
  it.each([
    [false, "Open in default app", "ExternalLink"],
    [true, "Copy path", "Copy"],
  ] as const)("in a reply (touch-first %s) draws %s", async (touchFirst, label, icon) => {
    device.touchFirst = touchFirst;
    const onReveal = vi.fn();
    const renderer = render(React.createElement(ImagePreview, { path: PATH, file, tokens, onReveal, bleed: true }));
    openViewer(renderer);
    const button = viewerButton(renderer, label);
    expect(iconsIn(button)).toEqual([icon]);
    await press(button);
    expect(onReveal).toHaveBeenCalledTimes(touchFirst ? 0 : 1);
    expect(clipboard.copyText).toHaveBeenCalledTimes(touchFirst ? 1 : 0);
    if (touchFirst) expect(clipboard.copyText).toHaveBeenCalledWith(PATH);
    act(() => renderer.unmount());
  });

  it.each([
    [false, "Open in default app", "ExternalLink"],
    [true, "Copy path", "Copy"],
  ] as const)("in an image read (touch-first %s) draws %s", async (touchFirst, label, icon) => {
    device.touchFirst = touchFirst;
    const onRevealPath = vi.fn();
    const data = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: PATH, content: "" } });
    const renderer = render(React.createElement(ToolCallout, {
      data, tokens, imageFile: file, defaultExpanded: true, onRevealPath,
    }));
    openViewer(renderer);
    const button = viewerButton(renderer, label);
    expect(iconsIn(button)).toEqual([icon]);
    await press(button);
    if (touchFirst) {
      expect(onRevealPath).not.toHaveBeenCalled();
      expect(clipboard.copyText).toHaveBeenCalledWith(PATH);
      expect(clipboard.show).toHaveBeenCalledWith("Copied path");
    } else {
      expect(onRevealPath).toHaveBeenCalledWith(PATH);
      expect(clipboard.copyText).not.toHaveBeenCalled();
    }
    act(() => renderer.unmount());
  });
});
