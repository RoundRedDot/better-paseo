import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

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
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { ToolPreviewContent } from "../../client/components/tool-callouts";
import { HoverPreviewHeader, PreviewPanelSample } from "../../client/ui/hover-preview";
import { ToolbarButton } from "../../client/ui/toolbar-button";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { classifyTool } from "../../client/tools/classify";
import { resetEnhancerPreferences } from "../../client/preferences";
import { PreviewLines } from "../../client/ui/preview-lines";

import { StyleSheet } from "react-native";
import { Dimensions } from "./helpers/rn-mock";
import { seedMarkBitmaps } from "../../client/components/marks";
import * as input from "../../client/ui/use-input-capabilities";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

const agentId = "db43c484-e0ea-4ae2-94f9-6f5261234567";
const prompt = "# Review\n\n**Read only**\n\n" + Array.from({ length: 80 }, (_, i) => `Line ${i}`).join("\n");
function agentView(theme = tokens, title = "Review") {
  const data = classifyTool({ callId: "create", name: "paseo.create_agent", status: "completed", detail: {
    type: "unknown", input: { title, provider: "cursor/grok-4.7", initialPrompt: prompt }, output: agentId,
  } });
  return React.createElement(PreviewPanelSample, { tokens: theme,
    children: React.createElement(ToolPreviewContent, { data, tokens: theme, compact: false, resolvePath: (path) => path }),
  });
}
let renderer: ReturnType<typeof TestRenderer.create> | undefined;
function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "children" in value) return textOf(value.children);
  return "";
}
async function press(label: string) {
  const button = renderer!.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);
  await act(async () => button.props.onPress());
}
beforeEach(() => {
  vi.clearAllMocks();
  seedMarkBitmaps({ "provider:cursor": "data:image/png;base64,cursor" });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  resetEnhancerPreferences();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

describe("create_agent preview", () => {
  it.each(["web", "ios", "android"])("shows the full prompt, toggles once, and copies source and ID on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(agentView()); });
    const root = renderer!.root;
    expect(root.findByType(MarkdownView).props.text).toBe(prompt);
    expect(root.findByType(HoverPreviewHeader).props.fitControls).toBe(true);
    expect(textOf(renderer!.toJSON())).toContain(agentId);
    expect(textOf(renderer!.toJSON())).toContain("Line 79");
    expect(textOf(renderer!.toJSON())).not.toMatch(/Initial task prompt|Show .*more|Show less/);
    await press("Copy prompt");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(prompt);
    await press(`Copy agent ID ${agentId}`);
    expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
    await press("Show raw text");
    expect(root.findAllByType(MarkdownView)).toHaveLength(0);
    expect(root.findByType(PreviewLines).props.text).toBe(prompt);
    expect(root.findByType(PreviewLines).props.lines).toHaveLength(84);
    expect(textOf(renderer!.toJSON())).not.toMatch(/Initial task prompt|Show .*more|Show less/);
    await press("Copy prompt");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(prompt);
    await press("Render Markdown");
    expect(root.findByType(MarkdownView).props.text).toBe(prompt);
    expect(root.findAllByType(ToolbarButton).filter((node) => node.props.label === "Show raw text")).toHaveLength(1);
  });

  it.each(["web", "ios", "android"])("keeps a full task heading above metadata in both modes on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const title = "[实施 A] 平台余额采集器：验证多平台额度采集、缓存有效期与失败状态的完整展示";
    act(() => { renderer = TestRenderer.create(agentView(tokens, title)); });
    const heading = () => renderer!.root.findAll((node) =>
      (node.type as unknown) === "Text" && node.props.testID === "create-agent-title");
    const verify = () => {
      expect(heading()).toHaveLength(1);
      const node = heading()[0]!;
      expect(node.props.children).toBe(title);
      expect(node.props.accessibilityRole).toBe("header");
      expect(node.props.selectable).toBe(true);
      expect(node.props.numberOfLines).toBeUndefined();
      expect(StyleSheet.flatten(node.props.style).color).toBe(tokens.foreground);
      const text = textOf(renderer!.toJSON());
      expect(text.indexOf(title)).toBeLessThan(text.indexOf("Cursor"));
      expect(text.indexOf(title)).toBeLessThan(text.indexOf(agentId));
    };
    verify();
    await press("Show raw text");
    verify();
    await press("Copy prompt");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(prompt);
    await press("Render Markdown");
    verify();
  });

  it.each(["ios", "android", "web"])("puts ID on its own row with a visible copy affordance on mobile %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: os !== "web", hover: false, touch: true, compact: false });
    act(() => { renderer = TestRenderer.create(agentView()); });
    const root = renderer!.root;
    expect(StyleSheet.flatten(root.findByProps({ testID: "create-agent-metadata" }).props.style).flexDirection).toBe("column");
    expect(StyleSheet.flatten(root.findByProps({ testID: "create-agent-copy-icon" }).props.style).opacity).toBe(1);
    expect(StyleSheet.flatten(root.findByProps({ testID: "create-agent-id" }).props.style).minHeight).toBe(44);
    const idText = root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === agentId)[0]!;
    expect(idText.props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(idText.props.style).flexShrink).toBe(1);
  });

  it("keeps desktop ID at the right and reveals copy on hover and focus", async () => {
    vi.spyOn(Dimensions, "get").mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: false, hover: true, touch: false, compact: false });
    act(() => { renderer = TestRenderer.create(agentView()); });
    const root = renderer!.root;
    expect(StyleSheet.flatten(root.findByProps({ testID: "create-agent-metadata" }).props.style).flexDirection).toBe("row");
    const opacity = () => StyleSheet.flatten(root.findByProps({ testID: "create-agent-copy-icon" }).props.style).opacity;
    const id = root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "create-agent-id")[0]!;
    expect(opacity()).toBe(0);
    act(() => id.props.onHoverIn());
    expect(opacity()).toBe(1);
    act(() => id.props.onHoverOut());
    expect(opacity()).toBe(0);
    act(() => id.props.onFocus());
    expect(opacity()).toBe(1);
    act(() => id.props.onBlur());
    expect(opacity()).toBe(0);
    await act(async () => id.props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
    expect(opacity()).toBe(1);
  });

  it.each([false, true])("uses the original Cursor black/white mark (dark=%s)", (isDark) => {
    act(() => { renderer = TestRenderer.create(agentView({ ...tokens, isDark })); });
    const image = renderer!.root.findAll((node) => (node.type as unknown) === "Image" && node.props.accessibilityLabel === "Cursor")[0]!;
    expect(StyleSheet.flatten(image.props.style).tintColor).toBe(isDark ? "#FFFFFF" : "#000000");
  });
});
