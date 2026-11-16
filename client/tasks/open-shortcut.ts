import { Platform } from "react-native";
import type { DeviceTasksStore } from "./device-store";
import { shortcutFromEvent } from "./shortcut-model";

interface PlatformHints {
  userAgent?: string;
  userAgentData?: { platform?: string };
}

/**
 * Whether shortcuts use the Mac modifiers (⌘ rather than Ctrl). Reads
 * `userAgentData.platform` where the runtime has it (Chromium, so the desktop
 * app), else the user agent; `navigator.platform` is deprecated. iPadOS Safari
 * reports a Mac user agent, which is what the old `MacIntel` platform said too.
 */
export function isShortcutMac(hints: PlatformHints | null = typeof navigator !== "undefined" ? navigator as PlatformHints : null): boolean {
  if (!hints) return false;
  const platform = hints.userAgentData?.platform;
  if (platform) return /mac|ios/i.test(platform);
  return /Mac|iPhone|iPad/.test(hints.userAgent ?? "");
}

interface Registration { open(): void }
interface ShortcutRuntime {
  selected: Registration | null;
  capture: ((event: KeyboardEvent) => void) | null;
}

/** Bundles are evaluated per host; keyboard ownership and recording are device-wide. */
function runtime(): ShortcutRuntime {
  const holder = globalThis as typeof globalThis & { __betterPaseoTasksShortcutV1?: ShortcutRuntime };
  return holder.__betterPaseoTasksShortcutV1 ??= { selected: null, capture: null };
}

let registration: Registration | null = null;

/** The host renders one sidebar entry for the selected installation. Remember it even when hidden. */
export function selectTasksShortcut(open: () => void): void {
  if (!registration) return;
  registration.open = open;
  runtime().selected = registration;
}

/**
 * `store` answers the device store when a key is pressed: a plugin update can replace it while
 * this listener lives (`device-preferences.ts`), and the shortcut follows the current one.
 */
export function bindTasksShortcut(store: () => DeviceTasksStore, open: () => void): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined") return () => {};
  const own = { open };
  registration = own;
  const shared = runtime();
  if (!shared.selected) shared.selected = own;
  const target = window;
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (shared.capture) {
      consume(event);
      shared.capture(event);
      return;
    }
    if (shared.selected !== own) return;
    const shortcut = store().current()?.openShortcut;
    if (!shortcut || shortcutFromEvent(event, isShortcutMac()) !== shortcut) return;
    consume(event);
    if (!event.repeat) own.open();
  };
  target.addEventListener("keydown", onKey, true);
  return () => {
    target.removeEventListener("keydown", onKey, true);
    if (shared.selected === own) shared.selected = null;
    if (registration === own) registration = null;
  };
}

/** Recording also works while the board is disabled and has no opening listener. */
export function captureTasksShortcut(receive: (event: KeyboardEvent) => void): () => void {
  const shared = runtime();
  shared.capture = receive;
  const target = window;
  const onKey = (event: KeyboardEvent) => {
    if (shared.capture !== receive || event.defaultPrevented || event.isComposing) return;
    consume(event);
    receive(event);
  };
  target.addEventListener("keydown", onKey, true);
  return () => {
    target.removeEventListener("keydown", onKey, true);
    if (shared.capture === receive) shared.capture = null;
  };
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}
