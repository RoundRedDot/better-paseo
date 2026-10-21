import { useEffect } from "react";
import type { ViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const STYLE_ELEMENT_ID = "better-paseo-resize-line";
const RESIZING_ATTR = "data-bcresizing";

/** The drag strip, the 1px track inside it, and the peaked indicator the track clips. */
export const resizeHandleProps = { dataSet: { bcresize: "" } } as unknown as ViewProps;
export const resizeTrackProps = { dataSet: { bcresizetrack: "" } } as unknown as ViewProps;
export const resizeIndicatorProps = { dataSet: { bcresizeindicator: "" } } as unknown as ViewProps;

/**
 * Linear's split handle: a 1px line that stays hidden until the pointer rests
 * on the strip for 100ms, fades its last 20px at both ends, and carries an
 * indicator twice the strip's height that is darkest at the pointer and
 * tapers off. The indicator follows the pointer's height, sliding out from
 * the middle when the line first shows. While a drag runs the line stays up
 * even if the pointer leaves the strip.
 */
function rules(theme: PluginTheme): string {
  const ink = `color-mix(in srgb, ${theme.colors.foreground} 72%, transparent)`;
  const ends = "linear-gradient(#0000 0, #000 20px calc(100% - 20px), #0000 100%)";
  const peak = `linear-gradient(
    #00000073 0% 30%, #0009 36%, #000c 42% 47%, #000000e6 48.5%,
    #000 49.5% 50.5%,
    #000000e6 51.5%, #000c 53% 58%, #0009 64%, #00000073 70% 100%)`;
  const shown = `[data-bcresize]:hover [data-bcresizetrack], [data-bcresize][${RESIZING_ATTR}] [data-bcresizetrack]`;
  const moving = `[data-bcresize]:hover [data-bcresizeindicator], [data-bcresize][${RESIZING_ATTR}] [data-bcresizeindicator]`;
  return `
[data-bcresizetrack] {
  opacity: 0;
  -webkit-mask-image: ${ends};
  mask-image: ${ends};
  transition: opacity 150ms;
}
[data-bcresizeindicator] {
  background: ${ink};
  -webkit-mask-image: ${peak};
  mask-image: ${peak};
}
${shown} {
  opacity: 1;
  transition-duration: 0s;
  transition-delay: 100ms;
}
[data-bcresize][${RESIZING_ATTR}] [data-bcresizetrack] {
  transition-delay: 0s;
}
${moving} {
  will-change: transform;
  animation: bc-resize-indicator-from-center 150ms cubic-bezier(0.215, 0.61, 0.355, 1);
}
@keyframes bc-resize-indicator-from-center {
  from { transform: translate3d(0, 0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-bcresizetrack] { transition: none; }
  ${moving} { animation: none; }
}
`;
}

/** A real DOM: off web, and in a test's bare `document`, there is nothing to style. */
const hasDom = () => typeof document !== "undefined" && typeof document.getElementById === "function";

let mounted = 0;

/** Installs the split handle's rules for the current theme while a desktop board is up. Off web a no-op. */
export function useResizeLine(theme: PluginTheme): void {
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

/** Marks the strip as dragging, so the line holds while the pointer is off it. */
export function setResizing(handle: HTMLElement | null, on: boolean): void {
  if (!handle) return;
  if (on) handle.setAttribute(RESIZING_ATTR, "");
  else handle.removeAttribute(RESIZING_ATTR);
}

/** Centres the indicator's peak on the pointer, held inside the strip. */
export function followPointer(handle: HTMLElement | null, indicator: HTMLElement | null, clientY: number): void {
  if (!handle || !indicator) return;
  const rect = handle.getBoundingClientRect();
  const y = Math.min(Math.max(clientY - rect.top, 0), rect.height) - rect.height / 2;
  indicator.style.transform = `translate3d(0, ${y}px, 0)`;
}
