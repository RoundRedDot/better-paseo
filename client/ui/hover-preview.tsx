import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { selectionSurface } from "../components/selection-actions";
import { bindPreviewPointer, openPreviewLayer } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";
import { cssShadow } from "./tokens/css-shadow";
import { DEFAULT_PREFERENCES, HOVER_DELAY_MS, useEnhancerPreferences } from "../preferences";
import { useHover } from "./use-hover";
import { SafeInset } from "./safe-inset";
import { pressPreviewPlacement, type WindowRect } from "./press-preview-placement";

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
} | null>(null);
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

export function HoverPreview(props: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  children: ReactNode;
}) {
  return Platform.OS === "web" ? <WebPreview {...props} /> : <PressPreview {...props} />;
}

function WebPreview({ preview, tokens, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  children: ReactNode;
}) {
  const panelRef = useRef<View>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const unbind = bindPreviewPointer(panelRef.current, preview.enter, preview.leave);
    const release = openPreviewLayer(panelRef.current, preview.anchorRef.current, preview.close, {
      maximized: preview.maximized,
      onOverflow: setOverflowing,
    });
    return () => {
      unbind();
      release();
    };
  }, [preview.anchorRef, preview.enter, preview.leave, preview.close, preview.maximized]);
  return (
    <HoverPreviewContext.Provider value>
      <PreviewActionsContext.Provider value={{ overflowing, maximized: preview.maximized, maximize: preview.maximize, close: preview.close }}>
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
 * transparent modal, placed on the row that was pressed (`pressPreviewPlacement`).
 * The modal is the only layer a plugin can raise above the timeline, and it
 * keeps the list from scrolling out from under the panel. A press outside the
 * panel or Android's back button closes it. The panel stays hidden until the
 * row and the safe area are measured, so it never flashes in the wrong place.
 */
function PressPreview({ preview, tokens, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  children: ReactNode;
}) {
  const [row, setRow] = useState<WindowRect | null>(null);
  const [stage, setStage] = useState<WindowRect | null>(null);
  const [origin, setOrigin] = useState<WindowRect | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const stageRef = useRef<View>(null);
  const originRef = useRef<View>(null);
  const { anchorRef, close } = preview;
  useLayoutEffect(() => {
    measureWindowRect(anchorRef.current, setRow);
  }, [anchorRef]);
  const onStageLayout = useCallback(() => measureWindowRect(stageRef.current, setStage), []);
  const onOriginLayout = useCallback(() => measureWindowRect(originRef.current, setOrigin), []);
  const onPanelLayout = useCallback((event: LayoutChangeEvent) => {
    setPanelHeight(event.nativeEvent.layout.height);
  }, []);
  const placement = row && stage && origin ? pressPreviewPlacement(row, stage, panelHeight, origin) : null;
  const ready = placement !== null && (!placement.above || panelHeight !== null);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close preview"
        onPress={close}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      />
      {/* Where the modal itself starts, in the coordinates the row was measured in. */}
      <View ref={originRef} onLayout={onOriginLayout} pointerEvents="none" style={StyleSheet.absoluteFill} />
      <SafeInset pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View ref={stageRef} onLayout={onStageLayout} style={styles.stage} />
      </SafeInset>
      <HoverPreviewContext.Provider value>
        <PreviewActionsContext.Provider value={{ overflowing: false, maximized: false, maximize: preview.maximize, close }}>
          <View
            {...selectionSurface}
            testID="hover-preview"
            accessibilityViewIsModal
            onLayout={onPanelLayout}
            style={[
              styles.panel,
              styles.pressPanel,
              panelLook(tokens),
              placement
                ? { left: placement.left, width: placement.width, top: placement.top, maxHeight: placement.maxHeight }
                : null,
              !ready && styles.hidden,
            ]}
          >
            {children}
          </View>
        </PreviewActionsContext.Provider>
      </HoverPreviewContext.Provider>
    </Modal>
  );
}

function measureWindowRect(node: unknown, done: (rect: WindowRect) => void) {
  const view = node as {
    measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
  } | null;
  view?.measureInWindow?.((x, y, width, height) => {
    if ([x, y, width, height].every(Number.isFinite)) done({ x, y, width, height });
  });
}

/** Only mounted in web hover previews; the actions and their menu stay above the scrolling body. */
export function HoverPreviewHeader({ tokens, children }: {
  tokens: ExtendedThemeTokens;
  children: ReactNode;
}) {
  const actions = useContext(PreviewActionsContext);
  const [toolbar, ...rest] = React.Children.toArray(children);
  return (
    <View
      testID="hover-preview-header"
      style={[styles.header, { backgroundColor: tokens.v2.surface1, borderBottomColor: tokens.v2.borderSubtle }]}
    >
      <View style={styles.toolbar}>
        {actions && (actions.overflowing || actions.maximized) ? (
          <PreviewWindowButton tokens={tokens} maximized={actions.maximized}
            onPress={actions.maximized ? actions.close : actions.maximize} />
        ) : null}
        {toolbar}
      </View>
      {rest}
    </View>
  );
}

function PreviewWindowButton({ tokens, maximized, onPress }: {
  tokens: ExtendedThemeTokens;
  maximized: boolean;
  onPress(): void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={maximized ? "Close preview" : "Maximize preview"}
      hitSlop={4} onPress={onPress} {...hoverProps}
      style={({ pressed }) => [styles.windowButton,
        hovered && { backgroundColor: tokens.v2.surface1 },
        pressed && { backgroundColor: tokens.v2.surface2 }]}
    >
      <Icon name={maximized ? "X" : "Maximize2"} size={14} color={tokens.foregroundMuted} />
    </Pressable>
  );
}

export function HoverPreviewBody({ children }: { children: ReactNode }) {
  if (Platform.OS !== "web") {
    // The panel's height is capped; the body scrolls inside it.
    return (
      <ScrollView testID="hover-preview-body" style={styles.pressBody} contentContainerStyle={styles.pressBodyContent}>
        {children}
      </ScrollView>
    );
  }
  return <View testID="hover-preview-body" style={styles.body}>{children}</View>;
}

const styles = StyleSheet.create({
  panel: { padding: 0, borderWidth: 1, borderRadius: radiusV2.block },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.xs },
  windowButton: { width: 24, height: 24, borderRadius: radiusV2.chip, alignItems: "center", justifyContent: "center" },
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
  backdrop: { backgroundColor: "rgba(0, 0, 0, 0.2)" },
  stage: { flex: 1 },
  pressPanel: { position: "absolute", overflow: "hidden" },
  hidden: { opacity: 0 },
  pressBody: { flexGrow: 0, flexShrink: 1 },
  pressBodyContent: { padding: space.md, gap: space.sm },
  header: {
    flexShrink: 0,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
  },
});
