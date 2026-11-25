const STYLE_ELEMENT_ID = "better-paseo-text-selection";

/**
 * The page rule that paints a drag over our surfaces (every plugin root,
 * `data-bcroot`, and every selectable surface, `data-bcselection`, which
 * covers previews that portal out of a root) in the
 * theme's `textSelection` blue, as iOS and Android do through
 * `selectionColor`. Web only; one style element, rewritten when the theme's
 * fill changes. The selection bar's shadow root keeps its own rules.
 */
export function textSelectionRule(fill: string): string {
  return `[data-bcroot] ::selection, [data-bcselection] ::selection { background-color: ${fill}; }`;
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
