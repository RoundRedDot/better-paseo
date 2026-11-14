import { measureHostTree } from "./helpers/yoga-host-layout";
import { ProviderLogo } from "../../client/components/provider-logo";
import type { AgentUpdate } from "../../shared/agent-updates";
import { resetUpdateIndicatorsForTests } from "../../client/tasks/board/update-indicator";
import { resetAgentUpdatesForTests } from "../../client/agent-updates";
import { deviceTasksStore } from "../../client/tasks/device-preferences";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS, applyDensity, effectiveCard } from "../../shared/tasks-settings";
// These tests start from the board and the archived lane both off; the stock settings turn both on.
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: false, board: { ...STOCK_SETTINGS.board, showArchived: false } };

// The Tasks tab on Better Paseo's settings page: switch, notice, preview,
// and options. The chat tab has no board settings. Presets write the switches,
// a hand edit makes the density custom, the preview follows the switches,
// reset asks first, and an unusable record offers a reset.

const state = vi.hoisted(() => ({ current: null as unknown, previews: [] as Array<Record<string, unknown>>, language: "en" as "en" | "zh", rpc: vi.fn(async (): Promise<unknown> => ({ state: "idle" })), copyText: vi.fn(async () => {}), agents: vi.fn(async (): Promise<unknown> => ({ state: "idle", entries: [], error: null })), openTerminal: vi.fn(async (): Promise<unknown> => ({ status: "opened" })) }));
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: (definition: { id: string }) => definition.id === "title-generation" ? { status: "loading", reload: vi.fn() } : state.current, useRpc: (definition: { name: string }) => definition.name === "settings.agent-updates" ? state.agents : definition.name === "settings.open-terminal" ? state.openTerminal : state.rpc }));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  SettingsSelect: "SettingsSelect", TextInput: "TextInput",
  SidebarRow: () => { throw new Error("SidebarRow must render inside a sidebar item"); },
}));
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const React = await import("react");
  const Modal = Object.assign((props: { children?: React.ReactNode }) => React.createElement("Modal", null, props.children), { Content: (props: { children?: React.ReactNode }) => React.createElement("ModalContent", null, props.children) });
  return { TextInput: "TextInput", Icon: "Icon", Modal, copyText: state.copyText, useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: () => state.language, resolveTasksLanguage: () => state.language }));
vi.mock("../../client/tasks/chunk/load", async () => import("../../client/tasks/settings/tasks-panel"));
vi.mock("../../client/state/preference-sync-slot", () => ({ usePreferenceSettings: () => ({ status: "ready", failed: false }) }));
vi.mock("../../client/ui/tokens/host-appearance-shim", () => ({ useHostAppearance: () => null, builtinNativeRead: () => null }));
vi.mock("../../client/i18n/host-language", async (original) => ({ ...await original<object>(), useHostLanguageVersion() {} }));
vi.mock("../../client/ui/wide-host-column", () => ({ useWideHostColumn() {} }));
vi.mock("../../client/settings-preview", () => ({ SettingsPreview: () => null }));
vi.mock("../../client/components/embed-fonts", () => ({ ensureEmbeddedFonts() {} }));
vi.mock("../../client/tasks/cards", async () => {
  const React = await import("react");
  const { useTasksFontScale } = await import("../../client/tasks/typography");
  return {
    StatusIcon: (props: Record<string, unknown>) => React.createElement("StatusIcon", props),
    TaskCardView: (props: Record<string, unknown>) => {
      state.previews.push({ ...props, fontScale: useTasksFontScale() });
      return React.createElement("TaskCardView", props);
    },
  };
});

const React = await import("react");
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { TasksSettingsPanel } = await import("../../client/tasks/settings/tasks-panel");
const { resetTasksEnabled, setTasksBoardOpener, tasksEnabled } = await import("../../client/tasks/board/enabled");
const { SETTINGS_STRINGS } = await import("../../client/i18n/settings-page-strings");
const { resetEnabledNotice } = await import("../../client/tasks/settings/use-tasks-form");
const { BetterPaseoSettingsPage } = await import("../../client/settings-page");
const { CommandBand } = await import("../../client/ui/command-band");
const { Section, SettingRow } = await import("../../client/settings-controls");
const { setSettingsTab } = await import("../../client/settings-tab");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const { TASKS_SETTINGS_STRINGS } = await import("../../client/tasks/settings/strings");
const { StyleSheet } = await import("react-native");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = ReturnType<typeof TestRenderer.create>;
type Node = Renderer["root"];

const theme = {
  colors: {
    surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
    foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#ffffff",
    statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
  },
};
const tokens = {
  typography: { ui: { size: 14 }, content: { size: 14, lineHeight: 20 } },
  isDark: false, fontUi: undefined, foreground: "#18181b", foregroundMuted: "#62626b", foregroundSubtle: "#9a9aa3",
  accent: "#2563eb", accentForeground: "#ffffff", warning: "#a36a00",
  v2: { surface0: "#ffffff", surface1: "#fafafa", surface2: "#ededef", border: "#e2e2e6" },
};
const look = (compact = false) => ({ compact, tokens: tokens as never, t: SETTINGS_STRINGS.en });

function makeSettings(extra: Record<string, unknown> = {}) {
  const api = {
    status: "ready", values: DEFAULT_TASKS_SETTINGS, revision: "r1", saving: false, saveError: null,
    save: vi.fn(async () => true), reset: vi.fn(async () => true), reload: vi.fn(async () => {}),
    ...extra,
  };
  state.current = api;
  return api;
}

function panel(compact = false, side = false) {
  let renderer!: Renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(TasksSettingsPanel, { look: look(compact), theme: theme as never, side }));
  });
  return renderer;
}

const textOf = (node: Node | string): string =>
  typeof node === "string" ? node : node.children.map((child) => textOf(child as Node | string)).join("");
const byTestID = (r: Renderer, id: string) => r.root.findAll((node) => typeof node.type === "string" && node.props.testID === id);
const byLabel = (r: Renderer, label: string) => r.root.find((node) => typeof node.type === "string" && node.props.accessibilityLabel === label);
const button = (r: Renderer, label: string) =>
  r.root.find((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "button" && node.props.accessibilityLabel === label);
const radio = (r: Renderer, group: string, label: string) =>
  byLabel(r, group).findAll((node) => (node.type as unknown) === "Pressable" && textOf(node) === label)[0]!;
const lastSaved = (api: ReturnType<typeof makeSettings>) => (api.save.mock.calls.at(-1) as unknown as [typeof DEFAULT_TASKS_SETTINGS, string])[0];

it("does not render an empty description as a native text node", () => {
  let r!: Renderer;
  act(() => { r = TestRenderer.create(React.createElement(SettingRow, { title: "Title", description: "", look: look(true) })); });
  expect(r.root.findAll((node) => (node.type as unknown) === "View").every((node) => !node.children.includes(""))).toBe(true);
  act(() => r.unmount());
});

it("records, cancels, clears and restores the device shortcut without saving host settings", async () => {
  vi.stubGlobal("__rnMockOS", "web");
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const press = (code: string, modifiers = {}) => target.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, ...modifiers }));
  let r: Renderer | undefined;
  try {
    const api = makeSettings();
    r = panel();
    const current = () => textOf(byTestID(r!, "tasks-open-shortcut")[0]!);
    expect(current()).toBe("Command + Shift + Y");
    act(() => button(r!, "Change shortcut").props.onPress());
    expect(textOf(r.root)).toContain("Escape cancels.");
    await act(async () => { press("ShiftLeft", { shiftKey: true }); press("KeyJ"); });
    expect(current()).toBe("Command + Shift + Y");
    act(() => { press("Escape"); });
    expect(button(r, "Change shortcut")).toBeTruthy();
    expect(current()).toBe("Command + Shift + Y");
    act(() => button(r!, "Change shortcut").props.onPress());
    await act(async () => { press("KeyJ", { metaKey: true, altKey: true }); });
    expect(current()).toBe("Command + Option + J");
    expect(deviceTasksStore().snapshot().values?.openShortcut).toBe("Mod+Alt+KeyJ");
    await act(async () => button(r!, "Clear shortcut").props.onPress());
    expect(current()).toBe("Not assigned");
    await act(async () => button(r!, "Restore default shortcut").props.onPress());
    expect(current()).toBe("Command + Shift + Y");
    expect(api.save).not.toHaveBeenCalled();
    act(() => button(r!, "Change shortcut").props.onPress());
    act(() => { target.dispatchEvent(new Event("blur")); });
    expect(button(r, "Change shortcut")).toBeTruthy();
    act(() => button(r!, "Change shortcut").props.onPress());
    act(() => r!.unmount());
    r = undefined;
    press("KeyJ", { metaKey: true });
    expect(deviceTasksStore().snapshot().values?.openShortcut).toBe("Mod+Shift+KeyY");
  } finally {
    act(() => r?.unmount());
    vi.unstubAllGlobals();
  }
});

it("hides keyboard settings on native phones", () => {
  makeSettings();
  const r = panel(true);
  expect(byTestID(r, "tasks-open-shortcut")).toHaveLength(0);
  act(() => r.unmount());
});

beforeEach(() => {
  resetUpdateIndicatorsForTests();
  resetAgentUpdatesForTests();
  state.previews = [];
  state.language = "en";
  resetTasksEnabled();
  resetEnabledNotice();
});

afterEach(() => {
  resetEnhancerPreferences();
  setSettingsTab("display");
});

describe("Tasks settings entry", () => {
  it.each([12, 21])("sizes settings chrome from UI size %i", (base) => {
    makeSettings();
    const r = panel();
    act(() => r.update(React.createElement(TasksSettingsPanel, {
      look: { ...look(), tokens: { ...tokens, typography: { ui: { size: base }, content: { size: 18 } } } as never },
      theme: theme as never, side: false,
    })));
    const styleOf = (text: string) => r.root.find((node) => (node.type as unknown) === "Text" && node.props.children === text).props.style.flat();
    expect(Object.assign({}, ...styleOf(TASKS_SETTINGS_STRINGS.en.enabled)).fontSize).toBe(base);
    expect(Object.assign({}, ...styleOf(TASKS_SETTINGS_STRINGS.en.fields.gitStatus)).fontSize).toBe(base - 1);
    act(() => r.unmount());
  });
  it.each([
    ["en", true, 390], ["en", false, 720], ["en", false, 1280],
    ["zh", true, 390], ["zh", false, 720], ["zh", false, 1280],
  ] as const)("keeps board settings only in the Tasks tab (%s, compact=%s, width=%s)", (language, compact, width) => {
    const api = makeSettings();
    state.language = language;
    updateEnhancerPreferences({ language });
    const t = SETTINGS_STRINGS[language];
    const strings = TASKS_SETTINGS_STRINGS[language];
    let r!: Renderer;
    act(() => {
      r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: theme as never,
        layout: { platform: "web", compact } as never,
        host: {} as never,
      }));
    });
    try {
      const root = r.root.find((node) => typeof node.type === "string" && typeof node.props.onLayout === "function");
      act(() => root.props.onLayout({ nativeEvent: { layout: { width } } }));
      const enableSwitches = () => r.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === strings.enabled);
      expect(enableSwitches()).toHaveLength(0);
      expect(byTestID(r, "tasks-preview-card")).toHaveLength(0);
      expect(textOf(r.root)).not.toContain(language === "zh" ? "看板选项与预览" : "Board options and preview");

      act(() => radio(r, t.tabsLabel, t.tabTasks).props.onPress());
      expect(enableSwitches()).toHaveLength(1);
      expect(enableSwitches()[0]!.props.accessibilityRole).toBe("switch");
      expect(byTestID(r, "tasks-preview-card")).toHaveLength(1);
      expect(api.save).not.toHaveBeenCalled();
      expect(api.reset).not.toHaveBeenCalled();
    } finally {
      act(() => r.unmount());
    }
  });

  it.each([true, false])("shares one horizontal edge across both tabs (compact=%s)", (compact) => {
    makeSettings();
    updateEnhancerPreferences({ language: "en" });
    const t = SETTINGS_STRINGS.en;
    let r!: Renderer;
    act(() => {
      r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: theme as never,
        layout: { platform: "web", compact } as never,
        host: {} as never,
      }));
    });
    try {
      const flat = (node: Node) => StyleSheet.flatten(node.props.style) ?? {};
      const root = r.root.find((node) => typeof node.type === "string" && typeof node.props.onLayout === "function");
      const cardAround = (text: string) => {
        let node = r.root.find((item) => (item.type as unknown) === "Text" && textOf(item) === text).parent as Node | null;
        while (node && flat(node).borderWidth !== 1) node = node.parent as Node | null;
        if (!node) throw new Error(`no card around ${text}`);
        return node;
      };
      // Touch pulls the page out by 4, so a host column padded 16 meets the
      // phone board's 12. Desktop leaves the edge to that column.
      expect(flat(root).marginHorizontal).toBe(compact ? -4 : undefined);
      expect(flat(root).paddingHorizontal).toBeUndefined();
      expect(flat(cardAround(t.previewTitle)).marginHorizontal).toBeUndefined();
      act(() => radio(r, t.tabsLabel, t.tabTasks).props.onPress());
      const tasksPreview = byTestID(r, "tasks-preview-card")[0]!;
      expect(flat(tasksPreview).marginHorizontal).toBeUndefined();
      expect(flat(root).marginHorizontal).toBe(compact ? -4 : undefined);
    } finally {
      act(() => r.unmount());
    }
  });
});

describe("Tasks half of the settings page", () => {
  it.each([false, true])("places sidebar settings before preview and archive control with enable (compact=%s)", async (compact) => {
    const api = makeSettings();
    const r = panel(compact);
    const host = byTestID(r, "tasks-settings-panel")[0]!;
    const content = host.children as Node[];
    const switchSection = content[0]!;
    expect(textOf(switchSection)).toContain("Show the archived lane");
    expect(textOf(content[1]!)).toContain("Sidebar entry count");
    expect(content[2]!.findAll((node) => typeof node.type === "string" && node.props.testID === "tasks-preview-card")).toHaveLength(1);
    expect(byLabel(r, "Show the archived lane").props["aria-checked"]).toBe(false);
    await act(async () => byLabel(r, "Show the archived lane").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values?.showArchived).toBe(true);
  });

  it.each([ ["all", 3], ["input-only", 1], ["none", 0] ] as const)("shows sidebar count preview for %s", (count, expected) => {
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, sidebar: { count } } });
    const r = panel(true);
    const preview = byTestID(r, "tasks-sidebar-preview")[0]!;
    expect(textOf(preview)).toContain("Tasks");
    expect(preview.findAll((node) => typeof node.type === "string" && node.props.testID?.startsWith("tasks-sidebar-preview-"))).toHaveLength(expected);
    expect(preview.findAll((node) => typeof node.type === "string" && node.props.testID === "hidden-tasks-count")).toHaveLength(count === "none" ? 0 : 1);
  });

  it("opens the hidden-task example from the sidebar preview", () => {
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } } });
    const r = panel(true);
    const button = byTestID(r, "hidden-tasks-count")[0]!;
    expect(button.props.accessibilityLabel).toBe("1 hidden task");
    act(() => button.props.onPress());
    const shown = r.root.findAll((node) => typeof node.type === "string" && node.props.card?.id === "example");
    expect(shown).toHaveLength(1);
    expect(shown[0]!.props.card.location.workspaceTitle).toBe("Example workspace");
    expect(shown[0]!.props.card.provider).toBe("claude");
    expect(shown[0]!.props.card.thinkingLabel).toBe("High");
    expect(shown[0]!.props.fields.provider).toBe(true);
    expect(shown[0]!.props.fields.thinking).toBe(true);
    // The preview has no board to clear, so the dialog offers no clear action there.
    expect(r.root.findAll((node) => node.props.testID === "hidden-tasks-clear-filters")).toHaveLength(0);
  });

  it("sets the web hover hint on the rendered button", () => {
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, sidebar: { count: "all" } } });
    const setAttribute = vi.fn();
    (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
    let r!: Renderer;
    try {
      act(() => {
        r = TestRenderer.create(React.createElement(TasksSettingsPanel, { look: look(), theme: theme as never, side: false }), {
          createNodeMock: (element) => (element.props as { testID?: string }).testID === "hidden-tasks-count" ? { setAttribute } : null,
        });
      });
      expect(setAttribute).toHaveBeenCalledWith("title", expect.stringContaining("Example task"));
    } finally {
      act(() => r?.unmount());
      delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
    }
  });

  it("keeps phone tabs scrollable and switches the preview lane", () => {
    makeSettings();
    const r = panel(true);
    const scroll = byTestID(r, "tasks-preview-tabs-scroll")[0]!;
    expect(scroll.props.horizontal).toBe(true);
    const tabs = scroll.findAll((node) => (node.type as unknown) === "Pressable" && node.props.accessibilityRole === "tab");
    expect(tabs).toHaveLength(4);
    act(() => tabs[1]!.props.onPress());
    expect(byTestID(r, "tasks-preview-lane-running")).toHaveLength(1);
  });

  it("shows subtasks by default, and its switch saves hidden subtasks once turned off", async () => {
    const api = makeSettings();
    const r = panel(false);
    expect(byLabel(r, "Show subtasks").props["aria-checked"]).toBe(true);
    await act(async () => byLabel(r, "Show subtasks").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values?.hideSubtasks).toBe(true);
  });

  it("turns off the groups with no active tasks from the board options, on by default", async () => {
    const api = makeSettings();
    const r = panel(false);
    expect(byLabel(r, "Show all").props["aria-checked"]).toBe(true);
    await act(async () => byLabel(r, "Show all").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values?.showEmptyGroups).toBe(false);
  });

  it.each([
    ["en", false], ["en", true], ["zh", false], ["zh", true],
  ] as const)("merges the intro and enable switch into one card (%s, compact=%s)", (language, compact) => {
    makeSettings();
    state.language = language;
    updateEnhancerPreferences({ language });
    setSettingsTab("tasks");
    let r!: Renderer;
    act(() => {
      r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, {
        theme: theme as never,
        layout: { platform: "web", compact } as never,
        host: {} as never,
      }));
    });
    const strings = TASKS_SETTINGS_STRINGS[language];
    const intro = SETTINGS_STRINGS[language].pageIntro;
    const textNodes = r.root.findAll((node) => (node.type as unknown) === "Text");
    expect(textNodes.filter((node) => textOf(node).includes(intro))).toHaveLength(1);
    expect(textNodes.some((node) => textOf(node) === `${strings.enabledHint}\n${intro}`)).toBe(true);
    // The only remaining board title is the tab label.
    expect(textNodes.filter((node) => textOf(node) === SETTINGS_STRINGS[language].tabTasks)).toHaveLength(1);
    expect(byLabel(r, strings.enabled).props.accessibilityRole).toBe("switch");
    expect(byTestID(r, "tasks-preview-card")).toHaveLength(1);
    act(() => r.unmount());
  });

  it("picking a preset writes every switch", async () => {
    const api = makeSettings();
    const r = panel();
    await act(async () => radio(r, "Card density", "Full").props.onPress());
    expect(api.save).toHaveBeenCalledWith(applyDensity(DEFAULT_TASKS_SETTINGS, "full"), "r1");
  });

  it("offers Custom only once the switches are hand-edited, and picking it writes nothing", async () => {
    const api = makeSettings();
    const r = panel();
    expect(byLabel(r, "Card density").findAll((node) => textOf(node) === "Custom")).toHaveLength(0);
    act(() => r.unmount());
    const custom = { ...DEFAULT_TASKS_SETTINGS, density: "custom" as const };
    makeSettings({ values: custom, save: api.save });
    const again = panel();
    await act(async () => radio(again, "Card density", "Custom").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
  });

  it("the lane width saves narrow, default or wide and keeps the other board options", async () => {
    const api = makeSettings();
    const r = panel();
    expect(textOf(r.root)).toContain("Phones show one lane at a time.");
    await act(async () => radio(r, "Lane width", "Wide").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values?.laneWidth).toBe("wide");
  });

  it("saves title line limits on this device and updates the preview immediately", async () => {
    const api = makeSettings();
    const r = panel();
    expect(byLabel(r, "Title lines").props.accessibilityRole).toBe("radiogroup");
    expect(radio(r, "Title lines", "2").props["aria-checked"]).toBe(true);
    expect(state.previews.some((preview) => preview.titleLines === 2)).toBe(true);
    await act(async () => radio(r, "Title lines", "4").props.onPress());
    expect(deviceTasksStore().snapshot().values?.titleLines).toBe("4");
    expect(api.save).not.toHaveBeenCalled();
    expect(state.previews.some((preview) => preview.titleLines === 4)).toBe(true);
    await act(async () => radio(r, "Title lines", "All").props.onPress());
    expect(deviceTasksStore().snapshot().values?.titleLines).toBe("all");
    expect(state.previews.some((preview) => preview.titleLines === null)).toBe(true);
    act(() => r.unmount());
  });

  it("shows local changes from another surface and ignores later host layout values", async () => {
    const api = makeSettings();
    const r = panel();
    await act(async () => deviceTasksStore().update({ showArchived: true, hideSubtasks: true, showEmptyGroups: false, laneWidth: "wide" }));
    expect(byLabel(r, "Show the archived lane").props["aria-checked"]).toBe(true);
    expect(byLabel(r, "Show subtasks").props["aria-checked"]).toBe(false);
    expect(byLabel(r, "Show all").props["aria-checked"]).toBe(false);
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS }, save: api.save });
    act(() => r.update(React.createElement(TasksSettingsPanel, { look: look(), theme: theme as never, side: false })));
    expect(byLabel(r, "Show the archived lane").props["aria-checked"]).toBe(true);
    expect(byLabel(r, "Show subtasks").props["aria-checked"]).toBe(false);
    expect(api.save).not.toHaveBeenCalled();
    await act(async () => byLabel(r, "Git status").props.onPress());
    expect(lastSaved(api).board).toEqual(DEFAULT_TASKS_SETTINGS.board);
    expect(deviceTasksStore().snapshot().values?.laneWidth).toBe("wide");
    act(() => r.unmount());
  });

  it("saves the plan chip independently and changes density", async () => {
    const api = makeSettings();
    const r = panel();
    expect(byTestID(r, "tasks-field-preview")).toHaveLength(1);
    await act(async () => byLabel(r, "Plan capsule").props.onPress());
    expect(lastSaved(api).card.plan).toBe(false);
    expect(lastSaved(api).density).toBe("custom");
    act(() => r.unmount());
  });

  it("a field chip flips its field and makes the density custom", async () => {
    const api = makeSettings();
    const r = panel();
    const chip = byLabel(r, "Git status");
    expect(chip.props.accessibilityState).toEqual({ checked: false });
    await act(async () => chip.props.onPress());
    const saved = lastSaved(api);
    expect(saved.card.gitStatus).toBe(true);
    expect(saved.density).toBe("custom");
  });

  it("the preview draws every sample card with the switches being edited", () => {
    const values = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, branch: false } };
    makeSettings({ values });
    panel();
    expect(state.previews.length).toBeGreaterThan(0);
    for (const shown of state.previews) expect(shown.fields).toEqual(effectiveCard(values, false));
    expect((state.previews.at(-1)!.fields as { branch: boolean }).branch).toBe(false);
  });

  it.each([14, 21])("provides the board's font scale to settings preview cards at UI base %i", (base) => {
    makeSettings();
    let r!: Renderer;
    act(() => {
      r = TestRenderer.create(React.createElement(TasksSettingsPanel, {
        look: look(),
        theme: { ...theme, typography: { fontSize: { ui: base } } } as never,
        side: false,
      }));
    });
    expect(state.previews.length).toBeGreaterThan(0);
    expect(state.previews.every((card) => card.fontScale === base / 14)).toBe(true);
    act(() => r.unmount());
  });

  it("uses the phone's minimal card on a phone when asked", () => {
    const values = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    makeSettings({ values });
    panel(true);
    const phoneCard = state.previews.findLast((card) => card.compact === true)!;
    expect(phoneCard.fields).toEqual(effectiveCard(values, true));
    expect(phoneCard.compact).toBe(true);
  });

  it("on a desktop page, draws the board as a phone does when the preview's device switch says so", () => {
    const values = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    makeSettings({ values });
    const r = panel();
    expect(byTestID(r, "tasks-preview-phone")).toHaveLength(0);
    expect(state.previews.at(-1)!.compact).toBe(false);
    act(() => radio(r, "Preview for", "Mobile").props.onPress());
    expect(byTestID(r, "tasks-preview-phone")).toHaveLength(1);
    expect(byTestID(r, "tasks-preview-tabs")).toHaveLength(1);
    expect(state.previews.at(-1)!.compact).toBe(true);
    expect(state.previews.at(-1)!.fields).toEqual(effectiveCard(values, true));
    act(() => radio(r, "Preview for", "Desktop").props.onPress());
    expect(byTestID(r, "tasks-preview-phone")).toHaveLength(0);
    expect(state.previews.at(-1)!.compact).toBe(false);
    // A phone page has no switch: its preview is the phone's already.
    const phone = panel(true);
    expect(phone.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === "Preview for")).toHaveLength(0);
  });

  it("the switch saves enabled, tells where the entry went, and opens the board", async () => {
    const api = makeSettings();
    const open = vi.fn();
    setTasksBoardOpener(open);
    const r = panel();
    const toggle = byLabel(r, "Enable the Tasks board");
    expect(toggle.props.accessibilityRole).toBe("switch");
    expect(toggle.props["aria-checked"]).toBe(false);
    expect(byTestID(r, "tasks-enabled-notice")).toHaveLength(0);
    await act(async () => toggle.props.onPress());
    expect(lastSaved(api)).toEqual({ ...DEFAULT_TASKS_SETTINGS, enabled: true });
    // The host's record answers with the saved value.
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, enabled: true }, save: api.save });
    act(() => r.update(React.createElement(TasksSettingsPanel, { look: look(), theme: theme as never, side: false })));
    // The store the sidebar entry follows is on.
    expect(tasksEnabled()).toBe(true);
    const notice = byTestID(r, "tasks-enabled-notice")[0]!;
    expect(textOf(notice)).toContain("Tasks is now at the top of the sidebar.");
    // Reopening the Tasks tab mounts a fresh form: the notice holds.
    act(() => r.unmount());
    const other = panel();
    expect(byTestID(other, "tasks-enabled-notice")).toHaveLength(1);
    act(() => button(other, "Open board").props.onPress());
    expect(open).toHaveBeenCalledTimes(1);
    // Opened: the notice has done its job.
    expect(byTestID(other, "tasks-enabled-notice")).toHaveLength(0);
  });

  it("an entry that was on already says nothing about where it appeared", () => {
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, enabled: true } });
    const r = panel();
    expect(byTestID(r, "tasks-enabled-notice")).toHaveLength(0);
    expect(tasksEnabled()).toBe(true);
  });

  it("ignores a second edit while the first saves", async () => {
    const api = makeSettings({ saving: true });
    const r = panel();
    await act(async () => byLabel(r, "Git status").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
  });

  it("reset asks first, then keeps the board on", async () => {
    const api = makeSettings({ values: { ...applyDensity(DEFAULT_TASKS_SETTINGS, "full"), enabled: true } });
    const r = panel();
    await act(async () => button(r, "Restore").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
    expect(textOf(r.root)).toContain("This restores card, board and sidebar options to their defaults.");
    await act(async () => button(r, "Restore now").props.onPress());
    expect(api.reset).not.toHaveBeenCalled();
    expect(lastSaved(api)).toEqual({ ...STOCK_SETTINGS, board: { ...STOCK_SETTINGS.board, showArchived: false }, enabled: true });
    expect(deviceTasksStore().snapshot().values).toMatchObject({ showArchived: true, hideSubtasks: false, laneWidth: "default", showEmptyGroups: true });
  });

  it("the armed reset can be cancelled", async () => {
    const api = makeSettings();
    const r = panel();
    await act(async () => button(r, "Restore").props.onPress());
    await act(async () => button(r, "Cancel").props.onPress());
    expect(r.root.findAll((node) => node.props.accessibilityLabel === "Restore now")).toHaveLength(0);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("an invalid record offers a reset and no options", async () => {
    const api = makeSettings({ status: "invalid", error: "bad", revision: "r9", values: undefined });
    const r = panel();
    expect(byTestID(r, "tasks-board-preview")).toHaveLength(0);
    expect(textOf(r.root)).toContain("The saved Tasks settings are unusable: bad");
    await act(async () => button(r, "Restore").props.onPress());
    await act(async () => button(r, "Restore now").props.onPress());
    expect(api.reset).toHaveBeenCalledTimes(1);
  });

  it("a refused save reloads and says so", async () => {
    const api = makeSettings({ save: vi.fn(async () => false) });
    const r = panel();
    await act(async () => byLabel(r, "Git status").props.onPress());
    expect(api.reload).toHaveBeenCalled();
    expect(textOf(r.root)).toContain("reloaded the latest");
  });

  it("wide, keeps the option columns below the preview", () => {
    makeSettings();
    const r = panel(false, true);
    const host = r.root.find((node) => node.props.testID === "tasks-settings-panel");
    const columns = host.findAll((node) => (node.type as unknown) === "View" && node.props.style?.flexDirection === "row" && node.props.style?.gap === 24);
    expect(columns.length).toBeGreaterThan(0);
  });
});


it("checks the plugin directory version from its settings tab", async () => {
  makeSettings();
  setSettingsTab("display");
  state.rpc.mockResolvedValueOnce({ state: "idle" }).mockResolvedValueOnce({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.0.0", currentBuild: 202610311637, latestBuild: 202610311557 }, notes: { status: "available", releases: [{ version: "1.0.0", en: ["Fix scrolling"], zh: ["修复滚动"] }] } });
  let r!: Renderer;
  act(() => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  await act(async () => { radio(r, SETTINGS_STRINGS.en.tabsLabel, SETTINGS_STRINGS.en.tabVersion).props.onPress(); });
  await act(async () => { button(r, "Check for updates").props.onPress(); });
  expect(state.rpc).toHaveBeenCalledWith({ action: "check" });
  expect(textOf(r.root)).toContain("This installation differs from the plugin directory version.");
  expect(textOf(r.root)).toContain("Current version1.0.1(1111111)");
  expect(textOf(r.root)).toContain("Latest version1.0.0(2222222)");
  expect(textOf(r.root)).not.toContain("202610311637");
  expect(textOf(r.root)).toContain("Fix scrolling");
  expect(r.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === SETTINGS_STRINGS.en.releaseNotesTitle)).toHaveLength(1);
  act(() => r.unmount());
});

it.each(["missing", "unavailable"] as const)("shows %s release notes under a single heading", async (notesStatus) => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.0.0", currentBuild: 202610311637, latestBuild: 202610311557 }, notes: { status: notesStatus } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "ios", compact: true } as never, host: {} as never })); });
  expect(r.root.findAll((node) => (node.type as unknown) === "Text" && node.props.children === SETTINGS_STRINGS.en.releaseNotesTitle)).toHaveLength(1);
  expect(textOf(r.root)).toContain(notesStatus === "missing" ? SETTINGS_STRINGS.en.releaseNotesMissing : SETTINGS_STRINGS.en.releaseNotesUnavailable);
  act(() => r.unmount());
});

it("shows the latest release notes even when the installation is up to date", async () => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "1".repeat(40), matches: true, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.0.1", currentBuild: 202610311637, latestBuild: 202610311637 }, notes: { status: "available", releases: [{ version: "1.0.1", en: ["Market release notes"], zh: ["市场版本说明"] }] } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  expect(textOf(r.root)).toContain("Market release notes");
  expect(byTestID(r, "update-badge")).toHaveLength(0);
  expect(r.root.findAll((node) => node.props.accessibilityLabel === "Copy update command")).toHaveLength(0);
  act(() => r.unmount());
});

it.each(["en", "zh"] as const)("renders version summaries with wrapping text in %s", async (language) => {
  makeSettings();
  updateEnhancerPreferences({ language });
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "1".repeat(40), matches: true, checkedAt: 1,
    versions: { status: "available", current: "1.1.5", latest: "1.1.5", currentBuild: 202611020746, latestBuild: 202611020746 },
    notes: { status: "available", releases: [
      { version: "1.1.5", en: ["A long update that wraps naturally"], zh: ["一条会自动换行的更新说明"] },
      { version: "1.1.4", en: ["Previous update"], zh: ["上一版本更新"] },
    ] } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "ios", compact: true } as never, host: {} as never })); });
  const text = language === "en" ? "A long update that wraps naturally" : "一条会自动换行的更新说明";
  const body = r.root.find((node) => (node.type as unknown) === "Text" && node.props.children === text);
  expect(StyleSheet.flatten(body.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
  expect(body.props.numberOfLines).toBeUndefined();
  expect(textOf(r.root)).toContain("1.1.5");
  expect(textOf(r.root)).toContain("1.1.4");
  expect(textOf(r.root)).not.toContain(language === "en" ? "一条会自动换行的更新说明" : "A long update that wraps naturally");
  act(() => r.unmount());
});

it("updates an open settings page after an automatic check finishes", async () => {
  vi.useFakeTimers();
  let r: Renderer | undefined;
  try {
    makeSettings();
    setSettingsTab("version");
    state.rpc.mockReset();
    state.rpc.mockResolvedValueOnce({ state: "idle" }).mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.1.0", currentBuild: 202610311637, latestBuild: 202610311700 }, notes: { status: "missing" } });
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
    expect(byTestID(r!, "update-badge")).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(byTestID(r!, "update-badge")).toHaveLength(1);
  } finally {
    act(() => r?.unmount());
    vi.useRealTimers();
  }
});


it("keeps polling after 130 seconds and displays a late result", async () => {
  vi.useFakeTimers();
  try {
    makeSettings();
    setSettingsTab("version");
    state.rpc.mockReset();
    state.rpc.mockResolvedValueOnce({ state: "idle" }).mockResolvedValueOnce({ state: "checking" })
      .mockResolvedValueOnce({ state: "checking" })
      .mockResolvedValueOnce({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.0.0", currentBuild: 202610311637, latestBuild: 202610311557 }, notes: { status: "missing" } });
    let r!: Renderer;
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: true } as never, host: {} as never })); });
    await act(async () => { button(r, "Check for updates").props.onPress(); });
    vi.setSystemTime(Date.now() + 131_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(textOf(r.root)).toContain("Checking…");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(textOf(r.root)).toContain("This installation differs from the plugin directory version.");
    act(() => r.unmount());
  } finally { vi.useRealTimers(); }
});

it("keeps compact settings tabs in a horizontal scroll container", async () => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "idle" });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "ios", compact: true } as never, host: {} as never })); });
  const tabGroup = byLabel(r, SETTINGS_STRINGS.en.tabsLabel);
  expect(textOf(tabGroup)).toContain("Chat presentation");
  expect(r.root.findAll((node) => (node.type as unknown) === "ScrollView" && node.props.horizontal === true).some((node) => node.findAll((child) => child.props.accessibilityLabel === SETTINGS_STRINGS.en.tabsLabel).length > 0)).toBe(true);
  act(() => r.unmount());
});


it.each(["done", "failed"] as const)("shows a spinner during a version check until %s", async (outcome) => {
  vi.useFakeTimers();
  try {
    makeSettings();
    setSettingsTab("version");
    let resolveCheck!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { resolveCheck = resolve; });
    state.rpc.mockReset();
    state.rpc.mockResolvedValueOnce({ state: "idle" }).mockReturnValueOnce(pending)
      .mockResolvedValueOnce(outcome === "done" ? { state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.0.0", currentBuild: 202610311637, latestBuild: 202610311557 }, notes: { status: "missing" } } : { state: "failed" });
    let r!: Renderer;
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
    expect(r.root.findAll((node) => (node.type as unknown) === "ActivityIndicator")).toHaveLength(0);
    await act(async () => { button(r, "Check for updates").props.onPress(); });
    expect(button(r, "Checking…").props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(button(r, "Checking…").findAll((node) => (node.type as unknown) === "ActivityIndicator")).toHaveLength(1);
    await act(async () => { resolveCheck({ state: "checking" }); });
    expect(button(r, "Checking…").findAll((node) => (node.type as unknown) === "ActivityIndicator")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(r.root.findAll((node) => (node.type as unknown) === "ActivityIndicator")).toHaveLength(0);
    expect(button(r, "Check for updates").props.disabled).toBe(false);
    act(() => r.unmount());
  } finally { vi.useRealTimers(); }
});


it("shows the revision and an explanation when the version map is unavailable", async () => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValueOnce({ state: "idle" }).mockResolvedValueOnce({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "unavailable" }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  await act(async () => { button(r, "Check for updates").props.onPress(); });
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionMapUnavailable);
  expect(textOf(r.root)).toContain("Current version1111111");
  expect(textOf(r.root)).toContain("Latest version2222222");
  expect(textOf(r.root)).not.toContain(SETTINGS_STRINGS.en.versionUnmapped);
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionMarketCommandHint);
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionCommandHint);
  expect(button(r, SETTINGS_STRINGS.en.versionCopyMarketCommand)).toBeTruthy();
  expect(textOf(r.root.findByType(CommandBand))).toBe("$ paseo plugin update better-paseo");
  expect(byTestID(r, "update-badge")).toHaveLength(0);
  act(() => r.unmount());
});

it.each([
  "git",
  "registry",
] as const)("shows the update badge and copies the update command for %s", async (source) => {
  const command = "paseo plugin update better-paseo";
  makeSettings();
  setSettingsTab("display");
  state.copyText.mockClear();
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source, current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.1.1", currentBuild: 202610311637, latestBuild: 202610311700 }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "ios", compact: true } as never, host: {} as never })); });
  expect(byTestID(r, "update-badge")).toHaveLength(1);
  await act(async () => { radio(r, SETTINGS_STRINGS.en.tabsLabel, SETTINGS_STRINGS.en.tabVersion).props.onPress(); });
  expect(r.root.findAllByType(Section).map((section) => section.props.title)).toEqual([
    SETTINGS_STRINGS.en.versionTitle,
    SETTINGS_STRINGS.en.versionUpdateCommand,
    SETTINGS_STRINGS.en.releaseNotesTitle,
    "Agent versions",
  ]);
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionCommandHint);
  expect(textOf(r.root)).toContain(command);
  expect(textOf(r.root.findByType(CommandBand))).toBe(`$ ${command}`);
  expect(r.root.findAll((node) => node.props.accessibilityLabel === "Open system Terminal")).toHaveLength(0);
  expect(textOf(r.root)).toContain("Paseo does not yet let plugins open its terminal from settings.");
  await act(async () => { button(r, "Copy update command").props.onPress(); });
  expect(state.copyText).toHaveBeenCalledWith(command);
  expect(button(r, "Copied")).toBeTruthy();
  act(() => r.unmount());
});

it.each(["1.0.1", "1.0.0"])("does not offer an update when the directory version is %s", async (latestVersion) => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: latestVersion, currentBuild: 202610311637, latestBuild: 202610311557 }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  expect(byTestID(r, "update-badge")).toHaveLength(0);
  expect(r.root.findAllByType(Section).map((section) => section.props.title)).toEqual([
    SETTINGS_STRINGS.en.versionTitle,
    SETTINGS_STRINGS.en.releaseNotesTitle,
    "Agent versions",
  ]);
  expect(r.root.findAll((node) => node.props.accessibilityLabel === "Copy update command")).toHaveLength(0);
  const toggle = byLabel(r, "Automatically check for updates");
  expect(toggle.props.accessibilityState.checked).toBe(true);
  act(() => toggle.props.onPress());
  expect(byLabel(r, "Automatically check for updates").props.accessibilityState.checked).toBe(false);
  act(() => r.unmount());
});


it("shows an update when the directory has a newer build of the same version", async () => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.0.1", currentBuild: 202610311637, latestBuild: 202610311700 }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  expect(byTestID(r, "update-badge")).toHaveLength(1);
  expect(button(r, "Copy update command")).toBeTruthy();
  act(() => r.unmount());
});


it.each(["opened", "unsupported", "failed"] as const)("opens the host terminal and reports %s", async (status) => {
  makeSettings();
  setSettingsTab("version");
  state.openTerminal.mockReset();
  state.copyText.mockReset();
  state.copyText.mockResolvedValue(undefined);
  state.openTerminal.mockResolvedValue({ status });
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.1.1", currentBuild: 202610311637, latestBuild: 202610311700 }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  await act(async () => { button(r, "Open system Terminal").props.onPress(); });
  expect(state.copyText).toHaveBeenCalledWith("paseo plugin update better-paseo");
  expect(state.openTerminal).toHaveBeenCalledWith({ source: "git", latest: "2".repeat(40) });
  expect(state.copyText.mock.invocationCallOrder[0]!).toBeLessThan(state.openTerminal.mock.invocationCallOrder[0]!);
  expect(button(r, "Copy update command")).toBeTruthy();
  if (status === "opened") expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionOpenTerminalOpened);
  if (status === "unsupported") expect(textOf(r.root)).toContain("Opening a system terminal is currently supported on macOS hosts only.");
  if (status === "failed") expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionOpenTerminalFailed);
  act(() => r.unmount());
});


it("does not open a terminal when copying fails", async () => {
  makeSettings();
  setSettingsTab("version");
  state.openTerminal.mockReset();
  state.copyText.mockReset();
  state.copyText.mockRejectedValueOnce(new Error("clipboard denied"));
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.1", latest: "1.1.1", currentBuild: 202610311637, latestBuild: 202610311700 }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  await act(async () => { button(r, "Open system Terminal").props.onPress(); });
  expect(state.openTerminal).not.toHaveBeenCalled();
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionCopyFailed);
  act(() => r.unmount());
  state.copyText.mockReset();
  state.copyText.mockResolvedValue(undefined);
});

it("explains when a revision has no version mapping while displaying known versions and hashes", async () => {
  makeSettings();
  setSettingsTab("version");
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: null, latest: "1.1.1", currentBuild: null, latestBuild: 202610311700 }, notes: { status: "missing" } });
  let r!: Renderer;
  await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false } as never, host: {} as never })); });
  expect(textOf(r.root)).toContain("Current version1111111");
  expect(textOf(r.root)).toContain("Latest version1.1.1(2222222)");
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionUnmapped);
  expect(byTestID(r, "update-badge")).toHaveLength(0);
  expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.versionMarketCommandHint);
  expect(button(r, SETTINGS_STRINGS.en.versionCopyMarketCommand)).toBeTruthy();
  expect(r.root.findAll((node) => node.props.accessibilityLabel === "Open system Terminal")).toHaveLength(0);
  act(() => r.unmount());
});

it("shows agent-only updates for the selected host and explains the workspace terminal capability gap", async () => {
  makeSettings(); setSettingsTab("version");
  state.rpc.mockResolvedValue({ state: "idle" });
  state.agents.mockResolvedValue({ state: "done", error: null, entries: [{ provider: "codex", label: "Codex", executable: "/owned/bin/codex", current: "1.0.0", latest: "1.2.0", status: "available", updateAvailable: true, method: "npm", issue: null, command: null }] });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false }, host: { id: "agent-host-a", label: "Host A" } })); });
    expect(byTestID(r, "update-badge")).toHaveLength(1);
    expect(textOf(r.root)).toContain("Selected host: Host A");
    expect(textOf(r.root)).toContain("/owned/bin/codex");
    expect(textOf(r.root)).toContain("1.2.0");
    act(() => byTestID(r, "agent-version-toggle-codex")[0]!.props.onPress());
    expect(button(r, "Update in Paseo terminal").props.disabled).toBe(true);
    expect(textOf(r.root)).toContain("cannot navigate plugins to an exact workspace terminal");
    expect(button(r, "Check agent updates")).toBeTruthy();
    expect(byTestID(r, "version-item-update-dot")[0]!.props.style).toMatchObject({ width: 6, height: 6, alignSelf: "center" });
    state.agents.mockResolvedValue({ state: "done", entries: [], error: null });
    await act(async () => { r.update(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false }, host: { id: "agent-host-b", label: "Host B" } })); });
    expect(textOf(r.root)).toContain("Selected host: Host B");
    expect(textOf(r.root)).not.toContain("/owned/bin/codex");
    expect(byTestID(r, "update-badge")).toHaveLength(0);
    await act(async () => { button(r, "Check agent updates").props.onPress(); });
    expect(state.agents).toHaveBeenCalledWith({ action: "check" });
  } finally { act(() => r?.unmount()); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});

it("retains confirmed plugin and agent dots through rechecks and transport errors, then clears on a conclusive result", async () => {
  vi.useFakeTimers();
  makeSettings(); setSettingsTab("version");
  const installed = { state: "done", source: "git", current: "1".repeat(40), latest: "2".repeat(40), matches: false, checkedAt: 1, versions: { status: "available", current: "1.0.0", latest: "1.2.0", currentBuild: 202611010000, latestBuild: 202611020000 }, notes: { status: "missing" } };
  state.rpc.mockResolvedValue(installed);
  const row = { provider: "codex", label: "Codex", executable: "/owned/codex", current: "1.0.0", latest: "1.2.0", method: "npm", command: null, status: "available", updateAvailable: true, issue: "npm_runtime_unverified" };
  state.agents.mockResolvedValue({ state: "done", entries: [row], error: null });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false }, host: { id: "retain-host", label: "Retain" } })); });
    expect(byTestID(r, "version-item-update-dot")).toHaveLength(2);
    act(() => byTestID(r, "agent-version-toggle-codex")[0]!.props.onPress());
    expect(textOf(r.root)).toContain(SETTINGS_STRINGS.en.agentIssues.npm_runtime_unverified);
    state.rpc.mockResolvedValue({ state: "checking" });
    state.agents.mockResolvedValue({ state: "checking", entries: [], error: null });
    await act(async () => { button(r, "Check for updates").props.onPress(); button(r, "Check agent updates").props.onPress(); });
    expect(byTestID(r, "version-item-update-dot")).toHaveLength(2);
    expect(byTestID(r, "update-badge")).toHaveLength(1);
    state.rpc.mockRejectedValue(new Error("PRIVATE_DIAGNOSTIC"));
    state.agents.mockRejectedValue(new Error("PRIVATE_DIAGNOSTIC"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(byTestID(r, "version-item-update-dot")).toHaveLength(2);
    expect(textOf(r.root)).not.toContain("PRIVATE_DIAGNOSTIC");
    state.rpc.mockResolvedValue({ ...installed, matches: true });
    state.agents.mockResolvedValue({ state: "done", entries: [{ ...row, status: "current", updateAvailable: false }], error: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(byTestID(r, "version-item-update-dot")).toHaveLength(0);
    expect(byTestID(r, "update-badge")).toHaveLength(0);
  } finally { act(() => r?.unmount()); vi.useRealTimers(); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});

it.each(["en", "zh"] as const)("renders specific structured agent failure causes in %s", async (language) => {
  makeSettings(); setSettingsTab("version"); updateEnhancerPreferences({ language });
  state.rpc.mockResolvedValue({ state: "idle" });
  const codes = Object.keys(SETTINGS_STRINGS[language].agentIssues) as Array<keyof typeof SETTINGS_STRINGS.en.agentIssues>;
  state.agents.mockResolvedValue({ state: "done", error: null, entries: codes.map((issue) => ({ provider: issue, label: issue, executable: null, current: null, latest: null, method: "unknown", status: "error", updateAvailable: false, command: null, issue })) });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false }, host: { id: `issues-${language}`, label: "Issues" } })); });
    for (const code of codes) {
      act(() => byTestID(r, `agent-version-toggle-${code}`)[0]!.props.onPress());
      expect(textOf(r.root)).toContain(SETTINGS_STRINGS[language].agentIssues[code]);
    }
  } finally { act(() => r?.unmount()); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});

it.each(["en", "zh"] as const)("explains plugin and selected-host Agent automatic checks in %s", async (language) => {
  makeSettings(); setSettingsTab("version"); updateEnhancerPreferences({ language });
  state.rpc.mockResolvedValue({ state: "idle" });
  state.agents.mockResolvedValue({ state: "idle", entries: [], error: null });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web", compact: false }, host: { id: `auto-description-${language}`, label: "Selected" } })); });
    const copy = SETTINGS_STRINGS[language].versionAutoCheckDescription;
    expect(textOf(r.root)).toContain(copy);
    for (const term of language === "en" ? ["selected host", "plugin directory", "Agent CLIs", "24 hours"] : ["所选主机", "插件市场", "Agent CLI", "24 小时"]) expect(copy).toContain(term);
  } finally { act(() => r?.unmount()); }
});


const layoutAgent: AgentUpdate = {
  provider: "codex", label: "Codex", executable: "/Users/example/.nvm/versions/node/v24.18.0/bin/codex",
  current: "1.0.0", latest: "1.2.0", method: "npm", status: "available", updateAvailable: true,
  issue: "npm_runtime_unverified", command: null,
};

it.each(["en", "zh"] as const)("keeps compact Agent status summaries accurate and details accessible in %s", async (language) => {
  makeSettings(); setSettingsTab("version"); updateEnhancerPreferences({ language });
  state.rpc.mockResolvedValue({ state: "idle" });
  const t = SETTINGS_STRINGS[language];
  const entries: AgentUpdate[] = [
    layoutAgent,
    { ...layoutAgent, provider: "claude", label: "Claude", status: "current", updateAvailable: false, method: "native", latest: "1.0.0", issue: null },
    { ...layoutAgent, provider: "grok", label: "Grok", status: "unknown", updateAvailable: false, method: "unknown", latest: null, issue: "release_source_unknown" },
    { ...layoutAgent, provider: "omp", label: "Oh My Pi", status: "error", updateAvailable: true, latest: null, issue: "latest_fetch_failed" },
  ];
  state.agents.mockResolvedValue({ state: "done", entries, error: null });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "ios", compact: true }, host: { id: `summary-${language}`, label: "Selected" } })); });
    expect(r.root.findAllByType(ProviderLogo).map((node) => node.props.provider)).toEqual(entries.map((entry) => entry.provider));
    expect(textOf(r.root)).toContain(t.agentEnabledCount(4));
    expect(byTestID(r, "version-item-update-dot")).toHaveLength(2);
    for (const [index, status] of [t.agentUpdateTo("1.2.0"), t.versionUpToDate, t.agentUnknownVersion, t.agentCheckFailed].entries()) {
      const entry = entries[index]!;
      const row = byTestID(r, `agent-version-${entry.provider}`)[0]!;
      const toggle = byTestID(r, `agent-version-toggle-${entry.provider}`)[0]!;
      expect(textOf(row)).toContain(status);
      expect(toggle.props.accessibilityRole).toBe("button");
      expect(toggle.props.accessibilityState.expanded).toBe(false);
      expect(byTestID(r, `agent-version-details-${entry.provider}`)).toHaveLength(0);
      act(() => toggle.props.onPress());
      expect(toggle.props["aria-expanded"]).toBe(true);
      const details = byTestID(r, `agent-version-details-${entry.provider}`)[0]!;
      expect(textOf(details)).toContain(t.agentInstallMethod);
      if (entry.issue) expect(textOf(details)).toContain(t.agentIssues[entry.issue]);
      if (entry.status === "available") {
        expect(textOf(details)).toContain(t.agentOriginalInstaller);
        expect(textOf(details)).toContain(t.versionWorkspaceTerminalUnavailable);
        expect(details.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === t.versionWorkspaceTerminal)[0]!.props.disabled).toBe(true);
      }
      act(() => toggle.props.onPress());
      expect(byTestID(r, `agent-version-details-${entry.provider}`)).toHaveLength(0);
    }
    // A retained availability dot must not turn a failed check into a successful comparison.
    expect(textOf(byTestID(r, "agent-version-omp")[0]!)).not.toContain(t.agentUpdateTo("—"));
  } finally { act(() => r?.unmount()); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});

it("keeps plugin and Agent checks independent and resets disclosure when changing hosts", async () => {
  makeSettings(); setSettingsTab("version");
  state.rpc.mockReset(); state.rpc.mockResolvedValue({ state: "idle" });
  state.agents.mockReset(); state.agents.mockResolvedValue({ state: "done", entries: [layoutAgent], error: null });
  let r!: Renderer;
  const page = (id: string) => React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "web" as const, compact: false }, host: { id, label: id } });
  try {
    await act(async () => { r = TestRenderer.create(page("layout-host-a")); });
    act(() => byTestID(r, "agent-version-toggle-codex")[0]!.props.onPress());
    expect(byTestID(r, "agent-version-details-codex")).toHaveLength(1);
    await act(async () => { r.update(page("layout-host-b")); });
    expect(byTestID(r, "agent-version-details-codex")).toHaveLength(0);
    state.rpc.mockClear(); state.agents.mockClear();
    state.agents.mockResolvedValue({ state: "checking", entries: [layoutAgent], error: null });
    await act(async () => button(r, SETTINGS_STRINGS.en.agentCheck).props.onPress());
    expect(state.agents).toHaveBeenCalledWith({ action: "check" });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(button(r, SETTINGS_STRINGS.en.agentCheck).props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(button(r, SETTINGS_STRINGS.en.versionCheck).props.disabled).toBe(false);
    state.agents.mockClear();
    state.rpc.mockResolvedValue({ state: "checking" });
    await act(async () => button(r, SETTINGS_STRINGS.en.versionCheck).props.onPress());
    expect(state.rpc).toHaveBeenCalledWith({ action: "check" });
    expect(state.agents).not.toHaveBeenCalled();
  } finally { act(() => r?.unmount()); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});

it("copies only an Agent's verified command from its expanded details", async () => {
  makeSettings(); setSettingsTab("version");
  state.rpc.mockResolvedValue({ state: "idle" });
  state.copyText.mockClear();
  const command = "claude update";
  state.agents.mockResolvedValue({ state: "done", entries: [{ ...layoutAgent, provider: "claude", label: "Claude", command, issue: null, method: "native" }], error: null });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: "ios", compact: true }, host: { id: "copy-agent", label: "Copy" } })); });
    expect(r.root.findAll((node) => typeof node.type === "string" && node.props.accessibilityLabel === SETTINGS_STRINGS.en.versionCopyCommand)).toHaveLength(0);
    act(() => byTestID(r, "agent-version-toggle-claude")[0]!.props.onPress());
    await act(async () => button(r, SETTINGS_STRINGS.en.versionCopyCommand).props.onPress());
    expect(state.copyText).toHaveBeenCalledWith(command);
    expect(button(r, SETTINGS_STRINGS.en.versionCommandCopied)).toBeTruthy();
  } finally { act(() => r?.unmount()); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});

it.each([
  ["en", true, 320, 1, false], ["zh", true, 320, 1.4, true],
  ["en", true, 390, 1.4, true], ["zh", true, 390, 1, false],
  ["en", false, 720, 1, true], ["zh", false, 1000, 1.4, false],
] as const)("contains long Agent paths and centered dots (%s compact=%s width=%s scale=%s dark=%s)", async (language, compact, width, textScale, dark) => {
  makeSettings(); setSettingsTab("version"); updateEnhancerPreferences({ language });
  state.rpc.mockResolvedValue({ state: "idle" });
  const executable = "/Users/example/" + "very-long-directory/".repeat(15) + "codex";
  const displayPath = "~/" + "very-long-directory/".repeat(15) + "codex";
  state.agents.mockResolvedValue({ state: "done", entries: [{ ...layoutAgent, executable }], error: null });
  const selectedTheme = dark ? { colors: { ...theme.colors, surface0: "#141416", surface1: "#1c1c1f", surface2: "#252529", foreground: "#f4f4f5", foregroundMuted: "#a1a1aa", border: "#37373e" } } : theme;
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: selectedTheme as never, layout: { platform: compact ? "ios" : "web", compact }, host: { id: `geometry-${language}-${width}`, label: "Selected" } })); });
    const row = byTestID(r, "agent-version-codex")[0]!;
    const summary = byTestID(r, "agent-version-toggle-codex")[0]!;
    const options = { width, textScale, wrapText: true, wordWrap: true };
    const frames = measureHostTree(row, options);
    for (const [node, frame] of frames) {
      expect(frame.left, `${String(node.type)} left`).toBeGreaterThanOrEqual(0);
      expect(frame.left + frame.width, `${String(node.type)} right`).toBeLessThanOrEqual(width + 0.5);
    }
    const path = summary.find((node) => typeof node.type === "string" && node.props.children === displayPath);
    expect(path.props.numberOfLines).toBe(1);
    expect(frames.get(path)!.width).toBeGreaterThan(0);
    const dot = byTestID(r, "version-item-update-dot")[0]!;
    const dotFrame = frames.get(dot)!;
    const nameFrame = frames.get(summary.find((node) => typeof node.type === "string" && node.props.children === "Codex"))!;
    expect(dotFrame.width).toBe(6); expect(dotFrame.height).toBe(6);
    expect(Math.abs(dotFrame.top + 3 - (nameFrame.top + nameFrame.height / 2))).toBeLessThanOrEqual(0.5);
    act(() => summary.props.onPress());
    const expandedFrames = measureHostTree(row, options);
    for (const frame of expandedFrames.values()) expect(frame.left + frame.width).toBeLessThanOrEqual(width + 0.5);
    const details = byTestID(r, "agent-version-details-codex")[0]!;
    const fullPath = details.find((node) => typeof node.type === "string" && node.props.children === displayPath);
    expect(fullPath.props.selectable).toBe(true);
    expect(fullPath.props.numberOfLines).toBeUndefined();
  } finally { act(() => r?.unmount()); state.agents.mockResolvedValue({ state: "idle", entries: [], error: null }); }
});


it.each([["en", true, 320], ["zh", true, 390], ["en", false, 1000], ["zh", false, 1000]] as const)("keeps plugin version numbers visible beside their labels (%s compact=%s width=%s)", async (language, compact, width) => {
  makeSettings(); setSettingsTab("version"); updateEnhancerPreferences({ language });
  state.rpc.mockResolvedValue({ state: "done", source: "git", current: "1".repeat(40), latest: "1".repeat(40), matches: true, checkedAt: 1,
    versions: { status: "available", current: "1.5.6", latest: "1.5.6", currentBuild: 202611140000, latestBuild: 202611140000 }, notes: { status: "missing" } });
  let r!: Renderer;
  try {
    await act(async () => { r = TestRenderer.create(React.createElement(BetterPaseoSettingsPage, { theme: theme as never, layout: { platform: compact ? "ios" : "web", compact }, host: { id: `plugin-geometry-${language}`, label: "Selected" } })); });
    const section = r.root.findAllByType(Section)[0]!;
    const hostSection = section.find((node) => typeof node.type === "string");
    const frames = measureHostTree(hostSection, { width, wrapText: true, wordWrap: true });
    const versions = section.findAll((node) => typeof node.type === "string" && node.props.children === "1.5.6");
    expect(versions).toHaveLength(2);
    for (const version of versions) {
      const frame = frames.get(version)!;
      expect(frame.width).toBeGreaterThan(15);
      expect(frame.left + frame.width).toBeLessThanOrEqual(width);
    }
    if (!compact) expect(frames.get(versions[0]!)!.top).toBe(frames.get(versions[1]!)!.top);
  } finally { act(() => r?.unmount()); }
});
