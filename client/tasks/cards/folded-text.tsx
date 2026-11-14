import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { withAlpha } from "../../components/theme-tokens";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { HoverControl } from "../hover-control";
import { MOTION } from "../board/board-style";
import type { TasksLanguage } from "../i18n";
import { TaskText as Text, HOST_FONT as F } from "../typography";
import { tipProps } from "./card-hints";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";

const FADE_STEPS = 6;
/**
 * The fold's clip must not size what it clips. Yoga hands a box's children its
 * height limit (`maxHeight`), and Fabric's text measure clamps to that limit
 * (iOS `TextLayoutManager`), so text measured under the fold read as one fold
 * tall: the fold dropped, the text measured whole, the fold came back, and the
 * fold and its row flickered without end, an opening fold re-measuring every
 * frame as it grew. Yoga lays the children of a `scroll` box out at their own
 * height, as a ScrollView's content; iOS and Android clip `scroll` as they
 * clip `hidden` and no scroll view is created. A browser measures text without
 * its box's limit, and would scroll a `scroll` box.
 */
const clipOverflow = () => (Platform.OS === "web" ? "hidden" as const : "scroll" as const);

/**
 * Text that folds under a fade after `limit` lines, with the same
 * "Show all · N lines" row under it as every message body. A caller that knows
 * the text's line count passes `long` and `total`; the card's title leaves
 * both out, so the fold measures the laid-out text: a title that fits stays
 * whole, and a narrower sidebar folds sooner.
 */
export function FoldedText(props: {
  id: string;
  language: TasksLanguage;
  tokens: TaskTokens;
  /** One line's height, already scaled as the text is. */
  line: number;
  limit: number;
  expanded: boolean;
  /** Whether the text overflows the fold; measured when absent. */
  long?: boolean;
  /** The text's line count; measured when absent. */
  total?: number;
  fadeColor: string;
  touch?: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const words = cardStrings(props.language).details;
  const [height, setHeight] = useState<number | null>(null);
  const progress = useRef(new Animated.Value(props.expanded ? 1 : 0)).current;
  /** Where `progress` rests; null while an animation was cut short. */
  const target = useRef<boolean | null>(props.expanded);
  const limit = props.limit * props.line;
  // Android's text box keeps a few font-padding pixels past its lines; count
  // whole lines so a title that just fits five stays whole.
  const measured = height !== null;
  const overflows = measured && Math.round(height / props.line) > props.limit;
  // Unmeasured text stays clamped: a long title must not paint open for a frame.
  const long = props.long ?? (!measured || overflows);
  useEffect(() => {
    if (reduced || !long || !measured) {
      target.current = props.expanded;
      progress.setValue(props.expanded ? 1 : 0);
      return;
    }
    if (target.current === props.expanded) return;
    target.current = props.expanded;
    const animation = Animated.timing(progress, { toValue: props.expanded ? 1 : 0, duration: props.expanded ? 180 : 140, easing: MOTION.ease, useNativeDriver: false, isInteraction: false });
    let done = false;
    animation.start(({ finished }) => { done = finished; });
    return () => {
      if (done) return;
      animation.stop();
      // Run on from where it stopped: a new height must not leave the fold
      // stuck partway, and a second press turns it around.
      target.current = null;
    };
    // Keyed on whether the text is measured, not its height: the clip follows
    // a new height through the interpolation below.
  }, [props.expanded, long, reduced, progress, measured]);
  const folded = long && !props.expanded;
  const overflow = clipOverflow();
  const style = !long || (props.expanded && (reduced || height === null)) ? null
    : reduced || height === null ? { maxHeight: limit, overflow }
    : { maxHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [Math.min(limit, height), height] }), overflow };
  const total = props.total ?? (height === null ? 0 : Math.max(1, Math.round(height / props.line)));
  return (
    <View>
      <Animated.View style={style} testID={`${props.id}-text`}>
        <View testID={`${props.id}-measure`} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
          {props.children}
        </View>
        {folded ? (
          // A heading or code block cuts the last line anywhere: fade it out.
          <View testID={`${props.id}-fade`} pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: props.line, flexDirection: "column" }}>
            {Array.from({ length: FADE_STEPS }, (_, step) => (
              <View key={step} style={{ flex: 1, backgroundColor: withAlpha(props.fadeColor, (step + 1) / FADE_STEPS) }} />
            ))}
          </View>
        ) : null}
      </Animated.View>
      {long && total > 0 ? (
        <View style={{ minHeight: props.touch ? 36 : 28, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <HoverControl base={props.fadeColor} foreground={props.tokens.foreground} accessibilityRole="button" accessibilityState={{ expanded: props.expanded }} {...tipProps(props.expanded ? words.showLess : words.showAll(total))} onPress={props.onToggle} hitSlop={4} testID={`${props.id}-more`} style={{ flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6 }}>
            <Icon name={props.expanded ? "ChevronsUp" : "ChevronsDown"} size={14} color={props.tokens.foregroundMuted} />
            <Text style={{ fontSize: F.sm, color: props.tokens.foregroundMuted }}>{props.expanded ? words.showLess : words.showAll(total)}</Text>
          </HoverControl>
        </View>
      ) : null}
    </View>
  );
}
