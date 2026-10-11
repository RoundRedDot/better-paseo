/**
 * What the reader can actually do with their pointer (plan §3.11).
 *
 * `layout.platform` cannot answer it: Electron on a desktop and Safari on a
 * phone both report `web`. So hover and touch are read from the device
 * itself — media queries on web, and on native a hover only once one has
 * really happened (an iPad with a trackpad). Every hover affordance must have
 * a touch equivalent; this hook is how a component picks which to show.
 */
import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

export interface InputCapabilities {
  /** A fine pointer that can hover: show hover-revealed actions. */
  hover: boolean;
  /** Touch input: long-press entries and 32px targets. */
  touch: boolean;
  /** `layout.compact`: header heights and truncation budgets. */
  compact: boolean;
  /** iOS/Android rather than web. Only for real capability gaps (font loading). */
  native: boolean;
}

export interface CapabilitySignals {
  native: boolean;
  compact: boolean;
  /** `(hover: hover) and (pointer: fine)` on web. */
  hoverMedia: boolean;
  /** `(pointer: coarse)` on web. */
  coarseMedia: boolean;
  /** A native `onHoverIn` has fired in this session. */
  nativeHoverSeen: boolean;
}

/** Pure: the capability rules, from raw signals. */
export function resolveCapabilities(signals: CapabilitySignals): InputCapabilities {
  if (signals.native) {
    return {
      hover: signals.nativeHoverSeen,
      touch: true,
      compact: signals.compact,
      native: true,
    };
  }
  return {
    hover: signals.hoverMedia,
    // A hybrid laptop reports a fine primary pointer; a phone reports coarse.
    // No hover at all is treated as touch too, so some entry always exists.
    touch: signals.coarseMedia || !signals.hoverMedia,
    compact: signals.compact,
    native: false,
  };
}

const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
const COARSE_QUERY = "(pointer: coarse)";
const NATIVE = Platform.OS === "ios" || Platform.OS === "android";

function canMatchMedia(): boolean {
  // Guarded per the cross-platform checklist: `window` exists only on web.
  return typeof document !== "undefined" && typeof window.matchMedia === "function";
}

// Read once at load so the first render is right before anything subscribes.
let hoverMedia = canMatchMedia() && window.matchMedia(HOVER_QUERY).matches;
let coarseMedia = canMatchMedia() && window.matchMedia(COARSE_QUERY).matches;
let nativeHoverSeen = false;
let version = 0;
const listeners = new Set<() => void>();
let release: (() => void) | null = null;

function publish(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function start(): void {
  if (!canMatchMedia()) {
    release = () => {};
    return;
  }
  const hover = window.matchMedia(HOVER_QUERY);
  const coarse = window.matchMedia(COARSE_QUERY);
  const sync = (): void => {
    if (hover.matches === hoverMedia && coarse.matches === coarseMedia) return;
    hoverMedia = hover.matches;
    coarseMedia = coarse.matches;
    publish();
  };
  sync();
  hover.addEventListener("change", sync);
  coarse.addEventListener("change", sync);
  release = () => {
    hover.removeEventListener("change", sync);
    coarse.removeEventListener("change", sync);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!release) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && release) {
      release();
      release = null;
    }
  };
}

function readVersion(): number {
  return version;
}

/**
 * Call from a native `onHoverIn`: the first real hover proves a pointer and
 * turns hover affordances on for the session. A no-op on web, where media
 * queries already answer.
 */
export function noteHover(): void {
  if (!NATIVE || nativeHoverSeen) return;
  nativeHoverSeen = true;
  publish();
}

export function useInputCapabilities(compact = false): InputCapabilities {
  // Subscribed through a version number so the snapshot is a primitive and
  // stable between changes; the object is rebuilt from module state.
  useSyncExternalStore(subscribe, readVersion, readVersion);
  return resolveCapabilities({
    native: NATIVE,
    compact,
    hoverMedia,
    coarseMedia,
    nativeHoverSeen,
  });
}
