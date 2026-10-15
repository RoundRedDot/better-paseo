import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { StyleSheet } from "./helpers/rn-mock";
import { seedMarkBitmaps } from "../../client/components/marks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const at = new Date("2026-10-14T14:44:00Z");
const text = "Reply with **Markdown** and a second line.\nFull reply.";
const footer = (compact: boolean) => React.createElement(AssistantFooter, { text, at, tokens, compact });

beforeEach(() => {
  vi.clearAllMocks();
  seedMarkBitmaps({ "lobe:codex": "data:image/png;base64,codex" });
});

describe("assistant footer", () => {
  it("shows agent, model, full local timestamp and duration after Copy in order", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at: new Date(2026, 9, 15, 15, 5, 3), tokens,
      agentName: "codex", modelName: "GPT-6.1-Sol", thinkingLabel: "Medium", durationMs: 138000,
    })); });
    try {
      const labels = renderer.root.findAllByType("Text" as never)
        .map((node) => [node.props.children].flat().join(""));
      expect(labels).toEqual(["Copy", "GPT-6.1-Sol", "Medium", "2026-10-15 15:05:03", "2分18秒"]);
      expect(renderer.root.findAllByType("Icon" as never).map((node) => node.props.name))
        .toEqual(["Copy", "Brain", "Timer"]);
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
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(React.createElement(AssistantFooter, {
      text, at, tokens, compact, agentName: "codex", modelName: "GPT-6.1-Sol", thinkingLabel: "Medium",
    })); });
    try {
      const button = renderer.root.findByProps({ accessibilityLabel: "Copy model name" });
      expect(button.props.hitSlop).toBe(compact ? 10 : 0);
      await act(async () => { button.props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("GPT-6.1-Sol");
      expect(renderer.root.findByProps({ accessibilityLabel: "Model name copied" })).toBeDefined();
      await act(async () => { renderer.root.findByProps({ accessibilityLabel: "Copy reply" }).props.onPress(); });
      expect(clipboard.copyText).toHaveBeenLastCalledWith(text);
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
      expect(renderer.root.findAllByProps({ accessibilityLabel: "Model name copied" })).toHaveLength(0);
    } finally {
      act(() => renderer.unmount());
    }
  });
  it("leaves 16pt below the compact Copy row, beyond its touch extension", () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(footer(true)); });
    try {
      const container = renderer.root.findByType("View" as never);
      const button = renderer.root.findByType("Pressable" as never);
      const style = StyleSheet.flatten(container.props.style);
      expect(style.minHeight).toBe(24);
      expect(style.flexWrap).toBe("wrap");
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
      const container = renderer.root.findByType("View" as never);
      expect(StyleSheet.flatten(container.props.style).marginBottom).toBe(16);
      expect(renderer.root.findByType("Pressable" as never).props.hitSlop).toBe(compact ? 10 : 0);
      act(() => renderer.update(footer(!compact)));
      expect(StyleSheet.flatten(container.props.style).marginBottom).toBe(16);
      expect(renderer.root.findByType("Pressable" as never).props.hitSlop).toBe(compact ? 0 : 10);
    } finally {
      act(() => renderer.unmount());
    }
  });

  it.each([false, true])("copies the full reply and confirms success (compact=%s)", async (compact) => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(footer(compact)); });
    try {
      await act(async () => { renderer.root.findByType("Pressable" as never).props.onPress(); });
      expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith(text);
      expect(renderer.root.findByType("Pressable" as never).props.accessibilityLabel).toBe("Reply copied");
    } finally {
      act(() => renderer.unmount());
    }
  });
});
