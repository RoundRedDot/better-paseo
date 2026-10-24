import React, { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { easing } from "../../ui/tokens/motion";
import { useReducedMotion } from "../../ui/use-reduced-motion";

/** Keeps the rows mounted through collapse, then releases their subscriptions. */
export function SubtaskPanel({ expanded, animated = true, children }: {
  expanded: boolean;
  animated?: boolean;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const still = reduced || !animated;
  const [present, setPresent] = useState(expanded);
  const [height, setHeight] = useState<number | null>(null);
  const initialExpanded = useRef(expanded).current;
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  const measured = height !== null;

  useLayoutEffect(() => {
    if (still) {
      progress.setValue(expanded ? 1 : 0);
      setPresent(expanded);
      return;
    }
    // The first layout measures the full body while its outer height stays zero.
    if (!measured) return;
    let live = true;
    const animation = Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: expanded ? 180 : 140,
      easing: easing.out,
      // Height and opacity share one clock; layout cannot use the native driver.
      useNativeDriver: false,
    });
    if (expanded) setPresent(true);
    animation.start(({ finished }) => {
      if (live && finished && !expanded) setPresent(false);
    });
    return () => {
      live = false;
      animation.stop();
    };
  }, [expanded, measured, still, progress]);

  if (!expanded && !present) return null;
  // Restored board state and static previews keep their natural first layout.
  const natural = still || (initialExpanded && expanded && !measured);
  return (
    <Animated.View
      testID="task-card-subtasks-panel"
      pointerEvents={expanded ? "auto" : "none"}
      aria-hidden={!expanded || undefined}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      style={{
        flexShrink: 0,
        overflow: "hidden",
        height: natural ? undefined : progress.interpolate({ inputRange: [0, 1], outputRange: [0, height ?? 0] }),
        opacity: progress,
      }}
    >
      <View
        testID="task-card-subtasks-measure"
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={natural ? undefined : { position: "absolute", top: 0, left: 0, right: 0 }}
      >
        {children}
      </View>
    </Animated.View>
  );
}
