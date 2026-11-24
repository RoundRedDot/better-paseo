import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => null, useSettings: () => ({ data: undefined, status: "loading" }) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", useToast: () => ({ show() {}, error() {} }) }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ noteHover() {}, useInputCapabilities: () => ({ hover: false, touch: true, native: false }) }));
vi.mock("../../client/state/home-directory", () => ({ useHomeDirectory: () => undefined }));
// The rows and diffs the card mounts on demand, as markers.
vi.mock("../../client/components/tool-callouts", () => ({
  ToolCallout: (props: Record<string, unknown>) => React.createElement("ToolCallout", props),
  FileEditsPreview: (props: Record<string, unknown>) => React.createElement("FileEditsPreview", props),
}));

import { TurnWorkCard } from "../../client/components/turn-work-card";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { createTurnFooterStore } from "../../client/state/turn-footers";
import { collectTurnWork, splitTurns } from "../../client/state/turn-work";
import { updateEnhancerPreferences, getEnhancerPreferences } from "../../client/preferences";
import { closeDetailsIfCurrent, detailsApi, MARKER_LINGER_MS, useDetails } from "../../client/details/details-store";
import { getBlock } from "../../client/details/block-registry";
import { timelineEntry as entry } from "./helpers/turn-timeline";
import { Dimensions } from "react-native";
import { DetailsShellContext, type DetailsShellValue } from "../../client/details/contracts";
import { PreviewChromeContext } from "../../client/ui/hover-preview";
import { resetDisclosureStore } from "../../client/state/disclosure-store";
import { FadeIn } from "../../client/ui/fade-in";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
  foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

const tool = (callId: string, detail: ToolCallTimelineItem["detail"], name = "Edit") =>
  ({ type: "tool_call", name, callId, status: "completed", error: null, detail }) as ToolCallTimelineItem;
const edit = (callId: string, path: string) => tool(callId, { type: "edit", filePath: path, unifiedDiff: "@@\n-a\n+b\n+c" });

function turn() {
  const entries = [
    entry({ type: "user_message", text: "fix" }, 1),
    entry({ type: "reasoning", text: "**Check the root first**, then fix the path.\nMore." }, 2),
    entry(tool("r1", { type: "read", filePath: "a.ts" }, "Read"), 3),
    entry(edit("e1", "a.ts"), 4),
    entry(edit("e2", "a.ts"), 5),
    entry(edit("e3", "b.ts"), 6),
    entry(tool("e4", { type: "edit", filePath: "c.ts" }), 7),
    entry(tool("w1", { type: "write", filePath: "d.ts", content: "x\n" }, "Write"), 8),
    entry(tool("c1", { type: "shell", command: "npm test", output: "SECRET OUTPUT", exitCode: 0 }, "Bash"), 9),
    entry({ type: "assistant_message", text: "done" }, 10),
  ];
  const span = splitTurns(entries, { running: false, activeTurnId: null, fromStart: true })[0]!;
  return collectTurnWork(entries, span, "r:10000:done");
}

let renderer: TestRenderer.ReactTestRenderer;
let openId: string | null = null;
function Probe() { openId = useDetails("agent").openId; return null; }

const texts = () => renderer.root.findAll((node) => (node.type as unknown) === "Text").map((node) => node.children.filter((child) => typeof child === "string").join(""));
const byType = (type: string) => renderer.root.findAll((node) => (node.type as unknown) === type);
const pressText = (label: string) => {
  const target = renderer.root.findAll((node) => typeof node.props?.onPress === "function" &&
    node.findAll((child: ReactTestInstance) => child.children.some((part) => part === label)).length > 0).at(-1);
  if (!target) throw new Error(`nothing to press for ${label}`);
  act(() => { target.props.onPress(); });
};

beforeEach(() => {
  vi.spyOn(Dimensions, "get").mockReturnValue({ width: 1000, height: 844, scale: 3, fontScale: 1 });
  updateEnhancerPreferences({ language: "zh", blockDetails: true });
  const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
  act(() => { renderer = TestRenderer.create(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} /></>); });
});
afterEach(() => { act(() => renderer.unmount()); detailsApi.close("agent"); resetDisclosureStore(); vi.restoreAllMocks(); });

describe("turn work card", () => {
  it("closed: the work row and the file header, no paths", () => {
    const shown = texts();
    expect(shown).toEqual(["用时 9秒", "已编辑 4 个文件", "查看变更"]);
    expect(renderer.root.findByProps({ testID: "work-files:agent" }).props.accessibilityState).toEqual({ expanded: false });
    expect(byType("ToolCallout")).toHaveLength(0);
    expect(byType("FileEditsPreview")).toHaveLength(0);
  });

  it("opened file card: three paths, nothing else", () => {
    pressText("已编辑 4 个文件");
    const shown = texts();
    expect(renderer.root.findByProps({ testID: "work-files:agent" }).props.accessibilityState).toEqual({ expanded: true });
    expect(shown).toContain("再显示 1 个文件");
    expect(shown.some((text) => text.includes("撤销"))).toBe(false);
    expect(shown).not.toContain("d.ts");
    expect(shown.filter((text) => ["a.ts", "b.ts", "c.ts"].includes(text))).toHaveLength(3);
    // Summed edit events, per file: a.ts was edited twice (+2 −1 each).
    expect(shown).toContain("+4");
    expect(byType("ToolCallout")).toHaveLength(0);
    expect(byType("FileEditsPreview")).toHaveLength(0);
    expect(shown.some((text) => text.includes("SECRET OUTPUT"))).toBe(false);
    // A file with no diff has no line counts, so the header shows none either.
    expect(shown).not.toContain("+7");
  });

  it("opens the desktop work steps in details rather than expanding the timeline", () => {
    pressText("用时 9秒");
    expect(texts()).toContain("Check the root first, then fix the path.");
    expect(texts()).toContain("读取了文件 · 编辑了文件 · 运行了命令");
    expect(byType("ToolCallout")).toHaveLength(0);
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    expect(getBlock("agent", openId!)?.reserveTimeline).toBe(true);
    expect(byType("ToolCallout")).toHaveLength(0);
    pressText("用时 9秒");
    expect(byType("ToolCallout")).toHaveLength(0);
    expect(texts()).not.toContain("读取了文件 · 编辑了文件 · 运行了命令");
  });

  it("opens work steps when ordinary block details are disabled", () => {
    act(() => { updateEnhancerPreferences({ blockDetails: false }); });
    pressText("用时 9秒");
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    expect(byType("ToolCallout")).toHaveLength(0);
    expect(getEnhancerPreferences().blockDetails).toBe(false);
  });

  it("marks the selected work row for outside-click handling on web", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} /></>); });
    pressText("用时 9秒");
    const row = renderer.root.find((node) => (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "读取了文件 · 编辑了文件 · 运行了命令");
    expect(row.props.dataSet).toEqual({ bcworkdetails: "agent:work:r:10000:done:steps" });
    delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  });

  it.each([true, false])("marks the work row while selected with block details %s", (enabled) => {
    vi.useFakeTimers();
    act(() => { updateEnhancerPreferences({ blockDetails: enabled }); });
    const agentId = `selection-${enabled}`;
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<TurnWorkCard agentId={agentId} at={10000} work={turn()} store={store} tokens={tokens} compact={false} />); });
    pressText("用时 9秒");
    const markers = () => renderer.root.findAll((node) => (node.type as unknown) === "Animated.View" && node.props?.testID === "details-current-marker");
    expect(markers()).toHaveLength(0);
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    expect(markers()).toHaveLength(1);
    pressText("用时 9秒");
    expect(markers()).toHaveLength(0);
    pressText("用时 9秒");
    expect(markers()).toHaveLength(1);
    act(() => { detailsApi.open(agentId, "other"); });
    expect(markers()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    expect(markers()).toHaveLength(1);
    act(() => { detailsApi.close(agentId); });
    expect(markers()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    expect(markers()).toHaveLength(1);
    act(() => { closeDetailsIfCurrent(agentId, `${agentId}:work:r:10000:done:steps`); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    vi.useRealTimers();
  });

  it.each([["side", true], ["side", false], ["drawer", true], ["drawer", false]] as const)(
    "shows the work title and a working close button in %s when block details are %s", (form, enabled) => {
    act(() => { updateEnhancerPreferences({ blockDetails: enabled }); });
    if (form === "drawer") {
      vi.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
      const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
      act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact /></>); });
    }
    pressText("用时 9秒");
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    const block = getBlock("agent", openId!)!;
    const shell: DetailsShellValue = {
      agentId: "agent", entry: block, form, detent: "fit", fullscreen: false,
      pointer: form === "side", index: 0, count: 0, canStep: { previous: false, next: false },
      step() {}, close: () => detailsApi.close("agent"),
    };
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<DetailsShellContext.Provider value={shell}>
      <PreviewChromeContext.Provider value="details">{block.render()}</PreviewChromeContext.Provider>
    </DetailsShellContext.Provider>); });
    const title = panel.root.findByProps({ testID: "details-header-title" });
    expect(title.props.accessibilityLabel).toBe("读取了文件 · 编辑了文件 · 运行了命令");
    expect(panel.root.findAll((node) => (node.type as unknown) === "ToolCallout")).toHaveLength(7);
    const close = panel.root.findAll((node) => node.props?.accessibilityLabel === "关闭详情" && typeof node.props.onPress === "function").at(-1)!;
    expect(close).toBeDefined();
    act(() => { close.props.onPress(); });
    expect(openId).toBeNull();
    act(() => panel.unmount());
  });

  it("opens the complete work steps in the phone drawer", () => {
    vi.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact /></>); });
    pressText("用时 9秒");
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    expect(byType("ToolCallout")).toHaveLength(0);
    const block = getBlock("agent", openId!);
    expect(block?.title).toBe("读取了文件 · 编辑了文件 · 运行了命令");
  });

  it("keeps the opened steps across the move to the next row: drawn at once, the details panel still attached", () => {
    pressText("用时 9秒");
    expect(renderer.root.findAllByType(FadeIn)).toHaveLength(1);
    pressText("读取了文件 · 编辑了文件 · 运行了命令");
    const id = openId!;
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    // The running card is redrawn under the newest row: a new mount, in the commit that drops the old one.
    act(() => { renderer.update(<><Probe /><TurnWorkCard key="next-row" agentId="agent" at={11000} work={turn()} store={store}
      tokens={tokens} compact={false} /></>); });
    expect(texts()).toContain("Check the root first, then fix the path.");
    expect(renderer.root.findAllByType(FadeIn)).toHaveLength(0);
    expect(openId).toBe(id);
    expect(getBlock("agent", id)?.mounted).toBe(true);
  });

  it("keeps one status line while the turn runs: what runs, then a thought, then the newest finished step", () => {
    const entries = [
      entry({ type: "user_message", text: "fix" }, 1),
      entry(edit("e1", "a.ts"), 2),
      entry({ ...tool("c1", { type: "shell", command: "npm test", output: "" }, "Bash"), status: "running" } as ToolCallTimelineItem, 3),
    ];
    const span = splitTurns(entries, { running: true, activeTurnId: null, fromStart: true })[0]!;
    const running = collectTurnWork(entries, span, "live");
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    const draw = (work: typeof running) => act(() => { renderer.update(<TurnWorkCard agentId="agent" at={10000} work={work}
      store={store} tokens={tokens} compact={false} />); });
    const lines = () => renderer.root.findAll((node) => typeof node.type === "string" &&
      typeof node.props.accessibilityLabel === "string" && /npm test|a\.ts|\u6b63\u5728\u601d\u8003/.test(node.props.accessibilityLabel))
      .map((node) => node.props.accessibilityLabel);
    draw(running);
    expect(texts()).toContain("\u5de5\u4f5c\u8fc7\u7a0b \u00b7 1 \u6b65");
    expect(lines()).toEqual(["\u6b63\u5728\u8fd0\u884c\u547d\u4ee4 npm test"]);
    // The command ends: the same line names the newest finished step, it does not leave.
    draw({ ...running, current: null, latest: running.steps[0]! });
    expect(lines()).toEqual(["\u7f16\u8f91\u4e86 a.ts"]);
    draw({ ...running, current: null, thinking: true });
    expect(lines()).toEqual(["\u6b63\u5728\u601d\u8003"]);
    // A settled card has no status line.
    draw(turn());
    expect(lines()).toEqual([]);
  });

  it("closes the file card again, and keeps the choice across a remount", () => {
    pressText("已编辑 4 个文件");
    expect(texts()).toContain("a.ts");
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => renderer.unmount());
    act(() => { renderer = TestRenderer.create(<TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} />); });
    expect(texts()).toContain("a.ts");
    pressText("已编辑 4 个文件");
    expect(texts()).not.toContain("a.ts");
    // Another agent's card with the same calls is its own choice.
    act(() => { renderer.update(<TurnWorkCard agentId="other" at={10000} work={turn()} store={store} tokens={tokens} compact={false} />); });
    expect(texts()).not.toContain("a.ts");
  });

  it("opens the first file's changes from a closed card without opening the card", () => {
    pressText("查看变更");
    expect(openId).toBe("agent:work:r:10000:done:file:a.ts");
    expect(texts()).not.toContain("a.ts");
  });

  it("opens a closed card for 查看变更 when the changes show under it", () => {
    act(() => { updateEnhancerPreferences({ blockDetails: false }); });
    pressText("查看变更");
    expect(texts()).toContain("a.ts");
    expect(byType("ToolCallout")).toHaveLength(2);
    // Closing the card takes the inline changes with it.
    pressText("已编辑 4 个文件");
    expect(byType("ToolCallout")).toHaveLength(0);
  });

  it("shows more paths only on request, and opens one file's changes in the details panel", () => {
    pressText("已编辑 4 个文件");
    pressText("再显示 1 个文件");
    expect(texts()).toContain("d.ts");
    expect(texts()).toContain("收起文件");
    pressText("b.ts");
    expect(openId).toBe("agent:work:r:10000:done:file:b.ts");
    expect(getBlock("agent", openId!)?.title).toBe("b.ts");
    // The card itself never mounts the diff.
    expect(byType("FileEditsPreview")).toHaveLength(0);
    // A file with no diff cannot be opened.
    expect(renderer.root.findAll((node) => node.props?.testID === "work-file:agent:c.ts" && typeof node.props.onPress === "function")).toHaveLength(0);
    pressText("查看变更");
    expect(openId).toBe("agent:work:r:10000:done:file:a.ts");
  });

  it("does not follow the tool detail preference", () => {
    act(() => { updateEnhancerPreferences({ toolDetail: "expand-failed" }); });
    expect(getEnhancerPreferences().toolDetail).toBe("expand-failed");
    expect(byType("ToolCallout")).toHaveLength(0);
  });
});
