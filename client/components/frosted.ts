import type { ViewProps } from "react-native";
import { getEnhancerPreferences, subscribeEnhancerPreferences } from "../preferences";

const STYLE_ELEMENT_ID = "beautiful-chat-frosted";

/**
 * `backdrop-filter` has no React Native style equivalent, and React Native Web
 * drops style keys it does not recognise. So the blur is declared once as a
 * real CSS rule and matched by attribute, the same technique the host itself
 * uses for `data-pmono`.
 *
 * `saturate` is included because blurring alone washes colour out of whatever
 * sits behind the surface; pushing saturation back up keeps syntax highlighting
 * under a nested block from turning grey.
 *
 * Since plan §3.6 only floating surfaces carry the mark (the selection bar,
 * the full-path tooltip); inline blocks are flat. The blur is dropped when
 * the system asks for reduced motion: a backdrop that smears as content
 * scrolls under it is motion too.
 */
const FROSTED_RULE = `[data-ompfrost] {
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  backdrop-filter: blur(14px) saturate(150%);
}
@media (prefers-reduced-motion: reduce) {
  [data-ompfrost] {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}`;

/**
 * The same blur for a surface inside a shadow root (the selection bar), which
 * the document rule cannot reach; keyed on `data-bcfrost` on the shadow host so
 * the document rule does not also blur the host's square box.
 */
export const FROSTED_SHADOW_CSS = `:host([data-bcfrost]) .bar {
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  backdrop-filter: blur(14px) saturate(150%);
}
@media (prefers-reduced-motion: reduce) {
  :host([data-bcfrost]) .bar {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}`;

/**
 * Installs the blur rule. A no-op off web, and idempotent so a second client
 * mount reuses the existing element.
 *
 * The rule is present only while the setting is on. With it off the glass
 * tokens are opaque, so a blur would be invisible — but the browser would
 * still composite a backdrop filter under every marked surface.
 */
export function installFrostedGlass(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById(STYLE_ELEMENT_ID)) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  const sync = (): void => {
    const rule = getEnhancerPreferences().frostedGlass ? FROSTED_RULE : "";
    if (style.textContent !== rule) style.textContent = rule;
  };
  sync();
  document.head.appendChild(style);
  const unsubscribe = subscribeEnhancerPreferences(sync);

  return () => {
    unsubscribe();
    style.remove();
  };
}

/**
 * Marks an overlay for blurring. Spread onto a `View` whose background is one of
 * the translucent `glass` tokens — an opaque background has nothing to show
 * through and the blur would be invisible.
 *
 * On native the attribute is ignored and the surface simply renders
 * translucent, which degrades honestly: a real blur there needs a native view
 * the plugin sandbox does not expose.
 */
export const frosted = {
  dataSet: { ompfrost: true },
} as unknown as ViewProps;
