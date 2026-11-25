import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import "./helpers/quiet-renderer";

vi.mock("react-native", () => import("./helpers/rn-mock"));
const translate = vi.hoisted(() => ({ rpc: (() => Promise.resolve(null)) as (...args: unknown[]) => Promise<unknown> }));
vi.mock("@getpaseo/plugin/client", () => ({ useAgent: () => undefined, useWorkspace: () => undefined,
  useRpc: () => translate.rpc, usePaseo: () => null, useSettings: () => ({ data: undefined, status: "loading" }) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: "Icon", useToast: () => ({ show() {}, error() {} }) }));
const caps = vi.hoisted(() => ({ hover: false }));
vi.mock("../../client/ui/use-input-capabilities", () => ({ noteHover() {},
  useInputCapabilities: () => ({ hover: caps.hover, touch: !caps.hover, native: false }) }));
vi.mock("../../client/state/home-directory", () => ({ useHomeDirectory: () => undefined }));
// The rows and diffs the card mounts on demand, as markers.
const calloutDraws = vi.hoisted(() => ({ renders: 0, mounts: 0 }));
function ToolCalloutStripe({ props, contexts }: { props: Record<string, unknown>; contexts: Record<string, unknown> }) {
  return React.createElement("ToolCallout", { ...props, ...contexts, stickyStripe: React.useContext(StickyStripeContext) },
    (props.leading as { content: React.ReactNode } | undefined)?.content);
}
vi.mock("../../client/components/tool-callouts", () => ({
  // Counts the row's own draws; the stripe is read below it, as the real row's pinned card does.
  ToolCallout: (props: Record<string, unknown>) => {
    calloutDraws.renders += 1;
    React.useEffect(() => { calloutDraws.mounts += 1; }, []);
    const contexts = { translationScope: React.useContext(SelectionTranslationContext),
      stickyStep: React.useContext(StickyStepContext), stickySource: React.useContext(DetailsStickySourceContext) };
    return React.createElement(ToolCalloutStripe, { props, contexts });
  },
  FileEditsPreview: (props: Record<string, unknown>) => React.createElement("FileEditsPreview", {
    ...props, translationScope: React.useContext(SelectionTranslationContext),
  }),
}));

import { TurnWorkCard, callKinds } from "../../client/components/turn-work-card";
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
import { resetWorkFilterStore } from "../../client/state/work-filter-store";
import { SELECTION_SCOPE_ATTRIBUTES, SelectionTranslationContext } from "../../client/translation/selection";
import { DetailsStickySourceContext, StickyStepContext, StickyStripeContext } from "../../client/details/sticky-step";
import { DEFAULT_TIMELINE_TRANSLATION_SETTINGS, publishTranslationSettings, resetTranslationSettingsStoreForTests } from "../../client/translation/settings-store";
import { resetTranslationStoreForTests } from "../../client/translation/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
  foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#198754", statusWarning: "#a36a00", statusDanger: "#d92d20" });

const tool = (callId: string, detail: ToolCallTimelineItem["detail"], name = "Edit") =>
  ({ type: "tool_call", name, callId, status: "completed", error: null, detail }) as ToolCallTimelineItem;
const edit = (callId: string, path: string) => tool(callId, { type: "edit", filePath: path, unifiedDiff: "@@\n-a\n+b\n+c" });

function turn(extra: ToolCallTimelineItem[] = []) {
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
    ...extra.map((item, index) => entry(item, 9.1 + index * 0.1)),
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
  act(() => renderer.unmount()); detailsApi.close("agent"); resetDisclosureStore(); resetWorkFilterStore(); vi.restoreAllMocks();
  caps.hover = false; delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  translate.rpc = () => Promise.resolve(null); resetTranslationSettingsStoreForTests(); resetTranslationStoreForTests();
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
    expect(shown).toEqual(["工作过程 · 7 步 · 7 次工具调用", "已编辑 4 个文件", "查看变更"]);
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
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    expect(texts()).not.toContain("读取了文件 · 编辑了文件 · 运行了命令");
    const block = getBlock("agent", openId!)!;
    expect(block.title).toBe("工作过程 · 7 步 · 7 次工具调用 · 读取了文件 · 编辑了文件 · 运行了命令");
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    expect(panel.root.findAll((node) => (node.type as unknown) === "ToolCallout")).toHaveLength(7);
    expect(panel.root.findAll((node) => node.children.includes("Check the root first, then fix the path.")).length).toBeGreaterThan(0);
    // The panel opens with a filter bar: all of the turn's steps, then each group, counted.
    const chipLabels = () => panel.root.findByProps({ testID: "work-filter" }).findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.children.join(""));
    expect(chipLabels()).toEqual(["全部 7", "读取 1", "编辑 5", "命令 1"]);
    act(() => panel.unmount());
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBeNull();
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBe(block.id);
    act(() => { renderer.update(<><Probe /><TurnWorkCard key="next" agentId="agent" at={11000} work={turn()} store={store} tokens={tokens} compact={compact} /></>); });
    expect(getBlock("agent", block.id)?.mounted).toBe(true);
  });

  it("opens work details even when ordinary block details are disabled", () => {
    act(() => { updateEnhancerPreferences({ blockDetails: false }); });
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBe("agent:work:r:10000:done:steps");
  });

  it("gives every work step in the independent details the original conversation's tool-output scope", () => {
    pressText("工作过程 · 7 步 · 7 次工具调用");
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
    pressText("工作过程 · 7 步 · 7 次工具调用");
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
    expect(title.props.accessibilityLabel).toBe("工作过程 · 7 步 · 7 次工具调用 · 读取了文件 · 编辑了文件 · 运行了命令");
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
    expect(cells.map((cell) => StyleSheet.flatten(cell.props.style).paddingVertical)).toEqual(Array(7).fill(4));
    expect(cells.map((cell) => StyleSheet.flatten(cell.props.style).paddingHorizontal)).toEqual(Array(7).fill(12));
    expect(panel.root.findAll((node) => (node.type as unknown) === "Text" && node.props.testID === "work-step-number")
      .map((number) => number.children.join("")))
      .toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(cells.map((cell) => StyleSheet.flatten(cell.props.style).backgroundColor)).toEqual([
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

  it("keeps an opened step open when the details body mounts again (iOS text size step)", () => {
    pressText("工作过程 · 7 步 · 7 次工具调用");
    const block = getBlock("agent", openId!)!;
    const draw = () => <PreviewChromeContext.Provider value="details">{block.render()}</PreviewChromeContext.Provider>;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(draw()); });
    const rows = () => panel.root.findAll((node) => (node.type as unknown) === "ToolCallout");
    expect(rows().map((row) => row.props.expanded)).toEqual(Array(7).fill(false));
    act(() => rows()[3]!.props.onExpandedChange(true));
    expect(rows().map((row) => row.props.expanded)).toEqual([false, false, false, true, false, false, false]);
    act(() => panel.unmount());
    act(() => { panel = TestRenderer.create(draw()); });
    expect(rows().map((row) => row.props.expanded)).toEqual([false, false, false, true, false, false, false]);
    act(() => panel.unmount());
  });

  it.each([["web", true], ["web", false], ["ios", true], ["ios", false]] as const)(
    "fills the %s details body while keeping cell and intent insets (wrap %s)", (platform, wrap) => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
      pressText("工作过程 · 7 步 · 7 次工具调用");
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
      expect(cells.every((cell) => StyleSheet.flatten(cell.props.style).paddingHorizontal === 12)).toBe(true);
      const intent = panel.root.findAll((node) => (node.type as unknown) === "Text" && node.children.includes("Check the root first, then fix the path."))[0]!;
      expect(StyleSheet.flatten(intent.props.style).paddingHorizontal).toBe(12);
      // Each step may pin its opened row to this body, behind its own stripe.
      const rows = panel.root.findAll((node) => (node.type as unknown) === "ToolCallout");
      expect(rows.every((row) => row.props.stickySource !== null)).toBe(true);
      expect(new Set(rows.map((row) => row.props.stickySource)).size).toBe(1);
      expect(rows.every((row) => row.props.stickyStep !== null)).toBe(true);
      expect(rows.map((row) => row.props.stickyStripe)).toEqual(cells.map((cell) => StyleSheet.flatten(cell.props.style).backgroundColor));
      act(() => panel.unmount());
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    });

  it("marks the title row while details are selected", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} /></>); });
    const row = renderer.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityLabel === "工作过程 · 7 步 · 7 次工具调用");
    expect(row.props.dataSet).toEqual({ bcworkdetails: "agent:work:r:10000:done:steps" });
    pressText("工作过程 · 7 步 · 7 次工具调用");
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
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(markers()).toHaveLength(1);
    // Another block opens: the title lingers, then lets go.
    act(() => { detailsApi.open(agentId, "other"); });
    expect(markers()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    // Closed from the panel: the same linger.
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(markers()).toHaveLength(1);
    act(() => { detailsApi.close(agentId); });
    expect(markers()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(MARKER_LINGER_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(markers()).toHaveLength(0);
    // An outside click clears the marker at once.
    pressText("工作过程 · 7 步 · 7 次工具调用");
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
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    settleForm("agent", 390, false);
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBe("agent:work:r:10000:done:steps");
    // A floating panel leaves the row in reach: the tap closes it, as it does a tool row.
    settleForm("agent", 700, false);
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(openId).toBeNull();
  });

  it("reports the title's selection to assistive technology, not a collapsed disclosure", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    settleForm("agent", 1000, true);
    expect(titleRow("工作过程 · 7 步 · 7 次工具调用").props.accessibilityState).toEqual({ selected: false });
    expect(titleRow("工作过程 · 7 步 · 7 次工具调用").props["aria-expanded"]).toBeUndefined();
    expect(titleRow("工作过程 · 7 步 · 7 次工具调用").props["aria-pressed"]).toBe(false);
    pressText("工作过程 · 7 步 · 7 次工具调用");
    expect(titleRow("工作过程 · 7 步 · 7 次工具调用").props.accessibilityState).toEqual({ selected: true });
    expect(titleRow("工作过程 · 7 步 · 7 次工具调用").props["aria-pressed"]).toBe(true);
  });

  it("shows the details entry's panel icon on hover, not an in-place chevron", () => {
    caps.hover = true;
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn()} store={store} tokens={tokens} compact={false} /></>); });
    act(() => { titleRow("工作过程 · 7 步 · 7 次工具调用").props.onHoverIn(); });
    const icons = titleRow("工作过程 · 7 步 · 7 次工具调用").findAll((node) => (node.type as unknown) === "Icon").map((node) => node.props.name);
    expect(icons).toContain("PanelRight");
    expect(icons).not.toContain("ChevronRight");
  });

  it("lets a selection of the intent line be translated as the turn's reasoning", () => {
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    pressText("工作过程 · 7 步 · 7 次工具调用");
    const block = getBlock("agent", openId!)!;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<PreviewChromeContext.Provider value="details">{block.render()}</PreviewChromeContext.Provider>); });
    const intent = panel.root.findAll((node) => (node.type as unknown) === "Text" && node.children.includes("Check the root first, then fix the path."))[0]!;
    expect(intent.props.selectable).toBe(true);
    expect(intent.props.dataSet).toMatchObject({ bcselection: true, [SELECTION_SCOPE_ATTRIBUTES.agent]: "agent",
      [SELECTION_SCOPE_ATTRIBUTES.kind]: "reasoning", [SELECTION_SCOPE_ATTRIBUTES.streaming]: "0" });
    act(() => panel.unmount());
  });

  describe.each(["web", "ios", "android"] as const)("%s intent translation", (platform) => {
    const INTENT = "Check the root first, then fix the path.";
    const openPanel = () => {
      (globalThis as { __rnMockOS?: string }).__rnMockOS = platform;
      pressText("工作过程 · 7 步 · 7 次工具调用");
      let panel!: TestRenderer.ReactTestRenderer;
      act(() => { panel = TestRenderer.create(<PreviewChromeContext.Provider value="details">{getBlock("agent", openId!)!.render()}</PreviewChromeContext.Provider>); });
      return panel;
    };
    const button = (panel: TestRenderer.ReactTestRenderer) => panel.root.findAll((node) => (node.type as unknown) === "Pressable" && node.props.testID === "work-intent-translate");
    const intentText = (panel: TestRenderer.ReactTestRenderer) => panel.root.findAll((node) => (node.type as unknown) === "Text" && node.props.selectable === true)[0]!;

    it("translates the intent in place from its own button and restores the source", async () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: true, mode: "openai",
        endpoint: "https://api.example.test/v1", endpointModel: "test-model" }, "intent-on");
      let resolve!: (value: unknown) => void;
      const calls: unknown[] = [];
      translate.rpc = (input) => { calls.push(input); return new Promise((done) => { resolve = done; }); };
      const panel = openPanel();
      const slot = panel.root.find((node) => (node.type as unknown) === "View" && node.props.testID === "work-intent-translation-slot");
      // Touch shows the button without a hover, as beside a reply's block.
      expect(StyleSheet.flatten(slot.props.style).opacity).toBe(1);
      expect(calls).toHaveLength(0);
      await act(async () => button(panel)[0]!.props.onPress({ stopPropagation() {} }));
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ agentId: "agent", sourceKind: "reasoning", text: INTENT });
      expect(intentText(panel).children.join("")).toBe(INTENT);
      await act(async () => resolve({ state: "done", translation: "先检查根目录，再修路径。", targetLanguageCode: "zh-CN",
        origin: "https://api.example.test", model: "test-model" }));
      await vi.waitFor(() => expect(intentText(panel).children.join("")).toBe("先检查根目录，再修路径。"));
      await act(async () => button(panel)[0]!.props.onPress({ stopPropagation() {} }));
      expect(intentText(panel).children.join("")).toBe(INTENT);
      act(() => panel.unmount());
    });

    it("offers no button when translation is off", () => {
      publishTranslationSettings({ ...DEFAULT_TIMELINE_TRANSLATION_SETTINGS, enabled: false }, "intent-off");
      const panel = openPanel();
      expect(button(panel)).toHaveLength(0);
      expect(panel.root.findAll((node) => node.props.testID === "work-intent-translation-slot")).toHaveLength(0);
      act(() => panel.unmount());
    });
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
    expect(getBlock("agent", "agent:work:r:10000:done:steps")?.title).toBe("工作过程 · 7 步 · 7 次工具调用 · 读取了文件 · 编辑了文件 · 运行了命令");
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
    // A desktop side panel like the step list's, not the drawer.
    expect(getBlock("agent", openId!)).toMatchObject({ reserveTimeline: true, dismissOnOutside: true });
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

describe("call kinds", () => {
  it("counts every call of the turn by kind, a failed call as failed whatever it did", () => {
    const call = (callId: string, name: string, detail: Record<string, unknown>, status = "completed") =>
      ({ type: "tool_call", name, callId, status, error: status === "failed" ? "boom" : null, detail }) as unknown as ToolCallTimelineItem;
    expect(callKinds([
      call("r1", "Read", { type: "read", filePath: "a.ts" }),
      call("s1", "Grep", { type: "search", query: "foo" }),
      call("s2", "Glob", { type: "search", query: "*.ts" }),
      call("f1", "WebFetch", { type: "fetch", url: "https://example.com" }),
      call("m1", "mcp__linear__get_issue", { type: "unknown", input: {}, output: null }),
      call("c1", "Bash", { type: "shell", command: "npm test", exitCode: 1 }, "failed"),
      call("c2", "Bash", { type: "shell", command: "ls", exitCode: 0 }),
      // A question to the user is its own group, not 其他; a failed one is still a failure.
      call("q1", "AskUserQuestion", { type: "unknown", input: { questions: [{ question: "Ship?", options: [{ label: "Yes" }] }] }, output: null }),
      call("q2", "request_user_input_async", { type: "unknown", input: { questions: [{ question: "Where?" }] }, output: null }),
      call("q3", "AskUserQuestion", { type: "unknown", input: { questions: [{ question: "Now?", options: [{ label: "Yes" }] }] }, output: null }, "failed"),
      call("o1", "TodoWrite", { type: "unknown", input: { todos: [] }, output: null }),
      // Every provider's question tool, however it records the call: Codex in text plus metadata,
      // Codex's async questions in text alone, OMP's ask and Pi's ask_user without a questions list.
      { ...call("q4", "request_user_input", { type: "plain_text", text: "Merge now?\nYes, No", icon: "brain" }),
        metadata: { questions: [{ id: "0", question: "Merge now?", options: [{ label: "Yes" }, { label: "No" }] }] } } as ToolCallTimelineItem,
      call("q5", "request_user_input_async", { type: "plain_text", text: "Which port?\n8080, 9090", icon: "brain" }),
      call("q6", "ask", { type: "plain_text", label: "Ship it?", text: "Ship it?\nYes" }),
      call("q7", "ask_user", { type: "unknown", input: { question: "Name?", options: ["A", "B"] }, output: null }),
      call("q8", "question", { type: "unknown", input: { questions: [{ question: "Which?", options: [{ label: "x" }] }] }, output: null }),
    ])).toEqual([{ kind: "read", count: 1 }, { kind: "command", count: 1 }, { kind: "search", count: 2 },
      { kind: "fetch", count: 1 }, { kind: "mcp", count: 1 }, { kind: "question", count: 7 }, { kind: "other", count: 1 },
      { kind: "failed", count: 2 }]);
  });
});

describe("work details filter", () => {
  // Two calls that fold into no step: a failed command and a search. They still count, and list.
  const unfolded = [
    { ...tool("x1", { type: "shell", command: "npm run lint", output: "boom", exitCode: 1 }, "Bash"), status: "failed", error: "boom" } as ToolCallTimelineItem,
    tool("s1", { type: "search", query: "foo" } as ToolCallTimelineItem["detail"], "Grep"),
    // The timeline draws no row for a notification that only repeats its command: not counted, not listed.
    { ...tool("task_notification_1", { type: "plain_text", label: "npm test", text: "npm test", icon: "wrench" } as ToolCallTimelineItem["detail"],
      "task_notification"), metadata: { synthetic: true, source: "claude_task_notification", taskId: "t1", status: "completed" } } as ToolCallTimelineItem,
  ];
  beforeEach(() => {
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn(unfolded)} store={store} tokens={tokens} compact={false} /></>); });
  });
  function openPanel() {
    pressText("工作过程 · 7 步 · 9 次工具调用");
    const block = getBlock("agent", openId!)!;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    return panel;
  }
  // A switch hides the cells outside the group; only the shown ones count.
  const shownCells = (panel: TestRenderer.ReactTestRenderer) => panel.root.findAll((node) =>
    (node.type as unknown) === "View" && node.props.testID === "work-step-cell" && StyleSheet.flatten(node.props.style).display !== "none");
  const numbers = (panel: TestRenderer.ReactTestRenderer) => shownCells(panel)
    .map((cell) => cell.findAll((node) => (node.type as unknown) === "ToolCallout")[0]!.props.data.callId);
  const chip = (panel: TestRenderer.ReactTestRenderer, kind: string) => panel.root.findByProps({ testID: `work-filter:${kind}` });

  it("groups every tool call, adding up to the card's count", () => {
    const panel = openPanel();
    const chipLabels = panel.root.findByProps({ testID: "work-filter" }).findAll((node) => (node.type as unknown) === "Text")
      .map((node) => node.children.join(""));
    expect(chipLabels).toEqual(["全部 9", "读取 1", "编辑 5", "命令 1", "搜索 1", "失败 1"]);
    expect(numbers(panel)).toEqual(["r1", "e1", "e2", "e3", "e4", "w1", "c1", "x1", "s1"]);
    act(() => chip(panel, "failed").props.onPress());
    expect(numbers(panel)).toEqual(["x1"]);
    act(() => panel.unmount());
  });

  it("draws the groups as the task details' tabs, 4 points above and below each label", () => {
    const panel = openPanel();
    const style = (kind: string) => StyleSheet.flatten(chip(panel, kind).props.style({ pressed: false }));
    const label = (kind: string) => StyleSheet.flatten(chip(panel, kind).findByType("Text" as never).props.style);
    const hair = StyleSheet.hairlineWidth;
    // Chosen: filled with the host's raised surface, its border the same colour. As tall as its label and its
    // padding; on the desktop 10 points beside the label.
    expect(style("all")).toMatchObject({ borderRadius: 999, borderWidth: hair, paddingVertical: 4 - hair, paddingHorizontal: 10 - hair,
      backgroundColor: tokens.v2.surface2, borderColor: tokens.v2.surface2 });
    expect(style("all").minHeight).toBeUndefined();
    expect(label("all")).toMatchObject({ color: tokens.foreground, fontWeight: "500" });
    // Not chosen: an outline, no fill.
    expect(style("edit")).toMatchObject({ borderRadius: 999, borderWidth: hair, paddingVertical: 4 - hair, paddingHorizontal: 10 - hair });
    expect(style("edit").backgroundColor).toBeUndefined();
    expect(style("edit").borderColor).not.toBe(tokens.v2.surface2);
    expect(label("edit")).toMatchObject({ color: tokens.foregroundMuted, fontWeight: "500" });
    // A desktop panel's labels are a step under the caption size.
    expect(label("all")).toMatchObject({ fontSize: tokens.typography.block.caption.size - 1,
      lineHeight: tokens.typography.block.caption.lineHeight - 2 });
    act(() => panel.unmount());
  });

  it("uses the button text size, regular weight and larger padding on a phone", () => {
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn(unfolded)} store={store} tokens={tokens} compact /></>); });
    const panel = openPanel();
    const button = tokens.typography.block.button;
    const hair = StyleSheet.hairlineWidth;
    for (const kind of ["all", "edit"]) {
      const group = chip(panel, kind);
      const label = StyleSheet.flatten(group.findByType("Text" as never).props.style);
      expect(label).toMatchObject({ fontSize: button.size, lineHeight: button.lineHeight });
      expect(label.fontWeight).toBeUndefined();
      expect(StyleSheet.flatten(group.props.style({ pressed: false }))).toMatchObject({
        paddingVertical: 4 - hair, paddingHorizontal: 10 - hair,
      });
    }
    act(() => panel.unmount());
  });

  const edge = (panel: TestRenderer.ReactTestRenderer) => StyleSheet.flatten(panel.root.findAll((node) =>
    (node.type as unknown) === "View" && node.props.testID === "work-filter-edge")[0]!.props.style);

  it("keeps the groups on one line that scrolls sideways, 6 points inside a 0.5 pt rule", () => {
    const panel = openPanel();
    const bar = panel.root.findAll((node) => (node.type as unknown) === "ScrollView" && node.props.testID === "work-filter")[0]!;
    expect(bar).toBeDefined();
    expect(bar.props.horizontal).toBe(true);
    expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ flexGrow: 0, flexShrink: 0 });
    const row = StyleSheet.flatten(bar.props.contentContainerStyle);
    expect(row).toMatchObject({ flexDirection: "row", padding: 6, gap: 4 });
    expect(row.flexWrap).toBeUndefined();
    // Ruled off from the steps below; no edge while nothing lies under the bar.
    expect(edge(panel)).toMatchObject({ borderBottomWidth: 0.5, borderBottomColor: tokens.v2.borderSubtle, zIndex: 1 });
    expect(edge(panel).boxShadow).toBeUndefined();
    act(() => panel.unmount());
  });

  it("draws the web's half-point rule as an inset shadow, which Chrome does not round up", () => {
    const webTokens = buildThemeTokens({ surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
      foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#198754", statusWarning: "#a36a00",
      statusDanger: "#d92d20" }, undefined, { platform: "web" });
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn(unfolded)} store={store} tokens={webTokens} compact={false} /></>); });
    const panel = openPanel();
    expect(edge(panel).boxShadow).toBe(`inset 0 -0.5px 0 0 ${webTokens.v2.borderSubtle}`);
    expect(edge(panel).borderBottomWidth).toBeUndefined();
    act(() => panel.unmount());
  });

  it("casts an edge over the steps only while they scroll under the bar", () => {
    pressText("工作过程 · 7 步 · 9 次工具调用");
    const block = getBlock("agent", openId!)!;
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<PreviewChromeContext.Provider value="details">{block.render()}</PreviewChromeContext.Provider>); });
    const body = () => panel.root.findAll((node) => typeof node.type === "string" && node.props.testID === "hover-preview-body")[0]!;
    const scroll = (y: number) => act(() => body().props.onScroll({ nativeEvent: { contentOffset: { x: 0, y },
      contentSize: { width: 400, height: 2000 }, layoutMeasurement: { width: 400, height: 600 } } }));
    const shadow = `0px 5px 8px -4px rgba(0, 0, 0, 0.14)`;
    expect(edge(panel).boxShadow).toBeUndefined();
    scroll(40);
    expect(edge(panel).boxShadow).toBe(shadow);
    scroll(80);
    expect(edge(panel).boxShadow).toBe(shadow);
    scroll(0);
    expect(edge(panel).boxShadow).toBeUndefined();
    act(() => panel.unmount());
  });

  it("sits outside the scrolling body, so it stays atop the panel", () => {
    const panel = openPanel();
    const bar = panel.root.findByProps({ testID: "work-filter" });
    const bodies = panel.root.findAll((node) => node.props?.testID === "hover-preview-body");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((body) => body.findAll((node) => node === bar).length > 0)).toBe(false);
    expect(bodies.some((body) => body.findAll((node) => (node.type as unknown) === "ToolCallout").length > 0)).toBe(true);
    act(() => panel.unmount());
  });

  it("narrows the steps to a group, numbered from 1, and 全部 shows them all again", () => {
    const panel = openPanel();
    expect(chip(panel, "all").props.accessibilityState).toEqual({ selected: true });
    act(() => chip(panel, "edit").props.onPress());
    expect(chip(panel, "edit").props.accessibilityState).toEqual({ selected: true });
    expect(chip(panel, "all").props.accessibilityState).toEqual({ selected: false });
    expect(numbers(panel)).toEqual(["e1", "e2", "e3", "e4", "w1"]);
    const shownNumbers = () => shownCells(panel).map((cell) => cell.findAll((node) => node.props?.testID === "work-step-number" &&
      (node.type as unknown) === "Text")[0]!.children.join(""));
    const stripes = () => shownCells(panel).map((cell) => StyleSheet.flatten(cell.props.style).backgroundColor);
    const stripe = withAlpha(tokens.foreground, tokens.isDark ? 0.045 : 0.04);
    expect(shownNumbers()).toEqual(["1", "2", "3", "4", "5"]);
    // Striped by the shown cells, and the opened step's pinned row takes its cell's stripe.
    expect(stripes()).toEqual([undefined, stripe, undefined, stripe, undefined]);
    expect(shownCells(panel).map((cell) => cell.findAll((node) => (node.type as unknown) === "ToolCallout")[0]!.props.stickyStripe))
      .toEqual([undefined, stripe, undefined, stripe, undefined]);
    act(() => chip(panel, "command").props.onPress());
    expect(numbers(panel)).toEqual(["c1"]);
    act(() => chip(panel, "all").props.onPress());
    expect(numbers(panel)).toEqual(["r1", "e1", "e2", "e3", "e4", "w1", "c1", "x1", "s1"]);
    act(() => panel.unmount());
  });

  it("keeps the list as tall as before a group switch, so the drawer does not jump", () => {
    const panel = openPanel();
    const list = () => panel.root.findByProps({ testID: "work-step-list" });
    expect(StyleSheet.flatten(list().props.style)?.minHeight).toBeUndefined();
    act(() => list().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 540 } } }));
    act(() => chip(panel, "failed").props.onPress());
    expect(numbers(panel)).toEqual(["x1"]);
    expect(StyleSheet.flatten(list().props.style).minHeight).toBe(540);
    act(() => list().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 540 } } }));
    act(() => chip(panel, "all").props.onPress());
    expect(StyleSheet.flatten(list().props.style).minHeight).toBe(540);
    act(() => panel.unmount());
  });

  it("draws a Codex question in the panel from its metadata, as its timeline row does", () => {
    const store = createTurnFooterStore(() => ({ refetch: vi.fn(), subscribe: vi.fn() }));
    const question = { ...tool("q1", { type: "plain_text", text: "Merge now?\nYes, No", icon: "brain" } as ToolCallTimelineItem["detail"],
      "request_user_input"), metadata: { questions: [{ id: "0", question: "Merge now?", options: [{ label: "Yes" }] }] } } as ToolCallTimelineItem;
    act(() => { renderer.update(<><Probe /><TurnWorkCard agentId="agent" at={10000} work={turn([...unfolded, question])} store={store} tokens={tokens} compact={false} /></>); });
    pressText("工作过程 · 7 步 · 10 次工具调用");
    let panel!: TestRenderer.ReactTestRenderer;
    act(() => { panel = TestRenderer.create(<>{getBlock("agent", openId!)!.render()}</>); });
    act(() => chip(panel, "question").props.onPress());
    expect(numbers(panel)).toEqual(["q1"]);
    const row = panel.root.findAll((node) => (node.type as unknown) === "ToolCallout")
      .find((node) => node.props.data.callId === "q1")!;
    expect(row.props.data.questionData.questions).toEqual([{ id: "0", question: "Merge now?", options: [{ label: "Yes" }] }]);
    act(() => panel.unmount());
  });

  it("switches groups without mounting or redrawing a single step row", () => {
    const panel = openPanel();
    calloutDraws.renders = 0;
    calloutDraws.mounts = 0;
    act(() => chip(panel, "edit").props.onPress());
    act(() => chip(panel, "failed").props.onPress());
    act(() => chip(panel, "all").props.onPress());
    expect(numbers(panel)).toEqual(["r1", "e1", "e2", "e3", "e4", "w1", "c1", "x1", "s1"]);
    expect(calloutDraws).toEqual({ renders: 0, mounts: 0 });
    act(() => panel.unmount());
  });

  it("mounts a group's rows when first shown, then keeps them for the next switch", () => {
    let panel = openPanel();
    act(() => chip(panel, "edit").props.onPress());
    act(() => panel.unmount());
    calloutDraws.renders = 0;
    calloutDraws.mounts = 0;
    const block = getBlock("agent", openId!)!;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    expect(calloutDraws.mounts).toBe(5);
    expect(panel.root.findAll((node) => (node.type as unknown) === "ToolCallout")).toHaveLength(5);
    act(() => chip(panel, "all").props.onPress());
    expect(calloutDraws.mounts).toBe(9);
    calloutDraws.renders = 0;
    act(() => chip(panel, "edit").props.onPress());
    act(() => chip(panel, "all").props.onPress());
    expect(calloutDraws).toEqual({ renders: 0, mounts: 9 });
    act(() => panel.unmount());
  });

  it("keeps the chosen group when the panel mounts again", () => {
    let panel = openPanel();
    act(() => chip(panel, "read").props.onPress());
    act(() => panel.unmount());
    const block = getBlock("agent", openId!)!;
    act(() => { panel = TestRenderer.create(<>{block.render()}</>); });
    expect(numbers(panel)).toEqual(["r1"]);
    act(() => panel.unmount());
  });
});
