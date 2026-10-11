/**
 * The system's reduce-motion setting (plan §3.7 item 1).
 *
 * The host's own `useReducedMotion` comes from Reanimated, which a plugin
 * cannot load. React Native's `AccessibilityInfo` covers both sides: native
 * reads the OS setting, React Native Web backs it with
 * `matchMedia("(prefers-reduced-motion: reduce)")`.
 *
 * One subscription for the whole plugin, held while any component listens:
 * a timeline holds hundreds of cards, and a listener per card would multiply
 * the work of a single system change.
 */
import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let reduced = false;
const listeners = new Set<() => void>();
let release: (() => void) | null = null;

function set(next: boolean): void {
  if (next === reduced) return;
  reduced = next;
  for (const listener of listeners) listener();
}

function start(): void {
  let live = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then((value) => {
      if (live) set(value);
    })
    .catch(() => {});
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", set);
  release = () => {
    live = false;
    subscription?.remove();
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

function read(): boolean {
  return reduced;
}

export function getReducedMotion(): boolean {
  return reduced;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
