/**
 * The safe area's top and bottom as numbers, for the panel's heights. The
 * host's safe-area context is not shared with plugins; React Native's
 * `SafeAreaView` (through `SafeInset`) pads its child by the insets, so a
 * probe child laid out inside a full-screen one reads them back. The last
 * reading is kept for the next panel, which then lays out at once.
 *
 * Android has no such view: `SafeInset` pads only the status bar there, so
 * the probe's bottom reads 0. Under edge-to-edge (Android 15 enforces it) the
 * Modal reaches under the navigation bar, and the panel's last line sat on
 * the gesture bar. `androidBottomInset` keeps that bar clear instead.
 */
import React, { useCallback, useRef, useState } from "react";
import { Dimensions, Platform, StatusBar, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { SafeInset } from "../../ui/safe-inset";

export interface Insets {
  top: number;
  bottom: number;
}

const NONE: Insets = { top: 0, bottom: 0 };

/** The gesture navigation bar (Android 10 and later, the default): what an edge-to-edge window cannot measure. */
export const ANDROID_NAV_FALLBACK = 24;
/** A navigation bar is 24 (gestures) to 48 (three buttons); a gap outside this is not one. */
const NAV_BAR = { min: 8, max: 64 } as const;

/**
 * The navigation bar a Modal must keep its content above on Android, in dp.
 * A Modal that stops above the bar (its stage shorter than the screen) needs
 * nothing. One that reaches under it reads the bar from the gap between the
 * screen and the app's window, which leaves the bar out (and on some devices
 * the status bar too). An edge-to-edge window leaves nothing out, so the gap
 * is 0: then the gesture bar's 24, which a three-button bar (48) exceeds.
 */
export function androidBottomInset(stage: number, screenHeight: number, windowHeight: number, statusBar: number): number {
  if (stage < screenHeight - 1) return 0;
  let gap = Math.round(screenHeight - windowHeight);
  if (gap > NAV_BAR.max && gap - statusBar >= NAV_BAR.min && gap - statusBar <= NAV_BAR.max) gap -= Math.round(statusBar);
  return gap >= NAV_BAR.min && gap <= NAV_BAR.max ? gap : ANDROID_NAV_FALLBACK;
}
let known: Insets | null = Platform.OS === "web" ? NONE : null;

/** The insets, null on native until the probe has laid out once. */
export function useSafeInsets(): [Insets | null, React.ReactNode] {
  const [insets, setInsets] = useState<Insets | null>(() => (Platform.OS === "web" ? NONE : known));
  const stage = useRef<number | null>(null);
  const inner = useRef<{ y: number; height: number } | null>(null);
  const settle = useCallback(() => {
    if (stage.current === null || !inner.current) return;
    const top = Math.max(0, Math.round(inner.current.y));
    const bottom = Platform.OS === "android"
      ? androidBottomInset(stage.current, Dimensions.get("screen").height, Dimensions.get("window").height, StatusBar.currentHeight ?? 0)
      : Math.max(0, Math.round(stage.current - inner.current.y - inner.current.height));
    const next = { top, bottom };
    known = next;
    setInsets((current) => (current && current.top === top && current.bottom === bottom ? current : next));
  }, []);
  const onStage = useCallback((event: LayoutChangeEvent) => {
    stage.current = event.nativeEvent.layout.height;
    settle();
  }, [settle]);
  const onInner = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    inner.current = { y, height };
    settle();
  }, [settle]);
  if (Platform.OS === "web") return [insets, null];
  const probe = (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onStage}>
      <SafeInset pointerEvents="none" style={styles.fill}>
        <View testID="details-inset-probe" style={styles.fill} onLayout={onInner} />
      </SafeInset>
    </View>
  );
  return [insets, probe];
}

/** Tests only. */
export function resetSafeInsets(next: Insets | null = null): void {
  known = next;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
