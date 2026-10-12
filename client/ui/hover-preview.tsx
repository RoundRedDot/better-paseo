import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { selectionSurface } from "../components/selection-actions";
import { bindPreviewPointer, openPreviewLayer } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";
import { cssShadow } from "./tokens/css-shadow";

/** Prevent a path inside a preview-enabled header from opening a second layer. */
export const HoverPreviewContext = createContext(false);
export const PREVIEW_OPEN_MS = 400;
export const PREVIEW_CLOSE_MS = 150;

export function useHoverPreview(enabled: boolean) {
  const parentPreview = useContext(HoverPreviewContext);
  const capabilities = useInputCapabilities();
  const active = enabled && !parentPreview && Platform.OS === "web" && capabilities.hover;
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);
  const enter = useCallback(() => {
    cancel();
    if (!open) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setOpen(true);
      }, PREVIEW_OPEN_MS);
    }
  }, [cancel, open]);
  const leave = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setOpen(false);
    }, PREVIEW_CLOSE_MS);
  }, [cancel]);

  useEffect(() => {
    if (!active) {
      close();
      return;
    }
    return bindPreviewPointer(anchorRef.current, enter, leave);
  }, [active, enter, leave, close]);
  useEffect(() => cancel, [cancel]);
  return { anchorRef, open: active && open, enter, leave, close };
}

export function HoverPreview({ preview, tokens, children }: {
  preview: ReturnType<typeof useHoverPreview>;
  tokens: ExtendedThemeTokens;
  children: ReactNode;
}) {
  const panelRef = useRef<View>(null);
  useLayoutEffect(() => {
    const unbind = bindPreviewPointer(panelRef.current, preview.enter, preview.leave);
    const release = openPreviewLayer(panelRef.current, preview.anchorRef.current, preview.close);
    return () => {
      unbind();
      release();
    };
  }, [preview.anchorRef, preview.enter, preview.leave, preview.close]);
  return (
    <HoverPreviewContext.Provider value>
      <View
        ref={panelRef}
        {...selectionSurface}
        testID="hover-preview"
        style={[styles.panel, {
          backgroundColor: tokens.surface0,
          borderColor: tokens.v2.border,
          boxShadow: cssShadow(tokens.v2.elevation.overlay),
        }]}
      >
        {children}
      </View>
    </HoverPreviewContext.Provider>
  );
}

const styles = StyleSheet.create({
  panel: { width: 880, padding: space.md, gap: space.sm, borderWidth: 1, borderRadius: radiusV2.block },
});
