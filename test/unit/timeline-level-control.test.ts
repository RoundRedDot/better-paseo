import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { vi } from "vitest";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client/ui", () => ({ Icon: (props: unknown) => React.createElement("Icon", props as never), useToast: () => ({ show() {}, error() {} }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, it } from "vitest";
import type { PluginButton, PluginComposerPillContribution } from "@getpaseo/plugin/client";
import {
  createTimelineLevelControl,
  installTimelineLevelControl,
  parseTimelineLevelArgument,
  setTimelineLevelToast,
  timelineLevelButton,
} from "../../client/timeline-level-control";
import { setSettingsTab, settingsTab } from "../../client/settings-tab";
import { DEFAULT_PREFERENCES, getEnhancerPreferences, resetEnhancerPreferences, updateEnhancerPreferences } from "../../client/preferences";

interface FakePill {
  contribution: PluginComposerPillContribution;
  button: PluginButton;
  updates: number;
  removed: boolean;
}

function fakeClient() {
  const pills: FakePill[] = [];
  const commands: { name: string; onSubmit: (context: never) => void; removed: boolean }[] = [];
  const opened: string[] = [];
  return {
    opened,
    openSettings(id: string) { opened.push(id); },
    pills,
    commands,
    addComposerPill(contribution: PluginComposerPillContribution) {
      const pill: FakePill = { contribution, button: contribution.button, updates: 0, removed: false };
      pills.push(pill);
      return {
        update(patch: Partial<PluginButton>) {
          if (pill.removed) return;
          pill.button = { ...pill.button, ...patch };
          pill.updates += 1;
        },
        remove() {
          pill.removed = true;
        },
      };
    },
    addSlashCommand(contribution: { name: string; onSubmit: (context: never) => void }) {
      const entry = { ...contribution, removed: false };
      commands.push(entry);
      return () => {
        entry.removed = true;
      };
    },
  };
}

function menuItems(button: PluginButton, close = () => {}) {
  if (button.behavior.kind !== "popover") throw new Error("expected a popover");
  const Content = button.behavior.Content;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Content, { theme: { colors: { foreground: "black", foregroundMuted: "gray", border: "gray", surface2: "gray" } }, layout: { compact: false }, host: { id: "h", label: "h" }, context: "agent", agentId: "a", workspaceId: "w", close } as never)); });
  const rows = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "radio");
  const result = rows.map((node, index) => ({ id: ["simple", "standard", "detailed"][index], title: node.props.accessibilityLabel as string,
    icon: node.findAllByType("Icon" as never)[0]!.props.name as string, checked: node.props.accessibilityState.checked as boolean, press: node.props.onPress as () => void }));
  const settings = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === (getEnhancerPreferences().language === "zh" ? "聊天设置" : "Chat settings"))[0]!.props.onPress as () => void;
  act(() => renderer.unmount());
  return { rows: result, settings };
}

afterEach(() => {
  resetEnhancerPreferences();
});

describe("timeline level pill", () => {
  it.each([false, true])("matches the host menu density for compact=%s", (compact) => {
    const button = timelineLevelButton(DEFAULT_PREFERENCES, () => {});
    if (button.behavior.kind !== "popover") throw new Error("expected a popover");
    const Content = button.behavior.Content;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Content, { theme: { colors: { foreground: "black", foregroundMuted: "gray", border: "gray", surface2: "gray" } }, layout: { compact }, host: { id: "h", label: "h" }, context: "agent", agentId: "a", workspaceId: "w", close() {} } as never)); });
    const rows = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "radio");
    for (const row of rows) {
      expect(row.props.style.height).toBe(compact ? 44 : 28);
      const label = row.findByType("Text" as never);
      expect(label.props.style).toMatchObject({ fontSize: 14, lineHeight: 18 });
    }
    const title = renderer.root.findAll((node) => String(node.type) === "Text" && node.props.children === "Agent steps")[0]!;
    expect(title.props.style).toMatchObject({ fontSize: 14, fontWeight: "normal" });
    const menu = renderer.root.findAll((node) => String(node.type) === "View" && node.props.testID === "timeline-level-menu")[0]!;
    expect(menu.props.style).toEqual(compact ? undefined : { margin: -8 });
    act(() => renderer.unmount());
  });

  it("closes the popover and opens chat settings even after another tab was selected", () => {
    updateEnhancerPreferences({ language: "zh" });
    setSettingsTab("tasks");
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    let closed = 0;
    menuItems(client.pills[0]!.button, () => { closed++; }).settings();
    expect(closed).toBe(1);
    expect(client.opened).toEqual(["chat-presentation"]);
    expect(settingsTab()).toBe("display");
    control.remove();
  });


  it("shows the current level and checks it in the menu", () => {
    updateEnhancerPreferences({ language: "zh" });
    const button = timelineLevelButton({ ...DEFAULT_PREFERENCES, language: "zh" }, () => {});
    expect(button.title).toBe("工作过程");
    expect(button.label).toBe("标准");
    expect(button.visible).toBe(true);
    expect(button.icon).toBe("ListCollapse");
    expect(menuItems(button).rows.map(({ id, title, icon }) => [id, title, icon])).toEqual([
      ["simple", "简洁", "Minus"],
      ["standard", "标准", "Equal"],
      ["detailed", "详细", "Menu"],
    ]);
  });

  it("hides while Better Paseo chat is off", () => {
    expect(timelineLevelButton({ ...DEFAULT_PREFERENCES, chatEnabled: false }, () => {}).visible).toBe(false);
  });

  it("registers one pill per agent, however many rows ask", () => {
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    control.request("a1", "w1");
    control.request("a2", "w1");
    expect(client.pills.map((pill) => [pill.contribution.agentId, pill.contribution.workspaceId])).toEqual([["a1", "w1"], ["a2", "w1"]]);
    control.remove();
  });

  it("switches the shared level from the menu and updates every pill", () => {
    updateEnhancerPreferences({ language: "en" });
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    control.request("a2", "w2");
    let closed = 0;
    const detailed = menuItems(client.pills[0]!.button, () => { closed++; }).rows.find((item) => item.id === "detailed")!;
    void detailed.press();
    expect(getEnhancerPreferences().timelineLevel).toBe("detailed");
    expect(closed).toBe(1);
    for (const pill of client.pills) {
      expect(pill.button.label).toBe("Detailed");
      expect(menuItems(pill.button).rows.find((item) => item.checked)?.id).toBe("detailed");
    }
    control.remove();
  });

  it("confirms a switch from the menu with a toast", () => {
    updateEnhancerPreferences({ language: "zh" });
    const shown: string[] = [];
    setTimelineLevelToast({ show: (message) => shown.push(message), error() {} });
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    void menuItems(client.pills[0]!.button).rows.find((item) => item.id === "simple")!.press();
    expect(shown).toEqual(["工作过程：简洁"]);
    control.remove();
    setTimelineLevelToast(null);
  });

  it("refreshes every pill when the slash command switches the level", () => {
    updateEnhancerPreferences({ language: "en" });
    const client = fakeClient();
    const remove = installTimelineLevelControl(client as never);
    const command = client.commands.find((entry) => entry.name === "bp-timeline")!;
    command.onSubmit({ args: "", agent: { id: "a1", workspaceId: "w1" } } as never);
    command.onSubmit({ args: "1", agent: { id: "a2", workspaceId: "w1" } } as never);
    expect(client.pills.map((pill) => pill.contribution.agentId)).toEqual(["a1", "a2"]);
    for (const pill of client.pills) {
      expect(pill.button.label).toBe("Simple");
      expect(menuItems(pill.button).rows.find((item) => item.checked)?.id).toBe("simple");
    }
    command.onSubmit({ args: "3", agent: { id: "a2", workspaceId: "w1" } } as never);
    for (const pill of client.pills) expect(pill.button.label).toBe("Detailed");
    remove();
  });

  it("leaves the pills alone when an unrelated preference changes", () => {
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    updateEnhancerPreferences({ hoverPreview: false });
    expect(client.pills[0]!.updates).toBe(0);
    updateEnhancerPreferences({ chatEnabled: false });
    expect(client.pills[0]!.updates).toBe(1);
    expect(client.pills[0]!.button.visible).toBe(false);
    control.remove();
  });

  it("removes every pill and stops following preferences on cleanup", () => {
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    control.remove();
    expect(client.pills[0]!.removed).toBe(true);
    updateEnhancerPreferences({ timelineLevel: "simple" });
    expect(client.pills[0]!.updates).toBe(0);
    control.request("a3", "w1");
    expect(client.pills).toHaveLength(1);
  });
});

describe("/bp-timeline", () => {
  it("cycles with no argument and sets a named level in either language", () => {
    expect(parseTimelineLevelArgument("", "simple")).toBe("standard");
    expect(parseTimelineLevelArgument(" ", "standard")).toBe("detailed");
    expect(parseTimelineLevelArgument("", "detailed")).toBe("simple");
    expect(parseTimelineLevelArgument("Detailed", "simple")).toBe("detailed");
    expect(parseTimelineLevelArgument("简洁", "detailed")).toBe("simple");
    expect(parseTimelineLevelArgument("verbose", "standard")).toBeNull();
  });

  it("picks a level by its number in the menu", () => {
    expect(parseTimelineLevelArgument("1", "detailed")).toBe("simple");
    expect(parseTimelineLevelArgument(" 2 ", "simple")).toBe("standard");
    expect(parseTimelineLevelArgument("3", "simple")).toBe("detailed");
    expect(parseTimelineLevelArgument("0", "simple")).toBeNull();
    expect(parseTimelineLevelArgument("4", "simple")).toBeNull();
  });

  it("says which level it switched to, or how to use it", () => {
    updateEnhancerPreferences({ language: "zh" });
    const shown: string[] = [];
    const errors: string[] = [];
    setTimelineLevelToast({ show: (message) => shown.push(message), error: (message) => errors.push(message) });
    const client = fakeClient();
    const remove = installTimelineLevelControl(client as never);
    const command = client.commands.find((entry) => entry.name === "bp-timeline")!;
    command.onSubmit({ args: "3", agent: { id: "a1", workspaceId: "w1" } } as never);
    expect(getEnhancerPreferences().timelineLevel).toBe("detailed");
    expect(shown).toEqual(["工作过程：详细"]);
    command.onSubmit({ args: "9", agent: { id: "a1", workspaceId: "w1" } } as never);
    expect(getEnhancerPreferences().timelineLevel).toBe("detailed");
    expect(errors).toEqual(["/bp-timeline 1 简洁 | 2 标准 | 3 详细"]);
    remove();
    setTimelineLevelToast(null);
  });

  it("sets the level and gives the agent its pill", () => {
    const client = fakeClient();
    const remove = installTimelineLevelControl(client as never);
    const command = client.commands.find((entry) => entry.name === "bp-timeline")!;
    command.onSubmit({ args: "simple", agent: { id: "a9", workspaceId: "w9" } } as never);
    expect(getEnhancerPreferences().timelineLevel).toBe("simple");
    expect(client.pills.map((pill) => pill.contribution.agentId)).toEqual(["a9"]);
    command.onSubmit({ args: "nonsense", agent: { id: "a9", workspaceId: "w9" } } as never);
    expect(getEnhancerPreferences().timelineLevel).toBe("simple");
    remove();
    expect(command.removed).toBe(true);
    expect(client.pills[0]!.removed).toBe(true);
  });
});
