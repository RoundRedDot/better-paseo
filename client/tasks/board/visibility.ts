import { useEffect, useState, type RefObject } from "react";
import { AppState, Platform } from "react-native";

/**
 * Whether the board is on screen. The host keeps hidden panes and screens
 * mounted, so the clock and the skeleton's breathing stop on this, not on
 * unmount. Web: the page is visible and the board's node intersects the
 * viewport (a hidden pane is `display: none`). Native: the app is active;
 * a native stack screen covered by another one cannot be told apart.
 */
export function useBoardVisible(rootRef: RefObject<unknown>): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (Platform.OS === "web") return watchWeb(rootRef.current, setVisible);
    if (!AppState?.addEventListener) return;
    setVisible(AppState.currentState === undefined || AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => setVisible(state === "active"));
    return () => subscription.remove();
  }, [rootRef]);
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

/** The board's one clock: ticks once a second while visible, and catches up when shown again. */
export function useBoardClock(visible: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);
  return now;
}
