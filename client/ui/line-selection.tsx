import React, { useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type ViewProps } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { FLOAT, floatPressed } from "./tokens/float";
import { unselectable } from "../components/selection";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { useCopy } from "./use-copy";
import { PreviewScrollerContext } from "./preview-scroller";

const HOLD_MS = 400;
const MOVE_SLOP = 8;
/** A frame's scroll for a finger just past the body's edge, and at most. */
const EDGE_STEP = 2;
const MAX_EDGE_STEP = 24;
/** The phone menu's height, fixed so it can be placed before it lays out. */
const MENU_HEIGHT = 40;
const MENU_GAP = 6;

export interface LineRange { from: number; to: number }

/**
 * The text's character offset as a DOM point. The text is the lines joined by
 * `\n`, split across the runs a highlighter made; `measureWebTops` walks the
 * same nodes. A start prefers the next node, an end the previous one, so a
 * range never begins or ends on a newline run it does not cover.
 */
function domPoint(root: HTMLElement, offset: number, start: boolean): { node: Node; offset: number } | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.nodeValue?.length ?? 0;
    if (start ? offset < seen + length : offset <= seen + length) return { node, offset: offset - seen };
    seen += length;
    last = node;
  }
  return last ? { node: last, offset: last.nodeValue?.length ?? 0 } : null;
}

/**
 * Makes whole source lines the page's own selection, so they look, copy and
 * offer the selection bar (Copy / Add to chat) and the context menu exactly as
 * a drag across the text does. The anchor stays on the line the drag began.
 */
function selectDomLines(root: HTMLElement, lines: readonly string[], range: LineRange, reversed: boolean): void {
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection) return;
  let from = 0;
  for (let index = 0; index < range.from; index++) from += lines[index]!.length + 1;
  const to = from + lines.slice(range.from, range.to + 1).join("\n").length;
  const start = domPoint(root, from, true);
  const end = domPoint(root, to, false);
  if (!start || !end) return;
  const [anchor, focus] = reversed ? [end, start] : [start, end];
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

interface Gesture {
  /** The line the gesture began on. */
  anchor: number;
  /** Where it began, in the gutter and on the page. */
  y: number;
  pageY: number;
  /** The finger's travel since. */
  delta: number;
  active: boolean;
  /** The body's scroll when the gesture began. */
  offset: number;
  /** The gutter's and the body's place on screen, once measured. */
  gutterTop?: number;
  viewport?: { top: number; height: number };
}

/**
 * Gutter gestures select source lines, independent of wrapping or displayed
 * diff numbers. Web hands the lines to the page's selection; iOS and Android
 * cannot set a native selection from a plugin, so they draw the range and
 * offer their own Copy. There a held drag keeps the body still, and scrolls
 * it only while the finger is past the body's top or bottom edge.
 */
export function useLineSelection({ enabled, lines, tops, bottom, contentRef }: {
  enabled: boolean;
  lines: readonly string[];
  tops: readonly number[];
  bottom: number;
  /** The view holding the text, whose DOM text is `lines` joined by `\n`. */
  contentRef: RefObject<View | null>;
}) {
  const web = Platform.OS === "web";
  const scroller = useContext(PreviewScrollerContext);
  const [range, setRange] = useState<LineRange | null>(null);
  const [menu, setMenu] = useState(false);
  const gutterRef = useRef<View>(null);
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const holding = useRef(false);
  const latest = useRef({ tops, lines, scroller });
  latest.current = { tops, lines, scroller };
  const stopTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (holding.current) latest.current.scroller?.hold(false);
    holding.current = false;
  };
  const dismiss = () => { setRange(null); setMenu(false); };
  const cancel = () => { stopTimer(); gesture.current = null; dismiss(); };
  const lineAt = (y: number) => {
    const positions = latest.current.tops;
    let index = 0;
    while (index + 1 < positions.length && y >= positions[index + 1]!) index++;
    return index;
  };
  const select = (y: number) => {
    const current = gesture.current;
    if (!current?.active) return;
    const focus = lineAt(y);
    const next = { from: Math.min(current.anchor, focus), to: Math.max(current.anchor, focus) };
    setRange(next);
    const root = contentRef.current as unknown as HTMLElement | null;
    if (web && root?.ownerDocument) selectDomLines(root, latest.current.lines, next, focus < current.anchor);
  };
  /** The finger's line, counting what the body has scrolled under it. */
  const track = (current: Gesture) => {
    const scrolled = (latest.current.scroller?.offset() ?? current.offset) - current.offset;
    select(current.y + current.delta + scrolled);
  };
  /** How far past the body's edge the finger is, signed; 0 inside it. */
  const overshoot = (current: Gesture) => {
    if (current.gutterTop === undefined || !current.viewport) return 0;
    const at = current.gutterTop + current.y + current.delta;
    const { top, height } = current.viewport;
    return at < top ? at - top : at > top + height ? at - top - height : 0;
  };
  // Each frame the finger stays out, the body scrolls on, faster the further
  // out it is, and the range follows the lines that pass under it.
  const follow = () => {
    if (frame.current !== null) return;
    const tick = () => {
      frame.current = null;
      const current = gesture.current;
      const over = current?.active ? overshoot(current) : 0;
      if (!current || over === 0) return;
      const step = Math.sign(over) * Math.min(MAX_EDGE_STEP, EDGE_STEP + Math.abs(over) / 4);
      if (!latest.current.scroller?.scrollBy(step)) return;
      track(current);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const begin = (y: number, pageY: number, touch: boolean) => {
    stopTimer();
    dismiss();
    const current: Gesture = { anchor: lineAt(y), y, pageY, delta: 0, active: !touch, offset: 0 };
    gesture.current = current;
    const body = web ? null : latest.current.scroller;
    if (body) {
      current.offset = body.offset();
      (gutterRef.current as { measure?: View["measure"] } | null)?.measure?.((_x, _y, _width, _height, _pageX, top) => {
        current.gutterTop = top;
      });
      body.measure((top, height) => { current.viewport = { top, height }; });
    }
    if (touch) {
      timer.current = setTimeout(() => {
        timer.current = null;
        if (gesture.current !== current) return;
        current.active = true;
        if (body) {
          holding.current = true;
          body.hold(true);
        }
        select(y);
      }, HOLD_MS);
    } else select(y);
  };
  const move = (pageY: number) => {
    const current = gesture.current;
    if (!current) return;
    current.delta = pageY - current.pageY;
    if (!current.active && Math.abs(current.delta) > MOVE_SLOP) {
      stopTimer();
      gesture.current = null;
      return;
    }
    track(current);
    if (current.active && overshoot(current) !== 0) follow();
  };
  const finish = () => {
    stopTimer();
    const current = gesture.current;
    gesture.current = null;
    if (current?.active && !web) setMenu(true);
  };

  const text = lines.join("\n");
  useEffect(() => {
    cancel();
    return () => { stopTimer(); gesture.current = null; };
  }, [enabled, text]);

  // Mouse capture also covers a drag that leaves the gutter. Touch pointers
  // wait for a hold before they select instead of scrolling.
  useLayoutEffect(() => {
    if (!enabled || !web) return;
    const gutter = gutterRef.current as unknown as HTMLElement | null;
    const content = contentRef.current as unknown as HTMLElement | null;
    if (!gutter?.ownerDocument || !content) return;
    const doc = gutter.ownerDocument;
    let pointer: number | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || pointer !== null) return;
      pointer = event.pointerId;
      const touch = event.pointerType === "touch";
      // Keeps the press from collapsing the selection it is about to make.
      if (!touch) event.preventDefault();
      event.stopPropagation();
      begin(event.clientY - gutter.getBoundingClientRect().top, event.clientY, touch);
      gutter.setPointerCapture(pointer);
    };
    const drag = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      if (gesture.current?.active) event.preventDefault();
      move(event.clientY);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      finish();
      pointer = null;
    };
    const lost = () => {
      pointer = null;
      if (gesture.current) cancel();
    };
    // The numbers mark the lines only while the page still selects exactly
    // them; a click or a drag in the text takes the mark away.
    const changed = () => {
      if (gesture.current) return;
      const selection = doc.defaultView?.getSelection();
      setRange((current) => {
        if (!current || !selection) return null;
        const expected = latest.current.lines.slice(current.from, current.to + 1).join("\n");
        const inside = selection.anchorNode !== null && content.contains(selection.anchorNode);
        return inside && String(selection) === expected ? current : null;
      });
    };
    gutter.addEventListener("pointerdown", down);
    gutter.addEventListener("pointermove", drag);
    gutter.addEventListener("pointerup", up);
    gutter.addEventListener("pointercancel", lost);
    gutter.addEventListener("lostpointercapture", lost);
    doc.addEventListener("selectionchange", changed);
    const previousTouchAction = gutter.style.touchAction;
    gutter.style.touchAction = "none";
    return () => {
      stopTimer();
      gesture.current = null;
      gutter.style.touchAction = previousTouchAction;
      gutter.removeEventListener("pointerdown", down);
      gutter.removeEventListener("pointermove", drag);
      gutter.removeEventListener("pointerup", up);
      gutter.removeEventListener("pointercancel", lost);
      gutter.removeEventListener("lostpointercapture", lost);
      doc.removeEventListener("selectionchange", changed);
    };
  }, [enabled, text]);

  const gutterProps: ViewProps = web ? {} : {
    onStartShouldSetResponder: () => enabled,
    onResponderGrant: (event) => begin(event.nativeEvent.locationY, event.nativeEvent.pageY, true),
    onResponderMove: (event) => move(event.nativeEvent.pageY),
    onResponderRelease: finish,
    onResponderTerminationRequest: () => !gesture.current?.active,
    onResponderTerminate: cancel,
  };
  const band = range ? {
    top: tops[range.from] ?? 0,
    height: (tops[range.to + 1] ?? bottom) - (tops[range.from] ?? 0),
  } : null;
  return {
    gutterRef, gutterProps, range, dismiss,
    // Only the selected source text reaches the clipboard, including empty
    // lines and indentation. Display numbers never participate in the range.
    selectedText: range ? lines.slice(range.from, range.to + 1).join("\n") : "",
    /** The drawn range, phones only: web shows the page's own selection. */
    selectionStyle: web ? null : band,
    /** Where the phone's Copy sits: above the range, else below it, else on it. */
    menuTop: !web && menu && band ? menuTop(band, bottom) : null,
  };
}

function menuTop(band: { top: number; height: number }, bottom: number): number {
  const above = band.top - MENU_HEIGHT - MENU_GAP;
  if (above >= 0) return above;
  const below = band.top + band.height + MENU_GAP;
  return below + MENU_HEIGHT <= bottom ? below : band.top + MENU_GAP;
}

/** The phone's Copy for a gutter range, drawn like the web selection bar, icon and all. */
export function LineSelectionMenu({ top, text, tokens, dismiss }: {
  top: number;
  text: string;
  tokens: ExtendedThemeTokens;
  dismiss(): void;
}) {
  const { copy } = useCopy();
  const { language } = useEnhancerPreferences();
  return (
    <View pointerEvents="box-none" style={[styles.slot, { top }]}>
      <View testID="preview-line-selection-menu" style={[styles.menu, tokens.v2.elevation.overlay, {
        backgroundColor: tokens.surface0,
        borderColor: tokens.v2.border,
      }]}>
        <View style={styles.raise}>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy selected lines"
            onPress={() => { void copy(text, { feedback: "toast" }).then((ok) => { if (ok) dismiss(); }); }}
            style={({ pressed }) => [styles.button, pressed && { backgroundColor: floatPressed(tokens) }]}>
            <Icon name="Copy" size={FLOAT.iconSize} color={tokens.foregroundMuted} />
            <Text selectable={false} style={[unselectable, styles.label, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
              {toolbarLabel("Copy", language)}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: "absolute", left: 0, right: 0, zIndex: 2, alignItems: "center" },
  // The floating controls' frame (float.ts) at a touch target's height.
  menu: { height: MENU_HEIGHT, borderWidth: 1, borderRadius: FLOAT.radius },
  raise: { flex: 1, padding: FLOAT.inset, flexDirection: "row" },
  // Sized by its icon and label: a `flex: 1` item in a frame sized by its
  // content shrinks to its minimum on iOS and Android, and the label spills out.
  button: { minWidth: 64, paddingHorizontal: 14, borderRadius: FLOAT.itemRadius, flexDirection: "row", gap: FLOAT.iconText, justifyContent: "center", alignItems: "center" },
  label: { fontSize: 13, fontWeight: "500" },
});
