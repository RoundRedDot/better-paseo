import { Platform, type ViewStyle } from "react-native";
import type { PermissionButton } from "../actions";
import type { TaskTokens } from "./tokens";

/** Authored card-action targets; independent of the card's layout metrics. */
export const CARD_BUTTON_HEIGHT = 28;
export const COMPACT_CARD_BUTTON_HEIGHT = 32;

/** Web desktop cards use 26; native tablet cards keep their existing size. */
export function cardButtonHeight(): number {
  return Platform.OS === "web" ? 26 : CARD_BUTTON_HEIGHT;
}

export const webTransition = (Platform.OS === "web"
  ? { transitionProperty: "background-color, border-color, box-shadow, color, opacity", transitionDuration: "120ms", transitionTimingFunction: "ease-out" }
  : {}) as ViewStyle;

/**
 * A permission button's look, wherever it is drawn: "Answer" in the
 * needs-input amber, View questions and Allow in the accent, and Deny in
 * the Stop button's danger; any other answer plain.
 */
export function requestLook(button: PermissionButton): CardButtonLook {
  if (button.kind === "open") return "answer";
  if (button.kind === "question") return "primary";
  if (button.variant === "primary") return "primary";
  if (button.variant === "danger" || button.action.behavior === "deny") return "danger";
  return "plain";
}

/**
 * Whether a request's answer must keep its words when its row runs out of
 * room: a question's written option, or one of several answers drawn with the
 * same Check or X (a plan's Implement and "Implement with Bypass"), which its
 * icon alone could not tell apart: those never fold or cut their words, and
 * their row stacks when they do not fit side by side (`ActionRow`'s `stack`).
 * The others fold to their icon first.
 */
export function keepsAnswerLabel(button: PermissionButton, buttons: readonly PermissionButton[]): boolean {
  if (button.answers) return true;
  if (button.kind !== "respond") return false;
  return buttons.filter((other) => other.kind === "respond" && !other.answers && other.action.behavior === button.action.behavior).length > 1;
}

export type CardButtonLook = "primary" | "plain" | "danger" | "answer" | "archive" | "read" | "unread";

/**
 * Every Tasks action button's colours, on the card, in the details sidebar
 * and in the phone sheet's bar: an outline whose border, label and icon carry
 * its hue, with no fill. Desktop hover deepens the shadow. A phone or iPad
 * deepens it while pressed, and grows. `hover` is the wash for an open stop
 * menu and for contrast, not a hover or press fill. Plain grey (Open tab),
 * Allow's accent, Stop and Deny's danger, "Answer"'s needs-input amber,
 * Archive's yellow, Mark read's unread green. Mark unread uses that same
 * success green for its frame and label; its dot is the review lane's.
 * No button fill is ever solid: an armed "Confirm stop" says so in words only.
 */
export function buttonHue(tokens: TaskTokens, look: CardButtonLook): { color: string; border: string; hover: string } {
  const card = tokens.card;
  switch (look) {
    case "primary":
      return { color: card.primaryText, border: card.primaryBorder, hover: card.primaryHover };
    case "danger":
      return { color: tokens.danger, border: tokens.danger, hover: card.dangerHover };
    case "answer":
      return { color: card.answerText, border: card.answerBorder, hover: card.answerHover };
    case "archive":
      return { color: card.archiveText, border: card.archiveBorder, hover: card.archiveHover };
    case "read":
      return { color: card.readText, border: card.readBorder, hover: card.readHover };
    case "unread":
      return { color: tokens.status.success, border: tokens.status.success, hover: card.readHover };
    default:
      return { color: tokens.foreground, border: card.buttonBorder, hover: card.controlHover };
  }
}

/** Armed Stop's icon: Lucide's stop sign with an exclamation mark, asking for the second press. */
export const CONFIRM_STOP_ICON = "OctagonAlert";

/**
 * Lucide's ArrowUpRight draws in columns 7–17 of its 24, where a box icon such
 * as Archive fills 2–22: after a label the arrow sits that 5/24 further off.
 * A trailing arrow is pulled in by it, so its gap reads as a leading icon's.
 */
export function arrowInset(size: number): number {
  return (size * 5) / 24;
}
