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

vi.mock("../../client/web", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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
    copyText: async () => {},
    useToast: () => ({ show() {}, error() {} }),
  };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { previewSampleCards as sampleCards } from "../../client/tasks/sample-cards";
import type { PermissionButton } from "../../client/tasks/actions";
import { TaskCardView, TaskDetails, type TaskCardViewProps } from "../../client/tasks/cards";
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
    const row = root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Measure the sidebar ring");
    expect(row.props.role).toBe("group");
    row.props.onPress();
    expect(onReveal).toHaveBeenCalledWith("sample-child-1");
    expect(nestedButtons(root)).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it("has no nested buttons in the details popover", async () => {
    const card = sampleCards(NOW).find((candidate) => candidate.id === "sample-running")!;
    const renderer = await render(React.createElement(TaskDetails, { card, theme: THEME, now: NOW, onOpen: () => {}, language: "zh" }));
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
    expect(stopButton()).toBeUndefined();
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
        .find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Measure the sidebar ring")
        .find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "在 workspace 中打开");
    expect(jump().props.disabled).toBe(true);
    await act(async () => hovers.get("Measure the sidebar ring")!.enter());
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

    // Desktop: the stop menu and the jump tooltip live in the meta row, above the rows after it.
    const renderer = await render(React.createElement(TaskCardView, props("sample-running")));
    const root = renderer.root;
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await act(async () =>
      root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === "停止选项").props.onPress(),
    );
    const header = host(root, "task-card-meta");
    expect(OVERLAY_ROW_Z).toBeGreaterThan(0);
    expect(zOf(header)).toBe(OVERLAY_ROW_Z);
    const rows = hostChildren(host(root, "task-card-sample-running"));
    const after = rows.slice(rows.indexOf(header) + 1);
    expect(after.length).toBeGreaterThan(0);
    for (const row of after) expect(zOf(row)).toBeLessThan(OVERLAY_ROW_Z);
    const items = header.findAll((node) => typeof node.type === "string" && node.props.accessibilityRole === "menuitem");
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

describe("TaskCardView details hover", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup(overrides: Partial<TaskCardViewProps> = {}) {
    vi.useFakeTimers();
    const onDetails = vi.fn();
    const onDetailsEnd = vi.fn();
    const element = (more: Partial<TaskCardViewProps> = {}) =>
      React.createElement(TaskCardView, props("sample-running", { onDetails, onDetailsEnd, ...overrides, ...more }));
    const renderer = await render(element());
    const root = renderer.root;
    const control = (label: string) =>
      root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);
    const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
    return { renderer, root, element, control, wait, onDetails, onDetailsEnd };
  }

  it("asks for the sidebar after 150 ms on the body, and not while the pointer rests on Stop", async () => {
    const { renderer, control, wait, onDetails, onDetailsEnd } = await setup();
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await act(async () => control("停止").props.onHoverIn());
    await wait(1000);
    expect(onDetails).not.toHaveBeenCalled();

    // Back on the body: the delay starts again.
    await act(async () => control("停止").props.onHoverOut());
    await wait(149);
    expect(onDetails).not.toHaveBeenCalled();
    await wait(1);
    expect(onDetails).toHaveBeenCalledTimes(1);

    // Onto the jump button: the hover on the body ends.
    await act(async () => control("在 workspace 中打开").props.onHoverIn());
    expect(onDetailsEnd).toHaveBeenCalledWith("sample-running");
    await act(async () => renderer.unmount());
  });

  it("stays closed while the stop menu is open or a stop is armed", async () => {
    const { renderer, control, wait, element, onDetails } = await setup();
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await act(async () => control("停止选项").props.onPress());
    await wait(1000);
    expect(onDetails).not.toHaveBeenCalled();

    // Close the menu, arm a stop: still closed.
    await act(async () => control("停止选项").props.onPress());
    await act(async () => renderer.update(element({ stopPhase: "confirming" })));
    await wait(1000);
    expect(onDetails).not.toHaveBeenCalled();

    await act(async () => renderer.update(element({ stopPhase: "idle" })));
    await wait(450);
    expect(onDetails).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it("does not close a popover it never opened", async () => {
    const { renderer, control, wait, onDetailsEnd } = await setup();
    await act(async () => hovers.get("task-card-sample-running")!.enter());
    await wait(100);
    await act(async () => control("停止").props.onHoverIn());
    await act(async () => hovers.get("task-card-sample-running")!.leave());
    await act(async () => renderer.unmount());
    expect(onDetailsEnd).not.toHaveBeenCalled();
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
        // Stop is on screen, floating over the row's end.
        const overlay = renderer.root.find((node) => typeof node.type === "string" && node.props.testID === "task-card-stop-overlay");
        expect(flat(overlay.props.style).position).toBe("absolute");
        expect(layout(renderer.root)).toEqual(before);
        await act(async () => hovers.get(`task-card-${id}`)!.leave());
        expect(layout(renderer.root)).toEqual(before);
        await act(async () => renderer.unmount());
      }
    }
  });
});
