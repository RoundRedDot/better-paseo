import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { selectionSurface } from "../components/selection-actions";
import { bindPreviewPointer, openPreviewLayer } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";
import { cssShadow } from "./tokens/css-shadow";
import { DEFAULT_PREFERENCES, HOVER_DELAY_MS, useEnhancerPreferences } from "../preferences";
import { useHover } from "./use-hover";

/** Prevent a path inside a preview-enabled header from opening a second layer. */
export const HoverPreviewContext = createContext(false);
const PreviewActionsContext = createContext<{
  overflowing: boolean;
  maximized: boolean;
  maximize(): void;
  close(): void;
} | null>(null);
export const PREVIEW_OPEN_MS = HOVER_DELAY_MS[DEFAULT_PREFERENCES.hoverDelay];
export const PREVIEW_CLOSE_MS = 150;

export function useHoverPreview(enabled: boolean) {
  const parentPreview = useContext(HoverPreviewContext);
  const capabilities = useInputCapabilities();
  const preferences = useEnhancerPreferences();
  const delay = HOVER_DELAY_MS[preferences.hoverDelay];
  const active = enabled && preferences.hoverPreview && !parentPreview && Platform.OS === "web" && capabilities.hover;
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
  const enter = useCallback(() => {
    cancel();
    if (!active) return;
    if (!open) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(true);
      }, delay);
    }
  }, [cancel, active, open, delay]);
  const leave = useCallback(() => {
    cancel();
    if (!active || pinned.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, PREVIEW_CLOSE_MS);
  }, [cancel, active]);

  useEffect(() => {
    if (!active) {
      close();
      return;
    }
    return bindPreviewPointer(anchorRef.current, enter, leave);
  }, [active, enter, leave, close]);
  useEffect(() => cancel, [cancel]);
  return { anchorRef, open: active && open, maximized, maximize, enter, leave, close };
}

export function HoverPreview({ preview, tokens, children }: {
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
          style={[styles.panel, {
            backgroundColor: tokens.surface0,
            borderColor: tokens.v2.border,
            boxShadow: cssShadow({
              ...tokens.v2.elevation.overlay,
              shadowOffset: { width: 0, height: 8 },
              shadowRadius: 24,
              shadowOpacity: tokens.isDark ? 0.36 : 0.22,
            }),
          }]}
        >
          {children}
        </View>
      </PreviewActionsContext.Provider>
    </HoverPreviewContext.Provider>
  );
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
  header: {
    flexShrink: 0,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
  },
});
