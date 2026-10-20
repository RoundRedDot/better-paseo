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
const host = vi.hoisted(() => ({ cwd: null as string | null, providers: { listModels: vi.fn(), listModes: vi.fn() } }));
vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: (_id: string, select: (agent: { cwd: string }) => unknown) => host.cwd === null ? null : select({ cwd: host.cwd }),
  useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => host,
  useSettings: () => ({ status: "loading" }),
}));
import { buildThemeTokens, withAlpha } from "../../client/components/theme-tokens";
import { Glyph } from "../../client/components/glyph";
import { ToolPreviewContent } from "../../client/components/tool-callouts";
import { HoverPreviewHeader, PreviewPanelSample } from "../../client/ui/hover-preview";
import { ToolbarButton, ToolbarItem, TOOLBAR_TOOLTIP_MS } from "../../client/ui/toolbar-button";
import { FooterDetails } from "../../client/components/footer-details";
import { MarkdownView } from "../../client/components/markdown/markdown-view";
import { classifyTool } from "../../client/tools/classify";
import { resetEnhancerPreferences } from "../../client/preferences";
import { PreviewLines } from "../../client/ui/preview-lines";
import { ToolCallout } from "../../client/components/tool-callouts";
import { AGENT_STATUS_LABEL, AGENT_STATUS_ICON, type AgentStatus } from "../../client/tools/agent-status";
import * as web from "../../client/web";
import { PREVIEW_OPEN_MS } from "../../client/ui/hover-preview";
import { summarizeTool } from "../../client/tools/summarize";
import type { AgentMessage } from "../../client/tools/agent-message";

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
function agentView(theme = tokens, title = "Review", settings?: Record<string, unknown>, provider = "cursor/grok-4.7", output = agentId, status = "completed") {
  const data = classifyTool({ callId: "create", name: "paseo.create_agent", status, detail: {
    type: "unknown", input: { title, provider, initialPrompt: prompt, settings }, output,
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
  host.cwd = null;
  seedMarkBitmaps({ "provider:cursor": "data:image/png;base64,cursor", "lobe:grok": "data:image/png;base64,grok" });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
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
    expect(textOf(renderer!.toJSON())).toContain(agentId.slice(0, 8));
    expect(textOf(renderer!.toJSON())).not.toContain(agentId);
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

  it.each(["web", "ios", "android"])("shows thinking and permissions and copies only the model in either mode on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(agentView(tokens, "Review", { thinkingOptionId: "max", modeId: "full-access" })); });
    const verify = () => {
      const text = textOf(renderer!.toJSON());
      expect(text).not.toContain("思考");
      expect(text).toContain("full-access");
      const thinking = renderer!.root.findByProps({ testID: "create-agent-thinking" });
      expect(thinking.props.accessibilityLabel).toBe("Thinking: max");
      expect(thinking.findAllByProps({ name: "Brain" })[0]!.props.color).toBe(tokens.accent);
      expect(text).not.toContain("权限：");
      const item = renderer!.root.findAllByType(ToolbarItem).find((node) => node.props.accessibilityLabel === "Copy model name")!;
      expect(item.props.details.type).toBe(FooterDetails);
      expect(item.props.details.props.thinkingLabel).toBe("max");
      const permissions = renderer!.root.findByProps({ testID: "create-agent-permissions" });
      expect(permissions.findAllByProps({ name: "Shield" }).length).toBeGreaterThan(0);
    };
    verify();
    await press("Copy model name");
    expect(clipboard.copyText).toHaveBeenLastCalledWith("grok-4.7");
    await press("Show raw text");
    verify();
    await press("Copy model name");
    expect(clipboard.copyText).toHaveBeenLastCalledWith("grok-4.7");
    await press(`Copy agent ID ${agentId}`);
    expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
    await press("Copy prompt");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(prompt);
    await press("Render Markdown");
    verify();
  });

  it("labels and colours the mode and model like the composer before the spawned agent loads", async () => {
    host.providers.listModels.mockResolvedValue({ models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5",
      thinkingOptions: [{ id: "high", label: "High", isDefault: true }] }] });
    host.providers.listModes.mockResolvedValue({ modes: [{ id: "bypassPermissions", label: "Bypass", icon: "ShieldOff", colorTier: "dangerous" }] });
    await act(async () => { renderer = TestRenderer.create(agentView(tokens, "Review", { modeId: "bypassPermissions" }, "claude/claude-sonnet-5-5")); });
    expect(host.providers.listModels).toHaveBeenCalledWith("claude", undefined);
    expect(textOf(renderer!.root.findByProps({ testID: "create-agent-model-label" }).props.children)).toBe("Sonnet 5.5");
    const thinking = renderer!.root.findByProps({ testID: "create-agent-thinking" });
    expect(thinking.props.accessibilityLabel).toBe("Thinking: High");
    const permissions = renderer!.root.findByProps({ testID: "create-agent-permissions" });
    expect(permissions.props.accessibilityLabel).toBe("Permissions: Bypass");
    expect(permissions.findAllByProps({ name: "ShieldOff" })[0]!.props.color).toBe(tokens.danger);
    const label = permissions.findAll((node) => (node.type as unknown) === "Text")[0]!;
    expect(StyleSheet.flatten(label.props.style).color).toBe(tokens.foregroundMuted);
  });

  it("shows missing settings explicitly without inferring values from the prompt", () => {
    act(() => { renderer = TestRenderer.create(agentView()); });
    expect(textOf(renderer!.toJSON())).not.toContain("思考");
    expect(textOf(renderer!.toJSON())).toContain("未指定");
    const item = renderer!.root.findAllByType(ToolbarItem).find((node) => node.props.accessibilityLabel === "Copy model name")!;
    expect(item.props.details.props.thinkingLabel).toBe("未指定");
  });

  it("shows thinking details on model hover using the Copy toolbar interaction", async () => {
    vi.useFakeTimers();
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: false, hover: true, touch: false, compact: false });
    act(() => { renderer = TestRenderer.create(agentView(tokens, "Review", { thinkingOptionId: "max", modeId: "full-access" })); });
    const root = renderer!.root;
    const model = root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Copy model name")[0]!;
    expect(root.findAllByType(FooterDetails)).toHaveLength(0);
    act(() => model.props.onHoverIn());
    act(() => { vi.advanceTimersByTime(TOOLBAR_TOOLTIP_MS); });
    expect(root.findByType(FooterDetails).props.thinkingLabel).toBe("max");
    await act(async () => model.props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith("grok-4.7");
  });

  it.each(["ios", "android"])("opens thinking details on model long press on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(agentView(tokens, "Review", { thinkingOptionId: "max" })); });
    const root = renderer!.root;
    const model = root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "Copy model name")[0]!;
    expect(root.findAllByType(FooterDetails)).toHaveLength(0);
    act(() => model.props.onLongPress());
    expect(root.findByType(FooterDetails).props.thinkingLabel).toBe("max");
    expect(clipboard.copyText).not.toHaveBeenCalled();
  });

  it("reports a rejected model copy without showing success", async () => {
    clipboard.copyText.mockRejectedValueOnce(new Error("clipboard denied"));
    act(() => { renderer = TestRenderer.create(agentView()); });
    await press("Copy model name");
    expect(clipboard.error).toHaveBeenCalled();
    expect(clipboard.show).not.toHaveBeenCalled();
  });

  it.each(["web", "ios", "android"])("names the task once, in the preview header, in both modes on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const title = "[实施 A] 平台余额采集器：验证多平台额度采集、缓存有效期与失败状态的完整展示";
    act(() => { renderer = TestRenderer.create(agentView(tokens, title)); });
    const verify = () => {
      expect(renderer!.root.findAllByProps({ testID: "create-agent-title" })).toHaveLength(0);
      expect(renderer!.root.findByType(HoverPreviewHeader).props.iconLabel).toBe(`Created · ${title}`);
      expect(textOf(renderer!.toJSON()).split(title)).toHaveLength(2);
    };
    verify();
    await press("Show raw text");
    verify();
    await press("Copy prompt");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(prompt);
    await press("Render Markdown");
    verify();
  });

  it.each(["ios", "android", "web"])("ends the strip with a short, copyable ID on mobile %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: os !== "web", hover: false, touch: true, compact: false });
    act(() => { renderer = TestRenderer.create(agentView()); });
    const root = renderer!.root;
    const strip = root.findByProps({ testID: "create-agent-metadata" });
    expect(StyleSheet.flatten(strip.props.style)).toMatchObject({ flexDirection: "row", alignItems: "flex-end" });
    // The ID is the strip's last child, outside the wrapping fields, so it never takes a line alone.
    const id = root.findByProps({ testID: "create-agent-id" });
    expect(StyleSheet.flatten(id.props.style).width).toBeUndefined();
    expect(StyleSheet.flatten(id.props.style).flexShrink).toBe(0);
    expect(id.props.hitSlop).toBeGreaterThanOrEqual(10);
    expect(root.findByProps({ testID: "create-agent-copy-icon" })).toBeDefined();
    expect(textOf(id.props.children)).toBe("");
    expect(root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === agentId.slice(0, 8))).toHaveLength(1);
    await press(`Copy agent ID ${agentId}`);
    expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
  });

  it.each([390, 1280])("shows the running state in the strip at width %s until the ID arrives", async (width) => {
    vi.spyOn(Dimensions, "get").mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: false, hover: true, touch: false, compact: false });
    act(() => { renderer = TestRenderer.create(agentView(tokens, "Review", undefined, "cursor/grok-4.7", "", "running")); });
    const text = textOf(renderer!.toJSON());
    expect(text.indexOf("running")).toBeGreaterThan(text.indexOf("未指定"));
    expect(renderer!.root.findByProps({ testID: "create-agent-state" }).props.accessibilityLabel).toBe("running");
    expect(renderer!.root.findAllByProps({ testID: "create-agent-id" })).toHaveLength(0);
    await act(async () => renderer!.update(agentView()));
    const id = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "create-agent-id")[0]!;
    expect(id.props.accessibilityLabel).toBe(`Copy agent ID ${agentId}`);
  });

  it("keeps the copy icon visible but quiet, and full strength on hover", async () => {
    vi.spyOn(Dimensions, "get").mockReturnValue({ width: 1280, height: 800, scale: 1, fontScale: 1 });
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: false, hover: true, touch: false, compact: false });
    act(() => { renderer = TestRenderer.create(agentView()); });
    const root = renderer!.root;
    const glyph = () => root.findByProps({ testID: "create-agent-copy-icon" }).findByType(Glyph);
    const id = root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "create-agent-id")[0]!;
    expect(glyph().props.color).toBe(withAlpha(tokens.foregroundMuted, 0.6));
    act(() => id.props.onHoverIn());
    expect(glyph().props.color).toBe(withAlpha(tokens.foregroundMuted, 1));
    act(() => id.props.onHoverOut());
    await act(async () => id.props.onPress());
    expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
    expect(glyph().props.name).toBe("Check");
  });

  it.each([false, true])("uses the theme's muted color for the Cursor mark (dark=%s)", (isDark) => {
    act(() => { renderer = TestRenderer.create(agentView({ ...tokens, isDark })); });
    const image = renderer!.root.findAll((node) => (node.type as unknown) === "Image" && node.props.accessibilityLabel === "Cursor")[0]!;
    expect(StyleSheet.flatten(image.props.style).tintColor).toBe(tokens.foregroundMuted);
  });

  it.each(["web", "ios", "android"])("matches the composer model label and preserves raw ID copying across themes on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    host.cwd = "/workspace";
    host.providers.listModels.mockResolvedValue({ models: [{ id: "grok-4.7", label: "Grok 4.7" }] });
    const view = (dark: boolean) => agentView({ ...tokens, isDark: dark,
      foregroundMuted: dark ? "#aaa" : "#666" }, "Review", undefined, "grok/grok-4.7");
    await act(async () => { renderer = TestRenderer.create(view(false)); });
    for (const dark of [false, true]) {
      await act(async () => renderer!.update(view(dark)));
      const model = renderer!.root.findByProps({ testID: "create-agent-model" });
      const images = model.findAll((node) => (node.type as unknown) === "Image");
      expect(images).toHaveLength(1);
      expect(images[0]!.props.accessibilityLabel).toBe("Grok");
      expect(StyleSheet.flatten(images[0]!.props.style).tintColor).toBe(dark ? "#aaa" : "#666");
      const label = model.findByProps({ testID: "create-agent-model-label" });
      expect(label.props.children).toBe("Grok 4.7");
      expect(StyleSheet.flatten(label.props.style)).toMatchObject({ color: tokens.foreground, fontWeight: "500" });
      expect(textOf(renderer!.toJSON())).not.toContain("grok-4.7");
      expect(model.findAll((node) => (node.type as unknown) === "Text" && node.props.children === "Grok")).toHaveLength(0);
      expect(model.findAllByProps({ name: "Copy" })).toHaveLength(0);
      const item = model.findByType(ToolbarItem);
      expect(item.props.details.props.modelId).toBe("grok-4.7");
      expect(item.props.details.props.modelName).toBe("Grok 4.7");
      await press("Copy model name");
      expect(clipboard.copyText).toHaveBeenLastCalledWith("grok-4.7");
    }
    expect(host.providers.listModels).toHaveBeenCalledWith("grok", { cwd: "/workspace" });
  });
});

const statusBody = "# Result\n\n**Cursor OK**\n\n" + "Long response\n".repeat(80);
const messageEvent: Record<AgentStatus, AgentMessage["event"]> = {
  message: "message", finished: "finished", errored: "errored", "needs permission": "permission-required", "was closed": "closed", "was canceled": "errored",
};
function statusView(status: AgentStatus = "finished") {
  const text = status === "message" ? statusBody : `Agent ${agentId} (卡片测试 · Cursor) ${status}.\n\n<agent-response>\n${statusBody}\n</agent-response>`;
  return classifyTool({ name: "agent_message", callId: "paseo-agent-message:m1", status: "completed",
    detail: { type: "plain_text", text }, agentMessage: { event: messageEvent[status],
      sender: { id: agentId, title: "卡片测试 · Cursor" }, text } });
}

function preview(data: ReturnType<typeof classifyTool>, theme = tokens) {
  return React.createElement(PreviewPanelSample, { tokens: theme,
    children: React.createElement(ToolPreviewContent, { data, tokens: theme, compact: false, resolvePath: (path) => path }) });
}

describe("agent status card presentation", () => {
  it.each(["web", "ios", "android"])("shows status, full title, ID and response in both modes on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    for (const status of Object.keys(AGENT_STATUS_LABEL) as AgentStatus[]) {
      for (const isDark of [false, true]) {
        const theme = { ...tokens, isDark };
        act(() => { renderer = TestRenderer.create(preview(statusView(status), theme)); });
        const root = renderer!.root;
        const header = root.findByType(HoverPreviewHeader);
        expect(header.props.iconLabel).toBe(`${AGENT_STATUS_LABEL[status]} · 卡片测试 · Cursor`);
        const color = status === "errored" ? tokens.danger : status === "needs permission" ? tokens.warning :
          status === "finished" ? tokens.success : tokens.foregroundMuted;
        expect(header.findAllByProps({ name: AGENT_STATUS_ICON[status] })[0]!.props.color).toBe(color);
        expect(root.findAllByProps({ testID: "agent-status-title" })).toHaveLength(0);
        // An errored reply opens with its first line as the error; the rest stays the reply.
        const body = status === "errored" ? statusBody.slice("# Result".length).trim() : statusBody;
        expect(root.findByType(MarkdownView).props.text).toBe(body);
        expect(textOf(renderer!.toJSON())).not.toContain("<agent-response>");
        await press(`Copy agent ID ${agentId}`);
        expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
        await press("Copy result");
        expect(clipboard.copyText).toHaveBeenLastCalledWith(statusBody);
        await press("Show raw text");
        expect(root.findAllByType(MarkdownView)).toHaveLength(0);
        expect(root.findByType(PreviewLines).props.text).toBe(statusBody);
        expect(root.findByType(HoverPreviewHeader).props.iconLabel).toBe(`${AGENT_STATUS_LABEL[status]} · 卡片测试 · Cursor`);
        await press("Render Markdown");
        act(() => renderer!.unmount());
        renderer = undefined;
      }
    }
  });

  it("opens a status hover popup after the configured delay and keeps the row collapsed", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    vi.useFakeTimers();
    vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: false, hover: true, touch: false, compact: false });
    let enter: (() => void) | undefined;
    vi.spyOn(web, "bindPreviewPointer").mockImplementation((_node, onEnter) => { enter = onEnter; return () => {}; });
    vi.spyOn(web, "openPreviewLayer").mockImplementation(() => () => {});
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, { data: statusView(), tokens, previewKey: "status-hover" })); });
    expect(renderer!.root.findAllByType(MarkdownView)).toHaveLength(0);
    expect(enter).toBeTypeOf("function");
    act(() => enter!());
    act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS - 1); });
    expect(renderer!.root.findAllByType(MarkdownView)).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(renderer!.root.findByType(MarkdownView).props.text).toBe(statusBody);
    expect(renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Finished 卡片测试 · Cursor")[0]!.props.accessibilityState.expanded).toBe(false);
  });

  it.each(["ios", "android"])("opens a status preview on long press on %s", (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, { data: statusView(), tokens })); });
    const row = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Finished 卡片测试 · Cursor")[0]!;
    act(() => row.props.onLongPress());
    expect(renderer!.root.findByType(MarkdownView).props.text).toBe(statusBody);
    expect(StyleSheet.flatten(renderer!.root.findByProps({ testID: "agent-status-id" }).props.style).width).toBeUndefined();
  });

  it("expands a status card using the same content as its preview", () => {
    act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, { data: statusView(), tokens })); });
    const row = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Finished 卡片测试 · Cursor")[0]!;
    act(() => row.props.onPress());
    expect(renderer!.root.findAllByProps({ testID: "agent-status-title" })).toHaveLength(0);
    expect(renderer!.root.findByType(MarkdownView).props.text).toBe(statusBody);
    // Inline, the long reply folds under "Show all"; the preview never folds.
    expect(renderer!.root.findByProps({ testID: "agent-body-folded" })).toBeDefined();
    expect(textOf(renderer!.toJSON())).toContain(`Show all · ${statusBody.split("\n").length} lines`);
  });

  it.each(["failed", "mcp-error", "canceled"])("marks unsuccessful creation without inventing an agent ID: %s", async (failure) => {
    const error = `Session could not be created (request ${agentId})`;
    const data = classifyTool({ name: "paseo.create_agent", callId: "create", status: failure === "mcp-error" ? "completed" : failure,
      error: failure === "failed" ? error : null,
      detail: { type: "unknown", input: { title: "Review", initialPrompt: "# Task" },
        output: failure === "mcp-error" ? { isError: true, content: [{ type: "text", text: error }] } : error } });
    expect(data.paseo!.createAgent!.agentId).toBeUndefined();
    act(() => { renderer = TestRenderer.create(preview(data)); });
    const label = failure === "canceled" ? "Create canceled" : "Create failed";
    expect(textOf(renderer!.toJSON())).toContain(label);
    expect(textOf(renderer!.toJSON())).not.toContain("running");
    expect(renderer!.root.findAllByProps({ testID: "create-agent-id" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ testID: "create-agent-copy-icon" })).toHaveLength(0);
    if (failure !== "canceled") {
      expect(data.status).toBe("failed");
      expect(summarizeTool(data)).toMatchObject({ verb: "Create failed", tone: "danger" });
      expect(renderer!.root.findByProps({ testID: "agent-error" })).toBeDefined();
      expect(textOf(renderer!.toJSON())).toContain(error);
    }
    await press("Show raw text");
    expect(textOf(renderer!.toJSON())).toContain(label);
  });

  it("shows missing ID explicitly once creation has settled", () => {
    act(() => { renderer = TestRenderer.create(agentView(tokens, "Review", undefined, "cursor/grok-4.7", "")); });
    expect(textOf(renderer!.toJSON())).toContain("ID unavailable");
    expect(textOf(renderer!.toJSON())).not.toContain("running");
  });
});

function agentTool(name: string, result: unknown, status = "completed") {
  return classifyTool({ name: `paseo.${name}`, status, callId: "agent-tool", detail: { type: "unknown",
    input: { agentId, prompt: statusBody }, output: result } });
}

describe("unified agent tool card layout", () => {
  it.each(["web", "ios", "android"])("renders the prompt and dispatch receipt and preserves all copy sources on %s", async (os) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = os;
    const receipt = { success: true, disposition: "turn_started", status: "running", guidance: "Wait for the finish notification." };
    act(() => { renderer = TestRenderer.create(preview(agentTool("send_agent_prompt", receipt))); });
    expect(renderer!.root.findByType(HoverPreviewHeader).props.iconLabel).toBe(`Sent prompt · ${agentId.slice(0, 8)}`);
    expect(summarizeTool(agentTool("send_agent_prompt", receipt)).meta).toEqual(["turn started"]);
    expect(renderer!.root.findByProps({ testID: "send-agent-prompt-state" }).props.accessibilityLabel).toBe("running");
    expect(textOf(renderer!.toJSON())).toContain(receipt.guidance);
    expect(renderer!.root.findByType(MarkdownView).props.text).toBe(statusBody);
    await press("Copy prompt");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(statusBody);
    await press(`Copy agent ID ${agentId}`);
    expect(clipboard.copyText).toHaveBeenLastCalledWith(agentId);
    await press("Copy result");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(JSON.stringify(receipt, null, 2));
    await press("Copy arguments");
    expect(clipboard.copyText).toHaveBeenLastCalledWith(JSON.stringify({ agentId, prompt: statusBody }, null, 2));
    await press("Show raw text");
    const source = renderer!.root.findByType(PreviewLines).props.text;
    expect(JSON.parse(source)).toEqual({ arguments: { agentId, prompt: statusBody }, result: receipt });
    await press("Render Markdown");
    expect(renderer!.root.findByType(MarkdownView).props.text).toBe(statusBody);
  });

  it.each(["message", "send_agent_prompt", "get_agent_status", "get_agent_activity", "list_agents", "sub_agent"])(
    "opens the unified %s card on hover without expanding its row", (kind) => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
      vi.useFakeTimers();
      vi.spyOn(input, "useInputCapabilities").mockReturnValue({ native: false, hover: true, touch: false, compact: false });
      let enter: (() => void) | undefined;
      vi.spyOn(web, "bindPreviewPointer").mockImplementation((_node, callback) => { enter = callback; return () => {}; });
      vi.spyOn(web, "openPreviewLayer").mockImplementation(() => () => {});
      const data = kind === "message" ? statusView("message") : kind === "sub_agent" ?
        classifyTool({ name: "Task", status: "completed", detail: { type: "sub_agent", description: "Explore", log: "" } }) :
        agentTool(kind, { success: true, status: "running", content: "# Activity", agents: [] });
      act(() => { renderer = TestRenderer.create(React.createElement(ToolCallout, { data, tokens })); });
      const row = renderer!.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityState)[0]!;
      expect(row.props.accessibilityState.expanded).toBe(false);
      act(() => enter!());
      act(() => { vi.advanceTimersByTime(PREVIEW_OPEN_MS); });
      expect(renderer!.root.findByProps({ testID: "hover-preview" })).toBeDefined();
      expect(row.props.accessibilityState.expanded).toBe(false);
    });

  it.each([["running", null, "Sending prompt", []], ["failed", "Provider unavailable", "Prompt failed", ["Provider unavailable"]],
    ["canceled", null, "Prompt canceled", []], ["completed", null, "Sent prompt", ["not confirmed"]]])(
    "shows dispatch outcome without treating an unknown result as success (%s)", (status, result, verb, meta) => {
      const data = agentTool("send_agent_prompt", result, status as string);
      act(() => { renderer = TestRenderer.create(preview(data)); });
      expect(summarizeTool(data)).toMatchObject({ verb, meta });
      expect(renderer!.root.findByType(HoverPreviewHeader).props.iconLabel).toBe(`${verb} · ${agentId.slice(0, 8)}`);
      expect(textOf(renderer!.toJSON())).not.toContain("turn started");
    });

  it.each(["get_agent_status", "get_agent_activity", "list_agents", "cancel_agent", "archive_agent", "kill_agent", "update_agent", "set_agent_mode", "list_pending_permissions", "respond_to_permission"])(
    "renders %s using the shared card and supports raw response inspection", async (name) => {
      const result = { success: true, status: "idle", agents: [], content: "# Agent activity\n\n**Complete response**", updateCount: 2 };
      act(() => { renderer = TestRenderer.create(preview(agentTool(name, result))); });
      expect(renderer!.root.findAllByProps({ testID: "agent-operation-title" })).toHaveLength(0);
      expect(renderer!.root.findByProps({ testID: "agent-operation-metadata" })).toBeDefined();
      const summary = summarizeTool(agentTool(name, result));
      expect(renderer!.root.findByType(HoverPreviewHeader).props.iconLabel).toBe(`${summary.verb} · ${summary.target}`);
      expect(renderer!.root.findByType(MarkdownView).props.text).toBe(result.content);
      await press("Show raw text");
      expect(JSON.parse(renderer!.root.findByType(PreviewLines).props.text).result).toEqual(result);
    });

  it("keeps a provider-native agent task previewable with title and status", async () => {
    const data = classifyTool({ name: "Task", status: "running", detail: { type: "sub_agent", description: "Explore the code", subAgentType: "Explore", log: "" } });
    act(() => { renderer = TestRenderer.create(preview(data)); });
    expect(renderer!.root.findByType(HoverPreviewHeader).props.iconLabel).toBe("Running subtask · Explore the code");
    expect(renderer!.root.findByProps({ testID: "sub-agent-state" }).props.accessibilityLabel).toBe("running");
    expect(textOf(renderer!.toJSON())).toContain("Explore");
    await press("Show raw text");
    expect(JSON.parse(renderer!.root.findByType(PreviewLines).props.text).description).toBe("Explore the code");
  });
});
