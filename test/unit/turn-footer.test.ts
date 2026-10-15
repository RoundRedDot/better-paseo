import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const clipboard = vi.hoisted(() => ({ copyText: vi.fn(async (_text: string) => {}), show: vi.fn(), error: vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
  copyText: clipboard.copyText,
  useToast: () => ({ show: clipboard.show, error: clipboard.error }),
}));
vi.mock("../../client/ui/disclosure-header", () => ({ DISCLOSURE_HEADER: { icon: 14 } }));

import { AssistantFooter } from "../../client/components/turn-footer";
import { ProviderLogo } from "../../client/components/provider-logo";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { StyleSheet } from "./helpers/rn-mock";
import { seedMarkBitmaps } from "../../client/components/marks";
import { updateEnhancerPreferences } from "../../client/preferences";
import { TOOLBAR_TOOLTIP_MS } from "../../client/ui/toolbar-button";
import { FLOAT, floatShadow } from "../../client/ui/tokens/float";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const at = new Date("2026-10-14T14:44:00Z");
const text = "Reply with **Markdown** and a second line.\nFull reply.";
const footer = (compact: boolean) => React.createElement(AssistantFooter, { text, at, tokens, compact });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 16));
  seedMarkBitmaps({ "lobe:codex": "data:image/png;base64,codex" });
});
afterEach(() => {
  vi.useRealTimers();
  updateEnhancerPreferences({ language: "system" });
});

describe("assistant footer", () => {
  it.each(["ios", "android"])("anchors the long-press panel to the model on %s", (platform) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    let anchor = { x: 60, y: 600, width: 160, height: 24 };
    const stage = { x: 0, y: 44, width: 390, height: 760 };
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact: true, modelName: "Opus 5.5", thinkingLabel: "High",
    }), { createNodeMock: (element) => ({
      measureInWindow(callback: (x: number, y: number, width: number, height: number) => void) {
        const box = (element.props as { testID?: string }).testID === "toolbar-details-stage" ? stage : anchor;
        callback(box.x, box.y, box.width, box.height);
      },
    }) }); });
    try {
      const trigger = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      act(() => { trigger.props.onLongPress(); });
      const panel = renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "toolbar-details-panel")!;
      expect(StyleSheet.flatten(panel.props.style).opacity).toBe(0);
      act(() => { renderer.root.findByType("Modal" as never).props.onShow(); });
      act(() => { panel.props.onLayout({ nativeEvent: { layout: { width: 240, height: 90 } } }); });
      expect(StyleSheet.flatten(panel.props.style)).toMatchObject({ left: 60, top: 462, opacity: 1 });
      anchor = { x: 330, y: 60, width: 40, height: 24 };
      const stageView = renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "toolbar-details-stage")!;
      act(() => { stageView.props.onLayout(); });
      expect(StyleSheet.flatten(panel.props.style)).toMatchObject({ left: 142, top: 44 });
      expect(clipboard.copyText).not.toHaveBeenCalled();
    } finally {
      act(() => renderer.unmount());
      globals.__rnMockOS = previousPlatform;
    }
  });

  it.each(["ios", "android", "web"])("reveals model details on long press and copies from the panel on %s", async (platform) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    updateEnhancerPreferences({ language: "zh" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact: true, modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    const details = () => renderer.root.findAllByProps({ testID: "footer-model-details" })
      .filter((node) => (node.type as unknown) === "View");
    try {
      expect(details()).toHaveLength(0);
      const trigger = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      expect(trigger.props.onFocus).toBeUndefined();
      act(() => { trigger.props.onLongPress(); });
      expect(clipboard.copyText).not.toHaveBeenCalled();
      expect(details()).toHaveLength(1);
      const bubble = renderer.root.findAllByType("View" as never)
        .map((node) => StyleSheet.flatten(node.props.style))
        .find((style) => style.boxShadow);
      expect(bubble).toMatchObject({ borderRadius: FLOAT.radius, borderWidth: 1,
        backgroundColor: tokens.surface0, borderColor: tokens.v2.border, boxShadow: floatShadow(tokens) });
      expect(details()[0]!.findAllByType("Text" as never)
        .map((node) => [node.props.children].flat().join(""))).toEqual(["Opus 5.5", "思考强度: High"]);
      const copyButton = details()[0]!.findByType("Pressable" as never);
      await act(async () => { copyButton.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("Opus 5.5");
      expect(copyButton.props.accessibilityLabel).toBe("Model name copied");
      if (platform !== "web") {
        const modal = renderer.root.findByType("Modal" as never);
        act(() => { modal.props.onRequestClose(); });
        expect(details()).toHaveLength(0);
        act(() => { trigger.props.onLongPress(); });
        const close = renderer.root.findAllByType("Pressable" as never)
          .find((node) => node.props.accessibilityLabel === "Close preview")!;
        act(() => { close.props.onPress(); });
        expect(details()).toHaveLength(0);
      }
    } finally {
      act(() => renderer.unmount());
      globals.__rnMockOS = previousPlatform;
    }
  });

  it("keeps hover details clickable while crossing from the model and closes after leaving", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    const details = () => renderer.root.findAllByProps({ testID: "footer-model-details" })
      .filter((node) => (node.type as unknown) === "View");
    try {
      const trigger = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      act(() => { trigger.props.onHoverIn(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS - 1); });
      expect(details()).toHaveLength(0);
      act(() => { vi.advanceTimersByTime(1); });
      expect(details()).toHaveLength(1);
      act(() => { trigger.props.onHoverOut(); });
      act(() => { vi.advanceTimersByTime(60); });
      const panel = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessible === false && node.props.onHoverIn)!;
      act(() => { panel.props.onHoverIn(); });
      act(() => { vi.advanceTimersByTime(500); });
      expect(details()).toHaveLength(1);
      await act(async () => { details()[0]!.findByType("Pressable" as never).props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("Opus 5.5");
      act(() => { panel.props.onHoverOut(); });
      act(() => { vi.advanceTimersByTime(120); });
      expect(details()).toHaveLength(0);
      act(() => { trigger.props.onHoverIn(); });
      act(() => { vi.advanceTimersByTime(100); trigger.props.onHoverOut(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(details()).toHaveLength(0);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    ["web", "en", "Elapsed time"],
    ["web", "zh", "耗时"],
    ["ios", "en", "Elapsed time"],
    ["ios", "zh", "耗时"],
  ] as const)("shows passive metadata hints on %s in %s with a full timestamp", (platform, language, durationHint) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 15, 16));
    updateEnhancerPreferences({ language });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at: new Date(2026, 9, 15, 15, 5, 3), tokens, thinkingLabel: "High", durationMs: 16000,
    })); });
    const labels = () => renderer.root.findAllByType("Text" as never).map((node) => node.props.children);
    try {
      const metadata = renderer.root.findAllByType("Pressable" as never).filter((node) => node.props.accessibilityRole === "image");
      expect(metadata).toHaveLength(2);
      expect(labels()).toEqual(["Copy", "15:05", "16秒"]);
      for (const [index, hint] of ["2026-10-15 15:05:03", durationHint].entries()) {
        const item = metadata[index]!;
        expect(item.props.onPress).toBeUndefined();
        expect(item.props.focusable).toBe(false);
        expect(StyleSheet.flatten(item.props.style).cursor).toBeUndefined();
        act(() => { item.props.onHoverIn(); });
        act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS - 1); });
        expect(labels()).not.toContain(hint);
        act(() => { vi.advanceTimersByTime(1); });
        expect(labels()).toContain(hint);
        act(() => { item.props.onHoverOut(); });
        expect(labels()).not.toContain(hint);
      }
      expect(clipboard.copyText).not.toHaveBeenCalled();
    } finally {
      act(() => renderer.unmount());
      globals.__rnMockOS = previousPlatform;
    }
  });

  it.each([
    ["en", "Copy reply", "Copy model name", "Copied"],
    ["zh", "复制回复", "复制模型名称", "已复制"],
  ] as const)("shows delayed copy hints in %s and clears them on exit", async (language, replyHint, modelHint, copiedHint) => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    updateEnhancerPreferences({ language });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    const labels = () => renderer.root.findAllByType("Text" as never).map((node) => node.props.children);
    try {
      const buttons = renderer.root.findAllByType("Pressable" as never).filter((node) => node.props.accessibilityRole === "button");
      expect(buttons).toHaveLength(2);
      expect(labels()).not.toContain(replyHint);
      act(() => { buttons[0]!.props.onHoverIn(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS - 1); });
      expect(labels()).not.toContain(replyHint);
      act(() => { vi.advanceTimersByTime(1); });
      expect(labels()).toContain(replyHint);
      await act(async () => { buttons[0]!.props.onPress(); });
      expect(labels()).toContain(copiedHint);
      act(() => { buttons[0]!.props.onHoverOut(); });
      expect(labels()).not.toContain(copiedHint);
      act(() => { buttons[1]!.props.onHoverIn(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(labels()).toContain(modelHint);
      await act(async () => { buttons[1]!.props.onPress(); });
      expect(labels()).toContain(copiedHint);
      expect(clipboard.copyText).toHaveBeenLastCalledWith("Opus 5.5");
      act(() => { buttons[1]!.props.onHoverOut(); });
      act(() => { vi.advanceTimersByTime(120); });
      expect(labels()).not.toContain(copiedHint);
      act(() => { buttons[1]!.props.onHoverIn(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS - 1); });
      act(() => { buttons[1]!.props.onHoverOut(); });
      act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
      expect(labels()).not.toContain(copiedHint);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([
    { agentName: "cursor", label: "Cursor", mark: "provider:cursor" },
    { agentName: "grok", label: "Grok", mark: "lobe:grok" },
    { agentName: "opencode", label: "OpenCode", mark: "lobe:opencode" },
  ])("shows the $label provider mark when serving a Grok model", ({ agentName, label, mark }) => {
    const uri = `data:image/png;base64,${agentName}`;
    seedMarkBitmaps({ [mark]: uri });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, agentName, modelName: "Grok 4.7",
    })); });
    try {
      const image = renderer.root.findByType("Image" as never);
      expect(image.props.accessibilityLabel).toBe(label);
      expect(image.props.source.uri).toBe(uri);
      expect(StyleSheet.flatten(image.props.style).tintColor).toBe(tokens.foregroundMuted);
    } finally {
      act(() => renderer.unmount());
    }
  });
  it("shows agent, model, today's time and duration after Copy in order", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at: new Date(2026, 9, 15, 15, 5, 3), tokens,
      agentName: "codex", modelName: "GPT-6.1-Sol", thinkingLabel: "Medium", durationMs: 138000,
    })); });
    try {
      const labels = renderer.root.findAllByType("Text" as never)
        .map((node) => [node.props.children].flat().join(""));
      expect(labels).toEqual(["Copy", "GPT-6.1-Sol", "15:05", "2分18秒"]);
      expect(renderer.root.findAllByType("Icon" as never).map((node) => node.props.name))
        .toEqual(["Copy", "Clock", "Hourglass"]);
      const image = renderer.root.findByType("Image" as never);
      expect(image.props.accessibilityLabel).toBe("Codex");
      expect(StyleSheet.flatten(image.props.style).tintColor).toBe(tokens.foregroundMuted);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("omits unavailable metadata and retains a measured zero duration", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(footer(false)); });
    try {
      expect(renderer.root.findAllByType("Text" as never)).toHaveLength(2);
      act(() => { renderer.update(React.createElement(AssistantFooter, { text, at, tokens, durationMs: 0 })); });
      expect(renderer.root.findAllByType("Text" as never).at(-1)!.props.children).toBe("0秒");
    } finally {
      act(() => renderer.unmount());
    }
  });
  it.each([false, true])("copies the displayed model name independently of the reply (compact=%s)", async (compact) => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    updateEnhancerPreferences({ language: "zh" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact, agentName: "codex", modelName: "GPT-6.1-Sol", thinkingLabel: "Medium",
    })); });
    try {
      const button = renderer.root.findByProps({ accessibilityLabel: "Copy model name" });
      const labelsBeforeCopy = renderer.root.findAllByType("Text" as never).map((node) => node.props.children);
      expect(button.props.hitSlop).toBe(compact ? 10 : 0);
      await act(async () => { button.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("GPT-6.1-Sol");
      expect(clipboard.show).toHaveBeenCalledExactlyOnceWith("已复制模型名称：GPT-6.1-Sol");
      expect(renderer.root.findByProps({ accessibilityLabel: "Model name copied" })).toBeDefined();
      expect(button.findAllByType("Image" as never)).toHaveLength(0);
      expect(button.findByType("Icon" as never).props).toMatchObject({ name: "Check", size: 14, color: tokens.success });
      expect(renderer.root.findAllByType("Text" as never).map((node) => node.props.children))
        .toEqual(labelsBeforeCopy);
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Copy reply" }).props.onPress(); });
      expect(clipboard.copyText).toHaveBeenLastCalledWith(text);
      await act(async () => { vi.advanceTimersByTime(1200); });
      expect(button.findByType(ProviderLogo).props.provider).toBe("codex");
      expect(button.findAllByType("Icon" as never)).toHaveLength(0);
      expect(button.findByType("Text" as never).props.children).toBe("GPT-6.1-Sol");
    } finally {
      act(() => renderer.unmount());
    }
  });

  it("reports a failed model copy without showing success", async () => {
    clipboard.copyText.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, modelName: "GPT-6.1-Sol",
    })); });
    try {
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Copy model name" }).props.onPress(); });
      expect(clipboard.error).toHaveBeenCalledOnce();
      expect(clipboard.show).not.toHaveBeenCalled();
      expect(renderer.root.findAllByProps({ accessibilityLabel: "Model name copied" })).toHaveLength(0);
    } finally {
      act(() => renderer.unmount());
    }
  });
  it("leaves 16pt below the compact Copy row, beyond its touch extension", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(footer(true)); });
    try {
      const container = renderer.root.findAllByType("View" as never)[0]!;
      const button = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityRole === "button")!;
      const style = StyleSheet.flatten(container.props.style);
      expect(style.minHeight).toBe(24);
      expect(style.flexWrap).toBe("wrap");
      expect(style.gap).toBe(8);
      expect(style.marginBottom).toBe(16);
      expect(button.props.hitSlop).toBe(10);
      expect(style.marginBottom).toBeGreaterThan(button.props.hitSlop);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([false, true])("keeps 16pt below Copy across layout changes (compact=%s)", (compact) => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(footer(compact)); });
    try {
      const container = renderer.root.findAllByType("View" as never)[0]!;
      expect(StyleSheet.flatten(container.props.style).marginBottom).toBe(16);
      expect(renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityRole === "button")!.props.hitSlop).toBe(compact ? 10 : 0);
      act(() => renderer.update(footer(!compact)));
      expect(StyleSheet.flatten(container.props.style).marginBottom).toBe(16);
      expect(renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityRole === "button")!.props.hitSlop).toBe(compact ? 0 : 10);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([false, true])("copies the full reply and confirms success (compact=%s)", async (compact) => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(footer(compact)); });
    try {
      await act(async () => { renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityRole === "button")!.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith(text);
      expect(renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityRole === "button")!.props.accessibilityLabel).toBe("Reply copied");
      const button = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityRole === "button")!;
      expect(button.findByType("Icon" as never).props.name).toBe("Check");
      expect(button.findByType("Text" as never).props.children).toBe("Copy");
    } finally {
      act(() => renderer.unmount());
    }
  });
});
