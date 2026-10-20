import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS, TASKS_SETTINGS, applyDensity, effectiveCard } from "../../shared/tasks-settings";

// The Tasks settings page: presets write the switches, a hand edit makes the density custom,
// the preview follows the switches, reset asks first, and an unusable record offers a reset.

const state = vi.hoisted(() => ({ current: null as unknown, previews: [] as unknown[] }));
vi.mock("react-native", async () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => state.current }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const React = await import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as never);
  return {
    SettingsSection: host("SettingsSection"),
    SettingsGroup: host("SettingsGroup"),
    SettingsRow: host("SettingsRow"),
    SettingsSwitch: host("SettingsSwitch"),
    SettingsSelect: host("SettingsSelect"),
    SettingsAction: host("SettingsAction"),
  };
});
vi.mock("../../client/tasks/i18n", () => ({ useTasksLanguage: () => "en" }));
vi.mock("../../client/tasks/cards", async () => {
  const React = await import("react");
  return {
    TaskCardView: (props: { fields: unknown; card: { lane: string } }) => {
      state.previews.push(props);
      return React.createElement("TaskCardView", props);
    },
  };
});

const React = await import("react");
await import("./helpers/quiet-renderer");
const { default: TestRenderer, act } = await import("react-test-renderer");
const { TasksSettingsPage } = await import("../../client/tasks/settings/settings-page");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = {
  colors: {
    surface0: "#fff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
    foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#fff",
    statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
  },
};

function makeSettings(extra: Record<string, unknown> = {}) {
  const api = {
    status: "ready", values: DEFAULT_TASKS_SETTINGS, revision: "r1", saving: false, saveError: null,
    save: vi.fn(async () => true), reset: vi.fn(async () => true), reload: vi.fn(async () => {}),
    ...extra,
  };
  state.current = api;
  return api;
}

function render(compact = false) {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  const props = { theme, host: { id: "h", label: "H" }, layout: { compact, platform: "ios" } };
  act(() => { renderer = TestRenderer.create(React.createElement(TasksSettingsPage, props as never)); });
  return renderer;
}

const byLabel = (r: ReturnType<typeof render>, type: string, label: string) =>
  r.root.find((node) => (node.type as unknown) === type && node.props.label === label);
const lastSaved = (api: ReturnType<typeof makeSettings>) => (api.save.mock.calls.at(-1) as unknown as [typeof DEFAULT_TASKS_SETTINGS, string])[0];

beforeEach(() => { state.previews = []; });

describe("tasks settings page", () => {
  it("picking a preset writes every switch", async () => {
    const api = makeSettings();
    const r = render();
    await act(async () => { byLabel(r, "SettingsSelect", "Card density").props.onValueChange("full"); });
    expect(api.save).toHaveBeenCalledWith(applyDensity(DEFAULT_TASKS_SETTINGS, "full"), "r1");
  });

  it("picking custom writes nothing", async () => {
    const api = makeSettings();
    const r = render();
    await act(async () => { byLabel(r, "SettingsSelect", "Card density").props.onValueChange("custom"); });
    expect(api.save).not.toHaveBeenCalled();
  });

  it("a hand edit makes the density custom", async () => {
    const api = makeSettings();
    const r = render();
    await act(async () => { byLabel(r, "SettingsSwitch", "Git status").props.onValueChange(true); });
    const saved = lastSaved(api);
    expect(saved.card.gitStatus).toBe(true);
    expect(saved.density).toBe("custom");
  });

  it("the preview follows the card switches", () => {
    const values = { ...DEFAULT_TASKS_SETTINGS, card: { ...DEFAULT_TASKS_SETTINGS.card, branch: false } };
    makeSettings({ values });
    render();
    const shown = state.previews.at(-1) as { fields: unknown };
    expect(shown.fields).toEqual(effectiveCard(values, false));
    expect((shown.fields as { branch: boolean }).branch).toBe(false);
  });

  it("the lane switch changes the sample card", () => {
    makeSettings();
    const r = render();
    const lane = (state.previews.at(-1) as { card: { lane: string } }).card.lane;
    const buttons = r.root.findAll((node) => (node.type as unknown) === "Pressable");
    act(() => { buttons[1]!.props.onPress(); });
    expect((state.previews.at(-1) as { card: { lane: string } }).card.lane).not.toBe(lane);
  });

  it("reset asks for confirmation first", async () => {
    const api = makeSettings();
    const r = render();
    await act(async () => { byLabel(r, "SettingsAction", "Restore default settings").props.onPress(); });
    expect(api.reset).not.toHaveBeenCalled();
    await act(async () => { byLabel(r, "SettingsAction", "Restore default settings").props.onPress(); });
    // The options go back to their defaults; the board's own switch stays as it was.
    expect(api.reset).not.toHaveBeenCalled();
    expect(api.save).toHaveBeenCalledWith(DEFAULT_TASKS_SETTINGS, "r1");
  });

  it("reset keeps the board on", async () => {
    const api = makeSettings({ values: { ...applyDensity(DEFAULT_TASKS_SETTINGS, "full"), enabled: true } });
    const r = render();
    await act(async () => { byLabel(r, "SettingsAction", "Restore default settings").props.onPress(); });
    await act(async () => { byLabel(r, "SettingsAction", "Restore default settings").props.onPress(); });
    expect(lastSaved(api)).toEqual({ ...DEFAULT_TASKS_SETTINGS, enabled: true });
  });

  it("the switch at the top saves enabled and steps the options back while off", async () => {
    const api = makeSettings();
    const r = render();
    const sections = r.root.findAll((node) => (node.type as unknown) === "SettingsSection");
    expect(sections[0]!.props.title).toBe("Tasks board");
    const toggle = byLabel(r, "SettingsSwitch", "Enable the Tasks board");
    expect(toggle.props).toMatchObject({ value: false, hint: "Shows the Tasks entry and board in the sidebar" });
    const options = r.root.find((node) => node.props.testID === "tasks-settings-options");
    expect(options.props.style.opacity).toBe(0.5);
    await act(async () => { toggle.props.onValueChange(true); });
    expect(lastSaved(api)).toEqual({ ...DEFAULT_TASKS_SETTINGS, enabled: true });
  });

  it("an invalid record offers a reset", async () => {
    const api = makeSettings({ status: "invalid", error: "bad", revision: "r9", values: undefined });
    const r = render();
    expect(r.root.findAll((node) => (node.type as unknown) === "SettingsSwitch")).toHaveLength(0);
    await act(async () => { byLabel(r, "SettingsAction", "Restore default settings").props.onPress(); });
    await act(async () => { byLabel(r, "SettingsAction", "Restore default settings").props.onPress(); });
    expect(api.reset).toHaveBeenCalledTimes(1);
  });

  it("a refused save reloads and says so", async () => {
    const api = makeSettings({ save: vi.fn(async () => false) });
    const r = render();
    await act(async () => { byLabel(r, "SettingsSwitch", "Git status").props.onValueChange(true); });
    expect(api.reload).toHaveBeenCalled();
    expect(JSON.stringify(r.toJSON())).toContain("reloaded the latest");
  });

  it("uses the phone's minimal card when asked", () => {
    const values = { ...DEFAULT_TASKS_SETTINGS, mobile: { compactCards: true } };
    makeSettings({ values });
    render(true);
    expect((state.previews.at(-1) as { fields: unknown }).fields).toEqual(effectiveCard(values, true));
    expect(TASKS_SETTINGS.id).toBe("tasks");
  });
});
