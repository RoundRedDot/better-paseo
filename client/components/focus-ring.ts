import type { ViewProps } from "react-native";

const STYLE_ELEMENT_ID = "better-paseo-focus-ring";

/** Set on every element this plugin draws a surface from (`data-bcroot`). */
export const PLUGIN_ROOT_ATTRIBUTE = "data-bcroot";
/** Set on an element of ours while it holds focus a pointer gave it. */
export const POINTER_FOCUS_ATTRIBUTE = "data-bcpointer";

/**
 * Marks a plugin surface root: an item renderer's root, the settings page.
 * Spread through `surfaceProps` when combined with another marker. Ignored on
 * native, where there is no focus ring to manage.
 */
export const pluginRoot = { dataSet: { bcroot: "" } } as unknown as ViewProps;

/**
 * The host's ring stays for keyboard focus; only focus a pointer gave one of
 * our elements loses it. Three attribute selectors outweigh the host's
 * `*:focus-visible` (one pseudo-class), with no `!important`.
 */
const RULES = `[${PLUGIN_ROOT_ATTRIBUTE}] [${POINTER_FOCUS_ATTRIBUTE}]:focus-visible,
[${PLUGIN_ROOT_ATTRIBUTE}][${POINTER_FOCUS_ATTRIBUTE}]:focus-visible { outline: none; }`;

/** Where the caret shows focus: a field keeps the host's own treatment. */
function isTextEntry(element: Element): boolean {
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    (element as HTMLElement).isContentEditable === true
  );
}

/**
 * Keeps a mouse or touch click from leaving the host's focus ring on a row,
 * a chip or a button this plugin draws (web and desktop).
 *
 * Paseo hides the browser outline with `*:focus { outline: none }` and draws
 * its own for `*:focus-visible`. That is not enough on its own: once an element
 * has focus, Chromium matches `:focus-visible` on any later key press, a bare
 * Shift or Cmd included, so clicking a card header and then pressing Cmd+C
 * (or scrolling with the keyboard) draws a 2px green ring around the header
 * and keeps it there. A `:focus:not(:focus-visible)` rule cannot help, since
 * the element does match `:focus-visible` by then.
 *
 * So the modality is recorded here instead of inferred later: focus that
 * arrives under a pointer press is tagged with `data-bcpointer` until the
 * element loses it, and the rule above hides the ring for tagged elements of
 * ours only. Tab and other keyboard focus are never tagged, so keyboard users
 * keep the host's ring, and the host's own controls are untouched. A key
 * press forgets the pending pointer target, so focus that a key moves later
 * (Tab, Shift+Tab back to the same row) is keyboard focus again.
 *
 * Off web this is a no-op: native has no focus ring.
 */
export function installPointerFocusRing(): () => void {
  if (typeof document === "undefined") return () => {};
  if (document.getElementById(STYLE_ELEMENT_ID)) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = RULES;
  document.head.appendChild(style);

  let pressed: unknown = null;

  // Duck-typed rather than `instanceof Element`: a node from another realm
  // (an iframe, a test double) is still an element.
  const asElement = (target: EventTarget | null): Element | null =>
    target && typeof (target as Element).closest === "function" ? (target as Element) : null;

  const onPointerDown = (event: Event) => {
    pressed = event.target;
  };
  const onKeyDown = () => {
    pressed = null;
  };
  const onFocusIn = (event: Event) => {
    const element = asElement(event.target);
    if (!element || !pressed) return;
    if (!element.closest(`[${PLUGIN_ROOT_ATTRIBUTE}]`) || isTextEntry(element)) return;
    // Focus lands on the focusable ancestor of what was pressed.
    if (element === pressed || element.contains(pressed as Node)) {
      element.setAttribute(POINTER_FOCUS_ATTRIBUTE, "");
    }
  };
  const onFocusOut = (event: Event) => {
    asElement(event.target)?.removeAttribute(POINTER_FOCUS_ATTRIBUTE);
  };

  // Capture phase: a handler that stops propagation must not hide the press.
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    for (const element of Array.from(document.querySelectorAll(`[${POINTER_FOCUS_ATTRIBUTE}]`))) {
      element.removeAttribute(POINTER_FOCUS_ATTRIBUTE);
    }
    style.remove();
  };
}
