import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
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
  watchNextPointerMove: () => () => {},
}));
vi.mock("../../client/components/image-viewer", async () => {
  const { createElement } = await import("react");
  return { ImageViewer: (props: { open: boolean }) => (props.open ? createElement("ImageViewer", props) : null) };
});
import { StyleSheet } from "react-native";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ImagePreview, PREVIEW_MAX_HEIGHT } from "../../client/components/image-preview";
import { ToolCallout } from "../../client/components/tool-callouts";
import { classifyTool } from "../../client/tools/classify";
import { PREVIEW_OPEN_MS } from "../../client/ui/hover-preview";
import { resetEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({
  surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20",
});
const file = {
  dataUri: "data:image/png;base64,AAAA",
  width: 940,
  height: 1542,
  bytes: 210 * 1024,
  error: null,
};

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

function render(element: React.ReactElement) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function flat(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
}

/** The host element above a composite, where the style actually sits. */
function hostParent(node: ReactTestInstance): ReactTestInstance {
  let current = node.parent;
  while (current && typeof current.type === "function") current = current.parent;
  if (!current) throw new Error("no host parent");
  return current;
}

function panelOf(renderer: ReturnType<typeof TestRenderer.create>): ReactTestInstance {
  const found = renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview");
  if (found.length !== 1) throw new Error(`expected one preview panel, found ${found.length}`);
  return found[0]!;
}

function press(renderer: ReturnType<typeof TestRenderer.create> | ReactTestInstance, label: string) {
  const root = "root" in renderer ? renderer.root : renderer;
  const button = root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
  act(() => {
    button.props.onPress();
  });
}

function openPreview() {
  act(() => {
    pointer.enter?.();
  });
  act(() => {
    vi.advanceTimersByTime(PREVIEW_OPEN_MS);
  });
}

/** The picture drawn inside the floating panel, not a glyph or the timeline thumbnail. */
function previewFrame(panel: ReactTestInstance): ReactTestInstance {
  const image = panel.find((node) =>
    (node.type as unknown) === "Image" && node.props.source?.uri === file.dataUri);
  let node: ReactTestInstance | null = image.parent;
  while (node) {
    if ((node.type as unknown) === "View" || (node.type as unknown) === "Pressable") {
      const style = flat(node.props.style);
      if (style.maxHeight !== undefined || style.flexGrow === 1) return node;
    }
    node = node.parent;
  }
  throw new Error("preview image has no frame");
}

describe("a maximized image preview", () => {
  it("keeps the resting panel's picture at the preview cap and opens the viewer from it", () => {
    const renderer = render(React.createElement(ImagePreview, { path: "/tmp/shot.png", file, tokens }));
    openPreview();
    const panel = panelOf(renderer);
    const frame = previewFrame(panel);
    expect(frame.type).toBe("Pressable");
    expect(flat(frame.props.style).maxHeight).toBeCloseTo(PREVIEW_MAX_HEIGHT);
    expect(flat(frame.props.style).flexGrow).toBeUndefined();
    press(panel, "Open the image full screen");
    expect(renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview")).toHaveLength(0);
    expect(renderer.root.findAll((node) => (node.type as unknown) === "ImageViewer")).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it("grows the picture to the panel and opens the viewer from it", () => {
    const renderer = render(React.createElement(ImagePreview, { path: "/tmp/shot.png", file, tokens }));
    openPreview();
    press(renderer, "Maximize preview");

    const panel = panelOf(renderer);
    const frame = previewFrame(panel);
    const image = panel.find((node) =>
      (node.type as unknown) === "Image" && node.props.source?.uri === file.dataUri);
    expect(frame.type).toBe("Pressable");
    expect(frame.props.accessibilityLabel).toBe("Open the image full screen");
    expect(flat(frame.props.style)).toMatchObject({ flexGrow: 1, flexShrink: 1, alignSelf: "stretch", position: "relative" });
    expect(flat(frame.props.style).maxHeight).toBeUndefined();
    expect(flat(image.props.style)).toMatchObject({ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 });
    // The canvas, the card and the scrolling body all pass the panel's height down.
    const canvas = hostParent(frame);
    const card = hostParent(canvas);
    expect(flat(canvas.props.style).flexGrow).toBe(1);
    expect(flat(card.props.style).flexGrow).toBe(1);
    expect(flat(panel.findByProps({ testID: "hover-preview-body" }).props.style).flexGrow).toBe(1);

    press(panel, "Open the image full screen");
    expect(renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview")).toHaveLength(0);
    expect(renderer.root.findAll((node) => (node.type as unknown) === "ImageViewer")).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it("does the same for an image read's floating preview", () => {
    const data = classifyTool({
      name: "Read", status: "completed", detail: { type: "read", filePath: "/tmp/shot.png", content: "" },
    });
    const renderer = render(React.createElement(ToolCallout, { data, tokens, imageFile: file }));
    openPreview();
    press(renderer, "Maximize preview");
    const panel = panelOf(renderer);
    const frame = previewFrame(panel);
    expect(flat(frame.props.style).flexGrow).toBe(1);
    expect(flat(frame.props.style).maxHeight).toBeUndefined();

    press(panel, "Open the image full screen");
    expect(renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview")).toHaveLength(0);
    expect(renderer.root.findAll((node) => (node.type as unknown) === "ImageViewer")).toHaveLength(1);
    act(() => renderer.unmount());
  });
});

/** Every string drawn under a node. */
function textsIn(node: ReactTestInstance): string[] {
  return node.findAll((child) => (child.type as unknown) === "Text")
    .flatMap((child) => React.Children.toArray(child.props.children))
    .filter((child): child is string => typeof child === "string");
}

describe("an image preview's chrome", () => {
  function expectChrome(panel: ReactTestInstance) {
    // The image glyph sits beside its size and weight in the centre.
    const center = panel.findByProps({ testID: "hover-preview-center" });
    const icon = center.findByProps({ testID: "hover-preview-icon" });
    expect(icon.findAll((node) => node.props.name === "Image").length).toBeGreaterThan(0);
    // The size and weight sit in the middle of the toolbar, and only there.
    expect(textsIn(center)).toEqual(["940 × 1542", "210 KB"]);
    expect(center.findAllByProps({ testID: "hover-preview-tool-name" })).toHaveLength(0);
    expect(panel.findByProps({ testID: "hover-preview-start" }).findAllByProps({ testID: "hover-preview-icon" })).toHaveLength(0);
    const body = panel.findByProps({ testID: "hover-preview-body" });
    expect(textsIn(body)).not.toContain("940 × 1542");
    // The path is set on the command band: a fill and a rule at the left.
    const path = body.find((node) => (node.type as unknown) === "Text" && node.props.children === "/tmp/shot.png");
    const band = flat(hostParent(path).props.style);
    expect(band).toMatchObject({ backgroundColor: tokens.v2.surface2, borderLeftWidth: 2, borderLeftColor: tokens.row.meta });
  }

  it("puts the icon and size in the toolbar and the path on the command band", () => {
    const renderer = render(React.createElement(ImagePreview, { path: "/tmp/shot.png", file, tokens }));
    openPreview();
    expectChrome(panelOf(renderer));
    act(() => renderer.unmount());
  });

  it("does the same for an image read's floating preview", () => {
    const data = classifyTool({
      name: "Read", status: "completed", detail: { type: "read", filePath: "/tmp/shot.png", content: "" },
    });
    const renderer = render(React.createElement(ToolCallout, { data, tokens, imageFile: file }));
    openPreview();
    expectChrome(panelOf(renderer));
    act(() => renderer.unmount());
  });

  it("keeps a grouped image's pager at the left and its icon and size centred", () => {
    const calls = ["first", "second"].map((callId) => classifyTool({
      callId, name: "Read", status: "completed", detail: { type: "read", filePath: "/tmp/shot.png", content: "" },
    }));
    const renderer = render(React.createElement(ToolCallout, { data: calls[0]!, groupCalls: calls, tokens, imageFile: file }));
    openPreview();
    const panel = panelOf(renderer);
    expectChrome(panel);
    const start = panel.findByProps({ testID: "hover-preview-start" });
    expect(textsIn(start)).toEqual(["1 / 2"]);
    press(start, "Next operation");
    expect(textsIn(start)).toEqual(["2 / 2"]);
    expectChrome(panel);
    act(() => renderer.unmount());
  });
});
