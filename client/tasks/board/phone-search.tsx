import React, { useLayoutEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { HOST_FONT as F, useTasksFontScale } from "../typography";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HAIRLINE, MOTION } from "./board-style";

/** Owns its height and exit lifetime instead of relying on a host layout transaction. */
export function PhoneSearch(props: {
  visible: boolean;
  autoFocus: boolean;
  query: string;
  onChange(query: string): void;
  placeholder: string;
  theme: PluginTheme;
}) {
  const { visible, theme } = props;
  const reduced = useReducedMotion();
  const scale = useTasksFontScale();
  const colors = theme.colors;
  const [present, setPresent] = useState(visible);
  const [height, setHeight] = useState(0);
  const measured = height > 0;
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const target = useRef(visible);
  const initiallyVisible = useRef(visible).current;

  useLayoutEffect(() => {
    if (reduced) {
      target.current = visible;
      progress.setValue(visible ? 1 : 0);
      setPresent(visible);
      return;
    }
    if ((visible && !measured) || target.current === visible) return;
    target.current = visible;
    if (visible) setPresent(true);
    let live = true;
    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: 180,
      easing: MOTION.ease,
      // Height changes layout; the native driver only supports non-layout properties.
      useNativeDriver: false,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (live && finished && !visible) setPresent(false);
    });
    return () => {
      live = false;
      animation.stop();
    };
  }, [visible, reduced, measured, progress]);

  const natural = visible && (reduced || (initiallyVisible && !measured));
  return (
    <Animated.View
      testID="phone-search-reveal"
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      aria-hidden={!visible || undefined}
      style={{
        flexShrink: 0,
        overflow: "hidden",
        height: natural ? undefined : reduced ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }),
        opacity: reduced ? (visible ? 1 : 0) : progress,
      }}
    >
      {visible || present ? (
        <View
          testID="phone-search-measure"
          onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
          style={{ position: natural ? "relative" : "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 16, paddingBottom: 10 }}
        >
          <View style={{ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderWidth: HAIRLINE, borderColor: colors.border, borderRadius: 18 }}>
            <Icon name="Search" size={15} color={colors.foregroundMuted} />
            <TextInput
              autoFocus={props.autoFocus}
              value={props.query}
              onChangeText={props.onChange}
              placeholder={props.placeholder}
              placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel={props.placeholder}
              returnKeyType="search"
              style={{ flex: 1, minWidth: 0, padding: 0, fontSize: Math.round(F.base * scale), color: colors.foreground }}
            />
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}
