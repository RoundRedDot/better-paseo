import { useEffect, useState, type RefObject } from "react";
import { AppState, Platform } from "react-native";
import { createTaskClock, type TaskClock } from "../cards/clock";

/**
 * Whether the board is on screen. The host keeps hidden panes and screens
 * mounted, so the clock and the skeleton's breathing stop on this, not on
 * unmount. Web: the page is visible and the board's node intersects the
 * viewport (a hidden pane is `display: none`). Native: the app is active;
 * a native stack screen covered by another one cannot be told apart.
 *
 * `layout` names the layout drawn (phone or desktop): each draws its own root
 * node, so a switch (the host's sidebar folded) watches the new node. The old
 * one has left the page, and watching it read as hidden, which stopped the
 * clock and the board's keys.
 */
export function useBoardVisible(rootRef: RefObject<unknown>, layout: unknown = null): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (Platform.OS === "web") return watchWeb(rootRef.current, setVisible);
    if (!AppState?.addEventListener) return;
    setVisible(AppState.currentState === undefined || AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => setVisible(state === "active"));
    return () => subscription.remove();
  }, [rootRef, layout]);
  return visible;
}

function watchWeb(node: unknown, set: (visible: boolean) => void): (() => void) | undefined {
  if (typeof document === "undefined") return;
  let pageVisible = document.visibilityState !== "hidden";
  let onScreen = true;
  const update = () => set(pageVisible && onScreen);
  const onPage = () => {
    pageVisible = document.visibilityState !== "hidden";
    update();
  };
  document.addEventListener("visibilitychange", onPage);
  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === "function" && node instanceof Element) {
    observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      onScreen = entry.isIntersecting;
      update();
    });
    observer.observe(node);
  }
  update();
  return () => {
    document.removeEventListener("visibilitychange", onPage);
    observer?.disconnect();
  };
}

/**
 * The board's one clock: ticks once a second while visible, and catches up
 * when shown again. The board holds it, never its time, so a tick re-renders
 * only what reads the time (`useTime`), not the board, its lanes or lists.
 */
export function useBoardClock(visible: boolean): TaskClock {
  const [clock] = useState(() => createTaskClock());
  useEffect(() => {
    if (!visible) return;
    clock.tick();
    const timer = setInterval(clock.tick, 1000);
    return () => clearInterval(timer);
  }, [clock, visible]);
  return clock;
}
