import { useEffect, useRef, useState } from "react";
import { Animated, Platform, View, type StyleProp, type TextStyle } from "react-native";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { TaskText } from "../typography";

const BAND_WIDTH = 72;
const INTENSITIES = [0.15, 0.5, 1, 0.5, 0.15];

export function TitleLoading(props: {
  title: string;
  color: string;
  mutedColor: string;
  style: StyleProp<TextStyle>;
  animated?: boolean;
  accessibilityLabel: string;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const active = props.animated !== false && !reduced;
  useEffect(() => {
    progress.setValue(0);
    if (!active || width === 0) return;
    const loop = Animated.loop(Animated.timing(progress, {
      toValue: 1, duration: 1600, easing: (value) => value, useNativeDriver: Platform.OS !== "web", isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [active, progress, width]);
  const travel = { inputRange: [0, 0.8, 1], outputRange: [-BAND_WIDTH, width, width] };
  const counterTravel = { inputRange: travel.inputRange, outputRange: [BAND_WIDTH, -width, -width] };
  return (
    <View accessibilityLabel={props.accessibilityLabel} accessibilityState={{ busy: true }} testID="task-title-update-shimmer"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
      <TaskText numberOfLines={2} ellipsizeMode="tail" style={[props.style, { color: props.mutedColor }]} testID="task-card-title">{props.title}</TaskText>
      {active && width > 0 ? (
        <Animated.View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="task-title-update-sheen"
          style={{ position: "absolute", top: 0, bottom: 0, width: BAND_WIDTH, overflow: "hidden", transform: [{ translateX: progress.interpolate(travel) }] }}>
          {INTENSITIES.map((opacity, index) => (
            <View key={index} style={{ position: "absolute", top: 0, bottom: 0, left: index * BAND_WIDTH / INTENSITIES.length, width: BAND_WIDTH / INTENSITIES.length, overflow: "hidden" }}>
              {/* Counter-motion keeps every clipped text copy aligned with the in-flow title. */}
              <Animated.View style={{ width, marginLeft: -index * BAND_WIDTH / INTENSITIES.length, opacity, transform: [{ translateX: progress.interpolate(counterTravel) }] }}>
                <TaskText numberOfLines={2} ellipsizeMode="tail" style={[props.style, { color: props.color }]}>{props.title}</TaskText>
              </Animated.View>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}
