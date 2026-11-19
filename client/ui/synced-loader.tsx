import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useReducedMotion } from "./use-reduced-motion";

/** Paseo's 14pt synced reply loader: six opacity steps over 950ms. */
export const SYNCED_LOADER_FRAMES = [
  [1, 0, 0.78, 0, 0.56, 0.34], [0.78, 1, 0.56, 0, 0.34, 0],
  [0.56, 0.78, 0.34, 1, 0, 0], [0.34, 0.56, 0, 0.78, 0, 1],
  [0, 0.34, 0, 0.56, 1, 0.78], [0, 0, 1, 0.34, 0.78, 0.56],
] as const;

export function SyncedLoader({ color, gridTestID }: { color: string; gridTestID?: string }) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(() => Math.floor((Date.now() % 950) * 6 / 950));
  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const phase = Date.now() % 950;
      const next = Math.floor(phase * 6 / 950);
      setStep(next);
      timer = setTimeout(tick, Math.max(1, Math.ceil((next + 1) * 950 / 6 - phase)));
    };
    tick();
    return () => clearTimeout(timer);
  }, [reduced]);
  return <View accessible={false} pointerEvents="none" style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
    <View testID={gridTestID} style={{ width: 26 / 3, height: 14, flexDirection: "row", flexWrap: "wrap", columnGap: 2, rowGap: 2 }}>
      {SYNCED_LOADER_FRAMES[reduced ? 0 : step]!.map((opacity, index) => <View key={index}
        style={{ width: 10 / 3, height: 10 / 3, borderRadius: 5 / 3, backgroundColor: color, opacity }} />)}
    </View>
  </View>;
}
