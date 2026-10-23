import React, { useEffect, useRef, useState, type RefObject } from "react";
import { Platform, StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { TaskText as Text, HOST_LINE, HOST_FONT as F } from "../typography";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { PREVIEW_REVEAL } from "../../ui/tokens/motion";
import { panelChrome } from "./panel";

/**
 * Hover hints on a desktop card: a pointer resting on a pill, the status
 * icon, the meta row or the footer's times names what it shows ("分支：main").
 *
 * One layer per card instead of one hover per mark: each mark carries a
 * `data-bchint` key (`hintProps`), and the card's layer listens on the card
 * once and reads the key under the pointer. The marks keep their layout, and
 * the hint, drawn as the card's last child, paints over every row of it.
 * Touch has no hover, and native none of this.
 */

/** How long a pointer rests on a mark before its hint shows, as the toolbars' names. */
export const HINT_DELAY_MS = 400;
/** The hint's distance from the card's edges and from its mark. */
const EDGE = 6;
const GAP = 4;
/** Room a one-line hint needs above its mark; with less it opens below. */
const ROOM = 30;

/** The hint texts a card registers each render, by key; read only when a hint opens. */
export type CardHintTexts = Map<string, () => string>;

/** The DOM attribute that marks a hinted element; nothing on native. */
export function hintProps(key: string | undefined): ViewProps {
  return Platform.OS === "web" && key ? ({ dataSet: { bchint: key } } as unknown as ViewProps) : {};
}

export interface HintBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HintPlace {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  maxWidth: number;
}

/**
 * Where a mark's hint sits in the card, in the card's own coordinates (inside
 * its border): above the mark when the card has room there, else below; from
 * the mark's left edge when the mark is in the card's left half, else ending
 * at its right edge, so the hint never leaves the card (the lane clips it).
 */
export function placeHint(anchor: HintBox, card: { width: number; height: number }): HintPlace {
  const above = anchor.top >= ROOM;
  const vertical = above ? { bottom: card.height - anchor.top + GAP } : { top: anchor.top + anchor.height + GAP };
  if (anchor.left + anchor.width / 2 <= card.width / 2) {
    const left = Math.max(EDGE, anchor.left);
    return { ...vertical, left, maxWidth: Math.max(0, card.width - EDGE - left) };
  }
  const right = Math.max(EDGE, card.width - anchor.left - anchor.width);
  return { ...vertical, right, maxWidth: Math.max(0, card.width - EDGE - right) };
}

interface Shown {
  text: string;
  place: HintPlace;
}

/** The card's hint layer: render it last in the card, with the card's root and its texts. */
export function CardHints(props: { root: RefObject<View | null>; texts: RefObject<CardHintTexts>; theme: PluginTheme; color: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const { root, texts } = props;
  const reducedMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const card = root.current as unknown as HTMLElement | null;
    if (Platform.OS !== "web" || !card?.addEventListener) return;
    let target: Element | null = null;
    const close = () => {
      clearTimeout(timer.current);
      setShown(null);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const found = (event.target as Element | null)?.closest?.("[data-bchint]") ?? null;
      const next = found && card.contains(found) ? found : null;
      if (next === target) return;
      target = next;
      close();
      if (!next) return;
      timer.current = setTimeout(() => {
        const text = texts.current?.get(next.getAttribute("data-bchint") ?? "")?.();
        if (!text || !next.isConnected) return;
        const box = card.getBoundingClientRect();
        const mark = next.getBoundingClientRect();
        // Absolute children sit inside the card's border.
        const anchor = { left: mark.left - box.left - card.clientLeft, top: mark.top - box.top - card.clientTop, width: mark.width, height: mark.height };
        setShown({ text, place: placeHint(anchor, { width: card.clientWidth, height: card.clientHeight }) });
      }, HINT_DELAY_MS);
    };
    const leave = () => {
      target = null;
      close();
    };
    // A press or a scroll ends the hint; the same mark shows it again only once the pointer leaves it.
    card.addEventListener("pointerover", over);
    card.addEventListener("pointerleave", leave);
    card.addEventListener("pointerdown", close);
    card.addEventListener("wheel", close, { passive: true });
    return () => {
      clearTimeout(timer.current);
      card.removeEventListener("pointerover", over);
      card.removeEventListener("pointerleave", leave);
      card.removeEventListener("pointerdown", close);
      card.removeEventListener("wheel", close);
    };
  }, [root, texts]);
  if (!shown) return null;
  const { place } = shown;
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          zIndex: 40,
          left: place.left,
          right: place.right,
          top: place.top,
          bottom: place.bottom,
          maxWidth: place.maxWidth,
          paddingHorizontal: 8,
          paddingVertical: 4,
          ...panelChrome(props.theme),
          borderRadius: 8,
        } as ViewStyle,
        reducedMotion ? null : place.bottom !== undefined ? motion?.above : motion?.below,
      ]}
      testID="task-card-hint"
    >
      <Text style={{ fontSize: F.sm, lineHeight: HOST_LINE.sm, color: props.color }}>{shown.text}</Text>
    </View>
  );
}

/** The toolbars' preview entrance: a fade with a short drift away from the mark. RNW compiles keyframes only through `StyleSheet.create`. */
const motion =
  Platform.OS === "web"
    ? StyleSheet.create({
        above: {
          animationKeyframes: [{ from: { opacity: 0, transform: `translateY(${PREVIEW_REVEAL.shift}px)` } }],
          animationDuration: `${PREVIEW_REVEAL.ms}ms`,
          animationTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
        } as ViewStyle,
        below: {
          animationKeyframes: [{ from: { opacity: 0, transform: `translateY(-${PREVIEW_REVEAL.shift}px)` } }],
          animationDuration: `${PREVIEW_REVEAL.ms}ms`,
          animationTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
        } as ViewStyle,
      })
    : null;
