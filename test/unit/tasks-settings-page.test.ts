import { deviceTasksStore } from "../../client/tasks/device-preferences";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS as STOCK_SETTINGS, applyDensity, effectiveCard } from "../../shared/tasks-settings";
// These tests start from the board and the archived lane both off; the stock settings turn both on.
const DEFAULT_TASKS_SETTINGS = { ...STOCK_SETTINGS, enabled: false, board: { ...STOCK_SETTINGS.board, showArchived: false } };

// The Tasks tab on Better Paseo's settings page: switch, notice, preview,
// and options. The chat tab has no board settings. Presets write the switches,
// a hand edit makes the density custom, the preview follows the switches,
// reset asks first, and an unusable record offers a reset.

const state = vi.hoisted(() => ({ current: null as unknown, previews: [] as Array<Record<string, unknown>>, language: "en" as "en" | "zh" }));
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: (definition: { id: string }) => definition.id === "title-generation" ? { status: "loading", reload: vi.fn() } : state.current, useRpc: () => vi.fn() }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SettingsSelect: "SettingsSelect", TextInput: "TextInput" }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ TextInput: "TextInput", useToast: () => ({ show() {} }) }));
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: () => state.language, resolveTasksLanguage: () => state.language }));
vi.mock("../../client/tasks/chunk/load", async () => import("../../client/tasks/settings/tasks-panel"));
vi.mock("../../client/state/preference-sync-slot", () => ({ usePreferenceSettings: () => ({ status: "ready", failed: false }) }));
vi.mock("../../client/ui/tokens/host-appearance-shim", () => ({ useHostAppearance: () => null }));
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
const { SETTINGS_STRINGS } = await import("../../client/i18n/settings-strings");
const { resetEnabledNotice } = await import("../../client/tasks/settings/use-tasks-form");
const { BetterPaseoSettingsPage } = await import("../../client/settings-page");
const { setSettingsTab } = await import("../../client/settings-tab");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");
const { TASKS_SETTINGS_STRINGS } = await import("../../client/tasks/settings/strings");
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

beforeEach(() => {
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
});

describe("Tasks half of the settings page", () => {
  it.each([false, true])("places the archived lane switch between enable and preview (compact=%s)", async (compact) => {
    const api = makeSettings();
    const r = panel(compact);
    const host = byTestID(r, "tasks-settings-panel")[0]!;
    const content = host.children as Node[];
    const switchSection = content[0]!;
    expect(textOf(switchSection)).toContain("Show the archived lane");
    expect(content[1]!.findAll((node) => typeof node.type === "string" && node.props.testID === "tasks-preview-card")).toHaveLength(1);
    expect(byLabel(r, "Show the archived lane").props["aria-checked"]).toBe(false);
    await act(async () => byLabel(r, "Show the archived lane").props.onPress());
    expect(api.save).not.toHaveBeenCalled();
    expect(deviceTasksStore().snapshot().values?.showArchived).toBe(true);
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
    expect(state.previews.at(-1)!.fields).toEqual(effectiveCard(values, true));
    expect(state.previews.at(-1)!.compact).toBe(true);
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
    expect(textOf(r.root)).toContain("This replaces all Tasks options with the defaults.");
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

  it("wide, puts the card options beside the board and sidebar ones", () => {
    makeSettings();
    const r = panel(false, true);
    const host = r.root.find((node) => node.props.testID === "tasks-settings-panel");
    const columns = host.findAll((node) => (node.type as unknown) === "View" && node.props.style?.flexDirection === "row" && node.props.style?.gap === 24);
    expect(columns.length).toBeGreaterThan(0);
  });
});
