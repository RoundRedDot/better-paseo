import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TestRenderer, { act } from "react-test-renderer";
import "./helpers/quiet-renderer";

function listContext() {
  const store = globalThis as { __replyListContext?: React.Context<unknown> };
  return store.__replyListContext ??= React.createContext<unknown>(null);
}
vi.mock("react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { ...rn, VirtualizedList: { contextType: listContext() } };
});
const clipboard = vi.hoisted(() => vi.fn(async (_value: string) => {}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
  copyText: clipboard, useToast: () => ({ show() {}, error() {} }),
}));
import { AssistantFooter } from "../../client/components/turn-footer";
import { adjacentReply, registerReplyTarget, type ReplyTarget } from "../../client/components/reply-navigation";
import { buildThemeTokens } from "../../client/components/theme-tokens";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc",
  foreground: "#111", foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff",
  statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.clearAllMocks(); });

function target(top: number | null, scope: unknown, agentId = "a", available = true) {
  const entry: ReplyTarget = { agentId, top: () => top, scope: () => scope, available: () => available,
    jump: () => true, open() {} };
  const remove = registerReplyTarget(entry);
  cleanups.push(remove);
  return { entry, remove };
}

describe("reply navigation", () => {
  it("uses drawn order, isolates panes and agents, and updates when neighbours unmount", () => {
    const scope = {};
    const last = target(900, scope);
    const first = target(100, scope);
    const middle = target(500, scope);
    target(400, {}, "a");
    target(450, scope, "another-agent");
    expect(adjacentReply(first.entry, -1)).toBeNull();
    expect(adjacentReply(first.entry, 1)).toBe(middle.entry);
    expect(adjacentReply(middle.entry, 1)).toBe(last.entry);
    expect(adjacentReply(last.entry, 1)).toBeNull();
    middle.remove();
    expect(adjacentReply(first.entry, 1)).toBe(last.entry);
  });

  it("disables ambiguous, unmeasurable and unscrollable destinations without skipping them", () => {
    const scope = {};
    const first = target(100, scope);
    const blocked = target(200, scope, "a", false);
    target(300, scope);
    expect(adjacentReply(first.entry, 1)).toBeNull();
    blocked.remove();
    const tied = target(100, scope);
    expect(adjacentReply(first.entry, 1)).toBeNull();
    tied.remove();
    target(null, scope);
    expect(adjacentReply(first.entry, 1)).toBeNull();
    expect(adjacentReply(target(10, null).entry, 1)).toBeNull();
  });

  it.each([true, false])("keeps one centered panel, updates metadata and copies the destination (inverted=%s)", async (inverted) => {
    let offset = 1000;
    const viewport = { measureInWindow: (done: (...box: number[]) => void) => done(0, 40, 390, 760) };
    const scrollToOffset = vi.fn((params: { offset: number }) => { offset = params.offset; });
    const scroller = { props: { inverted }, scrollToOffset, getScrollRef: () => viewport };
    const list = { getScrollMetrics: () => ({ offset }), getOutermostParentListRef: () => scroller };
    const nodes = [100, 500, 900].map((top) => ({ current: {
      measureInWindow: (done: (...box: number[]) => void) => done(0, top, 390, 100),
    } }));
    const render = (count = 3) => React.createElement(listContext().Provider, { value: list },
      nodes.slice(0, count).map((replyRef, index) => React.createElement(AssistantFooter, {
        key: index, agentId: "native-agent", replyRef: replyRef as never,
        text: `Reply ${index}`, at: new Date(2026, 9, 16, 10, index), modelName: `Model ${index}`,
        usage: { inputTokens: 100 + index }, tokens, compact: true,
      })));
    let renderer!: ReturnType<typeof TestRenderer.create>;
    act(() => { renderer = TestRenderer.create(render()); });
    try {
      const buttons = (label: string) => renderer.root.findAllByType("Pressable" as never)
        .filter((node) => node.props.accessibilityLabel === label);
      const model = () => renderer.root.findAllByType("View" as never)
        .find((node) => node.props.testID === "footer-detail-Model name")!;
      act(() => buttons("Copy model name")[0]!.props.onLongPress());
      expect(buttons("Previous reply")[0]!.props.disabled).toBe(true);
      act(() => buttons("Next reply")[0]!.props.onPress());
      expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: inverted ? 556 : 1444, animated: false });
      expect(renderer.root.findAllByType("Modal" as never)).toHaveLength(1);
      expect(model().findAllByType("Text" as never).map((node) => node.props.children)).toContain("Model 1");
      expect(buttons("Previous reply")[0]!.props.disabled).toBe(false);
      const copy = model().findByType("Pressable" as never);
      await act(async () => { copy.props.onPress(); });
      expect(clipboard).toHaveBeenLastCalledWith("Model 1");
      act(() => buttons("Next reply")[0]!.props.onPress());
      expect(buttons("Next reply")[0]!.props.disabled).toBe(true);
      act(() => buttons("Previous reply")[0]!.props.onPress());
      act(() => renderer.update(render(2)));
      expect(buttons("Next reply")[0]!.props.disabled).toBe(true);
      expect(renderer.root.findAllByType("Modal" as never)).toHaveLength(1);
      act(() => buttons("Close preview")[0]!.props.onPress());
      expect(renderer.root.findAllByType("Modal" as never)).toHaveLength(0);
    } finally { act(() => renderer.unmount()); }
  });
});
