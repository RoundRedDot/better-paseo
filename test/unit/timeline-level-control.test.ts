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
  AGENT_PILL_PAGE,
  createTimelineLevelControl,
  installTimelineLevelControl,
  parseTimelineLevelArgument,
  setTimelineLevelToast,
  timelineLevelButton,
  timelineLevelStrings,
} from "../../client/timeline-level-control";
import { SETTINGS_STRINGS } from "../../client/i18n/settings-page-strings";
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

interface FakeObserver {
  snapshot(snapshot: { entries: { agent: { id: string; workspaceId?: string } }[] }): void;
  update(message: unknown): void;
}

/** `paseo.agents.list` with a subscription, as the SDK has it: `subscribe` replays the first page at once. */
function fakePaseo(entries: { id: string; workspaceId?: string }[], failures: unknown[] = []) {
  const calls: Record<string, unknown>[] = [];
  const observers: FakeObserver[] = [];
  let released = 0;
  let answer!: () => void;
  let held: Promise<void> | null = null;
  const paseo = {
    calls,
    observers,
    get released() { return released; },
    hold() { held = new Promise((resolve) => { answer = resolve; }); },
    answer: () => answer(),
    agents: {
      async list(options: Record<string, unknown>) {
        calls.push(options);
        const failure = failures.shift();
        if (failure) throw failure;
        if (held) await held;
        const first = { entries: entries.map((agent) => ({ agent })), subscriptionId: "s1" };
        return {
          ...first,
          subscription: {
            subscribe(observer: FakeObserver) {
              observers.push(observer);
              observer.snapshot(first);
              return () => { observers.splice(observers.indexOf(observer), 1); };
            },
            async release() { released += 1; },
          },
        };
      },
    },
  };
  return paseo;
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function menuItems(button: PluginButton, close = () => {}, compact = false) {
  if (button.behavior.kind !== "popover") throw new Error("expected a popover");
  const Content = button.behavior.Content;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Content, { theme: { colors: { foreground: "black", foregroundMuted: "gray", border: "gray", surface2: "gray" } }, layout: { compact }, host: { id: "h", label: "h" }, context: "agent", agentId: "a", workspaceId: "w", close } as never)); });
  const rows = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "radio");
  const result = rows.map((node, index) => ({ id: ["simple", "standard", "detailed"][index], title: node.findAllByType("Text" as never)[0]!.props.children as string, description: node.findAllByType("Text" as never)[1]!.props.children as string,
    icon: node.findAllByType("Icon" as never)[0]!.props.name as string, checked: node.props.accessibilityState.checked as boolean, press: node.props.onPress as () => void }));
  const settings = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === (getEnhancerPreferences().language === "zh" ? "聊天设置" : "Chat settings"))[0]!.props.onPress as () => void;
  act(() => renderer.unmount());
  return { rows: result, settings };
}

afterEach(() => {
  resetEnhancerPreferences();
});

describe("timeline level pill", () => {
  it.each(["en", "zh"] as const)("uses the same chat switch label in the menu and settings for %s", (language) => {
    expect(timelineLevelStrings({ ...DEFAULT_PREFERENCES, language }).chat).toBe(SETTINGS_STRINGS[language].chatEnabledTitle);
  });

  it.each([false, true])("matches the host menu density for compact=%s", (compact) => {
    const button = timelineLevelButton(DEFAULT_PREFERENCES, () => {});
    if (button.behavior.kind !== "popover") throw new Error("expected a popover");
    const Content = button.behavior.Content;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Content, { theme: { colors: { foreground: "black", foregroundMuted: "gray", border: "gray", surface2: "gray" } }, layout: { compact }, host: { id: "h", label: "h" }, context: "agent", agentId: "a", workspaceId: "w", close() {} } as never)); });
    const rows = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityRole === "radio");
    for (const row of rows) {
      expect(row.props.style.minHeight).toBe(compact ? 44 : 28);
      const label = row.findAllByType("Text" as never)[0]!;
      expect(label.props.style).toMatchObject({ fontSize: 13, lineHeight: 17 });
      expect(row.findAllByType("Text" as never)[1]!.props.style).toMatchObject({ fontSize: 11, lineHeight: 15 });
    }
    // The compact sheet header already carries the title, so the menu draws it only on wide layouts.
    const titles = renderer.root.findAll((node) => String(node.type) === "Text" && node.props.children === "Agent steps");
    if (compact) expect(titles).toEqual([]);
    else expect(titles[0]!.props.style).toMatchObject({ fontSize: 14, fontWeight: "normal" });
    const settings = renderer.root.findAll((node) => String(node.type) === "Pressable" && node.props.accessibilityLabel === "Chat settings")[0]!;
    if (compact) {
      expect(settings.props.style.minHeight).toBe(44);
      expect(settings.findByType("Text" as never).props.children).toBe("Chat settings");
    }
    const menu = renderer.root.findAll((node) => String(node.type) === "View" && node.props.testID === "timeline-level-menu")[0]!;
    expect(menu.props.style).toEqual(compact ? undefined : { margin: -8 });
    const children = menu.findAll((node) => String(node.type) === "Pressable" || (String(node.type) === "View" && node.props.testID === "chat-switch-divider"));
    const divider = children.find((node) => node.props.testID === "chat-switch-divider")!;
    const toggle = children.find((node) => node.props.accessibilityRole === "switch")!;
    expect(divider.props.style.height).toBe(0.5);
    expect(children.indexOf(divider)).toBeGreaterThan(children.indexOf(rows[2]!));
    expect(children.indexOf(toggle)).toBe(children.indexOf(divider) + 1);
    if (compact) expect(children.indexOf(settings)).toBe(children.indexOf(toggle) + 1);
    act(() => renderer.unmount());
  });

  it.each([false, true])("closes the popover and opens chat settings even after another tab was selected (compact=%s)", (compact) => {
    updateEnhancerPreferences({ language: "zh" });
    setSettingsTab("tasks");
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a1", "w1");
    let closed = 0;
    menuItems(client.pills[0]!.button, () => { closed++; }, compact).settings();
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
    expect(menuItems(button).rows.map(({ id, title, description, icon }) => [id, title, description, icon])).toEqual([
      ["simple", "简洁", "只看对话和结果", "MessageSquareText"],
      ["standard", "标准", "汇总改动，列出失败", "FileText"],
      ["detailed", "详细", "显示每一步", "ListChecks"],
    ]);
  });

  it.each([false, true])("shows English descriptions in both layouts (compact=%s)", (compact) => {
    updateEnhancerPreferences({ language: "en" });
    const rows = menuItems(timelineLevelButton(getEnhancerPreferences(), () => {}), () => {}, compact).rows;
    expect(rows.map((row) => row.description)).toEqual(["Conversation and results", "Summarize changes, show failures", "Every step"]);
  });

  it.each([false, true])("keeps the switch accessible and synchronized (compact=%s)", (compact) => {
    const client = fakeClient();
    const control = createTimelineLevelControl(client);
    control.request("a", "w");
    const button = client.pills[0]!.button;
    if (button.behavior.kind !== "popover") throw new Error("expected a popover");
    const Content = button.behavior.Content;
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Content, { theme: { colors: { foreground: "black", foregroundMuted: "gray", border: "gray", surface2: "gray", surface0: "white", accent: "green", accentForeground: "white" } }, layout: { compact }, host: { id: "h", label: "h" }, context: "agent", agentId: "a", workspaceId: "w", close() {} } as never)); });
    const toggle = () => renderer.root.findByProps({ accessibilityRole: "switch" });
    expect(toggle().props.accessibilityState.checked).toBe(true);
    act(() => toggle().props.onPress());
    expect(getEnhancerPreferences().chatEnabled).toBe(false);
    expect(client.pills[0]!.button.visible).toBe(true);
    expect(toggle().props.accessibilityState.checked).toBe(false);
    act(() => updateEnhancerPreferences({ chatEnabled: true }));
    expect(toggle().props.accessibilityState.checked).toBe(true);
    act(() => renderer.unmount());
    control.remove();
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
    expect(client.pills[0]!.updates).toBe(0);
    expect(client.pills[0]!.button.visible).toBe(true);
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

describe("agent steps pills before the chat opens", () => {
  it("gives the most recently updated agents a pill without waiting for a timeline row", async () => {
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }, { id: "a2", workspaceId: "w2" }, { id: "a3" }]);
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    expect(paseo.calls).toEqual([{ filter: { includeBackground: true }, sort: [{ key: "updated_at", direction: "desc" }], page: { limit: AGENT_PILL_PAGE }, subscribe: {} }]);
    // No workspace yet: the host cannot place the pill, so a later update or row asks.
    expect(client.pills.map((pill) => [pill.contribution.agentId, pill.contribution.workspaceId])).toEqual([["a1", "w1"], ["a2", "w2"]]);
    remove();
  });

  it("adds a new agent's pill when the daemon reports it, once", async () => {
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }]);
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    const [observer] = paseo.observers;
    observer!.update({ type: "agent_update", payload: { kind: "upsert", agent: { id: "a2", workspaceId: "w1", status: "initializing" } } });
    observer!.update({ type: "agent_update", payload: { kind: "upsert", agent: { id: "a2", workspaceId: "w1", status: "running" } } });
    observer!.update({ type: "agent_stream", payload: { agentId: "a3" } });
    expect(client.pills.map((pill) => pill.contribution.agentId)).toEqual(["a1", "a2"]);
    // A row and the slash command for an agent that already has its pill add none.
    const command = client.commands.find((entry) => entry.name === "bp-timeline")!;
    command.onSubmit({ args: "3", agent: { id: "a2", workspaceId: "w1" } } as never);
    expect(client.pills).toHaveLength(2);
    // The level change reaches the pills that went up early.
    for (const pill of client.pills) expect(pill.button.label).toBe("Detailed");
    // An agent leaving the list keeps its pill.
    observer!.update({ type: "agent_update", payload: { kind: "remove", agentId: "a1" } });
    expect(client.pills.every((pill) => !pill.removed)).toBe(true);
    remove();
  });

  it("picks up the agents of a fresh first page after a reconnect", async () => {
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }]);
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    paseo.observers[0]!.snapshot({ entries: [{ agent: { id: "a1", workspaceId: "w1" } }, { agent: { id: "a4", workspaceId: "w2" } }] });
    expect(client.pills.map((pill) => pill.contribution.agentId)).toEqual(["a1", "a4"]);
    remove();
  });

  it("releases the list and removes the pills on cleanup", async () => {
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }]);
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    remove();
    expect(paseo.released).toBe(1);
    expect(paseo.observers).toHaveLength(0);
    expect(client.pills[0]!.removed).toBe(true);
  });

  it("releases a list that answers after cleanup, and adds no pill", async () => {
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }]);
    paseo.hold();
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    remove();
    paseo.answer();
    await settle();
    expect(paseo.released).toBe(1);
    expect(paseo.observers).toHaveLength(0);
    expect(client.pills).toHaveLength(0);
  });

  it("asks an older host for the list without background workspaces", async () => {
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }], [new Error("Update the host to use background workspaces.")]);
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    expect(paseo.calls.map((call) => call.filter)).toEqual([{ includeBackground: true }, {}]);
    expect(client.pills.map((pill) => pill.contribution.agentId)).toEqual(["a1"]);
    remove();
  });

  it("leaves the pills to the timeline rows when the list fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const paseo = fakePaseo([{ id: "a1", workspaceId: "w1" }], [new Error("socket closed")]);
    const client = { ...fakeClient(), paseo };
    const remove = installTimelineLevelControl(client as never);
    await settle();
    expect(paseo.calls).toHaveLength(1);
    expect(client.pills).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const command = client.commands.find((entry) => entry.name === "bp-timeline")!;
    command.onSubmit({ args: "2", agent: { id: "a1", workspaceId: "w1" } } as never);
    expect(client.pills.map((pill) => pill.contribution.agentId)).toEqual(["a1"]);
    remove();
    warn.mockRestore();
  });
});
