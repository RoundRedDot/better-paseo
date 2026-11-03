import React, { useEffect, useRef, useState } from "react";
import { Animated, Platform, Pressable } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useTitleUndoState, type TitleUpdateControl } from "../actions/title-update";
import type { TasksLanguage } from "../i18n";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { useHover } from "../../ui/use-hover";
import { tipProps } from "./card-hints";
import { cardStrings } from "./strings";
import type { TaskTokens } from "./tokens";

export function TitleUndo(props: { agentId: string; control?: TitleUpdateControl; tokens: TaskTokens; language: TasksLanguage; touch: boolean }) {
  const item = useTitleUndoState(props.control, props.agentId);
  const visible = item?.ready === true;
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const toast = useToast();
  const { hovered, hoverProps } = useHover();
  const strings = cardStrings(props.language);
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
    <Pressable accessibilityRole="button" accessibilityLabel={strings.undoTitle} disabled={!visible}
      testID={`task-title-undo-${props.agentId}`} {...tipProps(strings.undoTitle)} {...hoverProps}
      onPress={(event) => {
        event.stopPropagation();
        void props.control?.undoTitle(props.agentId).catch((error: unknown) => toast.error(strings.renameFailed(error instanceof Error ? error.message : String(error))));
      }}
      style={{ width: props.touch ? 32 : 24, height: props.touch ? 32 : 24, borderRadius: 5, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? props.tokens.card.controlHover : "transparent" }}>
      <Icon name="Undo2" size={props.touch ? 16 : 14} color={hovered ? props.tokens.foreground : props.tokens.foregroundMuted} />
    </Pressable>
  </Animated.View>;
}
