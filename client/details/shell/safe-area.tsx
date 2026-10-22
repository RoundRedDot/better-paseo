/**
 * The safe area's top and bottom as numbers, for the panel's heights. The
 * host's safe-area context is not shared with plugins; React Native's
 * `SafeAreaView` (through `SafeInset`) pads its child by the insets, so a
 * probe child laid out inside a full-screen one reads them back. The last
 * reading is kept for the next panel, which then lays out at once.
 */
import React, { useCallback, useRef, useState } from "react";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { SafeInset } from "../../ui/safe-inset";

export interface Insets {
  top: number;
  bottom: number;
}

const NONE: Insets = { top: 0, bottom: 0 };
let known: Insets | null = Platform.OS === "web" ? NONE : null;

/** The insets, null on native until the probe has laid out once. */
export function useSafeInsets(): [Insets | null, React.ReactNode] {
  const [insets, setInsets] = useState<Insets | null>(() => (Platform.OS === "web" ? NONE : known));
  const stage = useRef<number | null>(null);
  const inner = useRef<{ y: number; height: number } | null>(null);
  const settle = useCallback(() => {
    if (stage.current === null || !inner.current) return;
    const top = Math.max(0, Math.round(inner.current.y));
    const bottom = Math.max(0, Math.round(stage.current - inner.current.y - inner.current.height));
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
