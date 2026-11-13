import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, HOST_FONT as F, useTasksFontScale, taskControlHeight } from "../typography";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { openOptionExpansion, optionTextClipped } from "../../web";
import { useActionFit } from "./action-row";
import { ActionPressable } from "./action-pressable";
import { liftedButtonOutline, surfaceLift } from "./surface-lift";
import { arrowInset, buttonHue, cardButtonHeight, COMPACT_CARD_BUTTON_HEIGHT, webTransition, type CardButtonLook } from "./action-style";
import { hintProps } from "./card-hints";
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
  /** A drawn mark in place of a Lucide icon. Called with the button's colour and icon box. */
  glyph?: (color: string, size: number) => React.ReactNode;
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
  /** The parent card's hover-hint key while this action has no visible label. */
  hint?: string;
  /** A question's written option: no icon, so its label never folds away. */
  labelOnly?: boolean;
  /**
   * Never fold to the icon or cut the label: for an answer whose words alone
   * tell it from another beside it with the same icon (a plan's Implement and
   * "Implement with Bypass"). Its row stacks when it does not fit
   * (`ActionRow`'s `stack`), and there the label wraps between words.
   */
  wrapLabel?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { tokens, compact, look: kind } = props;
  const forcedSquare = compact && props.square === true;
  const scale = useTasksFontScale();
  const { hovered: hover, hoverProps } = useHover();
  const reduced = useReducedMotion();
  const labelRef = useRef<React.ElementRef<typeof Text>>(null);
  const panelRef = useRef<View>(null);
  const expansion = useRef<ReturnType<typeof openOptionExpansion> | null>(null);
  const [showExpansion, setShowExpansion] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (!showExpansion) return;
    const layer = openOptionExpansion(labelRef.current, panelRef.current, reduced);
    expansion.current = layer;
    return () => { expansion.current = null; layer.close(); };
  }, [showExpansion, reduced]);
  useLayoutEffect(() => { expansion.current?.setExpanded(expanded); }, [expanded, showExpansion]);
  useEffect(() => {
    if (!showExpansion || expanded) return;
    const timer = setTimeout(() => setShowExpansion(false), reduced ? 0 : 180);
    return () => clearTimeout(timer);
  }, [expanded, reduced, showExpansion]);
  const disabled = props.busy || props.disabled;
  const hovered = hover && !disabled;
  const answer = kind === "answer";
  const hue = buttonHue(tokens, kind);
  const color = hue.color;
  const border = hue.border;
  const size = compact ? 14 : 13;
  const baseHeight = compact ? COMPACT_CARD_BUTTON_HEIGHT : cardButtonHeight();
  const height = taskControlHeight(baseHeight, scale);
  const hasIcon = !!props.icon || props.glyph !== undefined || props.busy || answer || props.arrow;
  const fit = useActionFit(props.label, `${scale}|${useWindowDimensions().fontScale}`, baseHeight, 2 * (compact ? 12 : 10) + (hasIcon ? size + 4 : 0) + 1, forcedSquare, kind === "primary", props.labelOnly, props.wrapLabel);
  const square = fit.iconOnly;
  const wrap = props.wrapLabel === true;
  return (
    <ActionPressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={disabled ? { disabled: true, busy: props.busy === true } : undefined}
      disabled={disabled}
      onPress={props.onPress}
      onHoverIn={() => {
        hoverProps.onHoverIn();
        if (props.labelOnly && !disabled && optionTextClipped(labelRef.current)) {
          setShowExpansion(true);
          setExpanded(true);
        }
      }}
      onHoverOut={() => { hoverProps.onHoverOut(); setExpanded(false); }}
      {...hintProps(square ? props.hint : undefined)}
      testID={props.testID}
      style={({ pressed }) => ({
        // A phone's button grows with a large system font.
        ...(compact ? { minHeight: COMPACT_CARD_BUTTON_HEIGHT, paddingVertical: 4, flexGrow: 1, flexShrink: 0, flexBasis: "auto", minWidth: height }
          : wrap ? { minHeight: height, paddingVertical: 2 } : { height }),
        ...(compact && props.hug ? { flexGrow: 0 } : null),
        ...(square ? { width: taskControlHeight(COMPACT_CARD_BUTTON_HEIGHT, scale), minWidth: 0, flexGrow: 0, flexShrink: 0 } : null),
        paddingHorizontal: square ? 0 : compact ? 12 : 10,
        borderRadius: compact ? 7 : 6,
        ...liftedButtonOutline(tokens, border, kind === "plain", surfaceLift(hovered, pressed && !disabled)),
        backgroundColor: "transparent",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        opacity: disabled ? 0.6 : 1,
        ...webTransition,
        ...fit.style,
      })}
    >
      {props.busy ? (
        // The running ring without its dot, in the icon's box so the button keeps its width.
        <SpinnerRing size={size} color={color} testID={props.testID ? `${props.testID}-spinner` : undefined} />
      ) : props.glyph ? (
        props.glyph(color, size)
      ) : props.icon ? (
        <Icon name={props.icon} size={size} color={color} />
      ) : null}
      {square ? null : (
        <Text ref={labelRef} onLayout={fit.labelLayout} numberOfLines={wrap ? undefined : 1} ellipsizeMode={props.labelOnly && !wrap ? "tail" : undefined} style={{ flexShrink: 0, ...fit.labelStyle, textAlign: "center", fontSize: F.sm, fontWeight: "500", color }}>
          {props.label}
        </Text>
      )}
      {Platform.OS === "web" && showExpansion ? (
        <View ref={panelRef} aria-hidden style={{ position: "absolute", opacity: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: compact ? 12 : 10, borderRadius: compact ? 7 : 6, backgroundColor: tokens.card.background, ...liftedButtonOutline(tokens, border, kind === "plain", surfaceLift(true, false)) }}>
          <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: F.sm, fontWeight: "500", color }}>{props.label}</Text>
        </View>
      ) : null}
      {/* The one arrow: a label that still ends in its own is trimmed by the caller. */}
      {(answer || props.arrow) && !(square && props.busy) ? (
        <View style={square ? undefined : { marginLeft: -arrowInset(size), width: size * 18 / 24 }}>
          <Icon name="ArrowUpRight" size={size} color={color} />
        </View>
      ) : null}
    </ActionPressable>
  );
}
