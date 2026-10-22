import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { mix, type ExtendedThemeTokens } from "../components/theme-tokens";
import { useMarkerPhase } from "./details-store";
import { useReducedMotion } from "../ui/use-reduced-motion";

/** The store owns the 1.2 s linger; the mounted row owns its final fade. */
export function CurrentMarker({ agentId, id, tokens }: { agentId: string; id: string; tokens: ExtendedThemeTokens }) {
  const phase = useMarkerPhase(agentId, id);
  const [visible, setVisible] = useState(phase !== "off");
  const opacity = useRef(new Animated.Value(phase === "off" ? 0 : 1)).current;
  const reduced = useReducedMotion();
  const wasVisible = useRef(phase !== "off");
  useEffect(() => {
    if (phase !== "off") {
      wasVisible.current = true;
      setVisible(true);
      opacity.setValue(1);
      return;
    }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    const duration = reduced ? 120 : 200;
    const animation = Animated.timing(opacity, { toValue: 0, duration, useNativeDriver: true });
    animation.start();
    const timer = setTimeout(() => setVisible(false), duration);
    return () => { animation.stop(); clearTimeout(timer); };
  }, [phase, opacity, reduced]);
  if (!visible) return null;
  const accentSoft = (tokens as ExtendedThemeTokens & { details?: { accentSoft: string } }).details?.accentSoft
    ?? mix(tokens.v2.surface0, tokens.accent, 0.1);
  return (
    <Animated.View testID="details-current-marker" pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: 6, backgroundColor: accentSoft, opacity }]}>
      <View style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 2, backgroundColor: tokens.accent }} />
    </Animated.View>
  );
}
