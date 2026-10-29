import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => vi.fn() }));
const iconCalls = vi.hoisted(() => [] as Array<{ icon?: unknown }>);
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return { Icon: (props: { icon?: unknown }) => { iconCalls.push(props); return null; }, ScrollView: rn.ScrollView, copyText: vi.fn(), useToast: () => ({ show() {}, error() {} }) };
});
const pointer = vi.hoisted(() => ({ touch: true }));
vi.mock("../../client/ui/use-input-capabilities", () => ({
  noteHover() {},
  useInputCapabilities: () => ({ touch: pointer.touch, hover: !pointer.touch }),
}));
vi.mock("../../client/components/markdown/markdown-view", () => ({
  MarkdownView: (props: { text: string; renderText?(text: string): React.ReactNode }) => (
    <>{props.renderText ? props.renderText(props.text) : props.text}</>
  ),
}));
import { TaskCardView, sameCardProps, type TaskCardViewProps } from "../../client/tasks/cards/task-card";
import { TaskDetailCards } from "../../client/tasks/cards/detail-cards";
import { highlightText } from "../../client/tasks/cards/search-highlight";
import { resetSectionChoices, setSectionClosed } from "../../client/tasks/cards/detail-collapse";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { sampleCards } from "../../client/tasks/sample-cards";

const theme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f7f7f8",
    surface2: "#efeff1",
    border: "#e2e2e6",
    foreground: "#1b1b1f",
    foregroundMuted: "#6b6b75",
    accent: "#3b6fe0",
    accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b",
    statusWarning: "#a36a00",
    statusDanger: "#d93636",
  },
};
const card = {
  ...sampleCards()[0]!,
  title: "Schedule task",
  children: [],
  labels: [],
  parent: null,
  location: {
    ...sampleCards()[0]!.location,
    projectName: "Project",
    workspaceTitle: "Workspace",
    workspaceName: "Workspace",
    branch: "main",
    folder: "App",
    folderName: "App",
    cwd: "/work/schedule/App",
    pullRequest: null,
  },
};
const props: TaskCardViewProps = {
  card,
  fields: { ...CARD_PRESETS.standard.fields, labelLimit: "2" },
  theme,
  compact: false,
  permissionButtons: [],
  stopPhase: "idle",
  focused: false,
  highlighted: false,
  onReveal() {},
  language: "zh",
  animated: false,
  now: 0,
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let tree: TestRenderer.ReactTestRenderer | undefined;
const host = (root: ReactTestInstance, id: string) => root.find((node) => typeof node.type === "string" && node.props.testID === id);
const text = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
const mount = async (element: React.ReactElement) => {
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree!.root;
};
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSectionChoices();
  iconCalls.length = 0;
  pointer.touch = true;
});

describe("card search rendering", () => {
  it("labels later-message and tool matches as conversation content", async () => {
    const root = await mount(<TaskCardView {...props} searchQuery="sche" searchPrompt={{ state: "ready", text: "Schedule tool output", field: "conversation" }} />);
    expect(text(host(root, "task-search-summary-trigger"))).toContain("会话内容");
    expect(text(host(root, "task-search-summary-trigger"))).not.toContain("首条消息");
  });

  it("uses the custom document-search icon for first-message hits", async () => {
    await mount(<TaskCardView {...props} searchQuery="sche" searchPrompt={{ state: "ready", text: "Schedule prompt" }} />);
    const firstMessageIcon = iconCalls.find((call) => typeof call.icon === "object" && call.icon !== null);
    expect(firstMessageIcon).toMatchObject({
      icon: {
        svg: expect.stringContaining('viewBox="0 0 24 24"'),
      },
    });
    expect((firstMessageIcon!.icon as { svg: string }).svg).toContain('<circle cx="16" cy="16.5" r="3"/>');
  });

  it("does not offer a retry for a conversation with missing prerequisites", async () => {
    const root = await mount(<TaskCardView {...props} searchQuery="sche" searchPrompt={{ state: "error", unavailable: true, field: "conversation" }} onSearchPromptRetry={vi.fn()} />);
    expect(text(host(root, "task-search-prompt-note"))).toBe("会话内容无法读取");
    await act(async () => host(root, "task-search-summary-trigger").props.onPress({ stopPropagation() {} }));
    expect(text(host(root, "task-search-expanded"))).not.toContain("重试");
  });

  it("renders an empty search identically, with no extra text wrappers or summary", async () => {
    await mount(<TaskCardView {...props} />);
    const before = JSON.stringify(tree!.toJSON());
    await act(async () => tree!.update(<TaskCardView {...props} searchQuery="" />));
    expect(JSON.stringify(tree!.toJSON())).toBe(before);
    expect(host(tree!.root, "task-card-title").children).toEqual(["Schedule task"]);
    expect(tree!.root.findAll((node) => node.props.testID === "task-search-summary")).toEqual([]);
    expect(highlightText("Schedule", " ", false)).toBe("Schedule");
  });
  it.each(["idle", "loading", "error"] as const)("keeps first-message %s notes out of the summary", async (state) => {
    const root = await mount(
      <TaskCardView
        {...props}
        card={{ ...card, location: { ...card.location, cwd: "/work/App" } }}
        searchQuery="sche"
        searchPrompt={{ state }}
      />,
    );
    expect(text(host(root, "task-search-prompt-note"))).toBe(state === "error" ? "首条消息无法读取" : "首条消息载入中");
    expect(root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-search-summary")).toHaveLength(0);
  });
  it("highlights visible text and only summarizes hidden fields, then expands all on touch", async () => {
    const root = await mount(<TaskCardView {...props} searchQuery="sche" searchPrompt={{ state: "ready", text: "查看 Schedule 推送" }} />);
    expect(host(root, "task-card-title").findAll((node) => node.props.style?.backgroundColor === "#FBE7A1").length).toBeGreaterThan(0);
    expect(text(host(root, "task-search-summary-trigger"))).toContain("首条消息");
    expect(text(host(root, "task-search-summary-trigger"))).toContain("路径");
    expect(text(host(root, "task-search-summary-trigger"))).not.toContain("标题");
    const stopPropagation = vi.fn();
    await act(async () => host(root, "task-search-summary-trigger").props.onPress({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    const expanded = host(root, "task-search-expanded");
    expect(text(expanded)).not.toContain("卡片上可见");
    for (const label of ["标题", "首条消息", "路径"]) {
      expect(expanded.findAll((node) => typeof node.type === "string" && text(node) === label && node.props.style?.fontWeight === "600").length).toBeGreaterThan(0);
    }
  });
  it("shows one summary row with overflow on phones and replaces the timer for minimal density", async () => {
    const root = await mount(
      <TaskCardView
        {...props}
        fields={{ ...CARD_PRESETS.minimal.fields, labelLimit: "2" }}
        searchQuery="sche"
        searchPrompt={{ state: "ready", text: "Schedule prompt" }}
        compact
      />,
    );
    const summary = text(host(root, "task-search-summary-trigger"));
    expect(summary).toContain("首条消息");
    expect(summary).toContain("+1 处命中");
    expect(root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-timer")).toHaveLength(0);
  });
  it("explains a home-path hit hidden by tilde abbreviation even when the path field is on", async () => {
    const root = await mount(
      <TaskCardView
        {...props}
        card={{ ...card, location: { ...card.location, cwd: "/Users/scheduler/work/App" } }}
        fields={{ ...props.fields, path: true }}
        searchQuery="sche"
      />,
    );
    expect(text(host(root, "task-search-summary-trigger"))).toContain("路径");
    expect(text(host(root, "task-search-summary-trigger"))).toContain("scheduler");
  });

  it("folds a long visible path around its match instead of losing the match to the trailing ellipsis", async () => {
    const root = await mount(
      <TaskCardView
        {...props}
        card={{ ...card, location: { ...card.location, cwd: "/workspace/rrd/one/two/duo-r12-sched/ios/App" } }}
        fields={{ ...props.fields, path: true }}
        searchQuery="sche"
      />,
    );
    expect(text(host(root, "pill-path"))).toContain("/…/");
    expect(text(host(root, "pill-path"))).toContain("duo-r12-sched/ios/App");
    expect(root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-search-summary")).toHaveLength(0);
  });

  it("does not offer a search retry for an unavailable parent session", async () => {
    const retry = vi.fn();
    const root = await mount(
      <TaskCardView {...props} searchQuery="sche" searchPrompt={{ state: "error" }} searchPromptUnavailable onSearchPromptRetry={retry} />,
    );
    expect(text(host(root, "task-search-prompt-note"))).toBe("首条消息无法读取");
    await act(async () => host(root, "task-search-summary-trigger").props.onPress({ stopPropagation() {} }));
    expect(text(host(root, "task-search-expanded"))).not.toContain("重试");
  });

  it("keeps unchanged props and card identity stable and memoizes the rendered card", async () => {
    await mount(<TaskCardView {...props} searchQuery="sche" />);
    const before = JSON.stringify(tree!.toJSON());
    expect(sameCardProps({ ...props, searchQuery: "sche" }, { ...props, searchQuery: "sche" })).toBe(true);
    const render = vi.fn();
    function Parent({ value }: { value: number }) {
      render(value);
      return <TaskCardView {...props} searchQuery="sche" />;
    }
    await act(async () => tree!.update(<Parent value={1} />));
    const title = host(tree!.root, "task-card-title");
    await act(async () => tree!.update(<Parent value={2} />));
    expect(host(tree!.root, "task-card-title")).toBe(title);
    expect(JSON.stringify(tree!.toJSON())).toBe(before);
  });
  it("opens the desktop popover at 300ms and dismisses it after the 150ms grace period", async () => {
    vi.useFakeTimers();
    pointer.touch = false;
    const root = await mount(<TaskCardView {...props} searchQuery="sche" />);
    const summary = host(root, "task-search-summary");
    await act(async () => summary.props.onHoverIn());
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-search-popover")).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(host(root, "task-search-popover").props.accessibilityLabel).toBe("搜索命中");
    expect(host(root, "task-search-popover-layer").props.style).toMatchObject({ left: "50%", marginLeft: -168, width: 336 });
    await act(async () => summary.props.onHoverOut());
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-search-popover")).toHaveLength(0);
  });
  it("uses exact light/dark colors and preserves blue only for branch hits", () => {
    const light = highlightText("Schedule", "sche", false) as React.ReactElement[];
    const dark = highlightText("Schedule", "sche", true, true) as React.ReactElement[];
    expect(light[0]!.props).toMatchObject({ style: { backgroundColor: "#FBE7A1", color: "#1D1E21", borderRadius: 2 } });
    expect(dark[0]!.props).toMatchObject({ style: { backgroundColor: "#5A4A17", color: "#B6D7FF" } });
  });
});

describe("detail search sections", () => {
  it("auto-expands matching groups, respects manual collapse, and restores the old choices on clear", async () => {
    setSectionClosed("properties", true);
    setSectionClosed("prompt", true);
    const detail = {
      card,
      theme,
      language: "zh" as const,
      strings: BOARD_STRINGS.zh.sidebar,
      now: 0,
      firstPrompt: { prompt: { state: "ready" as const, text: "Schedule prompt" }, load() {} },
    };
    const root = await mount(<TaskDetailCards {...detail} searchQuery="sche" />);
    const heading = (id: string) =>
      host(root, id).find((node) => typeof node.type === "string" && typeof node.props.accessibilityState?.expanded === "boolean");
    expect(heading("detail-location").props.accessibilityState.expanded).toBe(true);
    expect(heading("detail-prompt").props.accessibilityState.expanded).toBe(true);
    expect(text(host(root, "detail-cwd"))).toContain("schedule");
    await act(async () => heading("detail-prompt").props.onPress());
    await act(async () => tree!.update(<TaskDetailCards {...detail} searchQuery="sche" now={60_000} />));
    expect(heading("detail-prompt").props.accessibilityState.expanded).toBe(false);
    await act(async () => tree!.update(<TaskDetailCards {...detail} searchQuery="schedule" />));
    expect(heading("detail-prompt").props.accessibilityState.expanded).toBe(false);
    await act(async () => tree!.update(<TaskDetailCards {...detail} searchQuery="" />));
    expect(heading("detail-location").props.accessibilityState.expanded).toBe(false);
    expect(heading("detail-prompt").props.accessibilityState.expanded).toBe(false);
  });
});
