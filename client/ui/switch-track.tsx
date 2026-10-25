import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { motionDuration } from "./tokens/motion";
import { useReducedMotion } from "./use-reduced-motion";

/** Switch geometry (S7 3.9): a 40x24 track and an 18pt knob. */
const TRACK_WIDTH = 40;
const TRACK_HEIGHT = 24;
const KNOB = 18;
const KNOB_INSET = (TRACK_HEIGHT - KNOB) / 2;

export interface SwitchColors {
  accent: string;
  accentForeground: string;
  surface0: string;
  surface2: string;
  border: string;
}

/**
 * An on/off switch's look, with no press of its own: on is the accent track
 * with the accent's foreground knob, off a surface2 track with a surface0
 * knob. The settings page's `Toggle` and the Tasks filter sheet's rows put
 * it inside their pressables.
 */
export function SwitchTrack({ value, colors }: { value: boolean; colors: SwitchColors }) {
  const reducedMotion = useReducedMotion();
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    const ms = motionDuration(140, reducedMotion);
    if (ms === 0) {
      position.setValue(value ? 1 : 0);
      return;
    }
    const animation = Animated.timing(position, {
      toValue: value ? 1 : 0,
      duration: ms,
      useNativeDriver: Platform.OS !== "web",
    });
    animation.start();
    return () => animation.stop();
  }, [value, position, reducedMotion]);

  return (
    <View
      style={[
        styles.track,
        {
          backgroundColor: value ? colors.accent : colors.surface2,
          borderColor: value ? colors.accent : colors.border,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.knob,
          {
            backgroundColor: value ? colors.accentForeground : colors.surface0,
            borderColor: value ? colors.accentForeground : colors.border,
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, TRACK_WIDTH - KNOB - KNOB_INSET * 2 - 2],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    paddingHorizontal: KNOB_INSET,
    justifyContent: "center",
  },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, borderWidth: 1 },
});
