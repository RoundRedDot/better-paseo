import { useEffect } from "react";
import { Platform } from "react-native";
import type { TextProps, ViewProps } from "react-native";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { radiusV2 } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { FLOAT, FLOAT_EASE, floatHover, floatPressed, floatShadow } from "../ui/tokens/float";
import { getEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";

/**
 * A floating Copy / Add to chat bar for highlighted callout text.
 *
 * The bar is raw DOM rather than a React tree because it has to escape the
 * timeline: the chat surface clips its content and the host translates it while
 * the keyboard moves, so an in-tree overlay is either cut off or dragged along.
 * The plugin sandbox exposes no portal — `react-dom` is not a module a plugin
 * may import — so the bar is parked on `document.body` and driven by selection
 * events.
 *
 * It lives in a shadow root. The host app ships its own global rules and a
 * React Native Web reset, and a bar in the light DOM inherits whatever those
 * say about font size, line height, and flex shrinking — which is how the first
 * version ended up with two labels sitting on top of each other on desktop.
 * `all: initial` on the shadow host stops inheritance at the boundary, and the
 * bar's own rules are the only ones inside it.
 *
 * Web only. iOS and Android route selection through the platform's own menu,
 * which a plugin cannot extend; `selectable` text there already offers Copy.
 */

/** Marks a callout root as a surface whose selections get the bar. */
export const selectionSurface = { dataSet: { bcselection: true } } as unknown as ViewProps;

/**
 * Marks a code or terminal body inside a surface. A selection from one is
 * quoted as a fenced block, because `>` in front of every line of code makes it
 * unreadable to the next reader and to the model.
 *
 * Every such body is also a monospace region, so the mark carries the host's
 * code-surface attribute (`data-pmono`, see `host-font-escape.ts`) too: the
 * host's UI font rule skips it and the plugin's mono family applies.
 */
export const selectionCodeSurface = { dataSet: { bccode: true, pmono: "" } } as unknown as ViewProps;

/**
 * The same mark for a code or terminal body that is a `Text` rather than a
 * `View` — React Native types the two prop bags separately, and the DOM
 * attribute is identical.
 */
export const selectionCodeText = { dataSet: { bccode: true, pmono: "" } } as unknown as TextProps;

const SURFACE_SELECTOR = "[data-bcselection]";
/** The bar's host, for layers that must treat a press on it as their own. */
export const SELECTION_BAR_SELECTOR = "[data-bcselectionbar]";
const CODE_SELECTOR = "[data-bccode]";
/** The host composer input carries `dataSet={{ composerInput: "" }}`. */
const COMPOSER_SELECTOR = "[data-composer-input]";

const GAP = 8;
/** How long a pressed button shows its check before the bar steps aside. */
const DONE_MS = 700;
/** The bar's fade out, after which it leaves the page. */
const LEAVE_MS = 100;

/** Lucide's shapes, the set the plugin's `Icon` draws, inlined: the bar is raw DOM. */
const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  add: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
} as const;
type IconName = keyof typeof ICONS;

interface Snapshot {
  text: string;
  isCode: boolean;
  rect: DOMRect;
  /** The element the selection sits in, to find its own chat's composer. */
  element: Element | null;
}

function elementOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
}

/**
 * The live selection, or null when it is empty, collapsed, or outside every
 * plugin surface. Both ends must sit in the same surface: a drag that runs from
 * a callout into host chrome is not a callout selection.
 */
function readSelection(): Snapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const text = selection.toString().trim();
  if (!text) return null;

  const anchor = elementOf(selection.anchorNode)?.closest(SURFACE_SELECTOR);
  const focus = elementOf(selection.focusNode)?.closest(SURFACE_SELECTOR);
  if (!anchor || anchor !== focus) return null;

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;

  const element = elementOf(range.commonAncestorContainer);
  const isCode = Boolean(element?.closest(CODE_SELECTOR));
  return { text, isCode, rect, element };
}

/** Markdown the composer can carry: a fence for code, a blockquote for prose. */
function quote(snapshot: Snapshot): string {
  if (snapshot.isCode) return "```\n" + snapshot.text + "\n```\n\n";
  return (
    snapshot.text
      .split("\n")
      .map((line) => (line.trim() ? "> " + line : ">"))
      .join("\n") + "\n\n"
  );
}

type Field = HTMLTextAreaElement | HTMLInputElement;

function fieldOf(marked: Element): Field | null {
  if (marked instanceof HTMLTextAreaElement || marked instanceof HTMLInputElement) return marked;
  return marked.querySelector("textarea, input");
}

/**
 * The composer of the chat the selection was made in. Paseo keeps every open
 * tab and split pane mounted, hidden with `display: none`, so the document's
 * first composer is often another chat's, invisible and unable to take focus.
 * The search widens from the selection outwards, one ancestor at a time, and
 * takes the first composer that is on screen.
 */
export function nearestComposer(from: Element | null): Field | null {
  for (let scope = from; scope; scope = scope.parentElement) {
    for (const marked of Array.from(scope.querySelectorAll(COMPOSER_SELECTOR))) {
      const field = fieldOf(marked);
      if (field && field.getClientRects().length > 0) return field;
    }
  }
  return null;
}

/**
 * Writes the snippet into the composer at the caret and reports whether it
 * landed.
 *
 * `insertText` is the first choice because it goes through the browser's own
 * editing path: the composer is an uncontrolled input that publishes its value
 * through React's change handler, and a real edit is what that handler listens
 * for. Assigning `.value` moves the pixels only, so the draft the host would
 * send stays behind — hence the native setter plus a bubbling `input` event as
 * the fallback, and a value check before either path claims success.
 */
export function insertIntoComposer(snippet: string, from: Element | null): boolean {
  const input = nearestComposer(from);
  if (!input) return false;

  const before = input.value;
  const start = input.selectionStart ?? before.length;
  const end = input.selectionEnd ?? start;
  const head = before.slice(0, start);
  // A quote needs a blank line above it or the previous paragraph absorbs it.
  const lead =
    head.length === 0 || head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
  const insert = lead + snippet;
  const next = head + insert + before.slice(end);
  const caret = head.length + insert.length;

  input.focus();
  input.setSelectionRange(start, end);
  if (document.execCommand("insertText", false, insert) && input.value === next) {
    input.setSelectionRange(caret, caret);
    return true;
  }

  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setValue) return false;

  setValue.call(input, next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  if (input.value !== next) return false;
  input.setSelectionRange(caret, caret);
  return true;
}

// The floating controls' family (float.ts): a rounded frame 30 tall lifted by
// a shadow, with toolbar-sized items, muted icons and a success check.
const BAR_CSS = `
:host { all: initial; }
.bar {
  display: flex;
  align-items: center;
  gap: ${FLOAT.inset}px;
  padding: ${FLOAT.inset}px;
  border-style: solid;
  border-width: 1px;
  border-radius: ${FLOAT.radius}px;
  box-shadow: var(--bc-bar-shadow);
  background-color: var(--bc-bar-bg);
  font-size: 12px;
  line-height: 16px;
  user-select: none;
  -webkit-user-select: none;
  opacity: 0;
  transform: translateY(var(--bc-bar-from, 4px));
  transition: opacity 140ms ${FLOAT_EASE.out}, transform 140ms ${FLOAT_EASE.out};
}
.bar.shown { opacity: 1; transform: none; }
.bar.leaving {
  opacity: 0;
  transform: translateY(var(--bc-bar-to, 2px));
  transition: opacity ${LEAVE_MS}ms ${FLOAT_EASE.in}, transform ${LEAVE_MS}ms ${FLOAT_EASE.in};
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: ${FLOAT.iconText}px;
  appearance: none;
  margin: 0;
  border: 0;
  background: transparent;
  color: var(--bc-bar-text);
  border-radius: ${FLOAT.itemRadius}px;
  cursor: pointer;
  font: inherit;
  font-weight: 500;
  height: ${FLOAT.item}px;
  padding: 0 10px 0 8px;
  white-space: nowrap;
  /* No shrinking: a squeezed button overlaps its neighbour's label. */
  flex: 0 0 auto;
  transition: background-color 100ms ${FLOAT_EASE.out};
}
.btn:hover { background-color: var(--bc-bar-hover); }
.btn:active { background-color: var(--bc-bar-pressed); }
.btn:focus { outline: none; }
.btn:focus-visible { box-shadow: 0 0 0 2px var(--bc-bar-ring); }
.btn svg {
  width: ${FLOAT.iconSize}px;
  height: ${FLOAT.iconSize}px;
  flex: 0 0 auto;
  fill: none;
  /* The icons stay muted, as on a preview toolbar; only the check is coloured. */
  color: var(--bc-bar-icon);
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.btn[data-done] svg { color: var(--bc-bar-done); }
@media (prefers-reduced-motion: reduce) {
  .bar, .bar.leaving, .btn { transition: none; }
}
`;

interface Bar {
  host: HTMLDivElement;
  setTheme(tokens: ExtendedThemeTokens): void;
  show(rect: DOMRect): void;
  hide(): void;
  dispose(): void;
}

/** `done` runs once a press has shown its result: the bar steps aside. */
function createBar(done: () => void): Bar {
  const host = document.createElement("div");
  host.setAttribute("data-bcselectionbar", "");
  // Host-app rules can match a bare `div`, so the placement properties are set
  // as important; everything else lives inside the shadow root.
  const placement: Array<[string, string]> = [
    ["position", "fixed"],
    ["top", "0"],
    ["left", "0"],
    ["z-index", "2147483000"],
    ["display", "none"],
    ["margin", "0"],
    ["padding", "0"],
    // A host rule for bare `div`s must not paint behind the rounded bar.
    ["background", "none"],
    // The popover UA rules: no border, no stretch to the far edges.
    ["border", "0"],
    ["right", "auto"],
    ["bottom", "auto"],
    ["overflow", "visible"],
  ];
  for (const [property, value] of placement) {
    host.style.setProperty(property, value, "important");
  }
  // A preview panel is a top-layer popover, above every z-index; the bar
  // joins the top layer too, after the panel, so it is drawn over it.
  const topLayer = typeof host.showPopover === "function";
  if (topLayer) host.setAttribute("popover", "manual");

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BAR_CSS;
  shadow.appendChild(style);

  const bar = document.createElement("div");
  bar.className = "bar";
  shadow.appendChild(bar);

  let doneTimer = 0;
  let leaveTimer = 0;

  /**
   * An icon and a label in the settings page's language, read on every paint
   * so a change there reaches a bar that is already up. The accessible name
   * stays the English label, as on every other plugin button.
   */
  const paint = (button: HTMLButtonElement, label: string, icon: IconName) => {
    const text = document.createElement("span");
    text.textContent = toolbarLabel(label, getEnhancerPreferences().language);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
    button.toggleAttribute("data-done", icon === "check");
    button.appendChild(text);
  };

  const makeButton = (label: string, icon: IconName, onPress: (button: HTMLButtonElement) => void) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.setAttribute("aria-label", label);
    button.dataset.label = label;
    button.dataset.icon = icon;
    paint(button, label, icon);
    button.addEventListener("click", () => onPress(button));
    bar.appendChild(button);
    return button;
  };

  const reset = () => {
    for (const button of [copyButton, addButton]) {
      paint(button, button.dataset.label ?? "", button.dataset.icon as IconName);
    }
  };

  // The check confirms the press, then the bar leaves; the labels come back
  // with the next selection.
  const flash = (button: HTMLButtonElement, label: string) => {
    paint(button, label, "check");
    window.clearTimeout(doneTimer);
    doneTimer = window.setTimeout(done, DONE_MS);
  };

  const copyButton = makeButton("Copy", "copy", (button) => {
    const snapshot = readSelection();
    if (!snapshot) return;
    void copyText(snapshot.text);
    flash(button, "Copied");
  });

  const addButton = makeButton("Add to chat", "add", (button) => {
    const snapshot = readSelection();
    if (!snapshot) return;
    if (insertIntoComposer(quote(snapshot), snapshot.element)) {
      flash(button, "Added");
      return;
    }
    // No composer on screen — the snippet still reaches the clipboard, and the
    // label says which of the two actions actually happened.
    void copyText(snapshot.text);
    flash(button, "Copied instead");
  });

  // The bar keeps the selection alive: a press inside it must not move the
  // caret, or `window.getSelection()` is empty by the time the click lands.
  const holdSelection = (event: MouseEvent) => event.preventDefault();
  bar.addEventListener("mousedown", holdSelection);

  document.body.appendChild(host);

  return {
    host,
    setTheme(tokens) {
      // The bar floats over text, so it needs the theme's one opaque surface;
      // the derived surfaces are translucent by design.
      host.style.setProperty("--bc-bar-bg", tokens.surface0);
      host.style.setProperty("--bc-bar-shadow", floatShadow(tokens));
      host.style.setProperty("--bc-bar-text", tokens.foreground);
      host.style.setProperty("--bc-bar-icon", tokens.foregroundMuted);
      host.style.setProperty("--bc-bar-done", tokens.success);
      host.style.setProperty("--bc-bar-hover", floatHover(tokens));
      host.style.setProperty("--bc-bar-pressed", floatPressed(tokens));
      host.style.setProperty("--bc-bar-ring", tokens.accent);
      bar.style.borderColor = tokens.v2.border;
      // The bar sits on document.body, outside the host's UI font rule, so
      // "Follow Paseo" reads the host's own font variable directly.
      bar.style.fontFamily = tokens.fontUi ?? "var(--paseo-ui-font, system-ui, sans-serif)";
    },
    show(rect) {
      window.clearTimeout(leaveTimer);
      const arriving = host.style.getPropertyValue("display") === "none" || bar.classList.contains("leaving");
      if (host.style.getPropertyValue("display") === "none") {
        window.clearTimeout(doneTimer);
        reset();
      }
      host.style.setProperty("display", "block", "important");
      if (topLayer && !host.matches(":popover-open")) host.showPopover();
      // Measure once visible, then clamp inside the viewport. Above the
      // selection by default: below it covers the next line of output.
      const width = bar.offsetWidth;
      const height = bar.offsetHeight;
      const left = Math.min(
        Math.max(GAP, rect.left + rect.width / 2 - width / 2),
        Math.max(GAP, window.innerWidth - width - GAP),
      );
      const above = rect.top - height - GAP;
      const top =
        above >= GAP ? above : Math.min(rect.bottom + GAP, window.innerHeight - height - GAP);
      host.style.setProperty("left", `${Math.round(left)}px`, "important");
      host.style.setProperty("top", `${Math.round(top)}px`, "important");
      // A bar already up moves with its selection at once; a new one rises 4
      // from the selection's side and fades in, and leaves 2 the other way.
      if (!arriving) return;
      const below = above < GAP;
      bar.style.setProperty("--bc-bar-from", below ? "-4px" : "4px");
      bar.style.setProperty("--bc-bar-to", below ? "-2px" : "2px");
      bar.classList.remove("leaving", "shown");
      void bar.offsetWidth;
      bar.classList.add("shown");
    },
    hide() {
      if (host.style.getPropertyValue("display") === "none" || bar.classList.contains("leaving")) return;
      bar.classList.add("leaving");
      bar.classList.remove("shown");
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      leaveTimer = window.setTimeout(() => {
        bar.classList.remove("leaving");
        host.style.setProperty("display", "none", "important");
        if (topLayer && host.matches(":popover-open")) host.hidePopover();
      }, reduced ? 0 : LEAVE_MS);
    },
    dispose() {
      window.clearTimeout(doneTimer);
      window.clearTimeout(leaveTimer);
      bar.removeEventListener("mousedown", holdSelection);
      host.remove();
    },
  };
}

interface Controller {
  bar: Bar;
  refs: number;
  dispose(): void;
}

let controller: Controller | null = null;

const LIVE_BAR = Symbol.for("better-paseo.selection-bar");

/**
 * Makes `next` the page's one live bar. A plugin update loads a new bundle
 * without unmounting the old one's renderers, so every bundle would keep its
 * own bar, all shown on one selection and their shadows stacked into a dark,
 * soft edge. The newest bundle's bar retires the one before it. The returned
 * release clears the slot only while `next` still holds it.
 */
export function claimSelectionBar(next: { dispose(): void }, scope: object = globalThis): () => void {
  const slot = scope as { [LIVE_BAR]?: { dispose(): void } };
  const previous = slot[LIVE_BAR];
  if (previous && previous !== next) previous.dispose();
  slot[LIVE_BAR] = next;
  return () => {
    if (slot[LIVE_BAR] === next) delete slot[LIVE_BAR];
  };
}

function startController(): Controller {
  // Set after an action or scroll, until the selection changes: keep the
  // highlight without letting a queued update bring the bar back over it.
  let dismissed = false;
  const bar = createBar(() => {
    dismissed = true;
    bar.hide();
  });
  let pending = 0;

  const sync = () => {
    pending = 0;
    const snapshot = dismissed ? null : readSelection();
    if (!snapshot) {
      bar.hide();
      return;
    }
    bar.show(snapshot.rect);
  };

  // Selection events fire per character during a drag, so they coalesce to the
  // next tick. A timer rather than a frame: an occluded or backgrounded window
  // never runs `requestAnimationFrame`, and the bar would be stuck.
  const schedule = () => {
    if (pending !== 0) return;
    pending = window.setTimeout(sync, 0);
  };

  const onPointerDown = (event: Event) => {
    const target = event.target;
    // Events from inside the shadow root are retargeted to the host, so a press
    // on a button reads as a press on the bar and leaves it open.
    if (target instanceof Node && bar.host.contains(target)) return;
    bar.hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") bar.hide();
  };

  const onSelectionChange = () => {
    dismissed = false;
    schedule();
  };
  const onScroll = () => {
    dismissed = true;
    bar.hide();
  };

  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  // The top-layer bar escapes a preview's clipping boundary. Dismiss it on
  // scroll rather than following a selection outside its visible container.
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", schedule);

  const started: Controller = {
    bar,
    refs: 0,
    dispose() {
      release();
      window.clearTimeout(pending);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
      bar.dispose();
    },
  };
  const release = claimSelectionBar(started);
  return started;
}

/**
 * Keeps one bar alive for as long as at least one enhanced callout is mounted,
 * and feeds it the live theme. Call it from every renderer: the bar is shared,
 * so the calls are reference counts rather than instances.
 */
export function useSelectionActions(tokens: ExtendedThemeTokens, enabled: boolean): void {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined" || !enabled) return;
    const active = controller ?? (controller = startController());
    active.refs += 1;
    return () => {
      active.refs -= 1;
      if (active.refs > 0) return;
      active.dispose();
      if (controller === active) controller = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    controller?.bar.setTheme(tokens);
  }, [tokens, enabled]);
}
