import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ViewStyle,
} from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space, withAlpha } from "../components/theme-tokens";
import { selectionSurface } from "../components/selection-actions";
import { bindPreviewMaximize, bindPreviewPointer, watchNextPointerMove, watchPointerOutside, dropSelectionIn, openPreviewLayer } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";
import { cssShadow } from "./tokens/css-shadow";
import { floatShadow } from "./tokens/float";
import { DEFAULT_PREFERENCES, useEnhancerPreferences } from "../preferences";
import { SafeInset } from "./safe-inset";
import { phoneChrome, PREVIEW_LIMIT, pressPreviewFrame, pressPreviewOrigin } from "./press-preview-placement";
import { PREVIEW_EDGES, PREVIEW_MIN, type PreviewBox } from "./preview-frame";
import { previewEdgeResponders, previewEdgeStyle, toolbarResponder, type FrameDrag } from "./preview-drag";
import { ProseSelectionContext } from "./prose-text";
import { HScroll } from "./h-scroll";
import { PreviewScrollerContext, type PreviewScroller } from "./preview-scroller";
import { ToolbarButton, ToolbarIcon, TooltipAlignContext } from "./toolbar-button";
import { Glyph } from "../components/glyph";
import { RunningDot } from "./running-dot";
import { bindPreviewTail, nativePreviewTail, PREVIEW_SETTLE_MS, previewFollowsTail } from "./preview-tail";
import { forgetPreview, holdPreview, recallPreview, rememberPreview, type PreviewMemory } from "./preview-memory";
import { useReducedMotion } from "./use-reduced-motion";
import { usePreviewEntrance } from "./use-preview-entrance";

/** Prevent a path inside a preview-enabled header from opening a second layer. */
export const HoverPreviewContext = createContext(false);
/**
 * The row's long-press preview, for a pressable inside the row (a path target)
 * that would otherwise take the long press for itself. Undefined where the row
 * has none: an opened row, a web pointer, previews turned off.
 */
export const RowLongPressContext = createContext<(() => void) | undefined>(undefined);
const PreviewActionsContext = createContext<{
  /** The desktop panel can always grow to the window; a phone's cannot. */
  maximizable: boolean;
  maximized: boolean;
  maximize(): void;
  close(): void;
  /** Opened as a window (`pop`): it stays up until closed, so it has a close button. */
  popped?: boolean;
  /** Where the preview keeps its state across its row's remount. */
  memoryKey?: string;
  /** What the row this preview took over from left, scroll offset included. */
  remembered?: PreviewMemory | null;
  /** The body fills a fixed height: the maximized window, or one the reader has sized. */
  fill: boolean;
  /** The preview's line wrap, on until the reader turns it off. */
  wrap?: { on: boolean; disabled?: boolean; toggle(): void; tokens: ExtendedThemeTokens };
  /** Question transcripts always wrap, including their toolbar title. */
  alwaysWrap?: boolean;
} | null>(null);

/** Keep prose wrapped; optionally leave the wrap control visible and disabled. */
export function AlwaysWrapPreview({ children, keepControl = false }: { children: ReactNode; keepControl?: boolean }) {
  const actions = useContext(PreviewActionsContext);
  const wrapped = useMemo(() => actions ? { ...actions,
    wrap: keepControl && actions.wrap ? { ...actions.wrap, on: true, disabled: true } : undefined,
    alwaysWrap: true } : null, [actions, keepControl]);
  return <PreviewActionsContext.Provider value={wrapped}>{children}</PreviewActionsContext.Provider>;
}
/** The phone toolbar's drag. Web moves the panel from pointer events on the popover. */
const PreviewDragContext = createContext<ReturnType<typeof toolbarResponder> | null>(null);

/** The panel this content is drawn in, when it is drawn in one. */
export function usePreviewPanel(): { maximized: boolean; close(): void } | null {
  const actions = useContext(PreviewActionsContext);
  if (!actions) return null;
  return { maximized: actions.maximized, close: actions.close };
}
/** False while the reader has turned the panel's line wrap off. */
export function usePreviewWraps(): boolean {
  const wrap = useContext(PreviewActionsContext)?.wrap;
  return !wrap || wrap.on;
}
/** The widest an unwrapped phone preview gets, about 500 characters of code. */
export const MAX_UNWRAPPED_WIDTH = 4096;
export const PREVIEW_OPEN_MS = DEFAULT_PREFERENCES.hoverDelaySeconds * 1000;
export const PREVIEW_CLOSE_MS = 150;

/**
 * The preview of a collapsed row. On web a pointer that rests on the row opens
 * it and leaving closes it. A phone has no hover, so on iOS and Android a long
 * press opens it (`press`), pinned until the reader dismisses it. A button can
 * open it as a window (`pop`): pinned, and shown even where hover and
 * long-press previews are turned off.
 *
 * `memoryKey` names the row across remounts. The host draws a finished
 * thought as a new row; a preview open then is opened again by that row as the
 * reader left it, so only the reader closes it (`preview-memory.ts`).
 */
export function useHoverPreview(enabled: boolean, memoryKey?: string, options?: { windowOnly?: boolean }) {
  const parentPreview = useContext(HoverPreviewContext);
  const capabilities = useInputCapabilities();
  const preferences = useEnhancerPreferences();
  const delay = Math.round(preferences.hoverDelaySeconds * 1000);
  const allowed = enabled && !options?.windowOnly && preferences.hoverPreview && !parentPreview;
  const hoverActive = allowed && Platform.OS === "web" && capabilities.hover;
  const pressActive = allowed && capabilities.native === true;
  const active = hoverActive || pressActive;
  const anchorRef = useRef<View>(null);
  // Taken over from the row this one replaced.
  const [restored] = useState(() => (memoryKey ? recallPreview(memoryKey) : null));
  // Reopened without an entrance, until the reader closes it.
  const [quiet, setQuiet] = useState(restored !== null);
  const [open, setOpen] = useState(false);
  // A restored panel must mount after the ancestor row's ref is attached.
  // Its child's layout effect otherwise reads a null anchor; reopen from
  // the owner's layout effect so positioning still finishes before paint.
  useLayoutEffect(() => {
    if (restored) setOpen(true);
  }, [restored]);
  const [maximized, setMaximized] = useState(restored?.maximized ?? false);
  const [placed, setPlaced] = useState(restored?.placed ?? false);
  const [popped, setPopped] = useState(restored?.popped ?? false);
  const poppedRef = useRef(false);
  poppedRef.current = popped;
  const pinned = useRef(restored?.pinned ?? false);
  const interacting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A preview the reader closed stays closed while the pointer rests: the
  // timeline can scroll its row back under it. The pointer's next real move
  // lets hover open it again.
  const rested = useRef<(() => void) | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancel();
    rested.current?.();
    rested.current = hoverActive
      ? watchNextPointerMove(anchorRef.current, () => { rested.current = null; })
      : null;
    if (memoryKey) forgetPreview(memoryKey);
    setQuiet(false);
    pinned.current = false;
    interacting.current = false;
    setPlaced(false);
    setPopped(false);
    setMaximized(false);
    setOpen(false);
  }, [cancel, memoryKey, hoverActive]);
  const hold = useCallback((on: boolean) => {
    interacting.current = on;
    if (on) cancel();
  }, [cancel]);
  const place = useCallback(() => {
    cancel();
    pinned.current = true;
    setPlaced(true);
    // A drag on the maximized window leaves that layout: the button can maximize again.
    setMaximized(false);
  }, [cancel]);
  const maximize = useCallback(() => {
    cancel();
    pinned.current = true;
    setMaximized(true);
  }, [cancel]);
  const press = useCallback(() => {
    cancel();
    pinned.current = true;
    setOpen(true);
  }, [cancel]);
  const pop = useCallback(() => {
    cancel();
    pinned.current = true;
    setPopped(true);
    setOpen(true);
  }, [cancel]);
  const enter = useCallback(() => {
    cancel();
    if (!hoverActive || rested.current) return;
    if (!open) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(true);
      }, delay);
    }
  }, [cancel, hoverActive, open, delay]);
  const leave = useCallback(() => {
    cancel();
    if (!hoverActive || pinned.current || interacting.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (memoryKey) forgetPreview(memoryKey);
      setQuiet(false);
      setOpen(false);
    }, PREVIEW_CLOSE_MS);
  }, [cancel, hoverActive, memoryKey]);

  const shown = (active || popped) && open;
  useEffect(() => (memoryKey && shown ? holdPreview(memoryKey) : undefined), [memoryKey, shown]);
  useEffect(() => {
    if (memoryKey && shown) rememberPreview(memoryKey, { pinned: pinned.current, maximized, placed, popped });
  }, [memoryKey, shown, maximized, placed, popped]);
  // A row drawn under a resting pointer never sees it enter, so it would never
  // see it leave either. A hover preview it took over closes on the pointer's
  // first move outside the row and the panel, as a leave would.
  useEffect(() => {
    if (!hoverActive || !quiet || pinned.current || !open) return;
    return watchPointerOutside(anchorRef.current, leave);
  }, [hoverActive, quiet, open, leave]);
  useEffect(() => {
    if (!active) {
      if (!poppedRef.current) close();
      return;
    }
    return hoverActive ? bindPreviewPointer(anchorRef.current, enter, leave) : undefined;
  }, [active, hoverActive, enter, leave, close]);
  useEffect(() => () => {
    cancel();
    rested.current?.();
  }, [cancel]);
  return {
    anchorRef,
    open: shown,
    /** The key this preview keeps its state under while it is open. */
    memoryKey: shown ? memoryKey : undefined,
    /** What the row this one replaced left; null for a preview opened here. */
    restored,
    /** Reopened for a remounted row: no entrance. */
    quiet,
    maximized,
    /** Opened by `pop`, as a window. */
    popped,
    maximize,
    /** True once the reader has dragged or resized this preview. */
    placed,
    /** Pointer is down on the frame. Leaving during that press must not close it. */
    hold,
    /** The drag moved the frame: keep the preview open after the pointer leaves. */
    place,
    enter,
    leave,
    close,
    /** Opens the preview from a long press; absent where a long press does not. */
    press: pressActive ? press : undefined,
    /** Opens the preview as a window from a button; absent inside another preview. */
    pop: enabled && !parentPreview ? pop : undefined,
  };
}

/**
 * A panel's line wrap: the reader's setting when it opens (Preview panel
 * settings), then this panel's own toggle until it closes.
 */
function usePanelWrap(remembered: boolean | null = null): [boolean, () => void] {
  const { previewWrap } = useEnhancerPreferences();
  const [on, setOn] = useState(remembered ?? previewWrap);
  // A change to the setting applies; mounting does not undo a remembered toggle.
  const setting = useRef(previewWrap);
  useEffect(() => {
    if (setting.current === previewWrap) return;
    setting.current = previewWrap;
    setOn(previewWrap);
  }, [previewWrap]);
  const toggle = useCallback(() => setOn((value) => !value), []);
  return [on, toggle];
}

export function HoverPreview(props: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  /** False for content with no lines to wrap, such as a picture: no wrap toggle. */
  wraps?: boolean;
  /** Override automatic disabling: true forces wrapping; false keeps the control enabled. */
  wrapDisabled?: boolean;
  children: ReactNode;
}) {
  return Platform.OS === "web" ? <WebPreview {...props} /> : <PressPreview {...props} />;
}

function WebPreview({ preview, tokens, wraps = true, wrapDisabled, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  wraps?: boolean;
  wrapDisabled?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<View>(null);
  const frameSync = useRef<(() => void) | null>(null);
  const { memoryKey } = preview;
  const [remembered] = useState(() => (preview.quiet ? preview.restored : null));
  // The box from the last drag. Maximize drops it; leaving maximize opens here again.
  const placedFrame = useRef<PreviewBox | null>(remembered?.box ?? null);
  // Keep the toggle's slot even when wrapping would make no visible difference.
  const [linesFit, setLinesFit] = useState(false);
  // Kept across Maximize, which re-renders this panel rather than remounting it.
  const [wrapOn, toggleWrap] = usePanelWrap(remembered?.wrap ?? null);
  useEffect(() => {
    if (memoryKey) rememberPreview(memoryKey, { wrap: wrapOn });
  }, [memoryKey, wrapOn]);
  const memoryKeyRef = useRef(memoryKey);
  memoryKeyRef.current = memoryKey;
  const quiet = useRef(preview.quiet);
  quiet.current = preview.quiet;
  useLayoutEffect(() => {
    const unbind = bindPreviewPointer(panelRef.current, preview.enter, preview.leave);
    const release = openPreviewLayer(panelRef.current, preview.anchorRef.current, preview.close, {
      maximized: preview.maximized,
      frame: preview.maximized ? null : placedFrame.current,
      onLinesFit: setLinesFit,
      onHold: preview.hold,
      onPlace(box) {
        placedFrame.current = box;
        if (memoryKeyRef.current) rememberPreview(memoryKeyRef.current, { box });
        preview.place();
      },
      onLeave: preview.leave,
      onFrame(sync) { frameSync.current = sync; },
      floating: preview.popped,
      quiet: quiet.current,
    });
    return () => {
      frameSync.current = null;
      unbind();
      release();
    };
  }, [preview.anchorRef, preview.enter, preview.leave, preview.close, preview.hold, preview.place, preview.maximized, preview.popped]);
  // A commit rewrites the panel's style and would drop a box applied on the DOM node.
  useLayoutEffect(() => {
    frameSync.current?.();
  });
  // On closing only: Maximize re-renders this panel and keeps its selection.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    return () => dropSelectionIn(panel);
  }, []);
  return (
    <HoverPreviewContext.Provider value>
      <PreviewActionsContext.Provider value={{
        maximizable: true,
        maximized: preview.maximized,
        maximize: preview.maximize,
        close: preview.close,
        popped: preview.popped,
        fill: preview.maximized || preview.placed,
        wrap: wraps ? { on: wrapDisabled || wrapOn, disabled: wrapDisabled ?? linesFit, toggle: toggleWrap, tokens } : undefined,
        memoryKey,
        remembered,
      }}>
        <View
          ref={panelRef}
          {...selectionSurface}
          testID="hover-preview"
          role={preview.maximized ? "dialog" : undefined}
          accessibilityLabel={preview.maximized ? "Expanded preview" : undefined}
          style={[styles.panel, panelLook(tokens)]}
        >
          {children}
        </View>
      </PreviewActionsContext.Provider>
    </HoverPreviewContext.Provider>
  );
}

/**
 * A panel drawn in place rather than on the preview layer: the settings page
 * shows one, open, so the panel options (line wrap, numbers, shading) are
 * seen as they change. Its wrap button works; there is nothing to maximize
 * or close, and paths inside it do not open a preview of their own.
 */
export function PreviewPanelSample({ tokens, children }: { tokens: ExtendedThemeTokens; children: ReactNode }) {
  const [wrapOn, toggleWrap] = usePanelWrap();
  return (
    <HoverPreviewContext.Provider value>
      <PreviewActionsContext.Provider value={{
        maximizable: false,
        maximized: false,
        maximize: noop,
        close: noop,
        fill: false,
        wrap: { on: wrapOn, toggle: toggleWrap, tokens },
      }}>
        <View {...selectionSurface} style={[styles.panel, panelLook(tokens), styles.sample]}>
          {children}
        </View>
      </PreviewActionsContext.Provider>
    </HoverPreviewContext.Provider>
  );
}

function noop(): void {}

function panelLook(tokens: ExtendedThemeTokens) {
  return {
    backgroundColor: tokens.surface0,
    borderColor: tokens.v2.border,
    boxShadow: floatShadow(tokens),
  };
}

/**
 * The phone panel sits on a dimmed backdrop, which the host's opaque border
 * is lighter than: the edge read as a pale halo. A device-pixel line of the
 * foreground at low alpha darkens whatever is under it, so the edge stays a
 * crisp line on the backdrop, and a tighter shadow keeps it from smearing.
 */
function pressLook(tokens: ExtendedThemeTokens) {
  return {
    backgroundColor: tokens.surface0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(tokens.foreground, tokens.isDark ? 0.18 : 0.14),
    boxShadow: cssShadow({
      ...tokens.v2.elevation.overlay,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 12,
      shadowOpacity: tokens.isDark ? 0.3 : 0.12,
    }),
  };
}

/**
 * The long-press preview on iOS and Android: the web panel's contents in a
 * transparent modal, centred between the header and the composer and sized by
 * `pressPreviewFrame`.
 * The modal is the only layer a plugin can raise above the timeline, and it
 * keeps the list from scrolling out from under the panel. A press outside the
 * panel or Android's back button closes it. The panel stays hidden until the
 * row and the safe area are measured, so it never flashes at the wrong size.
 */
function PressPreview({ preview, tokens, wraps = true, wrapDisabled = false, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  wraps?: boolean;
  wrapDisabled?: boolean;
  children: ReactNode;
}) {
  const [modalShown, setModalShown] = useState(false);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const { anchorRef, close, memoryKey } = preview;
  // What the row this one replaced left: the reader's box, wrap and offset.
  const [remembered] = useState(() => (preview.quiet ? preview.restored : null));
  const [box, setBox] = useState<PreviewBox | null>(remembered?.box ?? null);
  const [wrapOn, toggleWrap] = usePanelWrap(remembered?.wrap ?? null);
  const memoryKeyRef = useRef(memoryKey);
  memoryKeyRef.current = memoryKey;
  useEffect(() => {
    if (memoryKey) rememberPreview(memoryKey, { wrap: wrapOn });
  }, [memoryKey, wrapOn]);
  const measured = useRef(false);
  const boxRef = useRef<PreviewBox | null>(null);
  const boundsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const frameReady = useRef(false);
  useLayoutEffect(() => {
    measureWidth(anchorRef.current, setRowWidth);
  }, [anchorRef]);
  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage({ width, height });
  }, []);
  const onPanelLayout = useCallback((event: LayoutChangeEvent) => {
    // The hidden first layout has no frame yet; measuring it would lock the wrong size.
    if (measured.current || !frameReady.current) return;
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    measured.current = true;
    setNatural({ width, height });
  }, []);
  const frame = rowWidth !== null && stage ? pressPreviewFrame(stage, rowWidth, Platform.OS) : null;
  frameReady.current = frame !== null;
  const maximizedBox = preview.maximized && stage ? pressPreviewOrigin(stage, {
    width: Math.max(0, stage.width - 2 * PREVIEW_LIMIT.margin),
    height: pressPreviewFrame(stage, stage.width, Platform.OS).maxHeight,
  }, Platform.OS) : null;
  const shown = maximizedBox ?? box ?? (natural && stage ? pressPreviewOrigin(stage, natural, Platform.OS) : null);
  const entrance = usePreviewEntrance({ ready: modalShown && shown !== null, quiet: preview.quiet });
  boxRef.current = shown;
  if (stage) boundsRef.current = stage;
  const drag = useRef<FrameDrag>(null!);
  if (!drag.current) {
    drag.current = {
      box: () => boxRef.current,
      bounds: () => boundsRef.current,
      margin: PREVIEW_LIMIT.margin,
      min: PREVIEW_MIN,
      commit(next) {
        const current = boxRef.current;
        if (current && current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height) return;
        boxRef.current = next;
        if (memoryKeyRef.current) rememberPreview(memoryKeyRef.current, { box: next });
        setBox(next);
      },
    };
  }
  const gestures = useMemo(() => ({
    toolbar: toolbarResponder(drag.current),
    edges: previewEdgeResponders(drag.current),
  }), []);
  return (
    <Modal visible transparent animationType="none" onShow={() => setModalShown(true)} onRequestClose={close} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close preview"
        onPress={close}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, entrance]}>
        <SafeInset pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View testID="hover-preview-stage" onLayout={onStageLayout} pointerEvents="box-none" style={[styles.stage, stagePadding()]}>
            <HoverPreviewContext.Provider value>
              <PreviewActionsContext.Provider value={{
                maximizable: false,
                maximized: preview.maximized,
                maximize: preview.maximize,
                close,
                fill: preview.maximized || box !== null,
                wrap: wraps ? { on: wrapDisabled || wrapOn, disabled: wrapDisabled, toggle: toggleWrap, tokens } : undefined,
                memoryKey,
                remembered,
              }}>
                <PreviewDragContext.Provider value={preview.maximized ? null : gestures.toolbar}>
                  <View
                    {...selectionSurface}
                    testID="hover-preview"
                    accessibilityViewIsModal
                    onLayout={onPanelLayout}
                    style={[
                      styles.panel, styles.pressPanel, pressLook(tokens),
                      // Centred in the band until its own height is known; then the same
                      // spot, absolutely, so a drag can move it without a jump.
                      shown
                        ? { position: "absolute", left: shown.x, top: shown.y, width: shown.width, height: shown.height }
                        : frame
                          ? { width: frame.width, maxHeight: frame.maxHeight }
                          : styles.hidden,
                    ]}
                  >
                    {children}
                    {shown && !preview.maximized ? <PreviewEdges edges={gestures.edges} /> : null}
                  </View>
                </PreviewDragContext.Provider>
              </PreviewActionsContext.Provider>
            </HoverPreviewContext.Provider>
          </View>
        </SafeInset>
      </Animated.View>
    </Modal>
  );
}

function PreviewEdges({ edges }: { edges: ReturnType<typeof previewEdgeResponders> }) {
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.edges]}>
      {PREVIEW_EDGES.map((edge) => (
        <View
          key={edge}
          testID={`hover-preview-edge-${edge}`}
          accessible={false}
          pointerEvents="auto"
          hitSlop={edge === "e" ? { right: 8 } : edge === "w" ? { left: 8 } : edge === "s" ? { bottom: 8 } : undefined}
          style={previewEdgeStyle(edge)}
          {...edges[edge]}
        />
      ))}
    </View>
  );
}

/** The stage keeps the header and the composer clear; the panel centres in what is left. */
function stagePadding(): ViewStyle {
  const { top, bottom } = phoneChrome(Platform.OS);
  return { paddingTop: top, paddingBottom: bottom };
}

function measureWidth(node: unknown, done: (width: number) => void) {
  const view = node as {
    measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
  } | null;
  view?.measureInWindow?.((_x, _y, width) => {
    if (Number.isFinite(width)) done(width);
  });
}

/**
 * The panel's toolbar, above the scrolling body. Line wrap and `left` (a
 * pager) sit at the left, the content's icon and name or size in the middle,
 * and the content's own buttons on the right, with the window button
 * always last, at the far right. The bar is also the window's handle: a drag
 * on its free space or title moves the panel, on desktop and on a phone.
 *
 * While `streaming`, the same pulsing dot a running row uses sits in that
 * middle, in front of the name when there is one. Hover and the maximized
 * window share this bar.
 */
export function HoverPreviewHeader({ tokens, icon, iconLabel, left, center, streaming = false, fitControls = false, children }: {
  tokens: ExtendedThemeTokens;
  /** A glyph name or the content's own icon, beside its name or size in the centre. */
  icon?: ReactNode;
  /** The current tool's type: the icon's hover label and title when the centre is free. */
  iconLabel?: string;
  /** Controls after the line-wrap button, such as a grouped tool's pager. */
  left?: ReactNode;
  center?: ReactNode;
  /** The block is still writing. A pulsing dot joins the centre of the title bar. */
  streaming?: boolean;
  /** Give wider question controls their own space before truncating the title. */
  fitControls?: boolean;
  children?: ReactNode;
}) {
  const actions = useContext(PreviewActionsContext);
  const toolbarDrag = useContext(PreviewDragContext);
  const [toolbar, ...rest] = React.Children.toArray(children);
  const toolbarRef = useRef<View>(null);
  const windowAction = actions?.maximizable ? (actions.maximized ? actions.close : actions.maximize) : undefined;
  useLayoutEffect(() => {
    if (windowAction) return bindPreviewMaximize(toolbarRef.current, windowAction);
  }, [windowAction]);
  const windowButton = actions && (actions.maximizable || actions.maximized) ? (
    <ToolbarButton
      icon={actions.maximized ? "X" : "Maximize2"}
      label={actions.maximized ? "Close preview" : "Maximize preview"}
      onPress={actions.maximized ? actions.close : actions.maximize}
      tokens={tokens}
    />
  ) : null;
  // A popped-out window ignores presses outside it; this is its way out.
  const closeButton = actions?.popped && actions.maximizable && !actions.maximized ? (
    <ToolbarButton icon="X" label="Close preview" onPress={actions.close} tokens={tokens} />
  ) : null;
  return (
    <View
      testID="hover-preview-header"
      style={[styles.header, { backgroundColor: tokens.v2.surface1, borderBottomColor: tokens.v2.borderSubtle }]}
    >
      <View ref={toolbarRef} testID="hover-preview-toolbar" {...(toolbarDrag ?? {})} style={[styles.toolbar, Platform.OS === "web" && styles.grab]}>
        <View testID="hover-preview-start" style={[styles.toolbarStart, fitControls && styles.toolbarControls]}>
          {/* At the panel's left edge: its name opens rightwards. */}
          <TooltipAlignContext.Provider value="start">
            {actions?.wrap ? (
              <ToolbarButton
                icon={actions.wrap.on ? "WrapText" : "AlignLeft"}
                label={actions.wrap.on ? "Do not wrap lines" : "Wrap lines"}
                checked={actions.wrap.on}
                disabled={actions.wrap.disabled}
                onPress={actions.wrap.toggle}
                tokens={tokens}
              />
            ) : null}
            {left}
          </TooltipAlignContext.Provider>
        </View>
        {streaming || icon || center || iconLabel ? (
          <View testID="hover-preview-center" style={[styles.toolbarCenter, fitControls && styles.toolbarFitTitle]}>
            {streaming ? (
              <View testID="hover-preview-streaming" style={styles.toolbarIcon}>
                <RunningDot color={tokens.accent} accessibilityLabel="Streaming" />
              </View>
            ) : null}
            {icon ? (
              <View testID="hover-preview-icon" style={styles.toolbarIcon}>
                {iconLabel ? (
                  <ToolbarIcon label={iconLabel} tokens={tokens} align="center">
                    {typeof icon === "string" ? <Glyph name={icon} size={14} color={tokens.foregroundMuted} /> : icon}
                  </ToolbarIcon>
                ) : typeof icon === "string" ? <Glyph name={icon} size={14} color={tokens.foregroundMuted} /> : icon}
              </View>
            ) : null}
            {center || (iconLabel ? (
              <Text
                testID="hover-preview-tool-name"
                selectable={false}
                numberOfLines={actions?.alwaysWrap ? undefined : 1}
                style={[{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: tokens.typography.ui.scale.base },
                  fitControls && { flexShrink: 1 }]}
              >
                {iconLabel}
              </Text>
            ) : null)}
          </View>
        ) : null}
        <View style={[styles.toolbarEnd, fitControls && styles.toolbarControls]}>
          {/* The group ends at the panel's right edge: names open leftwards. */}
          <TooltipAlignContext.Provider value="end">
            {toolbar}
            {windowButton}
            {closeButton}
          </TooltipAlignContext.Provider>
        </View>
      </View>
      {rest}
    </View>
  );
}

export function HoverPreviewBody({ children, streaming = false }: { children: ReactNode; streaming?: boolean }) {
  const actions = useContext(PreviewActionsContext);
  const wrap = actions?.wrap;
  const fill = actions?.fill ?? false;
  const memoryKey = actions?.memoryKey;
  const remembered = actions?.remembered ?? null;
  const scroller = usePreviewScroller(streaming, memoryKey, remembered);
  const webBody = useRef<View>(null);
  const following = useStreamingTail(streaming, webBody);
  useWebScrollMemory(webBody, memoryKey, remembered, streaming, following);
  // Lines keep their length; the body scrolls sideways, with a track under it
  // only while it is wider than the panel. The track keeps clear of the last
  // line's descenders and sits down in the body's bottom padding, near the
  // panel's edge.
  const content = wrap && !wrap.on ? (
    <HScroll tokens={wrap.tokens} trackStyle={styles.track} contentContainerStyle={styles.unwrappedScroll} scrollEnabled={!scroller.held}>
      <View style={[styles.unwrapped, Platform.OS !== "web" && styles.unwrappedNative]}>{children}</View>
    </HScroll>
  ) : children;
  if (Platform.OS !== "web") {
    // The panel's height is capped; the body scrolls inside it. Its text takes
    // a long press as the start of a selection, with a cursor and handles.
    return (
      <ScrollView ref={scroller.ref} testID="hover-preview-body" style={[styles.pressBody, fill && styles.pressBodyFill]} contentContainerStyle={styles.pressBodyContent}
        scrollEnabled={!scroller.held} scrollEventThrottle={16} {...scroller.props}>
        <PreviewScrollerContext.Provider value={scroller.value}>
          <ProseSelectionContext.Provider value>{content}</ProseSelectionContext.Provider>
        </PreviewScrollerContext.Provider>
      </ScrollView>
    );
  }
  return (
    <View ref={webBody} testID="hover-preview-body" style={[styles.body, fill && styles.bodyFill]}>
      {content}
    </View>
  );
}

/**
 * On web the body itself scrolls. Each commit of new output, and any growth
 * the commit does not see (fonts, highlighting), pulls the tail into view
 * while the reader is already there.
 */
function useStreamingTail(streaming: boolean, ref: RefObject<View | null>) {
  const pinned = useRef(true);
  const follow = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (!streaming) {
      pinned.current = true;
      follow.current = null;
      return;
    }
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function" || typeof node.scrollHeight !== "number") return;
    return bindPreviewTail(node, pinned, follow);
  }, [streaming, ref]);
  useLayoutEffect(() => {
    if (streaming) follow.current?.();
  });
  return pinned;
}

/**
 * The web body's offset, kept under `memoryKey` while the preview is open.
 * A body that takes over a remounted row's preview starts where that one was,
 * or on the newest output if it was there. While streaming, the follow knows
 * that better than the offset, which trails the tail during a glide.
 */
function useWebScrollMemory(
  ref: RefObject<View | null>,
  memoryKey: string | undefined,
  remembered: PreviewMemory | null,
  streaming: boolean,
  following: RefObject<boolean>,
) {
  const key = useRef(memoryKey);
  key.current = memoryKey;
  const live = useRef(streaming);
  live.current = streaming;
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const view = node.ownerDocument?.defaultView;
    let frame = 0;
    if (remembered) {
      const place = () => { node.scrollTop = remembered.tail ? node.scrollHeight : remembered.offset; };
      place();
      // The layer sizes the panel after this effect, so place it again then.
      frame = view?.requestAnimationFrame?.(place) ?? 0;
    }
    const onScroll = () => {
      if (!key.current) return;
      const tail = live.current ? following.current : previewFollowsTail(node.scrollTop, node.clientHeight, node.scrollHeight);
      rememberPreview(key.current, { offset: node.scrollTop, tail });
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      if (frame) view?.cancelAnimationFrame?.(frame);
    };
  }, [ref, remembered, following]);
}

/**
 * The phone body's scroller as a gesture inside it sees it. A held body
 * scrolls only by `scrollBy`, so its offset is kept here and the scroll
 * events still on their way from before the hold are ignored.
 *
 * Its offset goes to `memoryKey` as the reader scrolls; a body that takes
 * over a remounted row's preview starts where that one was, or on the newest
 * output if it was there.
 */
function usePreviewScroller(streaming: boolean, memoryKey?: string, remembered: PreviewMemory | null = null) {
  const ref = useRef<ScrollView>(null);
  const memoryKeyRef = useRef(memoryKey);
  memoryKeyRef.current = memoryKey;
  // Applied again while the taken-over text settles its layout, which grows
  // the content a few times after the first size; the reader's drag ends it.
  const restore = useRef(remembered ? { offset: remembered.offset, tail: remembered.tail, until: Date.now() + PREVIEW_SETTLE_MS } : null);
  const [held, setHeld] = useState(false);
  const state = useRef({ held: false, offset: 0, viewport: 0, content: 0 });
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const still = useRef(false);
  still.current = useReducedMotion();
  const [tail] = useState(() => nativePreviewTail((offset, animated) => {
    if (offset === "end") ref.current?.scrollToEnd({ animated });
    else ref.current?.scrollTo({ y: offset, animated });
  }));
  const wasStreaming = useRef(streaming);
  if (wasStreaming.current && !streaming) tail.end();
  wasStreaming.current = streaming;
  if (!streaming) tail.reset();
  const value = useMemo<PreviewScroller>(() => ({
    hold(on) {
      state.current.held = on;
      setHeld(on);
    },
    measure(done) {
      (ref.current as unknown as View | null)?.measure?.((_x, _y, _width, height, _pageX, pageY) => done(pageY, height));
    },
    offset: () => state.current.offset,
    scrollBy(delta) {
      const current = state.current;
      const next = Math.max(0, Math.min(current.content - current.viewport, current.offset + delta));
      const moved = next - current.offset;
      if (moved === 0) return 0;
      current.offset = next;
      ref.current?.scrollTo({ y: next, animated: false });
      return moved;
    },
  }), []);
  // Puts a taken-over body back where the reader left it; false once that is done.
  const restoring = () => {
    const pending = restore.current;
    if (!pending) return false;
    if (Date.now() > pending.until) {
      restore.current = null;
      return false;
    }
    if (pending.tail) ref.current?.scrollToEnd({ animated: false });
    else ref.current?.scrollTo({ y: pending.offset, animated: false });
    return true;
  };
  const props = useMemo(() => ({
    onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
      const native = event.nativeEvent;
      const offset = native.contentOffset.y;
      const viewport = native.layoutMeasurement?.height ?? state.current.viewport;
      const content = native.contentSize?.height ?? state.current.content;
      if (!state.current.held) state.current.offset = offset;
      if (streamingRef.current) tail.scrolled(offset, viewport, content);
      const key = memoryKeyRef.current;
      if (key && !state.current.held) {
        rememberPreview(key, { offset, tail: streamingRef.current ? tail.pinned : previewFollowsTail(offset, viewport, content) });
      }
    },
    onScrollBeginDrag() {
      restore.current = null;
      tail.drag();
    },
    onLayout(event: LayoutChangeEvent) {
      state.current.viewport = event.nativeEvent.layout.height;
      // Android sizes the body after its content: the end moves without a new content size.
      if (Platform.OS !== "web" && state.current.content > 0) restoring();
    },
    onContentSizeChange(_width: number, height: number) {
      state.current.content = height;
      // The phone preview is a ScrollView. Web scrolls the body element.
      if (Platform.OS === "web" || state.current.held) return;
      if (height > 0 && restoring()) return;
      if (!streamingRef.current) {
        tail.settle(state.current.viewport, height, state.current.offset, still.current);
        return;
      }
      tail.grow(state.current.viewport, height, state.current.offset, still.current);
    },
  }), [tail]);
  return { ref, held, value, props };
}

const styles = StyleSheet.create({
  panel: { padding: 0, borderWidth: 1, borderRadius: radiusV2.overlay },
  // In the page, not on the layer: clipped to its corners, with no shadow to float on.
  sample: { overflow: "hidden", boxShadow: "none" } as ViewStyle,
  toolbar: { flexDirection: "row", alignItems: "center", gap: space.xs },
  // The title and the empty stretches drag; buttons set their own pointer cursor.
  grab: { cursor: "grab", touchAction: "none" } as unknown as ViewStyle,
  // Equal flexible sides keep the centre slot in the middle of the panel.
  toolbarStart: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center", gap: space.xs },
  toolbarCenter: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: space.xs },
  toolbarControls: { flex: 0, flexBasis: "auto", flexShrink: 0 },
  toolbarFitTitle: { flex: 1, flexShrink: 1, minWidth: 0, justifyContent: "center" },
  // The size of a toolbar button, so the glyph lines up with the buttons.
  toolbarIcon: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  toolbarEnd: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.xs },
  body: {
    minHeight: 0,
    flexShrink: 1,
    overflowY: "auto",
    overscrollBehavior: "contain",
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    gap: space.sm,
  } as ViewStyle,
  // A maximized panel has a fixed height. The body fills it, so a picture can
  // grow with the window; text still scrolls inside the same box.
  bodyFill: { flexGrow: 1 },
  backdrop: { backgroundColor: "rgba(0, 0, 0, 0.2)" },
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressPanel: { overflow: "hidden" },
  // Above the toolbar, so the top edge can be grabbed; the overlay itself ignores touches.
  edges: { zIndex: 2 },
  hidden: { opacity: 0 },
  pressBody: { flexGrow: 0, flexShrink: 1 },
  pressBodyFill: { flexGrow: 1, minHeight: 0 },
  pressBodyContent: { padding: space.md, gap: space.sm },
  unwrappedScroll: { flexGrow: 1 },
  unwrapped: { flexGrow: 1, gap: space.sm },
  // On a phone a text is one layer, and a layer wider than the GPU's largest
  // texture (16384px, 5461pt at 3x) draws nothing: a minified JSON line
  // left the whole output blank. Lines past this width wrap here instead.
  unwrappedNative: { maxWidth: MAX_UNWRAPPED_WIDTH },
  // 4pt from the panel's edge, out of the body's 12pt bottom padding.
  track: { marginTop: space.sm, marginBottom: space.xs - space.md },
  // Raised over the body, so a button's name can hang down across it.
  header: {
    flexShrink: 0,
    zIndex: 1,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
  },
});
