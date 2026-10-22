import { useEffect } from "react";
import type { ViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { DETAIL_SCROLLBAR, taskTokens, type DetailScrollbarKind } from "../cards";
import { boardPalette } from "./board-style";

const STYLE_ELEMENT_ID = "better-paseo-lane-scrollbar";

/** Linear's lane thumb: 12 device px at 2x, flush with the panel's right edge. */
export const LANE_SCROLLBAR_WIDTH = 6;

/** How long the thumb stays after the last scroll event before it fades. */
const SCROLL_IDLE_MS = 800;
const THUMB_VAR = "--bc-lane-thumb";
const SCROLLING_ATTR = "data-bcscrolling";

/** Marks a lane's list on web, where its scrollbar is restyled below. */
export const laneScrollProps = { dataSet: { bclane: "" } } as unknown as ViewProps;

/**
 * The host styles every web scrollbar thin and faint (`scrollbar-width:
 * thin`, a 40% muted thumb), and an overlay one sits inside the lane's 8pt
 * padding, so the thumb touches the cards. Linear's lane keeps a gutter of its
 * own: a 6pt rounded thumb at the panel's right edge, about 3.5pt off the
 * cards, dark enough to read on the panel.
 *
 * Resetting the standard properties to `auto` on the lane lets Chromium use
 * the `::-webkit-scrollbar` rules again, and a styled scrollbar is a classic
 * one: it takes its width out of the list instead of covering the padding.
 * `scrollbar-gutter: stable` keeps that width while a lane fits, so cards do
 * not shift sideways when one starts to overflow.
 *
 * The thumb shows only while the lane scrolls, as an overlay one does: it
 * fades in on scroll and out a moment after, and reveals itself under the
 * pointer so it can still be grabbed. Scrollbar pseudo-elements take no
 * transitions, so the fade animates a registered colour property on the lane
 * that the thumb reads.
 */
function rules(theme: PluginTheme): string {
  const { panel } = boardPalette(theme);
  const muted = theme.colors.foregroundMuted;
  const thumb = mix(panel, muted, 0.92);
  const pressed = mix(muted, theme.colors.foreground, 0.35);
  return `
@property ${THUMB_VAR} {
  syntax: "<color>";
  inherits: true;
  initial-value: transparent;
}
[data-bclane] {
  scrollbar-width: auto;
  scrollbar-color: auto;
  scrollbar-gutter: stable;
  ${THUMB_VAR}: transparent;
  transition: ${THUMB_VAR} 400ms ease-out;
}
[data-bclane][${SCROLLING_ATTR}] {
  ${THUMB_VAR}: ${thumb};
  transition-duration: 100ms;
}
[data-bclane]::-webkit-scrollbar {
  width: ${LANE_SCROLLBAR_WIDTH}px;
  background: transparent;
}
[data-bclane]::-webkit-scrollbar-track {
  background: transparent;
}
[data-bclane]::-webkit-scrollbar-thumb {
  border-radius: ${LANE_SCROLLBAR_WIDTH / 2}px;
  background: var(${THUMB_VAR});
}
[data-bclane]::-webkit-scrollbar-thumb:hover,
[data-bclane]::-webkit-scrollbar-thumb:active {
  background: ${pressed};
}
${detailRules("inset", theme)}
${detailRules("column", theme)}
`;
}

/**
 * The details' scrollbars (`cards/detail-scrollbar.ts`): a classic one in a
 * stable gutter, so it never lies over the text and the text does not shift
 * when the details start to overflow. Unlike a lane's it stays while the
 * details overflow, a sign that there is more below.
 *
 * The thumb draws narrower than its gutter through transparent borders. A
 * border shrinks the inner radius by its width, so each side's outer radius
 * adds its border back: the visible thumb stays a round-ended pill even when
 * it sits off centre. The track keeps clear of the card's rounded corner.
 */
function detailRules(kind: DetailScrollbarKind, theme: PluginTheme): string {
  const { gutter, left, right } = DETAIL_SCROLLBAR[kind];
  const selector = `[data-bcdetails="${kind}"]`;
  const background = kind === "inset" ? taskTokens(theme).card.background : boardPalette(theme).panel;
  const muted = theme.colors.foregroundMuted;
  const thumb = mix(background, muted, 0.55);
  const pressed = mix(muted, theme.colors.foreground, 0.35);
  const round = (gutter - left - right) / 2;
  return `
${selector} {
  scrollbar-width: auto;
  scrollbar-color: auto;
  scrollbar-gutter: stable;
}
${selector}::-webkit-scrollbar {
  width: ${gutter}px;
  background: transparent;
}
${selector}::-webkit-scrollbar-track {
  background: transparent;
  margin: 2px 0 ${kind === "inset" ? 8 : 2}px;
}
${selector}::-webkit-scrollbar-thumb {
  border: solid transparent;
  border-width: 0 ${right}px 0 ${left}px;
  border-radius: ${left + round}px ${right + round}px ${right + round}px ${left + round}px / ${round}px;
  background: ${thumb};
  background-clip: padding-box;
}
${selector}::-webkit-scrollbar-thumb:hover,
${selector}::-webkit-scrollbar-thumb:active {
  background: ${pressed};
  background-clip: padding-box;
}`;
}

let mounted = 0;

const idleTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** Scroll does not bubble, so one capturing listener on the document sees every lane. */
function markScrolling(event: Event): void {
  const lane = event.target;
  if (!(lane instanceof Element) || !lane.hasAttribute("data-bclane")) return;
  lane.setAttribute(SCROLLING_ATTR, "");
  clearTimeout(idleTimers.get(lane));
  idleTimers.set(
    lane,
    setTimeout(() => lane.removeAttribute(SCROLLING_ATTR), SCROLL_IDLE_MS),
  );
}

/** A real DOM: off web, and in a test's bare `document`, there is nothing to style. */
const hasDom = () => typeof document !== "undefined" && typeof document.getElementById === "function";

/** Installs the lane and details scrollbar rules for the current theme while a desktop board is up. Off web a no-op. */
export function useLaneScrollbar(theme: PluginTheme): void {
  const css = hasDom() ? rules(theme) : "";

  useEffect(() => {
    if (!css) return;
    let style = document.getElementById(STYLE_ELEMENT_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ELEMENT_ID;
      document.head.appendChild(style);
    }
    style.textContent = css;
  }, [css]);

  useEffect(() => {
    if (!hasDom()) return;
    mounted += 1;
    if (mounted === 1) document.addEventListener("scroll", markScrolling, true);
    return () => {
      mounted -= 1;
      if (mounted > 0) return;
      document.removeEventListener("scroll", markScrolling, true);
      document.getElementById(STYLE_ELEMENT_ID)?.remove();
    };
  }, []);
}
