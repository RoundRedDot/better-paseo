import { afterEach, describe, expect, it } from "vitest";
import type { PluginButton, PluginComposerPillContribution } from "@getpaseo/plugin/client";
import {
  createTimelineLevelControl,
  installTimelineLevelControl,
  parseTimelineLevelArgument,
  setTimelineLevelToast,
  timelineLevelButton,
} from "../../client/timeline-level-control";
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
  return {
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

function menuItems(button: PluginButton) {
  if (button.behavior.kind !== "menu") throw new Error("expected a menu");
  return button.behavior.items.map((entry) => {
    if (entry.kind !== "item" || entry.behavior.kind !== "action") throw new Error("expected action items");
    return { id: entry.id, title: entry.title, icon: entry.icon, checked: String(entry.title).endsWith(" ✓"), press: entry.behavior.onPress };
  });
}

afterEach(() => {
  resetEnhancerPreferences();
});

describe("timeline level pill", () => {
  it("shows the current level and checks it in the menu", () => {
    const button = timelineLevelButton({ ...DEFAULT_PREFERENCES, language: "zh" });
    expect(button.title).toBe("工作过程");
    expect(button.label).toBe("标准");
    expect(button.visible).toBe(true);
    expect(button.icon).toBe("ListCollapse");
    expect(menuItems(button).map(({ id, title, icon }) => [id, title, icon])).toEqual([
      ["simple", "简洁", "Minus"],
      ["standard", "标准 ✓", "Equal"],
      ["detailed", "详细", "Menu"],
    ]);
  });

  it("hides while Better Paseo chat is off", () => {
    expect(timelineLevelButton({ ...DEFAULT_PREFERENCES, chatEnabled: false }).visible).toBe(false);
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
    const detailed = menuItems(client.pills[0]!.button).find((item) => item.id === "detailed")!;
    void detailed.press();
    expect(getEnhancerPreferences().timelineLevel).toBe("detailed");
    for (const pill of client.pills) {
      expect(pill.button.label).toBe("Detailed");
      expect(menuItems(pill.button).find((item) => item.checked)?.id).toBe("detailed");
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
    void menuItems(client.pills[0]!.button).find((item) => item.id === "simple")!.press();
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
      expect(menuItems(pill.button).find((item) => item.checked)?.id).toBe("simple");
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
