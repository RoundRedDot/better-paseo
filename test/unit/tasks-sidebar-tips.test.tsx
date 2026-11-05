import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

vi.mock("react-native", async () => import("./helpers/rn-mock"));
const hover = vi.hoisted(() => new Map<string, () => void>());
const contextMenus = vi.hoisted(() => new Map<string, (point: { x: number; y: number }) => void>());
const actions = vi.hoisted(() => ({ copy: vi.fn(), reveal: vi.fn(async () => ({ error: null })) }));
vi.mock("../../client/web", async (original) => ({
  ...await original<object>(),
  bindContextMenu: (node: { props: { testID?: string } } | null, open: (point: { x: number; y: number }) => void) => {
    const id = node?.props.testID;
    if (id) contextMenus.set(id, open);
    return () => { if (id) contextMenus.delete(id); };
  },
  bindRowHover: (node: { props: { testID?: string } } | null, enter: () => void) => {
    const id = node?.props.testID;
    if (id) hover.set(id, enter);
    return () => { if (id) hover.delete(id); };
  },
}));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => actions.reveal }));
// Node has no matchMedia, which reads as touch and hides Open folder; these are mouse sidebars.
vi.mock("../../client/ui/use-input-capabilities", async (original) => ({
  ...await original<object>(),
  useInputCapabilities: () => ({ hover: true, touch: false, compact: false, native: false }),
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    TextInput: rn.TextInput,
    ScrollView: rn.ScrollView,
    copyText: actions.copy,
    useToast: () => ({ show() {}, error() {} }),
  };
});
vi.mock("../../client/components/markdown/markdown-view", () => ({ MarkdownView: () => null }));
vi.mock("../../client/tasks/data/first-prompt", () => ({ useFirstPrompt: () => null }));
vi.mock("../../client/tasks/data/last-message", () => ({ useLastMessage: () => null, lastMessageVersion: () => "", useLiveReplyCount: () => 0 }));
vi.mock("../../client/tasks/data/last-human-message", () => ({ useLastHumanMessage: () => ({ prompt: { state: "idle" }, load() {} }), lastHumanMessageVersion: () => "" }));
vi.mock("../../client/tasks/data/session-tokens", () => ({ useSessionTokens: () => null }));
vi.mock("../../client/tasks/data/subagent-timeline", () => ({ useSubagentTimeline: () => ({ firstPrompt: null, lastMessage: null }) }));
vi.mock("../../client/tasks/board/board-parts", () => ({ RollingCount: () => null, RollingTotal: () => null }));

import { StyleSheet } from "react-native";
import { DetailsSidebar } from "../../client/tasks/board/details-sidebar";
import { EMPTY_PARAMS } from "../../client/tasks/board/params";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import type { BoardController } from "../../client/tasks/board/use-board";
import { BoardTips, CardHints } from "../../client/tasks/cards/card-hints";
import { TASK_MONO } from "../../client/tasks/typography";
import { resetSectionChoices } from "../../client/tasks/cards/detail-collapse";
import { TaskDetailCards, type TaskDetailCardsProps } from "../../client/tasks/cards/detail-cards";
import { cardStrings } from "../../client/tasks/cards/strings";
import { taskTokens } from "../../client/tasks/cards/tokens";
import { LANE_ORDER } from "../../client/tasks/model";
import { previewSampleCards } from "../../client/tasks/sample-cards";
import { createTitleUpdateControl } from "../../client/tasks/actions/title-update";

const NOW = Date.parse("2026-10-20T09:00:00Z");
const THEME = { colors: {
  surface0: "#ffffff", surface1: "#f7f7f8", surface2: "#efeff1", border: "#e2e2e6",
  foreground: "#1b1b1f", foregroundMuted: "#6b6b75", accent: "#3b6fe0", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d93636",
} };
const globals = globalThis as { __rnMockOS?: string; IS_REACT_ACT_ENVIRONMENT?: boolean };
let renderer: TestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  globals.__rnMockOS = "web";
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  resetSectionChoices();
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
  delete globals.__rnMockOS;
});

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = TestRenderer.create(element, { createNodeMock: (node) => ({ props: node.props, measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(10, 20, 30, 40) }) });
  });
  return renderer!.root;
}
function host(root: ReactTestInstance, id: string) {
  return root.find((node) => typeof node.type === "string" && node.props.testID === id);
}
function tip(node: ReactTestInstance): string | undefined {
  for (let current: ReactTestInstance | null = node; current; current = current.parent) {
    if (typeof current.type === "string" && current.props.dataSet?.bctip) return current.props.dataSet.bctip;
  }
}
function expectActionTips(root: ReactTestInstance) {
  const buttons = root.findAll((node) => typeof node.type === "string" && typeof node.props.onPress === "function" && !node.props.disabled);
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) expect(tip(button), button.props.accessibilityLabel ?? button.props.testID).toBeTruthy();
}
function details(language: "zh" | "en", id = "sample-running", overrides: Partial<TaskDetailCardsProps> = {}): TaskDetailCardsProps {
  return {
    card: previewSampleCards(NOW).find((card) => card.id === id)!, theme: THEME, now: NOW,
    language, strings: BOARD_STRINGS[language].sidebar,
    onClose() {}, onOpen() {}, onJump() {},
    back: { title: "Parent", onPress() {} },
    notice: { icon: "EyeOff", text: "Hidden", action: { label: BOARD_STRINGS[language].clearFilters, onPress() {} } },
    stop: { phase: "idle", onPress() {} },
    unarchive: { pending: () => false, press() {} }, archive: { pending: () => false, press() {} },
    permissionButtons: [{ key: "allow", label: language === "zh" ? "允许" : "Allow", variant: "primary", kind: "respond", action: { behavior: "allow", id: null } }],
    onPermission() {},
    firstPrompt: { prompt: { state: "ready", text: "Prompt\n".repeat(11) }, load() {} },
    lastMessage: { prompt: { state: "idle" }, load() {} },
    ...overrides,
  };
}

describe("sidebar action tips", () => {
  it("opens the selected card menu at the header button", async () => {
    const onMenu = vi.fn();
    const root = await render(<TaskDetailCards {...details("zh", "sample-running", { onMenu })} />);
    await act(async () => host(root, "detail-menu").props.onPress());
    expect(onMenu).toHaveBeenCalledWith({ x: 40, y: 60 });
  });
  it("clears filters and shows subtasks when clearing a hidden card notice", async () => {
    const card = previewSampleCards(NOW).find((item) => item.id === "sample-child-1")!;
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: [] }]));
    const setParams = vi.fn();
    const board = {
      language: "en", strings: BOARD_STRINGS.en, params: EMPTY_PARAMS, lanes,
      tasks: { ready: true }, cardById: () => card, setParams, callbacks: {},
      stop: { phase: () => "idle" }, read: { available: false }, unarchive: { available: false }, archive: { pending: () => false }, buttonsFor: () => [],
    } as unknown as BoardController;
    const root = await render(<DetailsSidebar board={board} theme={THEME} selection={{ id: card.id, back: [] }} dispatch={() => {}} onLane={() => {}} onReveal={() => {}} touch={false} stats={false} />);
    const button = host(root, "detail-notice").find((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
    await act(async () => button.props.onPress());
    expect(setParams).toHaveBeenCalledOnce();
    expect(setParams.mock.calls[0]![0]({ ...EMPTY_PARAMS, query: "test", hideSubtasks: true })).toEqual({ ...EMPTY_PARAMS, hideSubtasks: false });
  });
  it("restarts the countdown if a hovered undo button is unmounted", async () => {
    vi.useFakeTimers();
    const child = details("en").card.children[0]!;
    const titleUpdates = createTitleUpdateControl(async () => ({ state: "done", title: child.title, previousTitle: "Previous" }), undefined, async () => ({ ok: true, error: null }));
    const root = await render(<TaskDetailCards {...details("en", "sample-running", { titleUpdates })} />);
    await act(async () => { titleUpdates.start(child.id); await vi.advanceTimersByTimeAsync(0); });
    const button = host(root, `task-title-undo-${child.id}`);
    await act(async () => button.props.onHoverIn());
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(titleUpdates.undoState(child.id)).toBeNull();
  });
  it("shares the undo button across detail titles and subtask rows", async () => {
    vi.useFakeTimers();
    const restore = vi.fn(async () => ({ ok: true, error: null }));
    const titleUpdates = createTitleUpdateControl(async () => ({ state: "done", title: "New title", previousTitle: "Previous title" }), undefined, restore);
    const props = details("en", "sample-running", { titleUpdates });
    const child = props.card.children[0]!;
    const subject = { ...props.card, id: child.id, title: child.title, children: [] };
    const root = await render(<><TaskDetailCards {...props} /><TaskDetailCards {...props} card={subject} /></>);
    await act(async () => { titleUpdates.start(child.id); await vi.advanceTimersByTimeAsync(0); });
    for (let i = 0; i < 40; i++) await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    const buttons = root.findAll((node) => typeof node.type === "string" && node.props.testID === `task-title-undo-${child.id}`);
    expect(buttons).toHaveLength(2);
    expect(buttons.every((node) => tip(node) === cardStrings("en").undoTitle && !node.props.disabled)).toBe(true);
    expect(buttons.map((node) => StyleSheet.flatten(node.props.style).backgroundColor)).toEqual(["transparent", "transparent"]);
    await act(async () => hover.get(`detail-subtask-${child.id}`)!());
    await act(async () => buttons[0]!.props.onHoverIn());
    expect(StyleSheet.flatten(buttons[0]!.props.style).backgroundColor).not.toBe("transparent");
    expect(StyleSheet.flatten(buttons[0]!.props.style).backgroundColor).not.toBe(StyleSheet.flatten(host(root, `detail-subtask-${child.id}`).props.style).backgroundColor);
    expect(StyleSheet.flatten(buttons[1]!.props.style).backgroundColor).toBe("transparent");
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(titleUpdates.undoState(child.id)?.ready).toBe(true);
    await act(async () => buttons[0]!.props.onHoverOut());
    expect(StyleSheet.flatten(buttons[0]!.props.style).backgroundColor).toBe("transparent");
    const stopPropagation = vi.fn();
    await act(async () => buttons[0]!.props.onPress({ stopPropagation }));
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledExactlyOnceWith({ agentId: child.id, title: "New title", previousTitle: "Previous title" });
    expect(titleUpdates.undoState(child.id)).toBeNull();
  });
  it("shows the subtask title shimmer while its title is generated and revealed", async () => {
    vi.useFakeTimers();
    let resolve!: (value: { state: "done"; title: string }) => void;
    const titleUpdates = createTitleUpdateControl(() => new Promise((done) => { resolve = done; }));
    const props = details("en", "sample-running", { titleUpdates });
    const child = props.card.children[0]!;
    const root = await render(<TaskDetailCards {...props} />);
    await act(async () => titleUpdates.start(child.id));
    const row = () => host(root, `detail-subtask-${child.id}`);
    expect(host(row(), "task-title-update-shimmer").props.accessibilityState.busy).toBe(true);
    await act(async () => resolve({ state: "done", title: "A newly generated title" }));
    expect(host(row(), "task-title-update-shimmer")).toBeTruthy();
    for (let i = 0; i < 40; i++) await act(async () => { await vi.advanceTimersByTimeAsync(30); });
    expect(row().findAll((node) => node.props.testID === "task-title-update-shimmer")).toHaveLength(0);
    expect(host(row(), `detail-subtask-title-${child.id}`).findAll((node) => typeof node.type === "string" && node.children.includes("A newly generated title"))).toHaveLength(1);
  });
  it("opens the selected subtask's card menu without navigating", async () => {
    const cards = previewSampleCards(NOW);
    const parent = cards.find((card) => card.id === "sample-running")!;
    const child = cards.find((card) => card.id === "sample-child-1")!;
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id) }]));
    const onOpen = vi.fn();
    const onReveal = vi.fn();
    const board = {
      language: "en", strings: BOARD_STRINGS.en, params: EMPTY_PARAMS, lanes,
      tasks: { ready: true }, cardById: (id: string) => cards.find((card) => card.id === id),
      callbacks: { onOpen, onReveal }, stop: { phase: () => "idle" }, read: { available: false, pending: () => false }, unarchive: { available: false }, archive: { pending: () => false },
      buttonsFor: () => [],
    } as unknown as BoardController;
    const root = await render(<DetailsSidebar board={board} theme={THEME} selection={{ id: parent.id, back: [] }} dispatch={() => {}} onLane={() => {}} onReveal={onReveal} touch={false} stats={false} />);
    await act(async () => contextMenus.get(`detail-subtask-${child.id}`)!({ x: 20, y: 30 }));
    expect(root.findAll((node) => node.props.accessibilityLabel === cardStrings("en").copyTitle).length).toBeGreaterThan(0);
    expect(onReveal).not.toHaveBeenCalled();
    const open = root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === cardStrings("en").openTab && node.props.accessibilityRole === "menuitem");
    await act(async () => open.props.onPress());
    expect(onOpen).toHaveBeenCalledWith(child.id);
  });
  it.each([false, true])("shows project paths and workspace projects on a separate line (touch=%s)", async (touch) => {
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: [] }]));
    const board = {
      language: "en", strings: BOARD_STRINGS.en, params: EMPTY_PARAMS, showEmptyGroups: true,
      tasks: {
        lanes, providers: [], labels: [],
        workspaces: [
          { id: "w1", name: "Main", projectId: "p1", projectName: "Payments", projectPath: "/Users/dev/code/payments", projectIcon: "icon" },
          { id: "w2", name: "Website", projectId: "p2", projectName: "Website", projectPath: "/home/dev/code/website", projectIcon: "icon" },
          { id: "w3", name: "Develop", projectId: "p3", projectName: "Server", projectPath: "/srv/server", projectIcon: "icon" },
          { id: "w4", name: "Other", projectId: "p4", projectName: "Other", projectIcon: "icon" },
        ],
        requestProjectIcon() {},
      },
      setParams: vi.fn(), callbacks: {}, cardById: () => undefined,
    } as unknown as BoardController;
    const root = await render(<DetailsSidebar board={board} theme={THEME} selection={{ id: null, back: [] }} dispatch={() => {}} onLane={() => {}} onReveal={() => {}} touch={touch} stats={false} />);
    const rows = () => root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "checkbox");
    const expectLines = (row: ReactTestInstance, label: string, detail: string) => {
      const texts = row.findAll((node) => (node.type as unknown) === "Text");
      expect(texts.map((text) => text.children)).toEqual([[label], [detail], ["0"]]);
      const column = row.find((node) => typeof node.type === "string" && node.props.style?.flex === 1 && node.props.style?.minWidth === 0);
      expect(column.findAll((node) => (node.type as unknown) === "Text").map((text) => text.children)).toEqual([[label], [detail]]);
      expect(column.props.style.flexDirection ?? "column").toBe("column");
      expect(texts.slice(0, 2).map((text) => text.props.numberOfLines)).toEqual([1, 1]);
      expect(StyleSheet.flatten(texts[1]!.props.style).color).toBe(THEME.colors.foregroundMuted);
      expect(row.props.style.height).toBe(touch ? 56 : 48);
    };
    await act(async () => host(root, "sidebar-group-tab-FolderKanban").props.onPress());
    expectLines(rows()[0]!, "Payments", "~/code/payments");
    expectLines(rows()[1]!, "Website", "~/code/website");
    expectLines(rows()[2]!, "Server", "/srv/server");
    expect(rows()[3]!.props.style.height).toBe(touch ? 44 : 36);
    await act(async () => rows()[0]!.props.onPress());
    expect(board.setParams).toHaveBeenCalledOnce();
    await act(async () => host(root, "sidebar-group-tab-FolderGit2").props.onPress());
    expectLines(rows()[0]!, "Main", "Payments");
    expectLines(rows()[1]!, "Website", "Website");
    await act(async () => rows()[0]!.props.onPress());
    expect(board.setParams).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("searches and clears all four group lists independently (touch=%s)", async (touch) => {
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: [] }]));
    const board = {
      language: "en", strings: BOARD_STRINGS.en, params: EMPTY_PARAMS, showEmptyGroups: true,
      tasks: {
        lanes, providers: [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude" }],
        labels: [{ name: "Bug fix", color: null }, { name: "Feature", color: null }],
        workspaces: [
          { id: "w1", name: "Main", projectId: "p1", projectName: "Payments", projectIcon: "icon" },
          { id: "w2", name: "Develop", projectId: "p2", projectName: "Website", projectIcon: "icon" },
        ],
        requestProjectIcon() {},
      },
      setParams: vi.fn(), callbacks: {}, cardById: () => undefined,
    } as unknown as BoardController;
    const root = await render(<DetailsSidebar board={board} theme={THEME} selection={{ id: null, back: [] }} dispatch={() => {}} onLane={() => {}} onReveal={() => {}} touch={touch} stats={false} />);
    const input = () => host(root, "sidebar-groups-search-input");
    const rows = () => root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "checkbox");
    expect(host(root, "sidebar-groups-search").props.style).toMatchObject({ borderRadius: 999, height: touch ? 36 : 28, borderColor: THEME.colors.border });
    expect(input().props.style.outlineStyle).toBe("none");
    expect(rows()[0]!.props.style).toMatchObject({ height: touch ? 44 : 36, marginVertical: 2 });
    await act(async () => input().props.onFocus());
    expect(host(root, "sidebar-groups-search").props.style.borderColor).toBe(THEME.colors.foregroundMuted);
    await act(async () => input().props.onBlur());
    expect(host(root, "sidebar-groups-search").props.style.borderColor).toBe(THEME.colors.border);
    for (const [icon, query, label] of [
      ["Bot", "  CODEX ", "Codex 0"],
      ["FolderKanban", "PAY", "Payments 0"],
      ["FolderGit2", "payments main", "Main Payments 0"],
      ["Tag", "FIX bug", "Bug fix 0"],
    ]) {
      await act(async () => host(root, `sidebar-group-tab-${icon}`).props.onPress());
      expect(input().props.value).toBe("");
      expect(rows()).toHaveLength(2);
      await act(async () => input().props.onChangeText(query));
      expect(rows().map((row) => row.props.accessibilityLabel)).toEqual([label]);
      await act(async () => input().props.onChangeText("missing"));
      expect(rows()).toHaveLength(0);
      await act(async () => host(root, "sidebar-groups-search-clear").props.onPress());
      expect(input().props.value).toBe("");
      expect(rows()).toHaveLength(2);
      await act(async () => input().props.onChangeText(query));
    }
    await act(async () => host(root, "sidebar-group-tab-Bot").props.onPress());
    expect(input().props.value).toBe("  CODEX ");
    await act(async () => rows()[0]!.props.onPress());
    expect(board.setParams).toHaveBeenCalledOnce();
  });

  it.each(["zh", "en"] as const)("covers every detail action across task states in %s", async (language) => {
    for (const card of previewSampleCards(NOW)) {
      const root = await render(<TaskDetailCards {...details(language, card.id)} />);
      await act(async () => hover.get("detail-cwd")?.());
      expectActionTips(root);
      await act(async () => renderer!.unmount());
    }
  });

  it.each(["zh", "en"] as const)("keeps the directory row, open-folder button and copy button distinct in %s", async (language) => {
    const root = await render(<TaskDetailCards {...details(language)} />);
    const words = cardStrings(language).details;
    await act(async () => hover.get("detail-cwd")!());
    const row = host(root, "detail-cwd");
    expect(tip(row)).toBe(words.copyPath);
    for (const label of [words.openFolder, words.copyPath]) {
      const button = row.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);
      expect(button.props.dataSet.bctip).toBe(label);
      const stopPropagation = vi.fn();
      await act(async () => button.props.onPress({ stopPropagation }));
      expect(stopPropagation).toHaveBeenCalledOnce();
    }
    expect(actions.reveal).toHaveBeenCalledExactlyOnceWith({ cwd: details(language).card.location.cwd, path: details(language).card.location.cwd });
    expect(actions.copy).toHaveBeenCalledExactlyOnceWith(details(language).card.location.cwd);
    expect(tip(host(root, "detail-pr"))).toBe(words.openLink);
    expect(host(root, "detail-place").props.dataSet).toBeUndefined();
  });

  it("updates expand/collapse tips and separates subtask navigation from opening its tab", async () => {
    const props = details("zh");
    const root = await render(<TaskDetailCards {...props} />);
    const words = cardStrings("zh").details;
    const section = host(root, "detail-location");
    const heading = () => section.find((node) => typeof node.type === "string" && typeof node.props.accessibilityState?.expanded === "boolean");
    expect(tip(heading())).toBe(words.collapse(words.properties));
    await act(async () => heading().props.onPress());
    expect(tip(heading())).toBe(words.expand(words.properties));
    const child = props.card.children.find((child) => child.kind !== "provider")!;
    expect(tip(host(root, `detail-subtask-${child.id}`))).toBe(words.locate);
    await act(async () => hover.get(`detail-subtask-${child.id}`)!());
    expect(tip(host(root, `detail-subtask-open-${child.id}`))).toBe(props.strings.openTab);
    expect(tip(host(root, "detail-message-load"))).toBe(words.promptLoad);
    expect(tip(host(root, "detail-prompt-copy"))).toBe(words.copyPrompt);
  });

  it.each(["zh", "en"] as const)("names archived-parent and provider-subagent actions in %s", async (language) => {
    const props = details(language);
    const words = cardStrings(language);
    props.card = {
      ...props.card,
      parent: { id: "archived-parent", title: "Archived parent", missing: true, archived: true },
      children: [{ ...props.card.children[0]!, id: "provider-child", kind: "provider" }],
    };
    const root = await render(<TaskDetailCards {...props} />);
    // The parent row itself is inert; only its Unarchive button has a tip.
    expect(host(root, "detail-parent").props.dataSet).toBeUndefined();
    expect(tip(host(root, "detail-parent-unarchive"))).toBe(words.details.unarchive);
    expect(tip(host(root, "detail-subtask-provider-child"))).toBe(words.openParentTab);
    expect(tip(host(root, "detail-subtask-parent-tab-provider-child"))).toBe(words.openParentTab);
    expectActionTips(root);
  });

  it.each(["zh", "en"] as const)("updates tips for confirmation and expanded content in %s", async (language) => {
    const props = details(language);
    const words = cardStrings(language);
    props.card = { ...props.card, children: Array.from({ length: 12 }, (_, index) => ({ ...props.card.children[0]!, id: `child-${index}` })) };
    const root = await render(<TaskDetailCards {...props} />);
    expect(tip(host(root, "detail-subtasks-more"))).toBe(words.details.subtasksShowAll(12));
    await act(async () => host(root, "detail-subtasks-more").props.onPress());
    expect(tip(host(root, "detail-subtasks-more"))).toBe(words.showFewer);
    expect(tip(host(root, "detail-prompt-more"))).toBe(words.details.showAll(11));
    await act(async () => host(root, "detail-prompt-more").props.onPress());
    expect(tip(host(root, "detail-prompt-more"))).toBe(words.details.showLess);
    await act(async () => renderer!.update(<TaskDetailCards {...props} stop={{ phase: "confirming", onPress() {} }} />));
    expect(tip(host(root, "detail-stop"))).toBe(words.confirmStop);
  });

  it.each(["zh", "en"] as const)("covers statistics, icon-only tabs and group filters in %s", async (language) => {
    const cards = previewSampleCards(NOW);
    const lanes = Object.fromEntries(LANE_ORDER.map((id) => [id, { id, cards: cards.filter((card) => card.lane === id) }]));
    const board = {
      language, strings: BOARD_STRINGS[language], params: EMPTY_PARAMS, defaults: { hideSubtasks: false, doneWindow: "24h" },
      lanes, laneOrder: LANE_ORDER, visible: false, showEmptyGroups: true,
      tasks: { lanes, ready: true, workspaces: [], providers: [{ id: "claude", label: "Claude" }], labels: [], requestProjectIcon() {} },
      setParams: vi.fn(), callbacks: {}, cardById: () => undefined,
    } as unknown as BoardController;
    const root = await render(<DetailsSidebar board={board} theme={THEME} selection={{ id: null, back: [] }} dispatch={() => {}} onLane={() => {}} onReveal={() => {}} touch={false} />);
    expectActionTips(root);
    for (const id of LANE_ORDER) expect(tip(host(root, `sidebar-stat-${id}`))).toBe(BOARD_STRINGS[language].lanes[id]);
    const tabs = root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "tab");
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) expect(tip(tab)).toBe(tab.props.accessibilityLabel);
    const iconSizes = () => tabs.map((tab) => tab.find((node) => (node.type as unknown) === "Icon").props.size);
    expect(iconSizes()).toEqual([18, 18, 18, 18]);
    // The tabs share their row equally: it alone is laid out, four tabs `width` wide.
    const tabsAt = (width: number) => host(root, "sidebar-group-tabs").props.onLayout({ nativeEvent: { layout: { width: 4 * width + 2 * 10 + 3 * 6 } } });
    await act(async () => {
      tabsAt(160);
      for (const tab of tabs) host(tab, "sidebar-group-tab-measure").props.onLayout({ nativeEvent: { layout: { width: 40 } } });
    });
    expect(iconSizes()).toEqual([14, 14, 14, 14]);
    await act(async () => tabsAt(30));
    expect(iconSizes()).toEqual([18, 18, 18, 18]);
    const filter = root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "checkbox");
    expect(tip(filter)).toBe("Claude");
    const controlHover = taskTokens(THEME).card.controlHover;
    const tab = host(root, "sidebar-group-tab-FolderKanban");
    await act(async () => tab.props.onHoverIn());
    expect(tab.props.style).toMatchObject({ backgroundColor: controlHover });
    expect(tab.props.style.boxShadow).toBeUndefined();
    await act(async () => filter.props.onHoverIn());
    expect(filter.props.style).toMatchObject({ backgroundColor: controlHover });
    expect(filter.props.style.boxShadow).toBeUndefined();
    await act(async () => filter.props.onHoverOut());
    expect(filter.props.style.backgroundColor).toBe("transparent");
    await act(async () => filter.props.onPress());
    expect(board.setParams).toHaveBeenCalledOnce();
  });

  it.each(["ios", "android"])("leaves native actions free of DOM tip markers on %s", async (os) => {
    globals.__rnMockOS = os;
    const root = await render(<TaskDetailCards {...details("zh", "sample-running", { touch: true })} />);
    expect(root.findAll((node) => typeof node.type === "string" && node.props.dataSet?.bctip)).toHaveLength(0);
  });
});

describe("sidebar tips in the board layer", () => {
  it.each(["E", "S", "A", "G", ",", "]", "/", "Esc", "Space", "空格"])("keeps tooltip prose intact and renders the %s shortcut separately", async (shortcut) => {
    vi.useFakeTimers();
    const listeners = new Map<string, (event: unknown) => void>();
    const root = {
      clientLeft: 0, clientTop: 0, clientWidth: 1000, clientHeight: 600,
      contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0 }),
      addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    const label = `工具栏\nToolbar (${shortcut})`;
    const mark = {
      isConnected: true, getAttribute: () => label,
      getBoundingClientRect: () => ({ left: 20, top: 20, width: 24, height: 24 }),
      closest: () => mark,
    };
    const enter = async () => act(async () => {
      listeners.get("pointerover")!({ pointerType: "mouse", target: mark });
      vi.advanceTimersByTime(400);
    });
    await render(<BoardTips root={{ current: root as never }} theme={THEME} color={THEME.colors.foreground} />);
    await enter();
    const texts = host(renderer!.root, "board-tip").findAll((node) => (node.type as unknown) === "Text");
    expect(texts[0]!.children.filter((child) => typeof child === "string")).toEqual(["工具栏\nToolbar (", ")"]);
    expect(texts[1]!.children).toEqual([shortcut]);
    expect(StyleSheet.flatten(texts[1]!.props.style).fontFamily).toBe(TASK_MONO);
    expect(StyleSheet.flatten(texts[0]!.props.style).fontFamily).toBeUndefined();
    // A card's hint can end in the same text without describing a keyboard shortcut.
    await act(async () => renderer!.unmount());
    await render(<CardHints root={{ current: root as never }} texts={{ current: new Map([[label, () => label]]) }} theme={THEME} color={THEME.colors.foreground} />);
    await enter();
    const prose = host(renderer!.root, "task-card-hint").findAll((node) => (node.type as unknown) === "Text");
    expect(prose).toHaveLength(1);
    expect(prose[0]!.children).toEqual([label]);
  });

  it("delays a nested action's own tip, opens above the bottom edge, and closes on scroll or press", async () => {
    vi.useFakeTimers();
    const listeners = new Map<string, (event: unknown) => void>();
    const root = {
      clientLeft: 0, clientTop: 0, clientWidth: 1000, clientHeight: 600,
      contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0 }),
      addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    await render(<BoardTips root={{ current: root as never }} theme={THEME} color={THEME.colors.foreground} />);
    const mark = {
      isConnected: true, getAttribute: () => "打开文件夹",
      getBoundingClientRect: () => ({ left: 920, top: 570, width: 24, height: 24 }),
      closest: () => mark,
    };
    const shown = () => renderer!.root.findAll((node) => typeof node.type === "string" && node.props.testID === "board-tip");
    const enter = async (pointerType = "mouse") => act(async () => listeners.get("pointerover")!({ pointerType, target: mark }));
    await enter();
    await act(async () => { vi.advanceTimersByTime(399); });
    expect(shown()).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(StyleSheet.flatten(shown()[0]!.props.style)).toMatchObject({ bottom: 34, right: 56, zIndex: 40 });
    expect(shown()[0]!.find((node) => (node.type as unknown) === "Text").children).toEqual(["打开文件夹"]);
    for (const event of ["scroll", "pointerdown", "wheel"]) {
      await act(async () => listeners.get(event)!({}));
      expect(shown()).toHaveLength(0);
      await act(async () => listeners.get("pointerleave")!({}));
      await enter();
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(shown()).toHaveLength(1);
    }
    await act(async () => listeners.get("pointerleave")!({}));
    await enter("touch");
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(shown()).toHaveLength(0);
    await act(async () => renderer!.unmount());
    renderer = undefined;
    expect(listeners.size).toBe(0);
  });
});
