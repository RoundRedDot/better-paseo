import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => () => Promise.resolve(null), usePaseo: () => null, useSettings: () => ({ data: undefined, status: "loading" }) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", useToast: () => ({ show() {}, error() {} }) }));
const caps = vi.hoisted(() => ({ hover: false }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ noteHover() {},
  useInputCapabilities: () => ({ hover: caps.hover, touch: !caps.hover, native: false }) }));
vi.mock("../../client/state/home-directory", () => ({ useHomeDirectory: () => undefined }));
// The rows and diffs the card mounts on demand, as markers.
vi.mock("../../client/components/tool-callouts", () => ({
  ToolCallout: (props: Record<string, unknown>) => React.createElement("ToolCallout", {
    ...props, translationScope: React.useContext(SelectionTranslationContext),
  }),
  FileEditsPreview: (props: Record<string, unknown>) => React.createElement("FileEditsPreview", {
    ...props, translationScope: React.useContext(SelectionTranslationContext),
  }),
}));

import { TurnWorkCard } from "../../client/components/turn-work-card";
import { buildThemeTokens, radiusV2, withAlpha } from "../../client/components/theme-tokens";
import { createTurnFooterStore } from "../../client/state/turn-footers";
import { collectTurnWork, splitTurns } from "../../client/state/turn-work";
import { updateEnhancerPreferences, getEnhancerPreferences } from "../../client/preferences";
import { closeDetailsIfCurrent, detailsApi, MARKER_LINGER_MS, readDetails, useDetails } from "../../client/details/details-store";
import { detailsForm } from "../../client/details/layout-model";
import { getBlock } from "../../client/details/block-registry";
import { timelineEntry as entry } from "./helpers/turn-timeline";
import { Dimensions, StyleSheet } from "react-native";
import { DetailsShellContext, type DetailsShellValue } from "../../client/details/contracts";
import { PreviewActionsContext, PreviewChromeContext } from "../../client/ui/hover-preview";
import { resetDisclosureStore } from "../../client/state/disclosure-store";
import { SELECTION_SCOPE_ATTRIBUTES, SelectionTranslationContext } from "../../client/translation/selection";

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
afterEach(() => {
  act(() => renderer.unmount()); detailsApi.close("agent"); resetDisclosureStore(); vi.restoreAllMocks();
  caps.hover = false; delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

/** The form the details shell settles on for a window, written back to the store as the shell does. */
function settleForm(agentId: string, width: number, pointer: boolean) {
  act(() => { detailsApi.setForm(agentId, detailsForm({ width, height: 844, sidebar: 0, pointer }, null)); });
}
const titleRow = (label: string) => renderer.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === label);

describe("turn work card", () => {
  it("uses the same translucent highlight for the file header", () => {
    const header = () => renderer.root.find((node) => (node.type as unknown) === "Pressable" && node.props.testID === "work-files:agent");
    act(() => header().props.onHoverIn());
    expect(StyleSheet.flatten(header().props.style).backgroundColor).toBe(tokens.row.hover);
    expect(tokens.row.hover).toMatch(/^rgba\(/);
  });
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

  it.each([false, true])("opens and closes work details in one press, compact=%s", (compact) => {
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={compact} /></>); });
    settleForm("agent", 1000, true);
    pressText("用时 9秒");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    expect(texts()).not.toContain("读取了文件 · 编辑了文件 · 运行了命令");
    const block = getBlock("agent", openId!)!;
    expect(block.title).toBe("用时 9秒 · 读取了文件 · 编辑了文件 · 运行了命令");
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    expect(panel.root.findAll((node) => (node.type as unknown) === "ToolCallout")).toHaveLength(7);
    expect(panel.root.findAll((node) => node.children.includes("Check the root first, then fix the path.")).length).toBeGreaterThan(0);
    act(() => panel.unmount());
    pressText("用时 9秒");
    expect(openId).toBeNull();
    pressText("用时 9秒");
    expect(openId).toBe(block.id);
    act(() => { renderer.update(<><Probe /><TurnWorkCard key="next" agentId="agent" at={11000} work={turn()} store={store} tokens={tokens} compact={compact} /></>); });
    expect(getBlock("agent", block.id)?.mounted).toBe(true);
  });

  it("opens work details even when ordinary block details are disabled", () => {
    act(() => { updateEnhancerPreferences({ blockDetails: false }); });
    pressText("用时 9秒");
    expect(openId).toBe("agent:work:r:10000:done:steps");
  });

  it("gives every work step in the independent details the original conversation's tool-output scope", () => {
    pressText("用时 9秒");
    const block = getBlock("agent", openId!)!;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    const callouts = panel.root.findAll((node) => (node.type as unknown) === "ToolCallout");
    expect(callouts).toHaveLength(7);
    for (const callout of callouts) {
      expect(callout.props.translationScope).toMatchObject({ agentId: "agent", kind: "tool_output", streaming: false });
    }
    act(() => panel.unmount());
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
    expect(title.props.accessibilityLabel).toBe("用时 9秒 · 读取了文件 · 编辑了文件 · 运行了命令");
    expect(panel.root.findAll((node) => (node.type as unknown) === "ToolCallout")).toHaveLength(7);
    const cells = panel.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "work-step-cell");
    const list = panel.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "work-step-list");
    expect(list).toHaveLength(1);
    expect(cells.every((cell) => {
      let parent = cell.parent;
      while (parent && typeof parent.type !== "string") parent = parent.parent;
      return parent === list[0];
    })).toBe(true);
    expect(list[0]!.props.style?.gap ?? 0).toBe(0);
    expect(cells.map((cell) => cell.props.style?.paddingVertical)).toEqual(Array(7).fill(4));
    expect(cells.map((cell) => cell.props.style?.paddingHorizontal)).toEqual(Array(7).fill(12));
    expect(cells.map((cell) => cell.props.style?.backgroundColor)).toEqual([
      undefined, withAlpha(tokens.foreground, tokens.isDark ? 0.045 : 0.04), undefined,
      withAlpha(tokens.foreground, tokens.isDark ? 0.045 : 0.04), undefined,
      withAlpha(tokens.foreground, tokens.isDark ? 0.045 : 0.04), undefined,
    ]);
    const close = panel.root.findAll((node) => node.props?.accessibilityLabel === "关闭详情" && typeof node.props.onPress === "function").at(-1)!;
    expect(close).toBeDefined();
    act(() => { close.props.onPress(); });
    expect(openId).toBeNull();
    act(() => panel.unmount());
  });

  it.each([["web", true], ["web", false], ["ios", true], ["ios", false]] as const)(
    "fills the %s details body while keeping cell and intent insets (wrap %s)", (platform, wrap) => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
      pressText("用时 9秒");
      const block = getBlock("agent", openId!)!;
      let panel!: TestRenderer.ReactTestRenderer;
      const actions = { maximizable: false, maximized: false, maximize() {}, close() {}, fill: true,
        wrap: { on: wrap, toggle() {}, tokens } };
      act(() => { panel = TestRenderer.create(<PreviewChromeContext.Provider value="details">
        <PreviewActionsContext.Provider value={actions}>{block.render()}</PreviewActionsContext.Provider>
      </PreviewChromeContext.Provider>); });
      const body = panel.root.findAll((node) => typeof node.type === "string" && node.props.testID === "hover-preview-body")[0]!;
      const bodyStyle = StyleSheet.flatten(platform === "web" ? body.props.style : body.props.contentContainerStyle);
      expect(bodyStyle.paddingHorizontal).toBe(0);
      const cells = panel.root.findAll((node) => (node.type as unknown) === "View" && node.props.testID === "work-step-cell");
      expect(cells).toHaveLength(7);
      expect(cells.every((cell) => cell.props.style.paddingHorizontal === 12)).toBe(true);
      const intent = panel.root.findAll((node) => (node.type as unknown) === "Text" && node.children.includes("Check the root first, then fix the path."))[0]!;
      expect(StyleSheet.flatten(intent.props.style).paddingHorizontal).toBe(12);
      act(() => panel.unmount());
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    });

  it("marks the title row while details are selected", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} /></>); });
    const row = renderer.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "用时 9秒");
    expect(row.props.dataSet).toEqual({ bcworkdetails: "agent:work:r:10000:done:steps" });
    pressText("用时 9秒");
    const markers = renderer.root.findAll((node) => (node.type as unknown) === "Animated.View" && node.props?.testID === "details-current-marker");
    expect(markers).toHaveLength(1);
    expect(StyleSheet.flatten(markers[0]!.props.style).borderRadius).toBe(radiusV2.block);
    delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  });

  it.each([true, false])("marks the title row while selected, lingers after a switch or close, with block details %s", (enabled) => {
    vi.useFakeTimers();
    act(() => { updateEnhancerPreferences({ blockDetails: enabled }); });
    const agentId = `selection-${enabled}`;
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<TurnWorkCard agentId={agentId} at={10000} work={turn()} store={store} tokens={tokens} compact={false} />); });
    settleForm(agentId, 1000, true);
    const markers = () => renderer.root.findAll((node) => (node.type as unknown) === "Animated.View" && node.props?.testID === "details-current-marker");
    expect(markers()).toHaveLength(0);
    pressText("用时 9秒");
    expect(markers()).toHaveLength(1);
    // Another block opens: the title lingers, then lets go.
    act(() => { detailsApi.open(agentId, "other"); });
    expect(markers()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    // Closed from the panel: the same linger.
    pressText("用时 9秒");
    expect(markers()).toHaveLength(1);
    act(() => { detailsApi.close(agentId); });
    expect(markers()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    // An outside click clears the marker at once.
    pressText("用时 9秒");
    expect(markers()).toHaveLength(1);
    act(() => { closeDetailsIfCurrent(agentId, `${agentId}:work:r:10000:done:steps`); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    vi.useRealTimers();
  });

  it("taps the title on a phone as any row: opens the drawer, and a second tap leaves the drawer open", () => {
    vi.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact /></>); });
    pressText("用时 9秒");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    settleForm("agent", 390, false);
    pressText("用时 9秒");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    // A floating panel leaves the row in reach: the tap closes it, as it does a tool row.
    settleForm("agent", 700, false);
    pressText("用时 9秒");
    expect(openId).toBeNull();
  });

  it("reports the title's selection to assistive technology, not a collapsed disclosure", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    settleForm("agent", 1000, true);
    expect(titleRow("用时 9秒").props.accessibilityState).toEqual({ selected: false });
    expect(titleRow("用时 9秒").props["aria-expanded"]).toBeUndefined();
    expect(titleRow("用时 9秒").props["aria-pressed"]).toBe(false);
    pressText("用时 9秒");
    expect(titleRow("用时 9秒").props.accessibilityState).toEqual({ selected: true });
    expect(titleRow("用时 9秒").props["aria-pressed"]).toBe(true);
  });

  it("shows the details entry's panel icon on hover, not an in-place chevron", () => {
    caps.hover = true;
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} /></>); });
    act(() => { titleRow("用时 9秒").props.onHoverIn(); });
    const icons = titleRow("用时 9秒").findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.name);
    expect(icons).toContain("PanelRight");
    expect(icons).not.toContain("ChevronRight");
  });

  it("lets a selection of the intent line be translated as the turn's reasoning", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    pressText("用时 9秒");
    const block = getBlock("agent", openId!)!;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<PreviewChromeContext.Provider value="details">{block.render()}</PreviewChromeContext.Provider>); });
    const intent = panel.root.findAll((node) => (node.type as unknown) === "Text" && node.children.includes("Check the root first, then fix the path."))[0]!;
    expect(intent.props.selectable).toBe(true);
    expect(intent.props.dataSet).toMatchObject({ bcselection: true, [SELECTION_SCOPE_ATTRIBUTES.agent]: "agent",
      [SELECTION_SCOPE_ATTRIBUTES.kind]: "reasoning", [SELECTION_SCOPE_ATTRIBUTES.streaming]: "0" });
    act(() => panel.unmount());
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
    pressText("工作过程 · 1 步");
    expect(getBlock("agent", "agent:work:live:steps")?.title).toBe("工作过程 · 1 步 · 编辑了文件");
    expect(lines()).toEqual(["正在运行命令 npm test"]);
    // The command ends: the same line names the newest finished step, it does not leave.
    draw({ ...running, current: null, latest: running.steps[0]! });
    expect(lines()).toEqual(["\u7f16\u8f91\u4e86 a.ts"]);
    draw({ ...running, current: null, thinking: true });
    expect(lines()).toEqual(["\u6b63\u5728\u601d\u8003"]);
    // A settled card has no status line.
    draw(turn());
    expect(lines()).toEqual([]);
    expect(readDetails("agent").openId).toBe("agent:work:r:10000:done:steps");
    expect(getBlock("agent", "agent:work:r:10000:done:steps")?.title).toBe("用时 9秒 · 读取了文件 · 编辑了文件 · 运行了命令");
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

  it("gives detached file changes their conversation's tool-output scope", () => {
    pressText("查看变更");
    const block = getBlock("agent", openId!)!;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    expect(panel.root.find((node) => (node.type as unknown) === "FileEditsPreview").props.translationScope)
      .toMatchObject({ agentId: "agent", kind: "tool_output", streaming: false });
    act(() => panel.unmount());
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
