/**
 * On web, React Native Web draws `role="button"` as a `<button>`, and a
 * button inside another is invalid HTML that the host turns into an error
 * badge. The card and its subtask rows hold buttons, so they are focusable
 * groups there; every button is a leaf.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.hoisted(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("react-native", async () => import("./helpers/rn-mock"));

/** The DOM hover bindings the cards make, by the bound element's testID or label. */
const hovers = vi.hoisted(() => new Map<string, { enter(): void; leave(): void }>());

/** The right-click handlers the cards bind, by the bound element's testID. */
const contextMenus = vi.hoisted(() => new Map<string, (point: { x: number; y: number }, target: unknown) => void>());
const copies = vi.hoisted(() => [] as string[]);

vi.mock("../../client/web", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  bindContextMenu: (node: { props?: Record<string, unknown> } | null, open: (point: { x: number; y: number }, target: unknown) => void) => {
    const key = String(node?.props?.testID ?? "?");
    contextMenus.set(key, open);
    return () => contextMenus.delete(key);
  },
  bindRowHover: (node: { props?: Record<string, unknown> } | null, enter: () => void, leave: () => void) => {
    const key = String(node?.props?.testID ?? node?.props?.accessibilityLabel ?? "?");
    hovers.set(key, { enter, leave });
    return () => hovers.delete(key);
  },
}));

vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  const rn = await import("./helpers/rn-mock");
  return {
    Icon: (props: Record<string, unknown>) => react.createElement("Icon", props),
    ScrollView: rn.ScrollView,
    copyText: async (text: string) => {
      copies.push(text);
    },
    useToast: () => ({ show() {}, error() {} }),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { previewSampleCards as sampleCards } from "../../client/tasks/sample-cards";
import type { PermissionButton } from "../../client/tasks/actions";
import type { TaskCard } from "../../client/tasks/model";
import { TaskCardView, TaskDetailCards, taskTokens, type TaskCardViewProps } from "../../client/tasks/cards";
import { BOARD_STRINGS } from "../../client/tasks/board/strings";
import { OVERLAY_ROW_Z } from "../../client/tasks/cards/task-card";

afterAll(() => {
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
});

const THEME = {
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

const NOW = Date.parse("2026-10-20T09:00:00.000Z");
const BUTTONS: PermissionButton[] = [
  { key: "allow", label: "允许", variant: "primary", kind: "respond", action: { behavior: "allow", id: null } },
  { key: "deny", label: "拒绝", variant: "secondary", kind: "respond", action: { behavior: "deny", id: null } },
];

function texts(root: ReactTestInstance): string[] {
  return root
    .findAll((node) => (node.type as unknown) === "Text")
    .flatMap((node) => node.children.filter((child): child is string => typeof child === "string"));
}

/** A host element that draws as a native interactive element on web. */
function isButton(node: ReactTestInstance): boolean {
  if (typeof node.type !== "string") return false;
  const role = node.props.role ?? node.props.accessibilityRole;
  return role === "button" || role === "menuitem" || role === "link";
}

/** Labels of buttons that sit inside another button. */
function nestedButtons(root: ReactTestInstance): string[] {
  const found: string[] = [];
  const walk = (node: ReactTestInstance, insideButton: boolean) => {
    const button = isButton(node);
    if (button && insideButton) found.push(String(node.props.accessibilityLabel ?? node.props.testID ?? node.type));
    for (const child of node.children) {
      if (typeof child !== "string") walk(child, insideButton || button);
    }
  };
  walk(root, false);
  return found;
}

function props(id: string, overrides: Partial<TaskCardViewProps> = {}): TaskCardViewProps {
  return {
    card: sampleCards(NOW).find((card) => card.id === id)!,
    fields: { ...CARD_PRESETS.full.fields, labelLimit: CARD_PRESETS.full.labelLimit },
    theme: THEME,
    compact: false,
    permissionButtons: [],
    stopPhase: "idle",
    focused: false,
    highlighted: false,
    now: NOW,
    language: "zh",
    onReveal: () => {},
    onOpen: () => {},
    onStop: () => {},
    onPermission: () => {},
    ...overrides,
  };
}

async function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    // Host refs resolve to the element, so the hover mock can tell cards and rows apart.
    renderer = TestRenderer.create(element, { createNodeMock: (node) => ({ props: node.props }) });
  });
  return renderer;
}

describe("TaskCardView on web", () => {
  it("never nests a button inside another, on any card, desktop or phone", async () => {
    for (const compact of [false, true]) {
      for (const card of sampleCards(NOW)) {
        const renderer = await render(
          React.createElement(TaskCardView, props(card.id, { compact, permissionButtons: card.permission ? BUTTONS : [] })),
        );
        const root = renderer.root;
        // Hover to show Stop, open the stop menu and the subtasks so every control is mounted.
        const surface = root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`);
        await act(async () => surface.props.onHoverIn?.());
        const menu = root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "停止选项");
        if (menu[0]) await act(async () => menu[0]!.props.onPress());
        const toggle = root.findAll((node) => typeof node.type === "string" && node.props.accessibilityState?.expanded === false);
        if (toggle[0]) await act(async () => toggle[0]!.props.onPress());
        expect({ card: card.id, compact, nested: nestedButtons(root) }).toEqual({ card: card.id, compact, nested: [] });
        await act(async () => renderer.unmount());
      }
    }
  });

  it("keeps the card a focusable, pressable group, and its subtask rows too", async () => {
    const onOpen = vi.fn();
    const onReveal = vi.fn();
    const renderer = await render(React.createElement(TaskCardView, props("sample-running", { onOpen, onReveal })));
    const root = renderer.root;
    const surface = root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-sample-running");
    expect(surface.props.role).toBe("group");
    expect(surface.props.accessibilityRole).toBeUndefined();
    expect(surface.props.focusable).not.toBe(false);
    expect(surface.props.disabled).toBeFalsy();
    surface.props.onPress();
    expect(onOpen).toHaveBeenCalledWith("sample-running");

    const toggle = root.find((node) => typeof node.type === "string" && node.props.accessibilityState?.expanded === false);
    await act(async () => toggle.props.onPress());
    const row = root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Measure the sidebar ring 运行中");
    expect(row.props.role).toBe("group");
    row.props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sample-child-1");
    expect(nestedButtons(root)).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it("has no nested buttons in the details cards", async () => {
    const card = sampleCards(NOW).find((candidate) => candidate.id === "sample-running")!;
    const renderer = await render(
      React.createElement(TaskDetailCards, {
        card,
        theme: THEME,
        now: NOW,
        language: "zh",
        strings: BOARD_STRINGS.zh.sidebar,
        onOpen: () => {},
        onClose: () => {},
        onJump: () => {},
        stop: { phase: "idle", onPress: () => {} },
      }),
    );
    expect(nestedButtons(renderer.root)).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it("keeps Stop while the pointer moves from the card onto it, and cancels on leaving the card", async () => {
    const onStop = vi.fn();
    const onCancelStop = vi.fn();
    const card = sampleCards(NOW).find((candidate) => candidate.id === "sample-child-1")!;
    const element = (overrides: Partial<TaskCardViewProps> = {}) =>
      React.createElement(TaskCardView, props(card.id, { onStop, onCancelStop, ...overrides }));
    const renderer = await render(element());
    const root = renderer.root;
    const stopButton = () =>
      root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "停止")[0];
    const surface = root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${card.id}`);
    expect(stopButton()).toBeUndefined();

    // Pointer onto the card.
    await act(async () => hovers.get(`task-card-${card.id}`)!.enter());
    expect(stopButton()).toBeDefined();

    // Pointer onto the stop button: RNW's Pressable would end the card's own hover
    // here (hover:lock); the card does not listen to it on web, and the DOM hover
    // still contains the button, so nothing leaves.
    expect(surface.props.onHoverOut).toBeUndefined();
    await act(async () => {
      stopButton()!.props.onHoverIn?.();
      surface.props.onHoverOut?.();
    });
    expect(stopButton()).toBeDefined();
    await act(async () => stopButton()!.props.onPress());
    expect(onStop).toHaveBeenCalledWith(card, { withChildren: false });

    // Armed: the second press within the window stops.
    await act(async () => renderer.update(element({ stopPhase: "confirming" })));
    const confirm = root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "确认停止");
    await act(async () => confirm.props.onPress());
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(onCancelStop).not.toHaveBeenCalled();

    // Leaving the card cancels the confirmation and hides Stop.
    await act(async () => hovers.get(`task-card-${card.id}`)!.leave());
    expect(onCancelStop).toHaveBeenCalledWith(card.id);
    await act(async () => renderer.update(element({ stopPhase: "idle" })));
    // It fades out first, out of reach, then unmounts.
    const overlay = () => root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop-overlay")[0];
    expect(overlay()?.props.pointerEvents).toBe("none");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(stopButton()).toBeUndefined();
    await act(async () => renderer.unmount());
  });

  it("floats Stop, Open parent on a subtask, then Open in the corner on hover, and Open alone on a card with neither", async () => {
    const onOpen = vi.fn();
    const running = await render(React.createElement(TaskCardView, props("sample-child-1", { onOpen, onStop: () => {} })));
    const label = (root: ReactTestInstance, text: string) =>
      root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === text)[0];
    expect(label(running.root, "打开")).toBeUndefined();
    await act(async () => hovers.get("task-card-sample-child-1")!.enter());
    const overlay = running.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-stop-overlay");
    const order = overlay.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel);
    expect(order).toEqual(["停止", "打开父任务", "打开"]);
    await act(async () => label(running.root, "打开")!.props.onPress());
    expect(onOpen).toHaveBeenCalledWith("sample-child-1");
    await act(async () => label(running.root, "打开父任务")!.props.onPress());
    expect(onOpen).toHaveBeenLastCalledWith("sample-running");
    await act(async () => running.unmount());

    const done = await render(React.createElement(TaskCardView, props("sample-done", { onOpen })));
    await act(async () => hovers.get("task-card-sample-done")!.enter());
    const alone = done.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-open-overlay");
    expect(alone.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel)).toEqual(["打开"]);
    await act(async () => done.unmount());
  });

  it("floats Open alone on a waiting card's hover, leaving Stop to the menu", async () => {
    const onStop = vi.fn();
    const renderer = await render(React.createElement(TaskCardView, props("sample-input", { onStop })));
    await act(async () => hovers.get("task-card-sample-input")!.enter());
    const overlay = renderer.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-open-overlay");
    expect(overlay.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button").map((node) => node.props.accessibilityLabel)).toEqual(["打开"]);
    expect(renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-stop")).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it("floats Archive before Open on a done task's hover, spinning while it runs", async () => {
    const onOpen = vi.fn();
    const onArchive = vi.fn();
    const renderer = await render(React.createElement(TaskCardView, props("sample-done", { onOpen, onArchive })));
    await act(async () => hovers.get("task-card-sample-done")!.enter());
    const overlay = renderer.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-archive-overlay");
    const buttons = overlay.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(["归档", "打开"]);
    await act(async () => buttons[0]!.props.onPress());
    expect(onArchive).toHaveBeenCalledWith("sample-done");
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () => renderer.update(React.createElement(TaskCardView, props("sample-done", { onOpen, onArchive, archivePending: true }))));
    const busy = renderer.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-archive");
    expect(busy.props.disabled).toBe(true);
    await act(async () => renderer.unmount());

    // Only the done lane: a running task has no Archive.
    const running = await render(React.createElement(TaskCardView, props("sample-child-1", { onOpen, onArchive })));
    await act(async () => hovers.get("task-card-sample-child-1")!.enter());
    expect(running.root.findAll((node) => node.props.testID === "task-card-archive")).toHaveLength(0);
    await act(async () => running.unmount());
  });

  it("floats Unarchive in Open's place on an archived task's hover", async () => {
    const onOpen = vi.fn();
    const onUnarchive = vi.fn();
    const card: TaskCard = { ...sampleCards(NOW).find((candidate) => candidate.id === "sample-done")!, lane: "archived", status: "archived", archived: "agent" };
    const renderer = await render(React.createElement(TaskCardView, { ...props(card.id, { onOpen, onUnarchive }), card }));
    await act(async () => hovers.get(`task-card-${card.id}`)!.enter());
    const overlay = renderer.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-unarchive-overlay");
    const buttons = overlay.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "button");
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(["取消归档"]);
    await act(async () => buttons[0]!.props.onPress());
    expect(onUnarchive).toHaveBeenCalledWith(card.id);
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it("floats Mark read over the row's end on hover, keeps it while pending, and fades it out", async () => {
    const onRead = vi.fn();
    const card: TaskCard = { ...sampleCards(NOW).find((candidate) => candidate.id === "sample-unread")!, readable: true };
    const element = (overrides: Partial<TaskCardViewProps> = {}) =>
      React.createElement(TaskCardView, { ...props(card.id, { onRead, ...overrides }), card });
    const renderer = await render(element());
    const root = renderer.root;
    const readButton = () =>
      root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "标为已读")[0];
    const overlay = () => root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-read-overlay")[0];
    expect(readButton()).toBeUndefined();
    expect(nestedButtons(root)).toEqual([]);

    await act(async () => hovers.get(`task-card-${card.id}`)!.enter());
    // Stop's place: the footer's right end, over the context ring.
    expect(Object.assign({}, ...[overlay()?.props.style].flat())).toMatchObject({ position: "absolute", right: 0 });
    const footer = root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-footer");
    expect(footer.findAll((node) => node === overlay())).toHaveLength(1);
    await act(async () => readButton()!.props.onPress());
    expect(onRead).toHaveBeenCalledWith(card);
    expect(nestedButtons(root)).toEqual([]);

    // Pending, it stays after the pointer leaves, until the card moves on.
    await act(async () => renderer.update(element({ readPending: true })));
    await act(async () => hovers.get(`task-card-${card.id}`)!.leave());
    expect(readButton()?.props.disabled).toBe(true);

    await act(async () => renderer.update(element({ readPending: false })));
    expect(overlay()?.props.pointerEvents).toBe("none");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(readButton()).toBeUndefined();
    await act(async () => renderer.unmount());
  });

  it("keeps a parent's stop menu and a subtask row's jump button while they are hovered", async () => {
    const onOpen = vi.fn();
    const renderer = await render(React.createElement(TaskCardView, props("sample-running", { onOpen })));
    const root = renderer.root;
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await act(async () =>
      root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "停止选项").props.onPress(),
    );
    expect(texts(root)).toContain("连同子任务一起停止");

    await act(async () =>
      root.find((node) => typeof node.type === "string" && node.props.accessibilityState?.expanded === false).props.onPress(),
    );
    const jump = () =>
      root
        .find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Measure the sidebar ring 运行中")
        .find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "在 workspace 中打开");
    expect(jump().props.disabled).toBe(true);
    await act(async () => hovers.get("subtask-sample-child-1")!.enter());
    expect(jump().props.disabled).toBe(false);
    expect(jump().props.style.opacity).toBe(1);
    jump().props.onPress();
    expect(onOpen).toHaveBeenCalledWith("sample-child-1");
    // The menu is still open: the card never lost its hover.
    expect(texts(root)).toContain("连同子任务一起停止");
    await act(async () => renderer.unmount());
  });

  it("raises the rows that hold overlays above the rows after them", async () => {
    const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;
    const host = (root: ReactTestInstance, testID: string) =>
      root.find((node) => typeof node.type === "string" && node.props.testID === testID);
    /** Host children of a host element, looking through rn-mock's function wrappers. */
    const hostChildren = (node: ReactTestInstance): ReactTestInstance[] =>
      node.children.flatMap((child) =>
        typeof child === "string" ? [] : typeof child.type === "string" ? [child] : hostChildren(child),
      );
    const zOf = (node: ReactTestInstance) => Number(flat(node.props.style).zIndex ?? 0);

    // Desktop: the stop menu lives in the footer, above the rows after it; the
    // meta row holds no overlay until the context ring's details show.
    const renderer = await render(React.createElement(TaskCardView, props("sample-running")));
    const root = renderer.root;
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await act(async () =>
      root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "停止选项").props.onPress(),
    );
    const header = host(root, "task-card-meta");
    const footer = host(root, "task-card-footer");
    expect(OVERLAY_ROW_Z).toBeGreaterThan(0);
    expect(zOf(header)).toBe(0);
    expect(zOf(footer)).toBe(OVERLAY_ROW_Z);
    const rows = hostChildren(host(root, "task-card-sample-running"));
    for (const row of rows.slice(rows.indexOf(footer) + 1)) expect(zOf(row)).toBeLessThan(OVERLAY_ROW_Z);
    const items = footer.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
    expect(items).toHaveLength(2);
    await act(async () => renderer.unmount());

    // Phone: the menu opens upwards from the action bar, the card's last and raised row.
    const phone = await render(React.createElement(TaskCardView, props("sample-running", { compact: true })));
    const actions = host(phone.root, "task-card-actions");
    expect(zOf(actions)).toBe(OVERLAY_ROW_Z);
    const phoneRows = hostChildren(host(phone.root, "task-card-sample-running"));
    expect(phoneRows[phoneRows.length - 1]).toBe(actions);
    await act(async () =>
      actions.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "停止选项").props.onPress(),
    );
    expect(actions.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem")).toHaveLength(2);
    await act(async () => phone.unmount());
  });
});

describe("TaskCardView right-click menu", () => {
  const rows = (root: ReactTestInstance) =>
    root.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem").map((node) => texts(node)[0]);
  const choose = (root: ReactTestInstance, label: string) =>
    act(async () => {
      root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem" && texts(node)[0] === label).props.onPress();
      await Promise.resolve();
    });

  it("opens at the pointer with Open, the copies, then what the card can do", async () => {
    const onStop = vi.fn();
    const renderer = await render(React.createElement(TaskCardView, props("sample-running", { onStop })));
    const root = renderer.root;
    expect(root.findAll((node) => node.props.testID === "task-card-menu")).toHaveLength(0);
    await act(async () => contextMenus.get("task-card-sample-running")!({ x: 40, y: 60 }, null));
    expect(rows(root)).toEqual(["打开", "复制会话 ID", "复制标题", "复制 workspace 名称", "复制项目名称", "停止"]);

    copies.length = 0;
    await choose(root, "复制会话 ID");
    expect(copies).toEqual(["sample-running"]);
    expect(root.findAll((node) => node.props.testID === "task-card-menu")).toHaveLength(0);

    // A parent's Stop opens "only this / with subtasks"; either stops without the confirm step.
    await act(async () => contextMenus.get("task-card-sample-running")!({ x: 40, y: 60 }, null));
    await choose(root, "停止");
    await choose(root, "连同子任务一起停止");
    expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ id: "sample-running" }), { withChildren: true, dialog: true });
    await act(async () => renderer.unmount());
  });

  it("draws Stop, and its subtask choices, in the danger colour", async () => {
    const renderer = await render(React.createElement(TaskCardView, props("sample-running")));
    const root = renderer.root;
    const danger = taskTokens(THEME).danger;
    await act(async () => contextMenus.get("task-card-sample-running")!({ x: 40, y: 60 }, null));
    const row = (label: string) =>
      root.find((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem" && texts(node)[0] === label);
    const colors = (node: ReactTestInstance) => ({
      text: node.findAll((child) => (child.type as unknown) === "Text")[0]!.props.style.color,
      icon: node.findAll((child) => (child.type as unknown) === "Icon")[0]?.props.color,
    });
    expect(colors(row("停止"))).toEqual({ text: danger, icon: danger });
    expect(colors(row("复制标题")).text).not.toBe(danger);
    await choose(root, "停止");
    expect(colors(row("仅停止此任务"))).toEqual({ text: danger, icon: danger });
    expect(colors(row("连同子任务一起停止"))).toEqual({ text: danger, icon: danger });
    await act(async () => renderer.unmount());
  });

  it("offers Mark read on a card to review and Unarchive on an archived task", async () => {
    const onRead = vi.fn();
    const onUnarchive = vi.fn();
    const card = { ...sampleCards(NOW).find((item) => item.id === "sample-unread")!, readable: true };
    const unread = await render(React.createElement(TaskCardView, props("sample-unread", { card, onRead })));
    await act(async () => contextMenus.get("task-card-sample-unread")!({ x: 0, y: 0 }, null));
    expect(rows(unread.root)).toContain("标为已读");
    expect(rows(unread.root)).not.toContain("停止");
    await choose(unread.root, "标为已读");
    expect(onRead).toHaveBeenCalledTimes(1);
    await act(async () => unread.unmount());

    const archived = await render(React.createElement(TaskCardView, props("sample-archived", { onUnarchive })));
    await act(async () => contextMenus.get("task-card-sample-archived")!({ x: 0, y: 0 }, null));
    await choose(archived.root, "取消归档");
    expect(onUnarchive).toHaveBeenCalledWith("sample-archived");
    await act(async () => archived.unmount());

    // Only a task archived itself can come back; one of an archived workspace has no Unarchive.
    const workspace = await render(React.createElement(TaskCardView, props("sample-archived-workspace", { onUnarchive })));
    await act(async () => contextMenus.get("task-card-sample-archived-workspace")!({ x: 0, y: 0 }, null));
    expect(rows(workspace.root)).not.toContain("取消归档");
    await act(async () => workspace.unmount());
  });

  it("offers Archive on a done task, and not while it runs", async () => {
    const onArchive = vi.fn();
    const done = await render(React.createElement(TaskCardView, props("sample-done", { onArchive })));
    await act(async () => contextMenus.get("task-card-sample-done")!({ x: 0, y: 0 }, null));
    expect(rows(done.root).at(-1)).toBe("归档");
    await choose(done.root, "归档");
    expect(onArchive).toHaveBeenCalledWith("sample-done");
    await act(async () => done.update(React.createElement(TaskCardView, props("sample-done", { onArchive, archivePending: true }))));
    await act(async () => contextMenus.get("task-card-sample-done")!({ x: 0, y: 0 }, null));
    expect(rows(done.root)).not.toContain("归档");
    await act(async () => done.unmount());

    const running = await render(React.createElement(TaskCardView, props("sample-running", { onArchive })));
    await act(async () => contextMenus.get("task-card-sample-running")!({ x: 0, y: 0 }, null));
    expect(rows(running.root)).not.toContain("归档");
    await act(async () => running.unmount());
    const archived = await render(React.createElement(TaskCardView, props("sample-archived", { onArchive })));
    await act(async () => contextMenus.get("task-card-sample-archived")!({ x: 0, y: 0 }, null));
    expect(rows(archived.root)).not.toContain("归档");
    await act(async () => archived.unmount());
  });

  it("leaves a right click inside the open menu alone", async () => {
    const renderer = await render(React.createElement(TaskCardView, props("sample-running")));
    const root = renderer.root;
    await act(async () => contextMenus.get("task-card-sample-running")!({ x: 40, y: 60 }, null));
    const menu = { closest: (selector: string) => (selector.includes("task-card-menu") ? {} : null) };
    await act(async () => contextMenus.get("task-card-sample-running")!({ x: 300, y: 300 }, menu));
    expect(root.find((node) => node.props.testID === "task-card-menu-anchor")).toBeTruthy();
    await act(async () => renderer.unmount());
  });
});

describe("TaskCardView details", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the card a double click's first click chose, wherever its second click lands", async () => {
    // The document's capture listeners run first; one that stops the click keeps it from its target.
    const listeners: Array<(event: MouseEvent) => void> = [];
    vi.stubGlobal("document", {
      addEventListener: (type: string, listener: (event: MouseEvent) => void, capture: boolean) => {
        if (type === "click" && capture) listeners.push(listener);
      },
    });
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    const renderer = await render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(TaskCardView, props("sample-running", { onOpen, onSelect })),
        React.createElement(TaskCardView, props("sample-child-1", { onOpen, onSelect })),
      ),
    );
    const surface = (id: string) => renderer.root.find((node) => typeof node.type === "string" && node.props.testID === `task-card-${id}`);
    /** A click with the system's count, on a card or on something else (the details panel). */
    const click = (id: string | null, detail: number) => {
      let stopped = false;
      const event = { detail, preventDefault() {}, stopPropagation: () => void (stopped = true) } as unknown as MouseEvent;
      for (const listener of listeners) listener(event);
      if (!stopped && id) surface(id).props.onPress({ nativeEvent: event });
    };
    const chosen = () => onSelect.mock.calls.map(([card]) => card.id);

    // The system's click count decides, however slow its double-click speed.
    click("sample-running", 1);
    click("sample-running", 2);
    expect(chosen()).toEqual(["sample-running"]);
    expect(onOpen).toHaveBeenCalledWith("sample-running");

    // The first click brought in the panel and scrolled the lanes: the second
    // click lands on the panel or on another card, and still opens the first card.
    for (const second of [null, "sample-child-1"]) {
      onOpen.mockClear();
      onSelect.mockClear();
      click("sample-child-1", 1);
      click(second === null ? null : "sample-running", 2);
      expect(chosen()).toEqual(["sample-child-1"]);
      expect(onOpen.mock.calls).toEqual([["sample-child-1"]]);
    }

    // A third click, a click elsewhere in between, and Enter (no count) open nothing.
    onOpen.mockClear();
    click("sample-running", 3);
    click("sample-running", 1);
    click(null, 1);
    click("sample-running", 2);
    surface("sample-child-1").props.onPress({ nativeEvent: { detail: 0 } });
    click(null, 2);
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it("never asks for the sidebar on a hover: only a click chooses a card", async () => {
    vi.useFakeTimers();
    const onDetails = vi.fn();
    const renderer = await render(React.createElement(TaskCardView, props("sample-running", { onDetails })));
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(onDetails).not.toHaveBeenCalled();
    await act(async () => hovers.get("task-card-sample-running")!.leave());
    await act(async () => renderer.unmount());
  });
});

describe("TaskCardView hover layout", () => {
  const LAYOUT_KEYS = /^(width|height|min|max|padding|margin|flex|gap|rowGap|columnGap|position|top|left|right|bottom|border.*Width|alignItems|alignSelf|justifyContent)/;
  const flat = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)) as Record<string, unknown>;

  /** Every in-flow host element's layout styles; absolutely positioned overlays and their content are skipped. */
  function layout(root: ReactTestInstance): string[] {
    const out: string[] = [];
    const walk = (node: ReactTestInstance, path: string) => {
      if (typeof node.type === "string") {
        const style = flat(node.props.style);
        if (style.position === "absolute") return;
        const picked = Object.keys(style)
          .filter((key) => LAYOUT_KEYS.test(key))
          .sort()
          .map((key) => `${key}=${JSON.stringify(style[key])}`);
        out.push(`${path}${node.type}[${node.props.testID ?? ""}] ${picked.join(" ")}`);
      }
      node.children.forEach((child, index) => {
        if (typeof child !== "string") walk(child, `${path}${index}/`);
      });
    };
    walk(root, "");
    return out;
  }

  it("moves nothing when the pointer enters a card, with or without a meta row", async () => {
    for (const fields of [CARD_PRESETS.full, CARD_PRESETS.minimal]) {
      for (const id of ["sample-running", "sample-child-1", "sample-input"]) {
        const renderer = await render(
          React.createElement(
            TaskCardView,
            props(id, { fields: { ...fields.fields, labelLimit: fields.labelLimit }, permissionButtons: BUTTONS }),
          ),
        );
        const before = layout(renderer.root);
        await act(async () => hovers.get(`task-card-${id}`)!.enter());
        // Stop (Open alone on the waiting card) is on screen, floating over the row's end.
        const overlayID = id === "sample-input" ? "task-card-open-overlay" : "task-card-stop-overlay";
        const overlay = renderer.root.find((node) => typeof node.type === "string" && node.props.testID === overlayID);
        expect(flat(overlay.props.style).position).toBe("absolute");
        expect(layout(renderer.root)).toEqual(before);
        await act(async () => hovers.get(`task-card-${id}`)!.leave());
        expect(layout(renderer.root)).toEqual(before);
        await act(async () => renderer.unmount());
      }
    }
  });
});

describe("TaskCardView hover hints", () => {
  /** A card root that records its DOM listeners, for the hint layer's delegation. */
  function fakeCard(testID: string) {
    const listeners = new Map<string, (event: unknown) => void>();
    const card = {
      props: { testID },
      clientLeft: 1,
      clientTop: 1,
      clientWidth: 338,
      clientHeight: 200,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 340, height: 202 }),
      contains: () => true,
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };
    return { card, listeners };
  }

  /** The DOM element a host node with a hint key draws as, at a window box. */
  function mark(key: string, box: { left: number; top: number; width: number; height: number }) {
    const element = {
      isConnected: true,
      getAttribute: (name: string) => (name === "data-bchint" ? key : null),
      getBoundingClientRect: () => box,
      closest: () => element,
    };
    return element;
  }

  it("marks the meta row, status, pills, times and stop options, and names each", async () => {
    vi.useFakeTimers();
    try {
      const { card, listeners } = fakeCard("task-card-sample-running");
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(TaskCardView, props("sample-running")), {
          createNodeMock: (node) => {
            const nodeProps = node.props as Record<string, unknown>;
            return nodeProps.testID === "task-card-sample-running" ? card : { props: nodeProps };
          },
        });
      });
      const root = renderer.root;
      const keys = root
        .findAll((node) => typeof node.type === "string" && node.props.dataSet?.bchint !== undefined)
        .map((node) => node.props.dataSet.bchint as string);
      expect(keys).toEqual(expect.arrayContaining(["project", "location", "status", "model", "branch", "subtasks", "started", "timer"]));

      const hint = () => root.findAll((node) => typeof node.type === "string" && node.props.testID === "task-card-hint");
      const show = async (key: string, box: { left: number; top: number; width: number; height: number }) => {
        await act(async () => listeners.get("pointerover")!({ pointerType: "mouse", target: mark(key, box) }));
        await act(async () => { vi.advanceTimersByTime(400); });
        return texts(hint()[0]!).join("");
      };

      await act(async () => listeners.get("pointerover")!({ pointerType: "mouse", target: mark("branch", { left: 220, top: 140, width: 120, height: 20 }) }));
      await act(async () => { vi.advanceTimersByTime(399); });
      expect(hint()).toHaveLength(0);
      await act(async () => { vi.advanceTimersByTime(1); });
      expect(texts(hint()[0]!).join("")).toBe("分支：feat/tasks-board\n有未提交改动\n领先 3 个提交\n点击复制");

      expect(await show("model", { left: 112, top: 140, width: 100, height: 20 })).toBe("模型：Codex GPT-5.5 Codex\n思考强度：Medium\n点击复制");
      expect(texts(root.find((node) => typeof node.type === "string" && node.props.testID === "agent-pill-thinking"))).toEqual(["Medium"]);
      expect(await show("status", { left: 112, top: 80, width: 16, height: 20 })).toBe("状态：运行中");
      expect(await show("timer", { left: 180, top: 230, width: 60, height: 18 })).toBe("本轮已运行：12m 30s");
      expect(await show("subtasks", { left: 112, top: 166, width: 80, height: 20 })).toBe("3 个子任务：2 运行中 · 1 已完成");

      // Touch has no hover, and leaving the card closes the hint.
      await act(async () => listeners.get("pointerleave")!({}));
      expect(hint()).toHaveLength(0);
      await act(async () => listeners.get("pointerover")!({ pointerType: "touch", target: mark("status", { left: 112, top: 80, width: 16, height: 20 }) }));
      await act(async () => { vi.advanceTimersByTime(400); });
      expect(hint()).toHaveLength(0);
      const separate = props("sample-running");
      separate.fields = { ...separate.fields, provider: false, model: false };
      await act(async () => renderer.update(React.createElement(TaskCardView, separate)));
      expect(texts(root.find((node) => typeof node.type === "string" && node.props.testID === "pill-thinking"))).toEqual(["Medium"]);
      expect(await show("thinking", { left: 112, top: 140, width: 40, height: 20 })).toBe("思考强度：Medium");
      await act(async () => renderer.unmount());
      expect(listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
