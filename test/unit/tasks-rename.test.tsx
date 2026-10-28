import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { rename: vi.fn(), generate: vi.fn(), paseo: { agents: { ref: vi.fn() } } };
});
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: (contract: { name: string }) => contract.name === "tasks.title-update" ? rpc.generate : rpc.rename, usePaseo: () => rpc.paseo }));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    Icon: (props: object) => react.createElement("Icon", props),
    Modal: Object.assign(
      (props: { open: boolean; children?: React.ReactNode }) => props.open ? react.createElement("HostModal", props, props.children) : null,
      { Content: (props: { children?: React.ReactNode }) => react.createElement("ModalContent", props, props.children) },
    ),
    copyText: vi.fn(),
    useToast: () => ({ show() {}, error() {} }),
  };
});
import "./helpers/quiet-renderer";
import { TaskRenameDialog } from "../../client/tasks/cards/rename-dialog";
import { CardContextMenu } from "../../client/tasks/cards/card-menu";
import { cardStrings } from "../../client/tasks/cards/strings";
import { sampleCards } from "../../client/tasks/sample-cards";
import { CascadeMenu } from "../../client/tasks/board/menu";
import { REVEAL_TICK_MS } from "../../client/tasks/cards/title-reveal";

const theme = {
  colors: {
    surface0: "#18181b", surface1: "#1f1f23", surface2: "#26262b", border: "#2e2e33",
    foreground: "#ededef", foregroundMuted: "#9b9ba5", accent: "#3b6fe0", accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
  },
};
let tree: ReactTestRenderer;
const onClose = vi.fn();
const input = () => tree.root.findByType("TextInput" as never);
const save = () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-save");
const cancel = () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Cancel");

beforeEach(() => {
  vi.useFakeTimers();
  rpc.rename.mockReset().mockResolvedValue({ ok: true, error: null });
  rpc.generate.mockReset().mockResolvedValue({ state: "done", title: "Generated title" });
  rpc.paseo.agents.ref.mockReset();
  onClose.mockReset();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  vi.useRealTimers();
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

async function renderDialog(extra: Partial<React.ComponentProps<typeof TaskRenameDialog>> = {}) {
  await act(async () => {
    tree = TestRenderer.create(<TaskRenameDialog agentId="agent-a" title="Original" strings={cardStrings("en")} theme={theme} onClose={onClose} {...extra} />);
  });
}

async function reveal(expected: string) {
  for (let index = 0; index < 80 && input().props.value !== expected; index++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_TICK_MS); });
  }
  expect(input().props.value).toBe(expected);
}

describe("task title editor", () => {
  it("disables an already open editor when the workspace becomes unavailable", async () => {
    await renderDialog({ canAutoTitle: true });
    await act(async () => input().props.onChangeText("New title"));
    await act(async () => tree.update(<TaskRenameDialog agentId="agent-a" title="Original" strings={cardStrings("en")} theme={theme} onClose={onClose} canAutoTitle blockedReason="Working directory missing" />));
    expect(save().props.disabled).toBe(true);
    expect(input().props.editable).toBe(false);
    const automatic = tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    expect(automatic.props.disabled).toBe(true);
    await act(async () => { save().props.onPress(); automatic.props.onPress(); });
    expect(rpc.rename).not.toHaveBeenCalled();
    expect(rpc.generate).not.toHaveBeenCalled();
  });

  it("keeps manual editing available when only automatic titles are unavailable", async () => {
    await renderDialog({ canAutoTitle: true, autoTitleBlockedReason: "Title model unavailable" });
    await act(async () => input().props.onChangeText("New title"));
    expect(save().props.disabled).toBe(false);
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title").props.disabled).toBe(true);
    await act(async () => save().props.onPress());
    expect(rpc.rename).toHaveBeenCalledWith({ agentId: "agent-a", title: "New title" });
  });
  it("does not restart the reveal when the final result trims streamed whitespace", async () => {
    rpc.generate.mockResolvedValueOnce({ state: "running", text: "New title\n" })
      .mockResolvedValueOnce({ state: "done", title: "New title" });
    await renderDialog({ canAutoTitle: true });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title").props.onPress());
    await reveal("New title");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(input().props.value).toBe("New title");
    expect(save().props.disabled).toBe(false);
    expect(tree.root.findAll((node) => node.props.testID === "task-rename-title-loading")).toHaveLength(0);
  });

  it.each(["ios", "android", "web"])("types out even a complete result, using the left icon slot for loading (%s)", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const title = "New streamed title";
    rpc.generate.mockResolvedValueOnce({ state: "done", title });
    await renderDialog({ canAutoTitle: true });
    const automatic = () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    await act(async () => automatic().props.onPress());
    expect(input().props.value).toBe("Original");
    expect((automatic().children[0] as TestRenderer.ReactTestInstance).props.testID).toBe("task-rename-title-loading");
    expect(automatic().findAllByType("Icon" as never)).toHaveLength(0);
    expect(automatic().findAllByType("Text" as never).map((node) => node.children.join("")).join("")).toBe("Generate title");
    expect(save().props.disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_TICK_MS); });
    expect(input().props.value.length).toBeGreaterThan(0);
    expect(input().props.value.length).toBeLessThan(title.length);
    expect(title.startsWith(input().props.value)).toBe(true);
    await reveal(title);
    expect(automatic().findByType("Icon" as never).props.name).toBe("Sparkles");
    expect(automatic().findAll((node) => node.props.testID === "task-rename-title-loading")).toHaveLength(0);
    expect(save().props.disabled).toBe(false);
    expect(rpc.rename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("replaces the old title as live chunks arrive without waiting for the polling interval", async () => {
    vi.useFakeTimers();
    let event!: (value: unknown) => void;
    const unsubscribe = vi.fn();
    rpc.paseo.agents.ref.mockReturnValue({ timeline: { subscribe: (handler: (value: unknown) => void) => {
      event = handler;
      return Object.assign(unsubscribe, { ready: Promise.resolve() });
    } } });
    rpc.generate.mockResolvedValueOnce({ state: "running", helperId: "helper" })
      .mockResolvedValueOnce({ state: "running", helperId: "helper", text: "New" })
      .mockResolvedValueOnce({ state: "running", helperId: "helper", text: "New title" })
      .mockResolvedValueOnce({ state: "done", title: "New title" });
    await renderDialog({ canAutoTitle: true });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title").props.onPress());
    expect(input().props.value).toBe("Original");
    const chunk = (text: string) => event({ agentId: "helper", event: { type: "timeline", item: { type: "assistant_message", text } } });
    await act(async () => { chunk("New"); await vi.advanceTimersByTimeAsync(0); });
    await reveal("New");
    expect(input().props.value).toBe("New");
    await act(async () => { chunk(" title"); await vi.advanceTimersByTimeAsync(0); });
    await reveal("New title");
    expect(input().props.value).toBe("New title");
    expect(rpc.rename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it.each(["ios", "android", "web"])("streams a preview with loading and saves only on confirmation (%s)", async (platform) => {
    vi.useFakeTimers();
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    rpc.generate.mockResolvedValueOnce({ state: "running" })
      .mockResolvedValueOnce({ state: "running", text: "" })
      .mockResolvedValueOnce({ state: "running", text: "Generated " })
      .mockResolvedValueOnce({ state: "running", text: "Generated title" })
      .mockResolvedValueOnce({ state: "done", title: "Final title" });
    await renderDialog({ canAutoTitle: true });
    const automatic = () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    const press = automatic().props.onPress;
    await act(async () => { press(); press(); });
    expect(rpc.generate).toHaveBeenCalledTimes(1);
    expect(input().props.value).toBe("Original");
    expect(automatic().findAllByType("Text" as never).map((node) => node.children.join("")).join("")).toBe("Generate title");
    expect(automatic().findAllByType("Icon" as never)).toHaveLength(0);
    expect(input().props.editable).toBe(false);
    expect(save().props.disabled).toBe(true);
    expect(cancel().props.disabled).toBe(false);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-rename-title-loading")).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(rpc.rename).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(input().props.value).toBe("Original");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await reveal("Generated");
    expect(input().props.value).toBe("Generated");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await reveal("Generated title");
    expect(input().props.value).toBe("Generated title");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await reveal("Final title");
    expect(input().props.value).toBe("Final title");
    expect(input().props.editable).toBe(true);
    expect(save().props.disabled).toBe(false);
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-rename-title-loading")).toHaveLength(0);
    expect(rpc.generate.mock.calls.every(([request]) => request.mode === "preview")).toBe(true);
    expect(rpc.rename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => save().props.onPress());
    expect(rpc.rename).toHaveBeenCalledExactlyOnceWith({ agentId: "agent-a", title: "Final title" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["ios", "android", "web"])("wraps the title within the editor width without clipping native intrinsic height (%s)", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const title = "A long title that wraps over several lines on a narrow device";
    await renderDialog({ title });
    expect(input().props.value).toBe(title);
    expect(input().props.multiline).toBe(true);
    expect(input().props.scrollEnabled).toBe(false);
    expect(input().props.style.width).toBe("100%");
    expect(input().props.style.textAlignVertical).toBe("center");
    expect(input().props.style.includeFontPadding).toBe(false);
    expect(input().props.style.lineHeight + input().props.style.paddingVertical * 2 + input().props.style.borderWidth * 2).toBe(input().props.style.minHeight);
    if (platform !== "web") {
      expect(input().props.style.height).toBeUndefined();
      expect(input().props.onContentSizeChange).toBeUndefined();
      await act(async () => input().props.onChangeText("Short title"));
      expect(input().props.style.height).toBeUndefined();
      return;
    }
    await act(async () => input().props.onContentSizeChange({ nativeEvent: { contentSize: { width: 260, height: 108 } } }));
    expect(input().props.style.height).toBe(108);
    expect(input().props.style.textAlignVertical).toBe("center");
    await act(async () => input().props.onContentSizeChange({ nativeEvent: { contentSize: { width: 260, height: 64 } } }));
    expect(input().props.style.height).toBe(64);
    await act(async () => input().props.onContentSizeChange({ nativeEvent: { contentSize: { width: 260, height: 20 } } }));
    expect(input().props.style.height).toBe(input().props.style.minHeight);
  });

  it.each(["cancel", "dismiss"])("discards a running preview on %s without saving or restoring it on reopen", async (action) => {
    vi.useFakeTimers();
    rpc.generate.mockResolvedValueOnce({ state: "running", text: "Partial title" }).mockResolvedValueOnce({ state: "done", title: "Final title" });
    await renderDialog({ canAutoTitle: true });
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title").props.onPress());
    await act(async () => action === "cancel" ? cancel().props.onPress() : tree.root.findByType("HostModal" as never).props.onOpenChange(false));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(rpc.rename).not.toHaveBeenCalled();
    await renderDialog({ canAutoTitle: true });
    expect(input().props.value).toBe("Original");
    expect(save().props.disabled).toBe(true);
  });

  it("keeps generation errors inside the editor and permits retry", async () => {
    rpc.generate.mockResolvedValueOnce({ state: "error", error: "Provider failed" });
    await renderDialog({ canAutoTitle: true });
    const automatic = () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    await act(async () => automatic().props.onPress());
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert").children.join("")).toContain("Provider failed");
    expect(onClose).not.toHaveBeenCalled();
    expect(rpc.rename).not.toHaveBeenCalled();
    expect(automatic().props.disabled).toBe(false);
    await act(async () => automatic().props.onPress());
    await reveal("Generated title");
    expect(input().props.value).toBe("Generated title");
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")).toHaveLength(0);
  });

  it.each(["en", "zh"] as const)("previews with the menu icon and keeps the editor open until save (%s)", async (language) => {
    await renderDialog({ canAutoTitle: true, strings: cardStrings(language) });
    const button = tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    expect(button.props.accessibilityLabel).toBe(language === "zh" ? "生成标题" : "Generate title");
    expect(button.findAllByType("Text" as never).some((node) => node.children.join("") === cardStrings(language).generateTitle)).toBe(true);
    expect(button.findByType("Icon" as never).props.name).toBe("Sparkles");
    await act(async () => button.props.onPress());
    expect(rpc.generate).toHaveBeenCalledExactlyOnceWith({ agentId: "agent-a", action: "start", mode: "preview" });
    expect(onClose).not.toHaveBeenCalled();
    await reveal("Generated title");
    expect(input().props.value).toBe("Generated title");
    expect(rpc.rename).not.toHaveBeenCalled();
    await act(async () => input().props.onChangeText("Edited generated title"));
    await act(async () => save().props.onPress());
    expect(rpc.rename).toHaveBeenCalledExactlyOnceWith({ agentId: "agent-a", title: "Edited generated title" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables automatic generation while an existing title job is running", async () => {
    await renderDialog({ canAutoTitle: true, autoTitlePending: true });
    const button = tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    expect(button.props.disabled).toBe(true);
    await act(async () => button.props.onPress());
    expect(rpc.generate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("prefills the title, blocks unchanged and blank values, then saves the trimmed title", async () => {
    await renderDialog();
    expect(input().props.value).toBe("Original");
    expect(save().props.disabled).toBe(true);
    await act(async () => input().props.onChangeText("   "));
    await act(async () => input().props.onSubmitEditing());
    expect(save().props.disabled).toBe(true);
    expect(rpc.rename).not.toHaveBeenCalled();
    await act(async () => input().props.onChangeText("  Updated 中文  "));
    await act(async () => save().props.onPress());
    expect(rpc.rename).toHaveBeenCalledExactlyOnceWith({ agentId: "agent-a", title: "Updated 中文" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels or dismisses without writing", async () => {
    await renderDialog();
    await act(async () => input().props.onChangeText("Draft"));
    await act(async () => cancel().props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    await act(async () => tree.root.findByType("HostModal" as never).props.onOpenChange(false));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(rpc.rename).not.toHaveBeenCalled();
  });

  it.each(["response", "rejection"])("keeps the draft after a failed %s and permits retry", async (failure) => {
    if (failure === "response") rpc.rename.mockResolvedValueOnce({ ok: false, error: "Agent not found" });
    else rpc.rename.mockRejectedValueOnce(new Error("Disconnected"));
    await renderDialog();
    await act(async () => input().props.onChangeText("Draft"));
    await act(async () => save().props.onPress());
    expect(input().props.value).toBe("Draft");
    expect(onClose).not.toHaveBeenCalled();
    expect(tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "alert")).toHaveLength(1);
    expect(save().props.disabled).toBe(false);
    await act(async () => save().props.onPress());
    expect(rpc.rename).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate requests and dismissal while saving", async () => {
    let finish!: (result: { ok: boolean; error: null }) => void;
    rpc.rename.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await renderDialog({ canAutoTitle: true });
    await act(async () => input().props.onChangeText("Draft"));
    const press = save().props.onPress;
    await act(async () => { press(); press(); });
    expect(rpc.rename).toHaveBeenCalledTimes(1);
    expect(save().props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(cancel().props.disabled).toBe(true);
    expect(input().props.editable).toBe(false);
    const automatic = tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title");
    expect(automatic.props.disabled).toBe(true);
    await act(async () => automatic.props.onPress());
    expect(rpc.generate).not.toHaveBeenCalled();
    await act(async () => tree.root.findByType("HostModal" as never).props.onOpenChange(false));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, error: null }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("task card rename entry", () => {
  const card = sampleCards(Date.parse("2026-10-20T09:00:00Z"))[0]!;
  it.each(["touch", "pointer"])("starts automatic title generation from the %s menu and closes it", async (kind) => {
    const autoTitle = vi.fn();
    await act(async () => {
      tree = TestRenderer.create(<CardContextMenu point={kind === "pointer" ? { x: 20, y: 30 } : null} card={card} strings={cardStrings("zh")} actions={{ children: 0, autoTitle }} theme={theme} onClose={onClose} />);
    });
    if (kind === "touch") {
      await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "自动更新标题").props.onPress());
    } else {
      const menu = tree.root.findByType(CascadeMenu);
      const items = menu.props.sections.flatMap((section: { items: Array<{ key: string }> }) => section.items);
      const index = items.findIndex((item: { key: string }) => item.key === "auto-title");
      await act(async () => tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem")[index]!.props.onPress());
    }
    expect(autoTitle).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the automatic action while a title request is pending", async () => {
    await act(async () => {
      tree = TestRenderer.create(<CardContextMenu point={null} card={card} strings={cardStrings("zh")} actions={{ children: 0, autoTitle: vi.fn(), autoTitlePending: true }} theme={theme} onClose={onClose} />);
    });
    expect(tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "正在更新标题…").props.disabled).toBe(true);
  });

  it.each(["ios", "android", "web"])("offers automatic titles and editor previews on archived cards (%s)", async (platform) => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
    const autoTitle = vi.fn();
    await act(async () => {
      tree = TestRenderer.create(<CardContextMenu point={platform === "web" ? { x: 20, y: 30 } : null} card={{ ...card, lane: "archived" }} strings={cardStrings("zh")} actions={{ children: 0, autoTitle }} theme={theme} onClose={onClose} />);
    });
    if (platform === "web") {
      const items = tree.root.findByType(CascadeMenu).props.sections.flatMap((section: { items: Array<{ key: string; disabled?: boolean }> }) => section.items);
      const index = items.findIndex((item: { key: string }) => item.key === "auto-title");
      expect(index).toBeGreaterThanOrEqual(0);
      expect(items[index].disabled).toBeFalsy();
      await act(async () => tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem")[index]!.props.onPress());
    } else {
      const automatic = tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "自动更新标题");
      expect(automatic.props.disabled).toBeFalsy();
      await act(async () => automatic.props.onPress());
    }
    expect(autoTitle).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    if (platform === "web") {
      const items = tree.root.findByType(CascadeMenu).props.sections.flatMap((section: { items: Array<{ key: string }> }) => section.items);
      const index = items.findIndex((item: { key: string }) => item.key === "rename");
      await act(async () => tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem")[index]!.props.onPress());
    } else {
      await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "修改标题").props.onPress());
    }
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title").props.onPress());
    await reveal("Generated title");
    expect(rpc.generate).toHaveBeenCalledWith({ agentId: card.id, action: "start", mode: "preview" });
    expect(rpc.rename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it.each(["touch", "pointer"])("replaces the %s menu with an editor without closing its owner", async (kind) => {
    const autoTitle = vi.fn();
    (globalThis as { __rnMockOS?: string }).__rnMockOS = kind === "pointer" ? "web" : "ios";
    await act(async () => {
      tree = TestRenderer.create(<CardContextMenu point={kind === "pointer" ? { x: 20, y: 30 } : null} card={card} strings={cardStrings("zh")} actions={{ children: 0, autoTitle }} theme={theme} onClose={onClose} />);
    });
    if (kind === "touch") {
      await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "修改标题").props.onPress());
    } else {
      const menu = tree.root.findByType(CascadeMenu);
      const items = menu.props.sections.flatMap((section: { items: Array<{ key: string }> }) => section.items);
      const index = items.findIndex((item: { key: string }) => item.key === "rename");
      const rows = tree.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
      await act(async () => rows[index]!.props.onPress());
    }
    expect(tree.root.findByType(TaskRenameDialog).props.agentId).toBe(card.id);
    expect(input().props.value).toBe(card.title);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => tree.root.find((node) => typeof node.type === "string" && node.props.testID === "task-rename-auto-title").props.onPress());
    expect(autoTitle).not.toHaveBeenCalled();
    expect(rpc.generate).toHaveBeenCalledWith({ agentId: card.id, action: "start", mode: "preview" });
    await reveal("Generated title");
    expect(input().props.value).toBe("Generated title");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not offer editing for a provider's read-only subagent", async () => {
    await act(async () => {
      tree = TestRenderer.create(<CardContextMenu point={null} card={{ ...card, subagent: { type: null, subtitle: null } }} strings={cardStrings("en")} actions={{ children: 0 }} theme={theme} onClose={onClose} />);
    });
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === "Edit title")).toHaveLength(0);
  });
});
