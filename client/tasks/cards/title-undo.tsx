import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable, View } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useTitleUndoState, type TitleUpdateControl } from "../actions/title-update";
import type { TasksLanguage } from "../i18n";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { useHover } from "../../ui/use-hover";
import { mix, withAlpha } from "../../components/theme-tokens";
import { taskControlHeight, useTasksFontScale } from "../typography";
import { tipProps } from "./card-hints";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";
import { hoverFill } from "../hover-fill";

export function TitleUndo(props: { agentId: string; control?: TitleUpdateControl; tokens: TaskTokens; language: TasksLanguage; touch: boolean; fadeColor?: string; fadeHeight?: number; unifiedHover?: boolean }) {
  const item = useTitleUndoState(props.control, props.agentId);
  const visible = item?.ready === true;
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(0)).current;
  const toast = useToast();
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const surface = useRef(Symbol("title-undo")).current;
  const scale = useTasksFontScale();
  const size = taskControlHeight(props.touch ? 44 : 30, scale);
  const strings = cardStrings(props.language);
  useEffect(() => () => props.control?.leaveUndo(props.agentId, surface), [props.control, props.agentId, surface]);
  useEffect(() => {
    if (visible) setMounted(true);
    if (reduced) {
      opacity.setValue(visible ? 1 : 0);
      if (!visible) setMounted(false);
      return;
    }
    const animation = Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.start(({ finished }) => { if (finished && !visible) setMounted(false); });
    return () => animation.stop();
  }, [visible, reduced, opacity]);
  if (!mounted && !visible) return null;
  return <Animated.View style={{ opacity, flexShrink: 0 }}>
    {props.fadeColor ? <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      testID={`task-title-undo-fade-${props.agentId}`} style={{ position: "absolute", top: props.fadeHeight === undefined ? 0 : (size - props.fadeHeight) / 2, height: props.fadeHeight ?? size, right: 0, width: size + 20, flexDirection: "row" }}>
      {Array.from({ length: 10 }, (_, step) => <View key={step} style={{ width: 2, backgroundColor: withAlpha(props.fadeColor!, (step + 1) / 10) }} />)}
      <View style={{ width: size, backgroundColor: props.fadeColor }} />
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={strings.undoTitle} disabled={!visible}
      testID={`task-title-undo-${props.agentId}`} {...tipProps(strings.undoTitle)}
      onHoverIn={() => { hoverProps.onHoverIn(); props.control?.enterUndo(props.agentId, surface); }}
      onHoverOut={() => { hoverProps.onHoverOut(); props.control?.leaveUndo(props.agentId, surface); }}
      onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      onPress={(event) => {
        event.stopPropagation();
        void props.control?.undoTitle(props.agentId).catch((error: unknown) => toast.error(strings.renameFailed(error instanceof Error ? error.message : String(error))));
      }}
      style={{ width: size, height: size, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: props.unifiedHover ? hoverFill(props.fadeColor ?? props.tokens.card.background, props.tokens.foreground, hovered, pressed, "transparent") : hovered ? mix(props.fadeColor ?? props.tokens.card.background, props.tokens.foreground, props.tokens.isDark ? 0.1 : 0.07) : "transparent" }}>
      <Icon name="Undo2" size={props.touch ? 20 : 18} color={hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  </Animated.View>;
}
