import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { steppedEasing } from "../../ui/tokens/motion";
import { useReducedMotion } from "../../ui/use-reduced-motion";

// Paseo's SyncedLoader snake states, in row-major order across its 2×3 grid.
const STATES = [
  [1, 0, 0.78, 0, 0.56, 0.34],
  [0.78, 1, 0.56, 0, 0.34, 0],
  [0.56, 0.78, 0.34, 1, 0, 0],
  [0.34, 0.56, 0, 0.78, 0, 1],
  [0, 0.34, 0, 0.56, 1, 0.78],
  [0, 0, 1, 0.34, 0.78, 0.56],
];

export function TitleLoading(props: { color: string; animated?: boolean; accessibilityLabel?: string; testID?: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const active = props.animated !== false && !reduced;
  useEffect(() => {
    progress.setValue(0);
    if (!active) return;
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 950, easing: steppedEasing(6), useNativeDriver: true, isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [active, progress]);
  const size = 16;
  const gap = Math.max(1, Math.round(size * 0.12));
  const dot = (size - gap * 2) / 3;
  return (
    <View accessibilityLabel={props.accessibilityLabel} accessibilityState={{ busy: true }} testID={props.testID}
      style={{ width: size, height: size, flexShrink: 0, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: dot * 2 + gap, height: size }}>
        {STATES[0]!.map((opacity, index) => (
          <Animated.View key={index} style={{
            position: "absolute", left: (index % 2) * (dot + gap), top: Math.floor(index / 2) * (dot + gap),
            width: dot, height: dot, borderRadius: dot / 2, backgroundColor: props.color,
            opacity: active ? progress.interpolate({
              inputRange: [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1],
              outputRange: [...STATES.map((state) => state[index]!), opacity],
            }) : opacity,
          }} />
        ))}
      </View>
    </View>
  );
}
