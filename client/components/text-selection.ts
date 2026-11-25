import { Platform, type TextProps } from "react-native";

/**
 * Selected text takes the theme's `textSelection` everywhere the plugin draws
 * text. Each platform paints it its own way:
 *
 * - Web: one page rule, `::selection` under every plugin root (`data-bcroot`)
 *   and every selectable surface (`data-bcselection`, which covers previews
 *   that portal out of a root). The selection bar's shadow root sets its own.
 * - Android: a selectable `Text` paints its range in `selectionColor`; with
 *   none it uses the host app's highlight. Every outermost selectable `Text`
 *   spreads `selectionColorProps()` (guarded by `text-selection-props.test.ts`);
 *   `ProseText` and `SelectableText` add it themselves.
 * - iOS: native Markdown takes the opaque accent as its tint
 *   (`textSelectionTint`). A plain selectable `Text` there offers one Copy and
 *   draws no range, and `RNUITextView` has no colour prop.
 */

const STYLE_ELEMENT_ID = "better-paseo-text-selection";

/**
 * The fill the theme last resolved. Set while the tokens are built
 * (`useThemeTokens`), so a theme change re-renders the text that reads it.
 */
let current: string | undefined;

export function textSelectionRule(fill: string): string {
  return `[data-bcroot] ::selection, [data-bcselection] ::selection { background-color: ${fill}; }`;
}

/** Records the theme's fill, and on web rewrites the page rule when it changes. */
export function applyTextSelection(fill: string, web: boolean): void {
  current = fill;
  if (web) ensureTextSelectionStyle(fill);
}

export function ensureTextSelectionStyle(fill: string): void {
  if (typeof document === "undefined" || !document.head) return;
  const rule = textSelectionRule(fill);
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (style?.textContent === rule) return;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    document.head.appendChild(style);
  }
  style.textContent = rule;
}

const NONE: Pick<TextProps, "selectionColor"> = {};

/** Android's `selectionColor` for a selectable `Text`; nothing elsewhere or before a theme resolved. */
export function selectionColorProps(): Pick<TextProps, "selectionColor"> {
  return Platform.OS === "android" && current !== undefined ? { selectionColor: current } : NONE;
}
