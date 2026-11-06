import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TASKS_SETTINGS } from "../../shared/tasks-settings";
import { createDeviceTasksStore, deviceBoardPreferences } from "../../client/tasks/device-store";
import { DEFAULT_OPEN_TASKS_SHORTCUT, shortcutFromEvent, shortcutLabel, validTasksShortcut } from "../../client/tasks/shortcut-model";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { bindTasksShortcut, captureTasksShortcut, selectTasksShortcut } from "../../client/tasks/open-shortcut";

const defaults = deviceBoardPreferences(DEFAULT_TASKS_SETTINGS.board);
const cleanups: Array<() => void> = [];
let listeners: Set<(event: KeyboardEvent) => void>;

function press(overrides: Partial<KeyboardEvent> = {}) {
  const event = {
    code: "KeyY", key: "Y", ctrlKey: false, metaKey: true, shiftKey: true, altKey: false,
    repeat: false, isComposing: false, defaultPrevented: false,
    preventDefault(this: { defaultPrevented: boolean }) { this.defaultPrevented = true; },
    stopImmediatePropagation: vi.fn(), ...overrides,
  } as unknown as KeyboardEvent;
  // defaultPrevented makes retained host listeners yield, like a real consumed event.
  for (const listener of listeners) listener(event);
  return event;
}

function store() {
  let saved = JSON.stringify(defaults);
  const storage = { read: () => saved, write: (next: string) => { saved = next; } };
  const value = createDeviceTasksStore(storage);
  value.load(defaults);
  return { value, storage };
}

beforeEach(() => {
  listeners = new Set();
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  vi.stubGlobal("window", {
    addEventListener: (_name: string, callback: (event: KeyboardEvent) => void) => listeners.add(callback),
    removeEventListener: (_name: string, callback: (event: KeyboardEvent) => void) => listeners.delete(callback),
  });
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals(); });

describe("open Tasks shortcut", () => {
  it("opens directly once, ignores repeat and IME, and removes its listener", () => {
    const open = vi.fn();
    const stop = bindTasksShortcut(store().value, open);
    cleanups.push(stop);
    expect(press().defaultPrevented).toBe(true);
    press({ repeat: true });
    press({ isComposing: true });
    press({ altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    stop();
    press();
    expect(listeners.size).toBe(0);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("applies edits immediately, persists across restart, and supports clearing and resetting", async () => {
    const disk = store();
    const open = vi.fn();
    cleanups.push(bindTasksShortcut(disk.value, open));
    await disk.value.update({ openShortcut: "Mod+Alt+KeyJ" });
    press();
    expect(open).not.toHaveBeenCalled();
    press({ code: "KeyJ", shiftKey: false, altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    const restarted = createDeviceTasksStore(disk.storage);
    restarted.load(defaults);
    expect(restarted.snapshot().values?.openShortcut).toBe("Mod+Alt+KeyJ");
    await disk.value.update({ openShortcut: null });
    press({ code: "KeyJ", shiftKey: false, altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    await disk.value.update({ openShortcut: DEFAULT_OPEN_TASKS_SHORTCUT });
    press();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("uses Ctrl on Windows and does not accept extra modifiers", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    const open = vi.fn();
    cleanups.push(bindTasksShortcut(store().value, open));
    press();
    press({ metaKey: false, ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("only opens the host selected by the sidebar, even when several bundles are registered", () => {
    const first = vi.fn();
    const second = vi.fn();
    const selected = vi.fn();
    cleanups.push(bindTasksShortcut(store().value, first));
    const stopSecond = bindTasksShortcut(store().value, second);
    cleanups.push(stopSecond);
    selectTasksShortcut(selected);
    press();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledTimes(1);
    stopSecond();
    press();
    expect(first).not.toHaveBeenCalled();
    expect(selected).toHaveBeenCalledTimes(1);
  });

  it("suspends opening while recording, resumes after cancel, and records with no board listener", () => {
    const open = vi.fn();
    const receive = vi.fn();
    const stop = bindTasksShortcut(store().value, open);
    cleanups.push(stop);
    const cancel = captureTasksShortcut(receive);
    cleanups.push(cancel);
    press();
    expect(receive).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    cancel();
    press();
    expect(open).toHaveBeenCalledTimes(1);
    stop();
    cleanups.push(captureTasksShortcut(receive));
    press();
    expect(receive).toHaveBeenCalledTimes(2);
  });

  it("does not act before device hydration and rolls back failed saves", async () => {
    const open = vi.fn();
    const storage = { read: () => JSON.stringify(defaults), write: () => { throw new Error("Disk full"); } };
    const value = createDeviceTasksStore(storage);
    cleanups.push(bindTasksShortcut(value, open));
    press();
    expect(open).not.toHaveBeenCalled();
    value.load(defaults);
    await expect(value.update({ openShortcut: "Mod+KeyJ" })).rejects.toThrow("Disk full");
    press({ code: "KeyJ", shiftKey: false });
    expect(open).not.toHaveBeenCalled();
    press();
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("shortcut codec", () => {
  it("uses physical keys and requires a modifier other than Shift", () => {
    const event = { code: "KeyJ", ctrlKey: false, metaKey: true, altKey: true, shiftKey: false };
    expect(shortcutFromEvent(event, true)).toBe("Mod+Alt+KeyJ");
    expect(shortcutFromEvent({ ...event, metaKey: false, altKey: false, shiftKey: true }, true)).toBeNull();
    expect(shortcutFromEvent({ ...event, code: "MetaLeft" }, true)).toBeNull();
    expect(shortcutLabel(DEFAULT_OPEN_TASKS_SHORTCUT, true)).toBe("Command + Shift + Y");
    expect(shortcutLabel(DEFAULT_OPEN_TASKS_SHORTCUT, false)).toBe("Ctrl + Shift + Y");
  });
  it.each(["", "KeyY", "Shift+KeyY", "Mod+Mod+KeyY", "Mod+KeyUnknown", 4, {}])("rejects invalid stored shortcuts: %s", (value) => {
    expect(validTasksShortcut(value)).toBe(false);
  });
});
