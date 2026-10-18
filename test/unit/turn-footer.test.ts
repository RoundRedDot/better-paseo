import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../client/ui/use-reduced-motion", () => ({ useReducedMotion: () => motion.reduced }));
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
import { Animated, StatusBar, StyleSheet } from "./helpers/rn-mock";
import { seedMarkBitmaps } from "../../client/components/marks";
import { updateEnhancerPreferences } from "../../client/preferences";
import { TOOLBAR_TOOLTIP_MS } from "../../client/ui/toolbar-button";
import { FLOAT, floatShadow } from "../../client/ui/tokens/float";
import { formatFullStamp } from "../../client/ui/time";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const at = new Date("2026-10-14T14:44:00Z");
const text = "Reply with **Markdown** and a second line.\nFull reply.";
const footer = (compact: boolean) => React.createElement(AssistantFooter, { text, at, tokens, compact });

beforeEach(() => {
  vi.clearAllMocks();
  motion.reduced = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 16));
  seedMarkBitmaps({ "lobe:codex": "data:image/png;base64,codex" });
});
afterEach(() => {
  vi.useRealTimers();
  updateEnhancerPreferences({ language: "system" });
});

describe("assistant footer", () => {
  it.each(["ios", "web"].flatMap((platform) => [0, 82000].flatMap((durationMs) =>
    ["grok", "cursor", "codex"].map((agentName) => ({ platform, durationMs, agentName })))))
  ("hides unreliable Grok and Cursor timing: $platform $agentName $durationMs", ({ platform, agentName, durationMs }) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, agentName, modelName: agentName === "codex" ? "GPT-6.1-Sol" : "Grok 4.7", durationMs,
      startedAt: 1000, usage: { outputTokens: 42 },
    })); });
    try {
      const visible = agentName !== "grok" && agentName !== "cursor";
      expect(renderer.root.findAllByType("Pressable" as never).some((node) =>
        node.props.accessibilityLabel?.startsWith("Elapsed time:"))).toBe(visible);
      const toolbar = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
      act(() => { toolbar.props.onLongPress(); });
      expect(renderer.root.findAllByType("View" as never).some((node) =>
        node.props.testID === "footer-detail-Elapsed time")).toBe(visible);
      for (const label of ["Agent", "Model name", "Start time", "End time", "Output"]) {
        expect(renderer.root.findAllByType("View" as never).some((node) =>
          node.props.testID === `footer-detail-${label}`)).toBe(true);
      }
      const output = renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "footer-detail-Output")!;
      expect(output.findByType("Icon" as never).props.name).toBe("LogOut");
    } finally {
      act(() => renderer.unmount());
      globals.__rnMockOS = previousPlatform;
    }
  });

  it.each(["en", "zh"] as const)("shows recorded token counts and zero, and hides missing values in %s", (language) => {
    updateEnhancerPreferences({ language });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, usage: { inputTokens: 123456, cachedInputTokens: 0 },
    })); });
    try {
      const toolbar = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
      act(() => { toolbar.props.onLongPress(); });
      const rows = ["Input", "Cached"].map((label) =>
        renderer.root.findAllByType("View" as never).find((node) => node.props.testID === `footer-detail-${label}`)!);
      expect(rows.map((row) => row.findAllByType("Text" as never).map((node) => node.props.children))).toEqual(language === "zh"
        ? [["输入", "123,456"], ["缓存", "0"]]
        : [["Input", "123,456"], ["Cached", "0"]]);
      expect(renderer.root.findAllByProps({ testID: "footer-detail-Output" })).toHaveLength(0);
      expect(rows.map((row) => row.findByType("Icon" as never).props.name)).toEqual(["LogIn", "Database"]);
      expect(rows.flatMap((row) => row.findAllByType("Pressable" as never))).toHaveLength(0);
    } finally { act(() => renderer.unmount()); }
  });

  it.each(["ios", "android", "web"].flatMap((platform) =>
    ["toolbar", "reply", "model", "time", "duration"].map((target) => [platform, target] as const)))
  ("opens complete turn details by long-pressing %s %s without copying", (platform, target) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact: true, agentName: "codex", modelId: "gpt-6.1-sol", modelName: "GPT-6.1-Sol", thinkingLabel: "High",
      startedAt: 1000, durationMs: 3000,
    })); });
    try {
      const labels = { toolbar: undefined, reply: "Copy reply", model: "Copy model name",
        time: `Start time ${formatFullStamp(new Date(1000))}`, duration: "Elapsed time: 3秒" };
      const trigger = renderer.root.findAllByType("Pressable" as never).find((node) => target === "toolbar"
        ? node.props.testID === "footer-toolbar" : node.props.accessibilityLabel === labels[target as keyof typeof labels])!;
      act(() => { trigger.props.onLongPress(); });
      expect(clipboard.copyText).not.toHaveBeenCalled();
      const table = renderer.root.findAllByType("View" as never).find((node) => node.props.testID === "footer-details-table")!;
      expect(table.findAllByType("View" as never).filter((node) => node.props.testID?.startsWith("footer-detail-"))).toHaveLength(6);
      const close = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.accessibilityLabel === "Close preview")!;
      act(() => { close.props.onPress(); });
      expect(renderer.root.findAllByType("Modal" as never)).toHaveLength(0);
      if (target === "reply" || target === "model") {
        act(() => { trigger.props.onPress(); });
        expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith(target === "reply" ? text : "gpt-6.1-sol");
      }
    } finally {
      act(() => renderer.unmount());
      globals.__rnMockOS = previousPlatform;
    }
  });

  it("copies each available metadata value, including the full start time, and leaves duration read-only", async () => {
    const startedAt = new Date(2026, 9, 15, 21, 2, 3).getTime();
    updateEnhancerPreferences({ language: "zh" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at: new Date(startedAt + 82000), tokens, agentName: "codex", modelId: "gpt-6.1-sol", modelName: "GPT-6.1-Sol", thinkingLabel: "High",
      startedAt, durationMs: 82000,
    })); });
    try {
      const toolbar = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
      act(() => { toolbar.props.onLongPress(); });
      const table = renderer.root.findAllByType("View" as never).find((node) => node.props.testID === "footer-details-table")!;
      expect(table.findAllByType("Text" as never).map((node) => node.props.children))
        .toEqual(["Agent", "codex", "模型名称", "GPT-6.1-Sol", "思考强度", "High", "开始时间", "2026-10-15 21:02:03",
          "结束时间", "2026-10-15 21:03:25", "耗时", "1分22秒"]);
      const buttons = table.findAllByType("Pressable" as never);
      expect(buttons.map((node) => node.props.accessibilityLabel))
        .toEqual(["Copy agent", "Copy model name", "Copy thinking level", "Copy start time", "Copy end time"]);
      // The model row shows its display label but copies the configured model name.
      const copied = ["codex", "gpt-6.1-sol", "High", "2026-10-15 21:02:03", "2026-10-15 21:03:25"];
      for (const [index, value] of copied.entries()) {
        await act(async () => { buttons[index]!.props.onPress(); });
        expect(clipboard.copyText).toHaveBeenLastCalledWith(value);
        expect(buttons[index]!.findByType("Icon" as never).props.name).toBe("Check");
      }
      const duration = table.findAllByType("View" as never).find((node) => node.props.testID === "footer-detail-Elapsed time")!;
      expect(duration.findAllByType("Pressable" as never)).toHaveLength(0);
      const rows = table.findAllByType("View" as never).filter((node) => node.props.testID?.startsWith("footer-detail-"));
      expect(table.findAllByType(ProviderLogo).map((node) => node.props.provider)).toEqual(["codex", "codex"]);
      expect(table.findAllByType("Icon" as never).map((node) => node.props.name))
        .toEqual(["Check", "Check", "Brain", "Check", "Clock", "Check", "Clock", "Check", "Hourglass"]);
      for (const [index, row] of rows.entries()) {
        const slot = row.findAllByType("View" as never).find((node) => node.props.testID === "footer-value-icon")!;
        const valueCell = row.findAllByType("View" as never)
          .find((node) => StyleSheet.flatten(node.props.style).flex === 1)!;
        expect(valueCell.findAllByType("View" as never)).toContain(slot);
        expect(StyleSheet.flatten(slot.props.style)).toMatchObject({ width: 14, height: 14, flexShrink: 0 });
        const style = StyleSheet.flatten(row.props.style);
        expect(style.backgroundColor).toBe(index % 2 === 0 ? tokens.surface0 : tokens.v2.surface1);
        expect(style.minHeight).toBe(32);
        expect(row.findAllByType("View" as never).some((node) => StyleSheet.flatten(node.props.style).width === 72)).toBe(true);
      }
    } finally { act(() => renderer.unmount()); }
  });

  it("keeps a long model name on one line in the details panel", () => {
    // The panel's value column has to hold the longest names the providers use.
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact: true, modelId: "deepseek-chat", modelName: "DeepSeek V4.1 Flash Free", thinkingLabel: "High",
    })); });
    try {
      const toolbar = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
      act(() => { toolbar.props.onLongPress(); });
      const row = renderer.root.findAllByType("View" as never).find((node) => node.props.testID === "footer-detail-Model name")!;
      const value = row.findAllByType("Text" as never).find((node) => node.props.children === "DeepSeek V4.1 Flash Free")!;
      expect(value.props.numberOfLines).toBe(1);
    } finally { act(() => renderer.unmount()); }
  });

  it("falls back to the model label when the agent has no configured model name", async () => {
    updateEnhancerPreferences({ language: "en" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    try {
      const toolbar = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
      act(() => { toolbar.props.onLongPress(); });
      const table = renderer.root.findAllByType("View" as never).find((node) => node.props.testID === "footer-details-table")!;
      await act(async () => { table.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("Opus 5.5");
    } finally { act(() => renderer.unmount()); }
  });

  it("shows known timing even without a model and does not invent missing start or duration", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, durationMs: 0,
    })); });
    try {
      const toolbar = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
      act(() => { toolbar.props.onLongPress(); });
      const table = renderer.root.findAllByType("View" as never).find((node) => node.props.testID === "footer-details-table")!;
      const rowIds = table.findAllByType("View" as never).map((node) => node.props.testID)
        .filter((id) => id?.startsWith("footer-detail"));
      expect(rowIds).toEqual(["footer-details-table", "footer-detail-End time", "footer-detail-Elapsed time"]);
      expect(rowIds).not.toContain("footer-detail-Start time");
      expect(rowIds).not.toContain("footer-detail-Model name");
      expect(table.findAllByType("Text" as never).map((node) => node.props.children)).toContain("0秒");
    } finally { act(() => renderer.unmount()); }
  });

  it.each(["ios", "android", "web"].flatMap((platform) =>
    [0, 28].map((statusBarHeight) => ({ platform, statusBarHeight }))))
  ("centers long-press details with one safe-area inset on $platform (status bar=$statusBarHeight)", ({ platform, statusBarHeight }) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    const previousStatusBarHeight = StatusBar.currentHeight;
    globals.__rnMockOS = platform;
    StatusBar.currentHeight = statusBarHeight;
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact: true, modelId: "opus", modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    try {
      const trigger = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      act(() => { trigger.props.onLongPress(); });
      const center = renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "footer-details-center")!;
      expect(StyleSheet.flatten(center.props.style)).toMatchObject({ alignItems: "center", justifyContent: "center" });
      const modal = renderer.root.findByType("Modal" as never);
      expect(modal.props.animationType).toBe("none");
      if (platform === "android") {
        // SafeInset owns the status-bar spacing; the native dialog must not add it again.
        expect(modal.props.statusBarTranslucent).toBe(true);
      }
      let safe = center.parent!;
      while (typeof safe.type !== "string") safe = safe.parent!;
      if (platform === "ios") {
        expect(safe.type).toBe("SafeAreaView");
        expect(StyleSheet.flatten(safe.props.style)).not.toHaveProperty("paddingTop");
      } else {
        expect(safe.type).toBe("View");
        expect(StyleSheet.flatten(safe.props.style).paddingTop ?? 0)
          .toBe(platform === "android" ? statusBarHeight : 0);
      }
      const panel = renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "toolbar-details-panel")!;
      expect(StyleSheet.flatten(panel.props.style)).not.toHaveProperty("top");
      expect(StyleSheet.flatten(panel.props.style)).not.toHaveProperty("left");
      expect(clipboard.copyText).not.toHaveBeenCalled();
    } finally {
      act(() => renderer.unmount());
      globals.__rnMockOS = previousPlatform;
      StatusBar.currentHeight = previousStatusBarHeight;
    }
  });

  it.each(["ios", "android", "web"])("reveals model details on long press and copies from the panel on %s", async (platform) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    updateEnhancerPreferences({ language: "zh" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact: true, modelId: "opus", modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    const details = () => renderer.root.findAllByProps({ testID: "footer-details-table" })
      .filter((node) => (node.type as unknown) === "View");
    try {
      expect(details()).toHaveLength(0);
      const trigger = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      expect(trigger.props.onFocus).toBeUndefined();
      act(() => { trigger.props.onLongPress(); });
      expect(clipboard.copyText).not.toHaveBeenCalled();
      expect(details()).toHaveLength(1);
      const title = renderer.root.findAllByType("Text" as never)
        .find((node) => node.props.accessibilityRole === "header")!;
      expect(title.props.children).toBe("轮次详情");
      expect(StyleSheet.flatten(title.props.style).textAlign).toBe("center");
      const bubble = renderer.root.findAllByType("View" as never)
        .map((node) => StyleSheet.flatten(node.props.style))
        .find((style) => style.boxShadow);
      expect(bubble).toMatchObject({ borderRadius: FLOAT.radius, borderWidth: 1,
        backgroundColor: tokens.surface0, borderColor: tokens.v2.border, boxShadow: floatShadow(tokens) });
      expect(renderer.root.findAllByType("Text" as never).map((node) => node.props.children))
        .not.toContain("复制模型名称");
      expect(details()[0]!.findAllByType("Text" as never)
        .map((node) => [node.props.children].flat().join(""))).toEqual(["模型名称", "Opus 5.5", "思考强度", "High",
          "结束时间", formatFullStamp(at)]);
      const copyButton = details()[0]!.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      // Labels stay plain; toolbar icons are rendered in the value column.
      expect(details()[0]!.findAllByType("View" as never)
        .filter((node) => node.props.testID === "footer-value-icon")).toHaveLength(3);
      expect(details()[0]!.findAllByType("View" as never)
        .filter((node) => StyleSheet.flatten(node.props.style).width === 20)).toHaveLength(0);
      const panel = renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "toolbar-details-panel" || StyleSheet.flatten(node.props.style).boxShadow)!;
      expect(StyleSheet.flatten(panel.props.style).width).toBe(324);
      await act(async () => { copyButton.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("opus");
      expect(clipboard.show).toHaveBeenCalledExactlyOnceWith("已复制模型名称");
      expect(copyButton.props.accessibilityLabel).toBe("Copied");
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
      text, at, tokens, modelId: "opus", modelName: "Opus 5.5", thinkingLabel: "High",
    })); });
    const details = () => renderer.root.findAllByProps({ testID: "footer-details-table" })
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
      await act(async () => { details()[0]!.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("opus");
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

  it.each(([
    ["web", "en", "Elapsed time: 3 min 56 s"],
    ["web", "zh", "耗时： 3 分 56 秒"],
    ["ios", "en", "Elapsed time: 3 min 56 s"],
    ["ios", "zh", "耗时： 3 分 56 秒"],
  ] as const).flatMap(([platform, language, durationHint]) =>
    [null, new Date(2026, 9, 14, 17, 50, 13).getTime(), 0].map((startedAt) =>
      ({ platform, language, durationHint, startedAt }))))(
    "shows passive metadata hints on $platform in $language (startedAt=$startedAt)", ({ platform, language, durationHint, startedAt }) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 15, 16));
    updateEnhancerPreferences({ language });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at: new Date(2026, 9, 15, 15, 5, 3), tokens, thinkingLabel: "High", durationMs: 236000, startedAt,
    })); });
    const labels = () => renderer.root.findAllByType("Text" as never).map((node) => node.props.children);
    try {
      const metadata = renderer.root.findAllByType("Pressable" as never).filter((node) => node.props.accessibilityRole === "image");
      expect(metadata).toHaveLength(2);
      expect(labels()).toEqual(["Copy", "15:05", "3分56秒"]);
      const timeLabel = startedAt != null ? (language === "zh" ? "开始时间" : "Start time")
        : (language === "zh" ? "结束时间" : "End time");
      const timeStamp = startedAt != null ? formatFullStamp(new Date(startedAt)) : "2026-10-15 15:05:03";
      for (const [index, hint] of [`${timeLabel} ${timeStamp}`, durationHint].entries()) {
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
      text, at, tokens, modelId: "opus", modelName: "Opus 5.5", thinkingLabel: "High",
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
      expect(labels()).not.toContain(modelHint);
      await act(async () => { buttons[1]!.props.onPress(); });
      expect(renderer.root.findAllByType("Pressable" as never)
        .filter((node) => node.props.accessibilityLabel === "Model name copied")).toHaveLength(1);
      expect(clipboard.copyText).toHaveBeenLastCalledWith("opus");
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
      agentName: "codex", modelId: "gpt-6.1-sol", modelName: "GPT-6.1-Sol", thinkingLabel: "Medium", durationMs: 138000,
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
  it.each([false, true])("copies the raw model name independently of the reply (compact=%s)", async (compact) => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    updateEnhancerPreferences({ language: "zh" });
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact, agentName: "codex", modelId: "gpt-6.1-sol", modelName: "GPT-6.1-Sol", thinkingLabel: "Medium",
    })); });
    try {
      const button = renderer.root.findByProps({ accessibilityLabel: "Copy model name" });
      const labelsBeforeCopy = renderer.root.findAllByType("Text" as never).map((node) => node.props.children);
      expect(button.props.hitSlop).toBe(compact ? 10 : 0);
      await act(async () => { button.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("gpt-6.1-sol");
      expect(clipboard.show).toHaveBeenCalledExactlyOnceWith("已复制模型名称");
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
      text, at, tokens, modelId: "gpt-6.1-sol", modelName: "GPT-6.1-Sol",
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
      const container = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
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
      const container = renderer.root.findAllByType("Pressable" as never).find((node) => node.props.testID === "footer-toolbar")!;
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

describe("assistant footer details motion", () => {
  it.each([
    { platform: "ios", entry: "longPress" },
    { platform: "android", entry: "longPress" },
    { platform: "web", entry: "longPress" },
    { platform: "web", entry: "hover" },
  ].flatMap((scenario) => [false, true].map((reduced) => ({ ...scenario, reduced }))))
  ("gently reveals details on $platform $entry and respects reduced motion ($reduced)", ({ platform, entry, reduced }) => {
    const globals = globalThis as { __rnMockOS?: string };
    const previousPlatform = globals.__rnMockOS;
    globals.__rnMockOS = platform;
    motion.reduced = reduced;
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const timing = vi.spyOn(Animated, "timing");
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, modelId: "opus", modelName: "Opus 5.5",
    })); });
    try {
      const trigger = renderer.root.findAllByType("Pressable" as never)
        .find((node) => node.props.accessibilityLabel === "Copy model name")!;
      expect(timing).not.toHaveBeenCalled();
      const open = () => {
        const previousAnimations = timing.mock.calls.length;
        if (entry === "hover") {
          act(() => { trigger.props.onHoverIn(); });
          act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
        } else {
          act(() => { trigger.props.onLongPress(); });
          expect(StyleSheet.flatten(renderer.root.findByType("Animated.View" as never).props.style).opacity).toBe(0);
          const modal = renderer.root.findByType("Modal" as never);
          const panel = renderer.root.findAllByType("View" as never)
            .find((node) => node.props.testID === "toolbar-details-panel")!;
          act(() => { panel.props.onLayout({ nativeEvent: { layout: { width: 294, height: 180 } } }); });
          if (platform !== "web") expect(timing).toHaveBeenCalledTimes(previousAnimations);
          act(() => { modal.props.onShow(); });
        }
      };
      open();
      const animated = renderer.root.findByType("Animated.View" as never);
      expect(animated.findAllByType("View" as never)
        .filter((node) => node.props.testID === "toolbar-details-frame")).toHaveLength(1);
      const opacity = StyleSheet.flatten(animated.props.style).opacity;
      expect(opacity).toMatchObject({ __value: reduced ? 1 : 0 });
      if (reduced) {
        expect(timing).not.toHaveBeenCalled();
        expect(StyleSheet.flatten(animated.props.style).transform).toEqual([{ translateY: 0 }]);
      } else {
        expect(timing).toHaveBeenCalledExactlyOnceWith(opacity, expect.objectContaining({
          toValue: 1, duration: 140, useNativeDriver: platform !== "web",
        }));
        const interpolate = vi.spyOn(opacity as InstanceType<typeof Animated.Value>, "interpolate");
        act(() => { renderer.update(React.createElement(AssistantFooter, {
          text, at, tokens, modelId: "opus", modelName: "Opus 5.5", durationMs: 1000,
        })); });
        expect(interpolate).not.toHaveBeenCalled();
        // Updating the details must not replay their entrance.
        expect(timing).toHaveBeenCalledTimes(1);
        interpolate.mockRestore();
      }
      if (entry === "hover") {
        act(() => { trigger.props.onHoverOut(); });
        act(() => { vi.advanceTimersByTime(120); });
      } else {
        act(() => { renderer.root.findAllByType("Pressable" as never)
          .find((node) => node.props.accessibilityLabel === "Close preview")!.props.onPress(); });
      }
      expect(renderer.root.findAllByType("Animated.View" as never)).toHaveLength(0);
      open();
      expect(renderer.root.findAllByType("Animated.View" as never)).toHaveLength(1);
      expect(timing).toHaveBeenCalledTimes(reduced ? 0 : 2);
    } finally {
      act(() => renderer.unmount());
      timing.mockRestore();
      globals.__rnMockOS = previousPlatform;
      motion.reduced = false;
    }
  });
});
