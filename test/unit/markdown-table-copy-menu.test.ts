/**
 * The table's copy control on a desktop pointer: hovering widens its circle
 * to the right into a capsule of "Copy as Markdown" and "Copy as image". Touch and native keep the
 * single button (`markdown-table-copy.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";

const { copyText, toastShow, toastError, copyElementImage, capabilities } = vi.hoisted(() => ({
  copyText: vi.fn(async (_text: string) => {}),
  toastShow: vi.fn(),
  toastError: vi.fn(),
  copyElementImage: vi.fn(async (_element: unknown, _options: { background: string }) => {}),
  capabilities: { hover: true, touch: false },
}));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Modal: rn.View,
    copyText,
    useToast: () => ({ show: toastShow, error: toastError, success() {} }),
    useRevealedText: (text: string) => text,
  };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null),
  usePaseo: () => ({}),
  useSettings: () => ({ data: undefined, status: "loading" }),
}));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  noteHover() {},
  useInputCapabilities: () => ({ ...capabilities, compact: false, native: false }),
}));
vi.mock("../../client/ui/element-image", () => ({ canCopyImage: () => true, copyElementImage }));

await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { buildThemeTokens } = await import("../../client/components/theme-tokens");
const { MarkdownView } = await import("../../client/components/markdown/markdown-view");
const { getEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const { StyleSheet } = await import("./helpers/rn-mock");
const { duration } = await import("../../client/ui/tokens/motion");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockOS = globalThis as { __rnMockOS?: string };

const tokens = buildThemeTokens({
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ececee", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0",
  accentForeground: "#ffffff", statusSuccess: "#1f8a5b", statusWarning: "#a36a00",
  statusDanger: "#d23c3c",
});
const SOURCE = "| A | B |\n| --- | --- |\n| one | two |";
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let previousLanguage = getEnhancerPreferences().language;

function render(text = SOURCE) {
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(MarkdownView, { text, tokens, variant: "document" }),
      { createNodeMock: (element) => domNode((element.props as { style?: unknown }).style) },
    );
  });
  return renderer!;
}

/** Enough of a DOM element for the hover binding, tagged with its host's style. */
function domNode(style: unknown) {
  const events = { addEventListener() {}, removeEventListener() {} };
  return { mock: style, ...events, ownerDocument: { ...events, defaultView: events } };
}

function entries() {
  return renderer!.root.findAll((node) => String(node.type) === "Pressable"
    && typeof node.props.accessibilityLabel === "string"
    && /^(Copy|Copied)/.test(node.props.accessibilityLabel));
}

/** The entries a pointer or keyboard can reach: the rest sit clipped inside the closed circle. */
function reachable() {
  return entries().filter((node) => !node.props["aria-hidden"]).map((node) => node.props.accessibilityLabel);
}

function entry(label: string) {
  return entries().find((node) => node.props.accessibilityLabel === label)!;
}

beforeEach(() => {
  mockOS.__rnMockOS = "web";
  capabilities.hover = true;
  previousLanguage = getEnhancerPreferences().language;
  updateEnhancerPreferences({ language: "zh" });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  delete mockOS.__rnMockOS;
  act(() => { updateEnhancerPreferences({ language: previousLanguage }); });
  copyText.mockClear();
  toastShow.mockClear();
  toastError.mockClear();
  copyElementImage.mockReset();
});

describe("Markdown table copy menu", () => {
  it("is a circle until hovered, then widens into a capsule of two named entries", () => {
    render();
    const frame = () => renderer!.root.findAll((node) => String(node.type) === "View"
      && StyleSheet.flatten(node.props.style).overflow === "hidden"
      && node.findAll((child) => child.props.accessibilityLabel === "Copy as image").length > 0)[0]!;
    const row = () => frame().findAll((node) => typeof node.props.onLayout === "function")[0]!;
    const names = () => entries().map((node) => {
      const text = node.findAll((child) => String(child.type) === "Text")[0]!;
      return [text.children.join(""), StyleSheet.flatten(text.props.style).opacity];
    });
    expect(StyleSheet.flatten(frame().props.style)).toMatchObject({
      width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: tokens.v2.border,
      transitionDuration: `${duration.menu}ms`,
    });
    expect(reachable()).toEqual(["Copy as Markdown"]);
    expect(names()).toEqual([["复制为 Markdown", 0], ["复制为图片", 0]]);

    act(() => { row().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 207.4, height: 22 } } }); });
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    expect(StyleSheet.flatten(frame().props.style)).toMatchObject({
      width: 210, borderRadius: 12, borderColor: tokens.foregroundMuted,
    });
    expect(reachable()).toEqual(["Copy as Markdown", "Copy as image"]);
    expect(names()).toEqual([["复制为 Markdown", 1], ["复制为图片", 1]]);
  });

  it("drops the transition under reduced motion", async () => {
    const { AccessibilityInfo } = await import("./helpers/rn-mock");
    const spy = vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    try {
      await act(async () => { render(); });
      const durations = renderer!.root.findAll((node) => String(node.type) === "View"
        && StyleSheet.flatten(node.props.style).transitionDuration !== undefined)
        .map((node) => StyleSheet.flatten(node.props.style).transitionDuration);
      expect(durations.length).toBeGreaterThan(0);
      expect(new Set(durations)).toEqual(new Set(["0ms"]));
    } finally {
      spy.mockRestore();
    }
  });

  it("copies the table's Markdown source", async () => {
    render();
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    await act(async () => { entry("Copy as Markdown").props.onPress(); });
    expect(copyText).toHaveBeenCalledExactlyOnceWith(SOURCE);
    expect(toastShow).toHaveBeenCalledExactlyOnceWith("已复制为 Markdown");
    expect(entries().map((node) => node.props.accessibilityLabel)).toEqual(["Copied", "Copy as image"]);
  });

  it("copies a picture of the table frame on the chat surface", async () => {
    render();
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    await act(async () => { entry("Copy as image").props.onPress(); });
    expect(copyText).not.toHaveBeenCalled();
    expect(copyElementImage).toHaveBeenCalledTimes(1);
    const [element, options] = copyElementImage.mock.calls[0]!;
    // The frame alone: the copy control at its corner stays out of the picture.
    const frame = renderer!.root.findAll((node) => String(node.type) === "View"
      && node.props.style === (element as { mock: unknown }).mock);
    expect(frame).toHaveLength(1);
    expect(frame[0]!.findAll((node) => node.props.accessibilityLabel === "Copy as image")).toHaveLength(0);
    expect(frame[0]!.findAll((node) => String(node.type) === "Text" && node.children[0] === "one")).toHaveLength(1);
    expect(options).toEqual({ background: tokens.surface0 });
    expect(toastShow).toHaveBeenCalledExactlyOnceWith("已复制为图片");
    expect(entries().map((node) => node.props.accessibilityLabel)).toEqual(["Copy as Markdown", "Copied"]);
  });

  it("reports a failed image copy and never shows the check", async () => {
    copyElementImage.mockRejectedValueOnce(new Error("denied"));
    render();
    act(() => { entry("Copy as Markdown").props.onHoverIn(); });
    await act(async () => { entry("Copy as image").props.onPress(); });
    expect(toastShow).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledExactlyOnceWith("复制失败");
    expect(entry("Copy as image")).toBeDefined();
  });

  it.each([
    ["a touch-only web reader", () => { capabilities.hover = false; }],
    ["native", () => { mockOS.__rnMockOS = "ios"; }],
  ])("keeps the single Markdown button for %s", (_name, setup) => {
    setup();
    render();
    expect(entries().map((node) => node.props.accessibilityLabel)).toEqual(["Copy Markdown table"]);
  });
});
