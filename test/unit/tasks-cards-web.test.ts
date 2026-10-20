/**
 * On web, React Native Web draws `role="button"` as a `<button>`, and a
 * button inside another is invalid HTML that the host turns into an error
 * badge. The card and its subtask rows hold buttons, so they are focusable
 * groups there; every button is a leaf.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import React from "react";

vi.hoisted(() => {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock("react-native", async () => import("./helpers/rn-mock"));

vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const react = await import("react");
  return { Icon: (props: Record<string, unknown>) => react.createElement("Icon", props) };
});

import "./helpers/quiet-renderer";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { CARD_PRESETS } from "../../shared/tasks-settings";
import { sampleCards } from "../../client/tasks/sample-cards";
import type { PermissionButton } from "../../client/tasks/actions";
import { TaskCardView, TaskDetails, type TaskCardViewProps } from "../../client/tasks/cards";

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
    renderer = TestRenderer.create(element);
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
});
