import React from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_FONT as F, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { buttonOutline } from "../board/board-style";
import { useActionFit } from "./action-row";
import { arrowInset, buttonHue, CARD_BUTTON_HEIGHT, COMPACT_CARD_BUTTON_HEIGHT, webTransition, type CardButtonLook } from "./action-style";
import { SpinnerRing } from "./status-icon";
import type { TaskTokens } from "./tokens";

/**
 * The card's button, always an outline: plain grey, Allow's accent, Archive's
 * yellow, the Stop button's danger, or "Answer" in the needs-input amber with its arrow. A busy
 * one keeps its look and label, dimmed, and swaps its icon for the hollow
 * spinner ring (`SpinnerRing`).
 */
export function CardButton(props: {
  label: string;
  /** The label read out, when it differs from the one drawn. */
  accessibilityLabel?: string;
  look: CardButtonLook;
  icon?: string | null;
  tokens: TaskTokens;
  compact: boolean;
  /** Working: dimmed, a spinner in place of the icon, and no second press. */
  busy?: boolean;
  disabled?: boolean;
  /** A phone's icon-only button, as wide as it is high; the label is read out. */
  square?: boolean;
  /** On a phone, as wide as its label: "Open tab" beside it takes the rest. */
  hug?: boolean;
  /** Ends in the ↗ after its label, as "Open tab" does; a square shows only the arrow. */
  arrow?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens, compact, look: kind } = props;
  const forcedSquare = compact && props.square === true;
  const scale = useTasksFontScale();
  const { hovered: hover, hoverProps } = useHover();
  const disabled = props.busy || props.disabled;
  const hovered = hover && !disabled;
  const answer = kind === "answer";
  const hue = buttonHue(tokens, kind);
  const color = hue.color;
  const fill = hovered ? hue.hover : "transparent";
  const border = hue.border;
  const size = compact ? 14 : 13;
  const height = taskControlHeight(compact ? COMPACT_CARD_BUTTON_HEIGHT : CARD_BUTTON_HEIGHT, scale);
  const hasIcon = !!props.icon || props.busy || answer || props.arrow;
  const fit = useActionFit(props.label, `${scale}|${useWindowDimensions().fontScale}`, compact ? COMPACT_CARD_BUTTON_HEIGHT : CARD_BUTTON_HEIGHT, 2 * (compact ? 12 : 10) + (hasIcon ? size + 5 : 0) + 1, forcedSquare, kind === "primary");
  const square = fit.iconOnly;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={disabled ? { disabled: true, busy: props.busy === true } : undefined}
      disabled={disabled}
      onPress={props.onPress}
      {...hoverProps}
      testID={props.testID}
      style={{
        // A phone's button grows with a large system font.
        ...(compact ? { minHeight: COMPACT_CARD_BUTTON_HEIGHT, paddingVertical: 4, flexGrow: 1, flexShrink: 0, flexBasis: "auto", minWidth: height } : { height: taskControlHeight(CARD_BUTTON_HEIGHT, scale) }),
        ...(compact && props.hug ? { flexGrow: 0 } : null),
        ...(square ? { width: taskControlHeight(COMPACT_CARD_BUTTON_HEIGHT, scale), minWidth: 0, flexGrow: 0, flexShrink: 0 } : null),
        paddingHorizontal: square ? 0 : compact ? 12 : 10,
        borderRadius: compact ? 7 : 6,
        ...buttonOutline(border),
        backgroundColor: fill,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        opacity: disabled ? 0.6 : 1,
        ...webTransition,
        ...fit.style,
      }}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={size} color={color} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : props.icon ? (
        <Icon name={props.icon} size={size} color={color} />
      ) : null}
      {square ? null : (
        <Text onLayout={fit.labelLayout} numberOfLines={1} style={{ flexShrink: 0, ...fit.labelStyle, textAlign: "center", fontSize: F.sm, fontWeight: "500", color }}>
          {props.label}
        </Text>
      )}
      {/* The one arrow: a label that still ends in its own is trimmed by the caller. */}
      {(answer || props.arrow) && !(square && props.busy) ? (
        <View style={{ marginLeft: square ? 0 : -arrowInset(size) }}>
          <Icon name="ArrowUpRight" size={size} color={color} />
        </View>
      ) : null}
    </Pressable>
  );
}
