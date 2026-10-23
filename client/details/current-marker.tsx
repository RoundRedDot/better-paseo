import React, { useCallback, useEffect, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { mix, type ExtendedThemeTokens } from "../components/theme-tokens";
import { useMarkerPhase } from "./details-store";
import { useReducedMotion } from "../ui/use-reduced-motion";

/** The store owns the 1.2 s linger; the mounted row owns its final fade. */
export function CurrentMarker({ agentId, id, tokens }: { agentId: string; id: string; tokens: ExtendedThemeTokens }) {
  const phase = useMarkerPhase(agentId, id);
  const [visible, setVisible] = useState(phase !== "off");
  const hide = useCallback(() => setVisible(false), []);
  useEffect(() => {
    if (phase !== "off") setVisible(true);
  }, [phase]);
  // Replayed rows need only the marker selector until one is selected.
  // Draw immediately on selection, and keep the body through its final fade.
  if (phase === "off" && !visible) return null;
  return <VisibleMarker phase={phase} tokens={tokens} onHidden={hide} />;
}

function VisibleMarker({ phase, tokens, onHidden }: {
  phase: "off" | "on" | "linger";
  tokens: ExtendedThemeTokens;
  onHidden(): void;
}) {
  const [opacity] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (phase !== "off") {
      opacity.setValue(1);
      return;
    }
    const duration = reduced ? 120 : 200;
    const animation = Animated.timing(opacity, { toValue: 0, duration, useNativeDriver: true });
    animation.start();
    const timer = setTimeout(onHidden, duration);
    return () => { animation.stop(); clearTimeout(timer); };
  }, [phase, opacity, reduced, onHidden]);
  const accentSoft = (tokens as ExtendedThemeTokens & { details?: { accentSoft: string } }).details?.accentSoft
    ?? mix(tokens.v2.surface0, tokens.accent, 0.1);
  return (
    <Animated.View testID="details-current-marker" pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: 6, backgroundColor: accentSoft, opacity }]}>
      <View style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 2, backgroundColor: tokens.accent }} />
    </Animated.View>
  );
}
