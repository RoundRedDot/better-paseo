import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { selectionSurface } from "../components/selection-actions";
import { bindPreviewPointer, openPreviewLayer } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";
import { cssShadow } from "./tokens/css-shadow";
import { DEFAULT_PREFERENCES, HOVER_DELAY_MS, useEnhancerPreferences } from "../preferences";
import { SafeInset } from "./safe-inset";
import { PHONE_CHROME, pressPreviewFrame } from "./press-preview-placement";
import { ProseSelectionContext } from "./prose-text";
import { HScroll } from "./h-scroll";
import { ToolbarButton, TooltipAlignContext } from "./toolbar-button";

/** Prevent a path inside a preview-enabled header from opening a second layer. */
export const HoverPreviewContext = createContext(false);
/**
 * The row's long-press preview, for a pressable inside the row (a path target)
 * that would otherwise take the long press for itself. Undefined where the row
 * has none: an opened row, a web pointer, previews turned off.
 */
export const RowLongPressContext = createContext<(() => void) | undefined>(undefined);
const PreviewActionsContext = createContext<{
  overflowing: boolean;
  maximized: boolean;
  maximize(): void;
  close(): void;
  /** The preview's line wrap, on until the reader turns it off. */
  wrap?: { on: boolean; toggle(): void; tokens: ExtendedThemeTokens };
} | null>(null);

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
export const PREVIEW_OPEN_MS = HOVER_DELAY_MS[DEFAULT_PREFERENCES.hoverDelay];
export const PREVIEW_CLOSE_MS = 150;

/**
 * The preview of a collapsed row. On web a pointer that rests on the row opens
 * it and leaving closes it. A phone has no hover, so on iOS and Android a long
 * press opens it (`press`), pinned until the reader dismisses it.
 */
export function useHoverPreview(enabled: boolean) {
  const parentPreview = useContext(HoverPreviewContext);
  const capabilities = useInputCapabilities();
  const preferences = useEnhancerPreferences();
  const delay = HOVER_DELAY_MS[preferences.hoverDelay];
  const allowed = enabled && preferences.hoverPreview && !parentPreview;
  const hoverActive = allowed && Platform.OS === "web" && capabilities.hover;
  const pressActive = allowed && capabilities.native === true;
  const active = hoverActive || pressActive;
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancel();
    pinned.current = false;
    setMaximized(false);
    setOpen(false);
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
  const enter = useCallback(() => {
    cancel();
    if (!hoverActive) return;
    if (!open) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(true);
      }, delay);
    }
  }, [cancel, hoverActive, open, delay]);
  const leave = useCallback(() => {
    cancel();
    if (!hoverActive || pinned.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, PREVIEW_CLOSE_MS);
  }, [cancel, hoverActive]);

  useEffect(() => {
    if (!active) {
      close();
      return;
    }
    return hoverActive ? bindPreviewPointer(anchorRef.current, enter, leave) : undefined;
  }, [active, hoverActive, enter, leave, close]);
  useEffect(() => cancel, [cancel]);
  return {
    anchorRef,
    open: active && open,
    maximized,
    maximize,
    enter,
    leave,
    close,
    /** Opens the preview from a long press; absent where a long press does not. */
    press: pressActive ? press : undefined,
  };
}

/**
 * A panel's line wrap: the reader's setting when it opens (Preview panel
 * settings), then this panel's own toggle until it closes.
 */
function usePanelWrap(): [boolean, () => void] {
  const { previewWrap } = useEnhancerPreferences();
  const [on, setOn] = useState(previewWrap);
  useEffect(() => setOn(previewWrap), [previewWrap]);
  const toggle = useCallback(() => setOn((value) => !value), []);
  return [on, toggle];
}

export function HoverPreview(props: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  /** False for content with no lines to wrap, such as a picture: no wrap toggle. */
  wraps?: boolean;
  children: ReactNode;
}) {
  return Platform.OS === "web" ? <WebPreview {...props} /> : <PressPreview {...props} />;
}

function WebPreview({ preview, tokens, wraps = true, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  wraps?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<View>(null);
  const [overflowing, setOverflowing] = useState(false);
  // Content whose every line fits needs no wrap toggle: both states look the same.
  const [linesFit, setLinesFit] = useState(false);
  // Kept across Maximize, which re-renders this panel rather than remounting it.
  const [wrapOn, toggleWrap] = usePanelWrap();
  useLayoutEffect(() => {
    const unbind = bindPreviewPointer(panelRef.current, preview.enter, preview.leave);
    const release = openPreviewLayer(panelRef.current, preview.anchorRef.current, preview.close, {
      maximized: preview.maximized,
      onOverflow: setOverflowing,
      onLinesFit: setLinesFit,
    });
    return () => {
      unbind();
      release();
    };
  }, [preview.anchorRef, preview.enter, preview.leave, preview.close, preview.maximized]);
  return (
    <HoverPreviewContext.Provider value>
      <PreviewActionsContext.Provider value={{
        overflowing,
        maximized: preview.maximized,
        maximize: preview.maximize,
        close: preview.close,
        wrap: wraps && !linesFit ? { on: wrapOn, toggle: toggleWrap, tokens } : undefined,
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

function panelLook(tokens: ExtendedThemeTokens) {
  return {
    backgroundColor: tokens.surface0,
    borderColor: tokens.v2.border,
    boxShadow: cssShadow({
      ...tokens.v2.elevation.overlay,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 24,
      shadowOpacity: tokens.isDark ? 0.36 : 0.22,
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
function PressPreview({ preview, tokens, wraps = true, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  wraps?: boolean;
  children: ReactNode;
}) {
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const [stage, setStage] = useState<{ width: number; height: number } | null>(null);
  const [wrapOn, toggleWrap] = usePanelWrap();
  const { anchorRef, close } = preview;
  useLayoutEffect(() => {
    measureWidth(anchorRef.current, setRowWidth);
  }, [anchorRef]);
  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage({ width, height });
  }, []);
  const frame = rowWidth !== null && stage ? pressPreviewFrame(stage, rowWidth) : null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close preview"
        onPress={close}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      <SafeInset pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View onLayout={onStageLayout} pointerEvents="box-none" style={styles.stage}>
          <HoverPreviewContext.Provider value>
            <PreviewActionsContext.Provider value={{
              overflowing: false,
              maximized: false,
              maximize: preview.maximize,
              close,
              wrap: wraps ? { on: wrapOn, toggle: toggleWrap, tokens } : undefined,
            }}>
              <View
                {...selectionSurface}
                testID="hover-preview"
                accessibilityViewIsModal
                style={[styles.panel, styles.pressPanel, panelLook(tokens), frame ?? styles.hidden]}
              >
                {children}
              </View>
            </PreviewActionsContext.Provider>
          </HoverPreviewContext.Provider>
        </View>
      </SafeInset>
    </Modal>
  );
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
 * The panel's toolbar, above the scrolling body. Line wrap sits at the left,
 * `center` (a pager) in the middle, and the content's own buttons on the
 * right, with the window button always last, at the far right.
 */
export function HoverPreviewHeader({ tokens, center, children }: {
  tokens: ExtendedThemeTokens;
  center?: ReactNode;
  children?: ReactNode;
}) {
  const actions = useContext(PreviewActionsContext);
  const [toolbar, ...rest] = React.Children.toArray(children);
  const windowButton = actions && (actions.overflowing || actions.maximized) ? (
    <ToolbarButton
      icon={actions.maximized ? "X" : "Maximize2"}
      label={actions.maximized ? "Close preview" : "Maximize preview"}
      onPress={actions.maximized ? actions.close : actions.maximize}
      tokens={tokens}
    />
  ) : null;
  return (
    <View
      testID="hover-preview-header"
      style={[styles.header, { backgroundColor: tokens.v2.surface1, borderBottomColor: tokens.v2.borderSubtle }]}
    >
      <View style={styles.toolbar}>
        <View style={styles.toolbarStart}>
          {/* At the panel's left edge: its name opens rightwards. */}
          <TooltipAlignContext.Provider value="start">
            {actions?.wrap ? (
              <ToolbarButton
                icon={actions.wrap.on ? "WrapText" : "AlignLeft"}
                label={actions.wrap.on ? "Do not wrap lines" : "Wrap lines"}
                checked={actions.wrap.on}
                onPress={actions.wrap.toggle}
                tokens={tokens}
              />
            ) : null}
          </TooltipAlignContext.Provider>
        </View>
        {center ? <View testID="hover-preview-center" style={styles.toolbarCenter}>{center}</View> : null}
        <View style={styles.toolbarEnd}>
          {/* The group ends at the panel's right edge: names open leftwards. */}
          <TooltipAlignContext.Provider value="end">
            {toolbar}
            {windowButton}
          </TooltipAlignContext.Provider>
        </View>
      </View>
      {rest}
    </View>
  );
}

export function HoverPreviewBody({ children }: { children: ReactNode }) {
  const actions = useContext(PreviewActionsContext);
  const wrap = actions?.wrap;
  const maximized = actions?.maximized ?? false;
  // Lines keep their length; the body scrolls sideways, with a track under it
  // only while it is wider than the panel. The track keeps clear of the last
  // line's descenders.
  const content = wrap && !wrap.on ? (
    <HScroll tokens={wrap.tokens} trackGap={space.sm} contentContainerStyle={styles.unwrappedScroll}>
      <View style={styles.unwrapped}>{children}</View>
    </HScroll>
  ) : children;
  if (Platform.OS !== "web") {
    // The panel's height is capped; the body scrolls inside it. Its text takes
    // a long press as the start of a selection, with a cursor and handles.
    return (
      <ScrollView testID="hover-preview-body" style={styles.pressBody} contentContainerStyle={styles.pressBodyContent}>
        <ProseSelectionContext.Provider value>{content}</ProseSelectionContext.Provider>
      </ScrollView>
    );
  }
  return <View testID="hover-preview-body" style={[styles.body, maximized && styles.bodyFill]}>{content}</View>;
}

const styles = StyleSheet.create({
  panel: { padding: 0, borderWidth: 1, borderRadius: radiusV2.block },
  toolbar: { flexDirection: "row", alignItems: "center", gap: space.xs },
  // Equal flexible sides keep the centre slot in the middle of the panel.
  toolbarStart: { flex: 1, flexBasis: 0, flexDirection: "row", alignItems: "center", gap: space.xs },
  toolbarCenter: { flexShrink: 0 },
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
    paddingTop: PHONE_CHROME.top,
    paddingBottom: PHONE_CHROME.bottom,
  },
  pressPanel: { overflow: "hidden" },
  hidden: { opacity: 0 },
  pressBody: { flexGrow: 0, flexShrink: 1 },
  pressBodyContent: { padding: space.md, gap: space.sm },
  unwrappedScroll: { flexGrow: 1 },
  unwrapped: { flexGrow: 1, gap: space.sm },
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
