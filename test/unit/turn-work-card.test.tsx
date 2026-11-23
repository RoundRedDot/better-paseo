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
import { detailsApi, useDetails } from "../../client/details/details-store";
import { getBlock } from "../../client/details/block-registry";
import { timelineEntry as entry } from "./helpers/turn-timeline";
import { Dimensions } from "react-native";

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
afterEach(() => { act(() => renderer.unmount()); detailsApi.close("agent"); vi.restoreAllMocks(); });

describe("turn work card", () => {
  it("closed: the work row, the file header and three paths, nothing else", () => {
    const shown = texts();
    expect(shown).toContain("用时 9秒");
    expect(shown).toContain("已编辑 4 个文件");
    expect(shown).toContain("查看变更");
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
    expect(byType("ToolCallout")).toHaveLength(0);
    const block = getBlock("agent", openId!);
    const body = block!.render() as React.ReactElement<{ children: React.ReactElement<{ steps: unknown[] }> }>;
    expect(body.props.children.props.steps).toHaveLength(7);
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
    const body = block!.render() as React.ReactElement<{ children: React.ReactElement<{ steps: unknown[] }> }>;
    expect(body.props.children.props.steps).toHaveLength(7);
  });

  it("shows more paths only on request, and opens one file's changes in the details panel", () => {
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
