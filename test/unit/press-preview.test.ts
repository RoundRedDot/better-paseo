import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import "./helpers/quiet-renderer";

// On a phone there is no hover: a long press on a collapsed tool or thought row
// opens the preview the desktop shows on hover, and the preview carries the
// copy actions the long press used to run.

vi.mock("react-native", () => import("./helpers/rn-mock"));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput,
    copyText: clipboard.copyText, useToast: () => ({ show: clipboard.show, error: clipboard.error }), useRevealedText: (text: string) => text };
});
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  useInputCapabilities: () => {
    const os = (globalThis as { __rnMockOS?: string }).__rnMockOS ?? "ios";
    const native = os === "ios" || os === "android";
    return { hover: !native, touch: native, compact: native, native };
  },
}));
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolCallout } from "../../client/components/tool-callouts";
import { ReasoningCard } from "../../client/components/reasoning-trace";
import { createReasoningSegmenter } from "../../client/reasoning/segment";
import { classifyTool } from "../../client/tools/classify";
import { pressPreviewPlacement } from "../../client/ui/press-preview-placement";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

beforeEach(() => {
  vi.clearAllMocks();
  resetEnhancerPreferences();
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "ios";
});
afterEach(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

const shell = classifyTool({ name: "Bash", status: "completed", detail: {
  type: "shell", command: "printf full-command", output: "full-output\n",
} });

function render(element: React.ReactElement) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(element, {
      // Every view sits at the same spot; placement has its own tests.
      createNodeMock: () => ({ measureInWindow: (done: (...box: number[]) => void) => done(0, 300, 390, 28) }),
    });
  });
  return renderer;
}

function row(renderer: ReturnType<typeof TestRenderer.create>): ReactTestInstance {
  return renderer.root.find((node) =>
    (node.type as unknown) === "Pressable" && "aria-expanded" in node.props);
}

const panels = (renderer: ReturnType<typeof TestRenderer.create>) =>
  renderer.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "hover-preview");
const panel = (renderer: ReturnType<typeof TestRenderer.create>) => {
  const [found] = panels(renderer);
  if (!found) throw new Error("no preview panel");
  return found;
};

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

describe("long-pressing a collapsed row on a phone", () => {
  it.each(["ios", "android"])("opens a tool row's preview instead of copying on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    expect(panels(renderer)).toHaveLength(0);
    act(() => row(renderer).props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(textOf(panel(renderer))).toContain("full-output");
    // The row did not open.
    expect(row(renderer).props["aria-expanded"]).toBe(false);
    act(() => renderer.unmount());
  });

  it("copies from the preview's own copy button and closes on a press outside", async () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const copy = panel(renderer).find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Copy command");
    await act(async () => { copy.props.onPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
    const backdrop = renderer.root.find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Close preview");
    act(() => backdrop.props.onPress());
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("closes on Android's back button", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "android";
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    act(() => row(renderer).props.onLongPress());
    const modal = renderer.root.find((node) => (node.type as unknown) === "Modal");
    act(() => modal.props.onRequestClose());
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("opens a thought row's preview", () => {
    const segmentation = createReasoningSegmenter().update("Checking the list of files.", { streaming: false });
    const renderer = render(React.createElement(ReasoningCard, {
      segmentation, streaming: false, durationMs: 1200, expanded: false, onToggle() {},
      tokens, compact: true, storeKey: "thought:press", copyText: "Checking the list of files.",
    }));
    act(() => row(renderer).props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(textOf(panel(renderer))).toContain("Checking the list of files.");
    act(() => renderer.unmount());
  });

  it("opens a Read row's preview from a long press on its path, while a tap still copies the path", async () => {
    const read = classifyTool({ name: "Read", status: "completed", detail: { type: "read", filePath: "/w/a.ts", content: "const value = 1;" } });
    const renderer = render(React.createElement(ToolCallout, { data: read, tokens, compact: true }));
    // The path target fills most of the row, so it is what a finger lands on.
    const path = () => row(renderer).find((node) =>
      (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "/w/a.ts");
    await act(async () => { path().props.onPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("/w/a.ts");
    clipboard.copyText.mockClear();
    act(() => path().props.onLongPress());
    expect(clipboard.copyText).not.toHaveBeenCalled();
    expect(textOf(panel(renderer))).toContain("const value = 1;");
    act(() => renderer.unmount());
  });

  it("still copies from an opened row, which shows no preview", async () => {
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true, expanded: true }));
    await act(async () => { row(renderer).props.onLongPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });

  it("still copies when previews are turned off", async () => {
    updateEnhancerPreferences({ hoverPreview: false });
    const renderer = render(React.createElement(ToolCallout, { data: shell, tokens, compact: true }));
    await act(async () => { row(renderer).props.onLongPress(); });
    expect(clipboard.copyText).toHaveBeenLastCalledWith("printf full-command");
    expect(panels(renderer)).toHaveLength(0);
    act(() => renderer.unmount());
  });
});

describe("where the long-press preview goes", () => {
  const stage = { x: 0, y: 59, width: 390, height: 750 };

  it("opens below a row with room under it, as wide as the row", () => {
    const placement = pressPreviewPlacement({ x: 8, y: 200, width: 374, height: 28 }, stage, null);
    expect(placement).toEqual({ left: 8, width: 374, top: 234, maxHeight: 450, above: false });
  });

  it("caps the panel at the room left below", () => {
    const placement = pressPreviewPlacement({ x: 8, y: 400, width: 374, height: 28 }, stage, null);
    expect(placement.above).toBe(false);
    // 59 + 750 - 8 - (400 + 28 + 6)
    expect(placement.maxHeight).toBe(367);
  });

  it("opens above a row near the bottom and sits on it once measured", () => {
    const row = { x: 8, y: 700, width: 374, height: 28 };
    const unmeasured = pressPreviewPlacement(row, stage, null);
    expect(unmeasured.above).toBe(true);
    expect(unmeasured.maxHeight).toBe(450);
    const measured = pressPreviewPlacement(row, stage, 200);
    expect(measured).toEqual({ left: 8, width: 374, top: 494, maxHeight: 450, above: true });
  });

  it("keeps the panel inside the safe area's sides", () => {
    const placement = pressPreviewPlacement({ x: -8, y: 200, width: 406, height: 28 }, stage, null);
    expect(placement.left).toBe(8);
    expect(placement.width).toBe(374);
  });
});
