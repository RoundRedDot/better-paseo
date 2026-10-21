import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS, applyDensity, effectiveCard } from "../../shared/tasks-settings";

// The Tasks board on Better Paseo's settings page: the entry at the head of
// the chat half (switch, preview while off, the way to the rest), and the
// Tasks half (switch, notice, preview, options). Presets write the switches,
// a hand edit makes the density custom, the preview follows the switches,
// reset asks first, and an unusable record offers a reset.

const state = vi.hoisted(() => ({ current: null as unknown, previews: [] as Array<Record<string, unknown>> }));
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.current, useRpc: () => vi.fn() }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ useToast: () => ({ show() {} }) }));
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: () => "en", resolveTasksLanguage: () => "en" }));
vi.mock("../../client/tasks/cards", async () => {
  const React = await import("react");
  return {
    StatusIcon: (props: Record<string, unknown>) => React.createElement("StatusIcon", props),
    TaskCardView: (props: Record<string, unknown>) => {
      state.previews.push(props);
      return React.createElement("TaskCardView", props);
    },
  };
});

const React = await import("react");
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { TasksEntrySection, TasksSettingsPanel } = await import("../../client/tasks/settings/tasks-panel");
const { resetTasksEnabled, setTasksBoardOpener, tasksEnabled } = await import("../../client/tasks/board/enabled");
const { SETTINGS_STRINGS } = await import("../../client/i18n/settings-strings");
const { resetEnabledNotice } = await import("../../client/tasks/settings/use-tasks-form");
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

function entry(onShowTasks = vi.fn()) {
  let renderer!: Renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(TasksEntrySection, { look: look(), theme: theme as never, onShowTasks }));
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
  resetTasksEnabled();
  resetEnabledNotice();
});

describe("Tasks half of the settings page", () => {
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

  it("uses the phone's minimal card on a phone when asked", () => {
    const values = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    makeSettings({ values });
    panel(true);
    expect(state.previews.at(-1)!.fields).toEqual(effectiveCard(values, true));
    expect(state.previews.at(-1)!.compact).toBe(true);
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
    // The other half of the page mounts its own form: the notice holds.
    act(() => r.unmount());
    const other = entry();
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
    expect(lastSaved(api)).toEqual({ ...DEFAULT_TASKS_SETTINGS, enabled: true });
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

describe("Tasks entry at the head of the chat half", () => {
  it("names the board, carries its switch and one line on what it adds", () => {
    makeSettings();
    const r = entry();
    expect(textOf(r.root)).toContain("Tasks board");
    expect(textOf(r.root)).toContain("Adds Tasks to the sidebar");
    expect(byLabel(r, "Enable the Tasks board").props["aria-checked"]).toBe(false);
  });

  it("shows the board it would draw while off, and not once on", () => {
    makeSettings();
    const r = entry();
    expect(byTestID(r, "tasks-board-preview")).toHaveLength(1);
    expect(textOf(r.root)).toContain("What the board looks like once it is on");
    act(() => r.unmount());
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, enabled: true } });
    const on = entry();
    expect(byTestID(on, "tasks-board-preview")).toHaveLength(0);
  });

  it("turning it on here saves, lights the sidebar store and says where the entry is", async () => {
    const api = makeSettings();
    const r = entry();
    await act(async () => byLabel(r, "Enable the Tasks board").props.onPress());
    expect(lastSaved(api)).toEqual({ ...DEFAULT_TASKS_SETTINGS, enabled: true });
    makeSettings({ values: { ...DEFAULT_TASKS_SETTINGS, enabled: true }, save: api.save });
    act(() => r.update(React.createElement(TasksEntrySection, { look: look(), theme: theme as never, onShowTasks: vi.fn() })));
    expect(tasksEnabled()).toBe(true);
    expect(byTestID(r, "tasks-enabled-notice")).toHaveLength(1);
  });

  it("leads to the Tasks half", () => {
    makeSettings();
    const onShowTasks = vi.fn();
    const r = entry(onShowTasks);
    act(() => button(r, "Show").props.onPress());
    expect(onShowTasks).toHaveBeenCalledTimes(1);
  });

  it("while the settings load, the switch waits", () => {
    makeSettings({ status: "loading", values: undefined, revision: undefined });
    const r = entry();
    expect(textOf(r.root)).toContain("Loading the Tasks settings");
    expect(byTestID(r, "tasks-board-preview")).toHaveLength(0);
  });
});
