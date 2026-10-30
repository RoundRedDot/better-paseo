import { afterEach, describe, expect, it, vi } from "vitest";

// Better Paseo's one settings screen: titled for Paseo's plugin menu in the
// host's language, registered again (same component) when the language changes.

// The registered component is the bundle's stand-in for the page in the Tasks chunk.
vi.mock("../../client/tasks/chunk/load", () => ({ BetterPaseoSettingsPage: function BetterPaseoSettingsPage() { return null; } }));

const { contributeSettingsScreen } = await import("../../client/settings-screen");
const { SETTINGS_SCREEN_ID } = await import("../../client/settings-tab");
const { resetTasksLanguage, resolveTasksLanguage } = await import("../../client/tasks/i18n");
const { resetEnhancerPreferences, updateEnhancerPreferences } = await import("../../client/preferences");

type Entry = { id: string; title: string; Component: unknown };

function client() {
  const active: Entry[] = [];
  return {
    active,
    value: {
      addSettingsScreen: (entry: Entry) => {
        active.push(entry);
        return () => void active.splice(active.indexOf(entry), 1);
      },
    },
  };
}
const flush = async () => {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
};

afterEach(() => {
  resetTasksLanguage();
  resetEnhancerPreferences();
});

describe("settings screen registration", () => {
  it("registers one page, titled in the host's language, and follows a change in place", async () => {
    updateEnhancerPreferences({ language: "zh" });
    const plugin = client();
    const cleanup = contributeSettingsScreen(plugin.value as never);
    expect(plugin.active.map((entry) => [entry.id, entry.title])).toEqual([[SETTINGS_SCREEN_ID, "设置"]]);
    const component = plugin.active[0]!.Component;
    updateEnhancerPreferences({ language: "en" });
    resolveTasksLanguage();
    await flush();
    expect(plugin.active.map((entry) => [entry.id, entry.title])).toEqual([[SETTINGS_SCREEN_ID, "Settings"]]);
    // The same component: an open page keeps its state.
    expect(plugin.active[0]!.Component).toBe(component);
    cleanup();
    expect(plugin.active).toEqual([]);
  });
});
