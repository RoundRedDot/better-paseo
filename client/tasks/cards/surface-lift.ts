import { Platform, type ViewStyle } from "react-native";
import { getReducedMotion } from "../../ui/use-reduced-motion";
import { buttonOutline, devicePixel } from "../board/board-style";
import type { TaskTokens } from "./tokens";

/**
 * What a lifted surface is, for how far a pointer press insets it and whether a
 * finger press shows anything:
 * - `card`: a task card. It keeps its size on every press.
 * - `capsule`: a sidebar stat capsule, wider than a finger.
 * - `row`: a full-width row or bar button, wider than a finger.
 * - `control`: a button, tab or chip a finger covers whole.
 */
export type LiftSize = "card" | "capsule" | "row" | "control";

/** How far a desktop or iPad trackpad press insets each size. A finger press never scales. */
export const PRESS_INSET: Record<LiftSize, number> = { card: 1, capsule: 0.97, row: 0.96, control: 0.96 };

/** A finger shows the press cue only after it has been down this long without moving. */
export const PRESS_CUE_DELAY = 100;
/** A finger that moves this far is a scroll (vertical) or the host's agent-list pan (horizontal). */
export const SCROLL_SLOP = 8;
export const PAN_SLOP = 15;

/** Press motion: in 80 ms ease-out, out 160 ms `cubic-bezier(.2,0,0,1)`, no overshoot. */
export const PRESS_MOTION = { in: 80, out: 160 } as const;

/**
 * Desktop web has a fine pointer, so hover is the interaction.
 * A phone, a touch browser, and an iPad (the native app, trackpad or not) use the press.
 * Vitest has no `matchMedia`, and there web is the desktop.
 */
export function liftsOnPress(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export type PressInput = "pointer" | "finger";

/**
 * Who is pressing. A desktop pointer, or an iPad trackpad: its hover arrived
 * before the press. Otherwise a finger.
 */
export function pressInput(hoveredAtPress: boolean): PressInput {
  return !liftsOnPress() || hoveredAtPress ? "pointer" : "finger";
}

export interface SurfaceLift {
  /** The line steps: neutral to `borderStrong`; a hued one keeps its hue and thickens on a dark theme. */
  line: boolean;
  /** The raised shadow (`0 2 6`). */
  shadow: boolean;
  /** 1, or the size's inset while a pointer presses it and motion is allowed. */
  scale: number;
  /** A finger is on it: a compact card paints its press fill. */
  finger: boolean;
}

const REST: SurfaceLift = { line: false, shadow: false, scale: 1, finger: false };

/**
 * One treatment for cards, sidebar capsules and board buttons. No fill on hover.
 * - Desktop hover: the line steps and the shadow rises. Nothing scales. iPad hover paints nothing.
 * - Desktop or trackpad press: the line stays stepped, the shadow drops back, the surface insets
 *   (a card keeps its size and its raised shadow).
 * - Finger press: nothing scales. A control the finger covers shows nothing; a card, capsule or row
 *   steps its line and raises its shadow. `pressed` is the delayed cue from `usePressCue`.
 * Reduced motion skips the inset and keeps the line and shadow.
 */
export function surfaceLift(hovered: boolean, pressed: boolean, reduced = getReducedMotion(), size: LiftSize = "control", input?: PressInput): SurfaceLift {
  if (pressed) {
    if ((input ?? pressInput(hovered)) === "finger") return size === "control" ? REST : { line: true, shadow: true, scale: 1, finger: true };
    if (size === "card") return { line: true, shadow: true, scale: 1, finger: false };
    return { line: true, shadow: false, scale: reduced ? 1 : PRESS_INSET[size], finger: false };
  }
  if (hovered && !liftsOnPress()) return { line: true, shadow: true, scale: 1, finger: false };
  return REST;
}

export function scaleStyle(scale: number): ViewStyle {
  return scale === 1 ? {} : { transform: [{ scale }] };
}

const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(", ") || undefined;

/**
 * The line and shadow a lifted surface draws, to spread after its own border.
 * - `border`: its resting line colour; a neutral one (or "transparent") steps to `borderStrong`.
 *   Leave it out when the surface draws no border: the step is then a hairline ring inside it.
 * - `hued`: the line is a status or action hue. It keeps its colour; on a dark theme it gains a
 *   second line inside, as the shadow alone does not read there.
 * - `rest`: its resting shadow, if it has one.
 * `theme` may be a getter, for a caller that builds its tokens only when it needs them.
 */
export function liftStyle(theme: TaskTokens | (() => TaskTokens), lift: SurfaceLift, options: { border?: string; hued?: boolean; rest?: string } = {}): ViewStyle {
  const { border, hued = false } = options;
  if (!lift.line && !lift.shadow) return border === undefined ? { boxShadow: options.rest } : { borderColor: border, boxShadow: options.rest };
  // Built only while lifted: a resting surface needs nothing from the theme.
  const tokens = typeof theme === "function" ? theme() : theme;
  let line = border;
  let ring: string | undefined;
  if (lift.line) {
    if (hued) ring = tokens.isDark && border ? `inset 0 0 0 1px ${border}` : undefined;
    else if (border !== undefined) line = tokens.borderStrong;
    else ring = `inset 0 0 0 ${devicePixel()}px ${tokens.borderStrong}`;
  }
  const boxShadow = join([ring, lift.shadow ? tokens.card.buttonShadowHover : options.rest]);
  return border === undefined ? { boxShadow } : { borderColor: line, boxShadow };
}

/**
 * An action button's outline while lifted: `buttonOutline(color, sides, shadow)`.
 * A plain button's line steps to `borderStrong`; a hued one keeps its hue. On a
 * dark theme the 0.5 line grows to 1, where the step alone barely shows.
 */
export function liftOutline(tokens: TaskTokens, border: string, plain: boolean, lift: SurfaceLift): { color: string; shadow?: string } {
  const color = lift.line && plain ? tokens.borderStrong : border;
  // On the web the 0.5 line is itself an inset shadow, so the ring covers it; natively it sits inside the border.
  const ring = lift.line && tokens.isDark ? `inset 0 0 0 ${Platform.OS === "web" ? 1 : 0.5}px ${color}` : undefined;
  return { color, shadow: join([ring, lift.shadow ? tokens.card.buttonShadowHover : undefined]) };
}

/** `buttonOutline` for a lifted action button (`liftOutline`). */
export function liftedButtonOutline(tokens: TaskTokens, border: string, plain: boolean, lift: SurfaceLift): ViewStyle {
  const outline = liftOutline(tokens, border, plain, lift);
  return buttonOutline(outline.color, {}, outline.shadow);
}
