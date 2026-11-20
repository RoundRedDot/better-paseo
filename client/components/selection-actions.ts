import { useEffect } from "react";
import { Platform } from "react-native";
import type { TextProps, ViewProps } from "react-native";
import { copyText } from "@getpaseo/plugin/client/ui";
import { radiusV2 } from "./theme-tokens";
import type { ExtendedThemeTokens } from "./theme-tokens";
import { FLOAT, FLOAT_EASE, floatHover, floatPressed } from "../ui/tokens/float";
import { CARD_RADIUS, CARD_SHADOW } from "../ui/tokens/card";
import { getEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import { translationSettingsSync } from "../translation/settings-store";
import { translationAgentConfigStoreFor } from "../translation/store";
import {
  SELECTION_SCOPE_ATTRIBUTES,
  createSelectionTranslation,
  selectionScopeForElement,
  watchSelectionScopeElements,
  selectionViewMessage,
  selectionViewRetryable,
  selectionViewText,
  type SelectionTranslation,
  type SelectionTranslationScopeValue,
  type SelectionTranslationView,
} from "../translation/selection";
import { selectionViewTitle } from "../translation/view-text";
import { openTranslationSettings } from "../translation/navigation";
import { markId, normalizeProvider } from "./provider-logo";
import { MONO_MARKS, readMark, requestMark, subscribeMarks } from "./marks";
import { SYNCED_LOADER_FRAMES } from "../ui/synced-loader";

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
 * In a reply or a thought the bar also offers Translate, for exactly the
 * selected text. Its result opens in a panel under the buttons, bounded to the
 * viewport. It stays open if the source scrolls or is replaced; a new
 * selection never shows the previous one's result.
 *
 * Web only. iOS and Android route selection through the platform's own menu,
 * which a plugin cannot extend; `selectable` text there already offers Copy,
 * and a double-tapped block has its own menu (`block-selection.tsx`).
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
/** A translatable surface carries its conversation (`selectionScopeDataSet`). */
const SCOPE_SELECTOR = `[data-${SELECTION_SCOPE_ATTRIBUTES.agent}]`;
/** The widest the translation panel grows, and its body's tallest. */
const PANEL_WIDTH = 420;
const PANEL_BODY_MAX = 360;
const PANEL_BODY_MIN = 48;
/** How long Copy translation shows its check. */
const COPIED_MS = 1200;

const GAP = 8;
/** How long a pressed button shows its check before the bar steps aside. */
const DONE_MS = 700;
/** The bar's fade out, after which it leaves the page. */
const LEAVE_MS = 100;

/** Lucide's shapes, the set the plugin's `Icon` draws, inlined: the bar is raw DOM. */
const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  retry: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  add: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  translate: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
} as const;
type IconName = keyof typeof ICONS;

interface Snapshot {
  text: string;
  isCode: boolean;
  rect: DOMRect;
  /** The element the selection sits in, to find its own chat's composer. */
  element: Element | null;
  /** The plugin surface holding both ends of the selection. */
  surface: Element;
  /** The reply or thought it belongs to; null where Translate is not offered. */
  scope: SelectionTranslationScopeValue | null;
}

/** The scope bound to the Markdown root holding the surface; attributes alone never route a request. */
function scopeOf(surface: Element): SelectionTranslationScopeValue | null {
  const marked = surface.closest(SCOPE_SELECTOR);
  return marked ? selectionScopeForElement(marked) : null;
}

/** The same text in the same surface of the same conversation. */
function sameSelection(a: Snapshot, b: Snapshot): boolean {
  return a.text === b.text && a.surface === b.surface &&
    a.scope?.agentId === b.scope?.agentId && a.scope?.kind === b.scope?.kind;
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
  return { text, isCode, rect, element, surface: anchor, scope: scopeOf(anchor) };
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

// The floating controls' sizing and motion, with the task card's corners and shadow.
const BAR_CSS = `
:host { all: initial; }
.bar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  box-sizing: border-box;
  padding: ${FLOAT.inset}px;
  border-style: solid;
  border-width: 1px;
  border-radius: ${CARD_RADIUS}px;
  box-shadow: var(--bc-bar-shadow);
  background-color: var(--bc-bar-bg);
  font-size: 12px;
  line-height: 16px;
  user-select: none;
  -webkit-user-select: none;
  opacity: 0;
  transform: translateY(var(--bc-bar-from, 4px));
  transition: opacity 140ms ${FLOAT_EASE.out}, transform 140ms ${FLOAT_EASE.out}, box-shadow 140ms ${FLOAT_EASE.out};
}
@media (hover: hover) { .bar:hover { box-shadow: var(--bc-bar-shadow-hover); } }
.row {
  display: flex;
  align-items: center;
  gap: ${FLOAT.inset}px;
}
.row-separator { width: 0.5px; height: 16px; flex: 0 0 auto; background-color: var(--bc-bar-border); }
.drag-handle { display: none; flex: 1 1 auto; min-width: 24px; align-self: stretch; cursor: move; }
.bar.translating .drag-handle { display: block; }
.resize-handle { display: none; position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none; }
.resize-handle::after { content: ""; position: absolute; right: 4px; bottom: 4px; width: 6px; height: 6px; border-right: 1px solid var(--bc-bar-icon); border-bottom: 1px solid var(--bc-bar-icon); opacity: 0.6; }
.bar.translating .resize-handle { display: block; }
.bar.translating { width: var(--bc-panel-width); }
.panel {
  display: none;
  flex-direction: column;
  gap: 6px;
  margin-top: ${FLOAT.inset}px;
  padding: 8px 8px 4px;
  border-top: 0.5px solid var(--bc-bar-border);
}
.bar.translating .panel { display: flex; }
.panel-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--bc-bar-subtle);
  font-weight: 500;
  min-height: 20px;
  font-size: 11px;
  line-height: 14px;
}
.panel-head svg {
  width: 11px;
  height: 11px;
  flex: 0 0 auto;
  fill: none;
  color: inherit;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.panel-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .panel-settings { margin-left: auto; padding: 0; width: 28px; height: 28px; justify-content: center; }
.panel-model { display: flex; align-items: center; gap: 5px; min-width: 0; }
.panel-model img, .panel-model .model-mark { width: 11px; height: 11px; flex: 0 0 auto; }
.panel-model span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.activity-grid { display: grid; grid-template-columns: repeat(2, ${10 / 3}px); grid-template-rows: repeat(3, ${10 / 3}px); gap: 2px; width: ${26 / 3}px; height: 14px; flex: 0 0 auto; }
.activity-dot { width: ${10 / 3}px; height: ${10 / 3}px; border-radius: 50%; background: var(--bc-bar-text); animation-duration: 950ms; animation-timing-function: steps(1, end); animation-iteration-count: infinite; animation-delay: var(--bc-loader-phase); }
${SYNCED_LOADER_FRAMES[0].map((opacity, index) => `.activity-dot:nth-child(${index + 1}) { opacity: ${opacity}; animation-name: bc-dot-${index}; } @keyframes bc-dot-${index} { ${SYNCED_LOADER_FRAMES.map((frame, step) => `${step * 100 / 6}% { opacity: ${frame[index]}; }`).join(" ")} 100% { opacity: ${opacity}; } }`).join("\n")}
.panel-message { display: flex; align-items: center; gap: 6px; color: var(--bc-bar-icon); white-space: pre-wrap; overflow-wrap: anywhere; }
.panel-message span:last-child { min-width: 0; }
.panel-message[data-tone="error"] { color: var(--bc-bar-danger); }
.panel-body {
  color: var(--bc-bar-text);
  font-size: 13px;
  line-height: 19px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: auto;
  height: var(--bc-panel-height, auto);
  overscroll-behavior: contain;
  padding-right: 16px;
  max-height: var(--bc-panel-max, ${PANEL_BODY_MAX}px);
}
.panel-actions { display: flex; justify-content: flex-end; gap: ${FLOAT.inset}px; }
.panel-actions .btn { position: relative; width: 28px; height: 28px; padding: 0; justify-content: center; }
.panel-actions .btn span { display: none; }
.panel-actions .btn::after {
  content: attr(data-tip); position: absolute; bottom: calc(100% + 4px); right: 0; z-index: 1;
  padding: 4px 6px; border: 0.5px solid var(--bc-bar-border); border-radius: 4px;
  background: var(--bc-bar-bg); color: var(--bc-bar-text); box-shadow: var(--bc-bar-shadow);
  font-size: 11.5px; line-height: 16px; white-space: nowrap; pointer-events: none;
  visibility: hidden; opacity: 0;
}
.panel-actions .btn:hover::after, .panel-actions .btn:focus-visible::after { visibility: visible; opacity: 1; }
.panel [hidden], .row [hidden] { display: none; }
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
.row .btn { border-radius: ${CARD_RADIUS - FLOAT.inset - 1}px; }
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
  .activity-dot { animation: none; }
}
`;

interface Bar {
  host: HTMLDivElement;
  setTheme(tokens: ExtendedThemeTokens): void;
  show(rect: DOMRect): void;
  hide(): void;
  /** Shows Translate for a scoped selection, hides it elsewhere. */
  setTranslatable(translatable: boolean): void;
  /** The translation panel's content; null closes it. */
  setPanel(view: SelectionTranslationView | null): void;
  pin(): void;
  reposition(): void;
  dispose(): void;
}

interface BarActions {
  /** A press has shown its result: the bar steps aside. */
  done(): void;
  translate(): void;
  retry(): void;
  settings(): void;
  snapshot(): Snapshot | null;
}

function readLanguage() {
  return getEnhancerPreferences().language;
}

function createBar(actions: BarActions): Bar {
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
  const row = document.createElement("div");
  row.className = "row";
  bar.appendChild(row);
  const panel = document.createElement("div");
  panel.className = "panel";
  bar.appendChild(panel);

  let doneTimer = 0;
  let leaveTimer = 0;
  let copiedTimer = 0;
  /** The selection the bar sits by, to place it again when the panel changes. */
  let anchor: DOMRect | null = null;
  let view: SelectionTranslationView | null = null;
  let geometry: { left: number; top: number; width: number; bodyHeight: number } | null = null;
  let endGesture: (() => void) | null = null;
  let resized = false;

  /**
   * An icon and a label in the settings page's language, read on every paint
   * so a change there reaches a bar that is already up. The accessible name
   * stays the English label, as on every other plugin button.
   */
  const paint = (button: HTMLButtonElement, label: string, icon: IconName) => {
    const text = document.createElement("span");
    text.textContent = toolbarLabel(label, readLanguage());
    button.dataset.tip = text.textContent;
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>`;
    button.toggleAttribute("data-done", icon === "check");
    button.appendChild(text);
  };

  const makeButton = (
    parent: HTMLElement,
    label: string,
    icon: IconName,
    onPress: (button: HTMLButtonElement) => void,
  ) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.setAttribute("aria-label", label);
    button.dataset.label = label;
    button.dataset.icon = icon;
    paint(button, label, icon);
    button.addEventListener("click", () => onPress(button));
    parent.appendChild(button);
    return button;
  };

  const reset = () => {
    for (const button of [copyButton, addButton, translateButton]) {
      paint(button, button.dataset.label ?? "", button.dataset.icon as IconName);
    }
  };

  // The check confirms the press, then the bar leaves; the labels come back
  // with the next selection.
  const flash = (button: HTMLButtonElement, label: string) => {
    paint(button, label, "check");
    window.clearTimeout(doneTimer);
    doneTimer = window.setTimeout(actions.done, DONE_MS);
  };

  const copyButton = makeButton(row, "Copy", "copy", (button) => {
    const snapshot = actions.snapshot();
    if (!snapshot) return;
    void copyText(snapshot.text);
    flash(button, "Copied");
  });

  const copySeparator = document.createElement("div");
  copySeparator.className = "row-separator";
  copySeparator.setAttribute("aria-hidden", "true");
  row.appendChild(copySeparator);

  const addButton = makeButton(row, "Add to chat", "add", (button) => {
    const snapshot = actions.snapshot();
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

  const separator = document.createElement("div");
  separator.className = "row-separator";
  separator.setAttribute("aria-hidden", "true");
  separator.hidden = true;
  row.appendChild(separator);
  const translateButton = makeButton(row, "Translate", "translate", () => actions.translate());
  translateButton.hidden = true;
  const dragHandle = document.createElement("div");
  dragHandle.className = "drag-handle";
  dragHandle.setAttribute("aria-hidden", "true");
  row.appendChild(dragHandle);
  const settingsButton = makeButton(row, "Translation settings", "settings", () => actions.settings());
  settingsButton.className += " panel-settings";
  settingsButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.settings}</svg>`;
  settingsButton.hidden = true;
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "resize-handle";
  resizeHandle.setAttribute("aria-hidden", "true");
  bar.appendChild(resizeHandle);

  const beginGesture = (event: PointerEvent, resize: boolean) => {
    if (!view || event.button !== 0) return;
    event.preventDefault();
    const body = panel.querySelector<HTMLElement>(".panel-body");
    const start = { x: event.clientX, y: event.clientY,
      left: parseFloat(host.style.getPropertyValue("left")), top: parseFloat(host.style.getPropertyValue("top")),
      width: bar.offsetWidth, bodyHeight: body?.offsetHeight ?? PANEL_BODY_MAX };
    const move = (next: PointerEvent) => {
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      const width = resize ? Math.min(Math.max(360, start.width + dx), window.innerWidth - start.left - GAP) : start.width;
      const bodyHeight = resize ? Math.min(Math.max(PANEL_BODY_MIN, start.bodyHeight + dy), window.innerHeight - start.top - GAP - (bar.offsetHeight - (body?.offsetHeight ?? 0))) : start.bodyHeight;
      geometry = { left: resize ? start.left : Math.max(GAP, Math.min(start.left + dx, window.innerWidth - bar.offsetWidth - GAP)),
        top: resize ? start.top : Math.max(GAP, Math.min(start.top + dy, window.innerHeight - bar.offsetHeight - GAP)), width, bodyHeight };
      host.style.setProperty("left", `${Math.round(geometry.left)}px`, "important");
      host.style.setProperty("top", `${Math.round(geometry.top)}px`, "important");
      bar.style.setProperty("--bc-panel-width", `${Math.round(width)}px`);
      if (resize) {
        resized = true;
        bar.style.setProperty("--bc-panel-height", `${Math.round(bodyHeight)}px`);
        bar.style.setProperty("--bc-panel-max", `${Math.round(bodyHeight)}px`);
      }
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); endGesture = null; };
    endGesture?.();
    endGesture = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  dragHandle.addEventListener("pointerdown", (event) => beginGesture(event, false));
  resizeHandle.addEventListener("pointerdown", (event) => beginGesture(event, true));

  // The bar keeps the selection alive: a press inside it must not move the
  // caret, or `window.getSelection()` is empty by the time the click lands.
  const holdSelection = (event: MouseEvent) => event.preventDefault();
  bar.addEventListener("mousedown", holdSelection);

  document.body.appendChild(host);

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = document.createElement(tag);
    node.className = className;
    // Text only: a translation is model output and never becomes markup.
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** Rebuilds the panel for `view`; the translation goes in as text, never as HTML. */
  const renderPanel = () => {
    panel.replaceChildren();
    if (!view) return;
    const language = readLanguage();
    const lang = resolveLanguage(language ?? "system");
    const head = element("div", "panel-head");
    head.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.translate}</svg>`;
    head.appendChild(element("span", "panel-title", selectionViewTitle(view, lang)));
    if (view.modelInfo) {
      const model = element("div", "panel-model");
      const id = markId(normalizeProvider(view.modelInfo.provider));
      const uri = readMark(id);
      if (id && uri === undefined) requestMark(id);
      if (uri) {
        if (id && MONO_MARKS.has(id)) {
          const mark = element("div", "model-mark");
          mark.style.backgroundColor = "var(--bc-bar-subtle)";
          mark.style.mask = `url("${uri}") center / contain no-repeat`;
          model.appendChild(mark);
        } else {
          const image = element("img", "model-mark");
          image.src = uri;
          image.alt = "";
          model.appendChild(image);
        }
      }
      model.appendChild(element("span", "model-label", view.modelInfo.model));
      head.appendChild(model);
    }
    panel.appendChild(head);

    const message = selectionViewMessage(view);
    if (message) {
      const line = element("div", "panel-message");
      if (view.status === "running" || view.status === "config-loading" || view.status === "settings-loading") {
        const grid = element("span", "activity-grid");
        grid.setAttribute("aria-hidden", "true");
        grid.style.setProperty("--bc-loader-phase", `${-(Date.now() % 950)}ms`);
        for (let index = 0; index < 6; index += 1) grid.appendChild(element("span", "activity-dot"));
        line.appendChild(grid);
      }
      line.appendChild(element("span", "", toolbarLabel(message, language) + (view.status === "error" ? `: ${view.error}` : "")));
      line.setAttribute("role", view.status === "error" ? "alert" : "status");
      if (view.status === "error") line.dataset.tone = "error";
      panel.appendChild(line);
    }
    const text = selectionViewText(view);
    if (text) panel.appendChild(element("div", "panel-body", text));

    const done = view.status === "done" ? view.result.translation : null;
    if (done !== null || selectionViewRetryable(view)) {
      const buttons = element("div", "panel-actions");
      if (done !== null) {
        makeButton(buttons, "Copy translation", "copy", (button) => {
          void copyText(done);
          paint(button, "Copied", "check");
          window.clearTimeout(copiedTimer);
          copiedTimer = window.setTimeout(() => paint(button, "Copy translation", "copy"), COPIED_MS);
        });
      }
      if (selectionViewRetryable(view)) {
        const retry = makeButton(buttons, "Retry", "retry", () => actions.retry());
        retry.dataset.action = "retry";
      }
      panel.appendChild(buttons);
    }
  };

  const place = (rect: DOMRect, arriving: boolean) => {
    const translating = view !== null;
    if (translating) bar.classList.add("translating");
    else bar.classList.remove("translating");
    if (translating) {
      bar.style.setProperty("--bc-panel-width", `${Math.max(0, Math.min(geometry?.width ?? PANEL_WIDTH, window.innerWidth - GAP * 2))}px`);
      const body = panel.querySelector<HTMLElement>(".panel-body");
      if (body) {
        // The body scrolls inside whatever height the viewport leaves.
        bar.style.setProperty("--bc-panel-max", `${PANEL_BODY_MAX}px`);
        const chrome = bar.offsetHeight - body.offsetHeight;
        const room = window.innerHeight - GAP * 2 - chrome;
        bar.style.setProperty("--bc-panel-max", `${Math.round(Math.max(PANEL_BODY_MIN, Math.min(resized ? geometry!.bodyHeight : PANEL_BODY_MAX, room)))}px`);
      }
    }
    // Measure once visible, then clamp inside the viewport. Above the
    // selection by default: below it covers the next line of output.
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    const left = Math.min(
      Math.max(GAP, rect.left + rect.width / 2 - width / 2),
      Math.max(GAP, window.innerWidth - width - GAP),
    );
    const above = rect.top - height - GAP;
    const top = above >= GAP
      ? above
      : Math.max(GAP, Math.min(rect.bottom + GAP, window.innerHeight - height - GAP));
    host.style.setProperty("left", `${Math.round(geometry ? Math.max(GAP, Math.min(geometry.left, window.innerWidth - width - GAP)) : left)}px`, "important");
    host.style.setProperty("top", `${Math.round(geometry ? Math.max(GAP, Math.min(geometry.top, window.innerHeight - height - GAP)) : top)}px`, "important");
    // A bar already up moves with its selection at once; a new one rises 4
    // from the selection's side and fades in, and leaves 2 the other way.
    if (!arriving) return;
    const below = above < GAP;
    bar.style.setProperty("--bc-bar-from", below ? "-4px" : "4px");
    bar.style.setProperty("--bc-bar-to", below ? "-2px" : "2px");
    bar.classList.remove("leaving", "shown");
    void bar.offsetWidth;
    bar.classList.add("shown");
  };

  const hidden = () => host.style.getPropertyValue("display") === "none";
  const unsubscribeMarks = subscribeMarks(() => { if (view?.modelInfo) renderPanel(); });

  return {
    host,
    setTheme(tokens) {
      // The bar floats over text, so it needs the theme's one opaque surface;
      // the derived surfaces are translucent by design.
      host.style.setProperty("--bc-bar-bg", tokens.surface0);
      host.style.setProperty("--bc-bar-shadow", CARD_SHADOW[tokens.isDark ? "dark" : "light"].rest);
      host.style.setProperty("--bc-bar-shadow-hover", CARD_SHADOW[tokens.isDark ? "dark" : "light"].hover);
      host.style.setProperty("--bc-bar-text", tokens.foreground);
      host.style.setProperty("--bc-bar-icon", tokens.foregroundMuted);
      host.style.setProperty("--bc-bar-subtle", tokens.foregroundSubtle);
      host.style.setProperty("--bc-bar-done", tokens.success);
      host.style.setProperty("--bc-bar-hover", floatHover(tokens));
      host.style.setProperty("--bc-bar-pressed", floatPressed(tokens));
      host.style.setProperty("--bc-bar-ring", tokens.accent);
      host.style.setProperty("--bc-bar-accent", tokens.accent);
      host.style.setProperty("--bc-bar-border", tokens.v2.border);
      host.style.setProperty("--bc-bar-danger", tokens.danger);
      bar.style.borderColor = tokens.v2.border;
      // The bar sits on document.body, outside the host's UI font rule, so
      // "Follow Paseo" reads the host's own font variable directly.
      bar.style.fontFamily = tokens.fontUi ?? "var(--paseo-ui-font, system-ui, sans-serif)";
    },
    show(rect) {
      window.clearTimeout(leaveTimer);
      const arriving = hidden() || bar.classList.contains("leaving");
      if (hidden()) {
        window.clearTimeout(doneTimer);
        reset();
      }
      host.style.setProperty("display", "block", "important");
      if (topLayer && !host.matches(":popover-open")) host.showPopover();
      anchor = rect;
      place(rect, arriving);
    },
    hide() {
      if (hidden() || bar.classList.contains("leaving")) return;
      endGesture?.();
      bar.classList.add("leaving");
      bar.classList.remove("shown");
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      leaveTimer = window.setTimeout(() => {
        bar.classList.remove("leaving");
        host.style.setProperty("display", "none", "important");
        if (topLayer && host.matches(":popover-open")) host.hidePopover();
        anchor = null;
        geometry = null;
        resized = false;
        bar.style.setProperty("--bc-panel-height", "");
        // The panel fades out with the bar, then goes.
        if (view) {
          view = null;
          settingsButton.hidden = true;
          renderPanel();
          bar.classList.remove("translating");
        }
      }, reduced ? 0 : LEAVE_MS);
    },
    setTranslatable(translatable) {
      translateButton.hidden = !translatable;
      separator.hidden = !translatable;
    },
    setPanel(next) {
      if (next === view) return;
      view = next;
      if (!next) geometry = null;
      settingsButton.hidden = !next;
      settingsButton.title = toolbarLabel("Translation settings", readLanguage());
      window.clearTimeout(copiedTimer);
      renderPanel();
      if (anchor && !hidden() && !bar.classList.contains("leaving")) place(anchor, false);
    },
    pin() {
      geometry = {
        left: parseFloat(host.style.getPropertyValue("left")),
        top: parseFloat(host.style.getPropertyValue("top")),
        width: parseFloat(bar.style.getPropertyValue("--bc-panel-width")),
        bodyHeight: PANEL_BODY_MAX,
      };
    },
    reposition() {
      if (anchor && !hidden()) place(anchor, false);
    },
    dispose() {
      endGesture?.();
      window.clearTimeout(doneTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(copiedTimer);
      unsubscribeMarks();
      bar.removeEventListener("mousedown", holdSelection);
      host.remove();
    },
  };
}

interface Controller {
  bar: Bar;
  refs: number;
  hasTranslation(): boolean;
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

/** Hides Translate only where the settings say it is off; any other state explains itself in the panel. */
function translationOffered(): boolean {
  const settings = translationSettingsSync.snapshot();
  return !(settings.status === "ready" && !settings.values.enabled);
}

function startController(): Controller {
  // Set after an action or scroll, until the selection changes: keep the
  // highlight without letting a queued update bring the bar back over it.
  let dismissed = false;
  /** The selection Translate was pressed for, and its job. */
  let translation: { snapshot: Snapshot; job: SelectionTranslation; release(): void } | null = null;

  const endTranslation = (clearPanel: boolean) => {
    if (!translation) return;
    translation.release();
    translation.job.dispose();
    translation = null;
    if (clearPanel) bar.setPanel(null);
  };
  // The panel leaves with the bar, whichever path closes it.
  const hide = () => {
    endTranslation(false);
    bar.hide();
    if (started.refs === 0) started.dispose();
  };

  const translate = () => {
    const snapshot = readSelection();
    if (!snapshot?.scope) return;
    // A second press on the same selection keeps its panel; Retry re-runs.
    if (translation && sameSelection(translation.snapshot, snapshot)) return;
    endTranslation(true);
    const { agentId, kind, streaming, lent } = snapshot.scope;
    const job = createSelectionTranslation({
      agentId,
      kind,
      text: snapshot.text,
      streaming,
      translator: lent?.translator,
      configStore: lent ? translationAgentConfigStoreFor(lent.paseo) : undefined,
      host: lent?.paseo,
    });
    const release = job.subscribe(() => {
      if (translation?.job === job) bar.setPanel(job.view());
    });
    translation = { snapshot, job, release };
    job.start();
    bar.setPanel(job.view());
    bar.pin();
  };

  const bar = createBar({
    done() {
      dismissed = true;
      hide();
    },
    translate,
    retry() {
      translation?.job.start();
    },
    settings() {
      const paseo = translation?.snapshot.scope?.lent?.paseo;
      dismissed = true;
      hide();
      openTranslationSettings(paseo);
    },
    snapshot() {
      return translation?.snapshot ?? readSelection();
    },
  });
  let pending = 0;

  const sync = () => {
    pending = 0;
    const snapshot = dismissed ? null : readSelection();
    if (!snapshot) {
      if (translation) return;
      hide();
      return;
    }
    // Another selection never shows this one's result; its job keeps running
    // into the session cache under its own key.
    if (translation && !sameSelection(translation.snapshot, snapshot)) endTranslation(true);
    if (translation && snapshot.scope) {
      translation.job.setStreaming(snapshot.scope.streaming);
      return;
    }
    bar.setTranslatable(snapshot.scope !== null && translationOffered());
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
    hide();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };

  const onSelectionChange = () => {
    dismissed = false;
    schedule();
  };
  // Scrolling inside the panel does not reach here: scroll events do not
  // cross the shadow root.
  const onScroll = () => {
    if (translation) return;
    dismissed = true;
    hide();
  };
  const onResize = () => {
    if (translation) bar.reposition();
    else schedule();
  };

  // The translated reply settling rebinds its element, with no selection event.
  // A cleared binding (the first half of a rebind, or an unmount) changes nothing.
  const stopScopeWatch = watchSelectionScopeElements((element, scope) => {
    if (!translation || !scope || translation.snapshot.surface.closest(SCOPE_SELECTOR) !== element) return;
    translation.job.setStreaming(scope.streaming);
  });

  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  // Dismiss the selection bar on scroll; an open translation stays in place.
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  const started: Controller = {
    bar,
    refs: 0,
    hasTranslation: () => translation !== null,
    dispose() {
      release();
      stopScopeWatch();
      endTranslation(false);
      window.clearTimeout(pending);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      bar.dispose();
      if (controller === started) controller = null;
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
      if (active.hasTranslation()) return;
      active.dispose();
      if (controller === active) controller = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    controller?.bar.setTheme(tokens);
  }, [tokens, enabled]);
}
