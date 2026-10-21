import { useEffect } from "react";
import type { ViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { boardPalette } from "./board-style";

const STYLE_ELEMENT_ID = "better-paseo-lane-scrollbar";

/** Linear's lane thumb: 12 device px at 2x, flush with the panel's right edge. */
export const LANE_SCROLLBAR_WIDTH = 6;

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
 */
function rules(theme: PluginTheme): string {
  const { panel } = boardPalette(theme);
  const muted = theme.colors.foregroundMuted;
  const thumb = mix(panel, muted, 0.92);
  const pressed = mix(muted, theme.colors.foreground, 0.35);
  return `
[data-bclane] {
  scrollbar-width: auto;
  scrollbar-color: auto;
  scrollbar-gutter: stable;
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
  background: ${thumb};
}
[data-bclane]::-webkit-scrollbar-thumb:hover,
[data-bclane]::-webkit-scrollbar-thumb:active {
  background: ${pressed};
}
`;
}

let mounted = 0;

/** A real DOM: off web, and in a test's bare `document`, there is nothing to style. */
const hasDom = () => typeof document !== "undefined" && typeof document.getElementById === "function";

/** Installs the lane scrollbar rules for the current theme while a desktop board is up. Off web a no-op. */
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
    return () => {
      mounted -= 1;
      if (mounted === 0) document.getElementById(STYLE_ELEMENT_ID)?.remove();
    };
  }, []);
}
