import React, { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, LayoutAnimation, Platform, View, type ViewStyle } from "react-native";
import { easing } from "../../ui/tokens/motion";
import { useReducedMotion } from "../../ui/use-reduced-motion";

interface SubtaskPanelProps {
  expanded: boolean;
  animated?: boolean;
  children: ReactNode;
}

type PanelProps = SubtaskPanelProps & { still: boolean };
const OPEN_MS = 180;
const CLOSE_MS = 140;

/** Keeps the rows mounted through collapse, then releases their subscriptions. */
export function SubtaskPanel(props: SubtaskPanelProps) {
  const reduced = useReducedMotion();
  const still = reduced || props.animated === false;
  return Platform.OS === "web" ? <WebSubtaskPanel {...props} still={still} /> : <NativeSubtaskPanel {...props} still={still} />;
}

/** Fabric animates the layout transaction; JS never writes a height per frame. */
function NativeSubtaskPanel({ expanded, still, children }: PanelProps) {
  const [present, setPresent] = useState(expanded);
  const [open, setOpen] = useState(expanded);
  const target = useRef(expanded);
  const opacity = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useLayoutEffect(() => {
    if (still) {
      target.current = expanded;
      opacity.setValue(expanded ? 1 : 0);
      setOpen(expanded);
      setPresent(expanded);
      return;
    }
    // Restored expansion and unrelated card updates start no animation.
    if (target.current === expanded) return;
    target.current = expanded;
    let live = true;
    const ms = expanded ? OPEN_MS : CLOSE_MS;
    LayoutAnimation.configureNext({ duration: ms, update: { type: "easeOut" } });
    setOpen(expanded);
    if (expanded) setPresent(true);
    const animation = Animated.timing(opacity, {
      toValue: expanded ? 1 : 0,
      duration: ms,
      easing: easing.out,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (live && finished && !expanded) setPresent(false);
    });
    return () => {
      live = false;
      animation.stop();
    };
  }, [expanded, still, opacity]);

  if (!expanded && !present) return null;
  return (
    <Animated.View
      testID="task-card-subtasks-panel"
      pointerEvents={expanded ? "auto" : "none"}
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
      style={{ flexShrink: 0, overflow: "hidden", height: open ? undefined : 0, opacity }}
    >
      <View style={{ flexShrink: 0 }}>{children}</View>
    </Animated.View>
  );
}

/** CSS owns interpolation; only measurement and the exit boundary reach React. */
function WebSubtaskPanel({ expanded, still, children }: PanelProps) {
  const [present, setPresent] = useState(expanded);
  const [height, setHeight] = useState<number | null>(null);
  const initialExpanded = useRef(expanded).current;
  useLayoutEffect(() => {
    if (still || expanded) {
      setPresent(expanded);
      return;
    }
    if (!present) return;
    const timer = setTimeout(() => setPresent(false), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [expanded, still, present]);

  const natural = still || (initialExpanded && expanded && height === null);
  const visible = expanded && (natural || height !== null);
  // Retain an empty, zero-height shell so a reopening has a CSS start state.
  return (
    <View
      testID="task-card-subtasks-panel"
      pointerEvents={expanded ? "auto" : "none"}
      aria-hidden={!expanded || undefined}
      style={{
        flexShrink: 0,
        overflow: "hidden",
        height: expanded && natural ? undefined : visible ? height! : 0,
        opacity: visible ? 1 : 0,
        transitionProperty: "height, opacity",
        transitionDuration: still ? "0ms" : `${expanded ? OPEN_MS : CLOSE_MS}ms`,
        transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
      } as ViewStyle}
    >
      {expanded || present ? (
        <View
          testID="task-card-subtasks-measure"
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          style={natural ? undefined : { position: "absolute", top: 0, left: 0, right: 0 }}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}
