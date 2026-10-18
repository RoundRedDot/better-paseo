import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Animated, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewStyle, type StyleProp } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { useCopy } from "./use-copy";
import { useHover } from "./use-hover";
import { UI_SCALE } from "./tokens/typography";
import { cssShadow } from "./tokens/css-shadow";
import { FLOAT, floatShadow } from "./tokens/float";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { anchoredTooltipOrigin, liftStackingRow, placeTooltipNear, type DomBox, type TooltipPlacement, type WindowBox } from "./tooltip-placement";
import { bindDetailsEscape, bindRowHover, bindTouchDismiss, openToolbarDetailsLayer, suppressTouchCallout } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";
import { SafeInset } from "./safe-inset";
import { usePreviewEntrance } from "./use-preview-entrance";
import { PREVIEW_REVEAL } from "./tokens/motion";

/** How long a pointer rests on a button before its name shows. */
export const TOOLBAR_TOOLTIP_MS = 400;

const TOOLTIP_SLOT = 240;

/** Which edge of the button its name lines up with, so one at a panel edge stays inside it. */
export type TooltipAlign = "start" | "center" | "end";

/**
 * The alignment for the buttons of one group, set by whoever knows which
 * edge the group sits against: a name centred under the last button of a
 * right-aligned group would be cut off by the panel.
 */
export const TooltipAlignContext = createContext<TooltipAlign>("center");

/**
 * Which side a name opens on. A panel's toolbar has its own body below
 * (`below`). A timeline row does not: on web every row is a stacking context
 * that paints over the one before it, so a name below would vanish under the
 * next row; `auto` opens it above unless the list's top edge leaves no room.
 */
export const TooltipSideContext = createContext<"below" | "auto">("below");

interface ToolbarButtonProps {
  icon: string;
  /** Accessibility label; shown on hover in the settings page's language. */
  label: string;
  onPress(): void;
  tokens: ExtendedThemeTokens;
  disabled?: boolean;
  checked?: boolean;
  /** Icon colour; muted by default. */
  color?: string;
  align?: TooltipAlign;
  /** A subtle outline for a standalone button, outside a toolbar group, in the floating controls' frame. */
  outlined?: boolean;
}

/**
 * A 24pt icon button of a preview toolbar. A pointer resting on it shows its
 * name underneath; touch has no hover, so there the label is only spoken.
 */
export function ToolbarButton({ icon, color, tokens, ...props }: ToolbarButtonProps) {
  return <ToolbarItem {...props} tokens={tokens}>
    <Icon name={icon} size={14} color={color ?? tokens.foregroundMuted} />
  </ToolbarItem>;
}

/** A passive toolbar icon with the same hover name as the action buttons. */
export function ToolbarIcon({ children, ...props }: {
  children: ReactNode;
  label: string;
  tokens: ExtendedThemeTokens;
  align?: TooltipAlign;
}) {
  return <ToolbarItem {...props}>{children}</ToolbarItem>;
}

/** A labelled action using the toolbar's shared hover hint and placement. */
export function ToolbarItem({
  children,
  label,
  onPress,
  tokens,
  disabled = false,
  checked,
  align: alignProp,
  outlined = false,
  buttonStyle,
  hitSlop = 4,
  accessibilityLabel = label,
  details,
  detailsWidth = TOOLTIP_SLOT,
  onLongPress,
}: Omit<ToolbarButtonProps, "icon" | "color" | "onPress"> & {
  children: ReactNode;
  onPress?: () => void;
  buttonStyle?: StyleProp<ViewStyle>;
  hitSlop?: number;
  accessibilityLabel?: string;
  /** Interactive hover content; a long press opens it on touch screens. */
  details?: ReactNode;
  detailsWidth?: number;
  onLongPress?: (anchor: RefObject<View | null>) => void;
}) {
  const groupAlign = useContext(TooltipAlignContext);
  const sideMode = useContext(TooltipSideContext);
  const anchorRef = useRef<View>(null);
  const detailsRef = useRef<View>(null);
  const [side, setSide] = useState<TooltipPlacement>("below");
  const preferences = useEnhancerPreferences();
  const capabilities = useInputCapabilities();
  const align = alignProp ?? groupAlign;
  // A disabled Pressable suppresses hover; its outer slot still receives it.
  const { hovered, hoverProps } = useHover(disabled ? anchorRef : undefined);
  const [named, setNamed] = useState(false);
  const [insideDetails, setInsideDetails] = useState(false);
  const [pressedOpen, setPressedOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const closeDetails = useCallback(() => {
    setPressedOpen(false);
    setNamed(false);
    setInsideDetails(false);
    setFocused(false);
  }, []);
  const open = named || pressedOpen;
  useLayoutEffect(() => {
    if (!details || !open || Platform.OS !== "web") return;
    // RNW Pressables end their parent's hover when a nested action takes it.
    // Track the entire DOM region so copy buttons remain part of the panel.
    const releaseLayer = openToolbarDetailsLayer(detailsRef.current, anchorRef.current, side);
    const releaseHover = bindRowHover(detailsRef.current, () => setInsideDetails(true), () => setInsideDetails(false));
    return () => { releaseHover(); releaseLayer(); };
  }, [Boolean(details), open, side]);
  useEffect(() => {
    if (details) suppressTouchCallout(anchorRef.current);
  }, [details]);
  useEffect(() => {
    if (!details || !open || Platform.OS !== "web") return;
    const release = bindTouchDismiss(anchorRef.current, closeDetails, { allowInsideScroll: true });
    const doc = (anchorRef.current as unknown as HTMLElement | null)?.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeDetails(); };
    doc?.addEventListener("keydown", onKeyDown);
    return () => { release(); doc?.removeEventListener("keydown", onKeyDown); };
  }, [details, open, closeDetails]);
  useEffect(() => {
    if (!hovered && !insideDetails && !focused) {
      // Leave time to cross from the trigger into the interactive bubble.
      if (details) {
        const timer = setTimeout(() => setNamed(false), 120);
        return () => clearTimeout(timer);
      }
      setNamed(false);
      return;
    }
    const timer = setTimeout(() => {
      setSide(sideMode === "auto" ? placeTooltipNear(anchorRef.current, Platform.OS, details ? 320 : undefined) : "below");
      setNamed(true);
    }, TOOLBAR_TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [hovered, insideDetails, focused, details, sideMode]);
  useEffect(() => {
    if (details || !open || sideMode !== "auto" || side !== "below" || Platform.OS !== "web") return;
    return liftStackingRow(anchorRef.current as unknown as DomBox | null);
  }, [Boolean(details), open, sideMode, side]);
  const bubble = details ? <ToolbarDetailsFrame tokens={tokens} side={side}>{details}</ToolbarDetailsFrame> : (
    <View style={[styles.tooltip, tooltipLook(tokens)]}>
      <Text selectable={false} numberOfLines={1}
        style={[styles.tooltipText, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
        {toolbarLabel(label, preferences.language)}
      </Text>
    </View>
  );
  return (
    // Every web View is its own stacking context (`z-index: 0`), so the name
    // can only rise over the buttons after this one if the button does.
    <View ref={anchorRef} collapsable={details || onLongPress ? false : undefined} style={[styles.anchor, open && styles.raised]}>
      <Pressable
        accessibilityRole={onPress ? "button" : "image"}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={onPress ? checked === undefined ? { disabled } : { disabled, checked } : undefined}
        focusable={onPress ? undefined : false}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={disabled ? undefined : onPress}
        onLongPress={!disabled && (details || onLongPress) ? () => {
          if (onLongPress) return onLongPress(anchorRef);
          setSide(sideMode === "auto" ? placeTooltipNear(anchorRef.current, Platform.OS, 320) : "below");
          setPressedOpen(true);
        } : undefined}
        onFocus={details && capabilities.hover ? () => setFocused(true) : undefined}
        onBlur={details ? () => setFocused(false) : undefined}
        {...hoverProps}
        style={({ pressed }) => [
          styles.button,
          Platform.OS === "web" && onPress && styles.pointer,
          outlined && styles.outlined,
          outlined && { borderColor: tokens.v2.border },
          buttonStyle,
          disabled && styles.disabled,
          onPress && !disabled && hovered && { backgroundColor: tokens.v2.surface2 },
          onPress && !disabled && pressed && { backgroundColor: tokens.v2.surface2 },
        ]}
      >
        {children}
      </Pressable>
      {pressedOpen && Platform.OS !== "web" ? (
        <AnchoredToolbarDetails anchor={anchorRef} close={closeDetails} width={detailsWidth} tokens={tokens}>{details}</AnchoredToolbarDetails>
      ) : open ? (
        <View pointerEvents={details ? "box-none" : "none"}
          style={[styles.tooltipSlot, side === "above" ? styles.above : styles.below, ALIGN[align],
            details ? { width: detailsWidth, marginTop: 0, marginBottom: 0 } : null]}>
          {details ? (
            <Pressable ref={detailsRef} accessible={false} focusable={false}
              // Padding keeps the visible gap inside the panel's hover target.
              style={side === "above" ? styles.detailsAbove : styles.detailsBelow}
              onFocus={capabilities.hover ? () => setFocused(true) : undefined}
              onBlur={() => setFocused(false)}
              onHoverIn={Platform.OS !== "web" ? () => setInsideDetails(true) : undefined}
              onHoverOut={Platform.OS !== "web" ? () => setInsideDetails(false) : undefined}>
              {bubble}
            </Pressable>
          ) : bubble}
        </View>
      ) : null}
    </View>
  );
}

/** A centered reading surface for long-press details. */
export function CenteredToolbarDetails({ close, children, tokens, width = TOOLTIP_SLOT }: {
  close(): void;
  children: ReactNode;
  width?: number;
  tokens: ExtendedThemeTokens;
}) {
  const window = useWindowDimensions();
  const panelRef = useRef<View>(null);
  const [shown, setShown] = useState(Platform.OS === "web");
  const [laidOut, setLaidOut] = useState(false);
  useEffect(() => bindDetailsEscape(panelRef.current, close), [close]);
  // SafeInset owns the status-bar spacing, matching the other native previews.
  return <Modal visible transparent animationType="none" onShow={() => setShown(true)} onRequestClose={close} statusBarTranslucent>
    <Pressable accessibilityRole="button" accessibilityLabel="Close preview"
      onPress={close} style={StyleSheet.absoluteFill} />
    <SafeInset pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View testID="footer-details-center" pointerEvents="box-none"
        style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 8 }}>
        <View ref={panelRef} testID="toolbar-details-panel" accessibilityViewIsModal
          onLayout={({ nativeEvent: { layout } }) => {
            if (layout.width > 0 && layout.height > 0) setLaidOut(true);
          }}
          style={{ width: Math.min(width, window.width - 16), maxWidth: "100%" }}>
          <ToolbarDetailsFrame tokens={tokens} ready={shown && laidOut}>{children}</ToolbarDetailsFrame>
        </View>
      </View>
    </SafeInset>
  </Modal>;
}

/** The modal avoids clipping by native timeline rows; its panel stays by the pressed control. */
export function AnchoredToolbarDetails({ anchor, close, children, tokens, width = TOOLTIP_SLOT }: {
  anchor: RefObject<View | null>;
  close(): void;
  children: ReactNode;
  width?: number;
  tokens: ExtendedThemeTokens;
}) {
  const stageRef = useRef<View>(null);
  const [bounds, setBounds] = useState<{ anchor: WindowBox; stage: WindowBox } | null>(null);
  const [panel, setPanel] = useState<{ width: number; height: number } | null>(null);
  const [shown, setShown] = useState(false);
  const measure = useCallback(() => {
    stageRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      const stage = { x, y, width, height };
      anchor.current?.measureInWindow((x, y, width, height) => {
        setBounds({ stage, anchor: { x, y, width, height } });
      });
    });
  }, [anchor]);
  const origin = bounds && panel ? anchoredTooltipOrigin(bounds.anchor, bounds.stage, panel) : null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={close} onShow={() => { setShown(true); measure(); }} statusBarTranslucent>
      <Pressable accessibilityRole="button" accessibilityLabel="Close preview"
        onPress={close} style={StyleSheet.absoluteFill} />
      <SafeInset pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View ref={stageRef} collapsable={false} testID="toolbar-details-stage" pointerEvents="box-none"
          onLayout={measure} style={{ flex: 1 }}>
          <View testID="toolbar-details-panel" accessibilityViewIsModal
            pointerEvents={origin ? "auto" : "none"} accessibilityElementsHidden={!origin}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setPanel((previous) => previous?.width === width && previous.height === height ? previous : { width, height });
            }}
            style={{ position: "absolute", width: bounds ? Math.min(width, bounds.stage.width - 16) : width,
              maxWidth: "100%", opacity: origin ? 1 : 0, left: origin?.left ?? 0, top: origin?.top ?? 0 }}>
            <ToolbarDetailsFrame tokens={tokens} ready={shown && origin !== null}>
              {children}
            </ToolbarDetailsFrame>
          </View>
        </View>
      </SafeInset>
    </Modal>
  );
}

/** Shared frame; the entrance matches the hover preview without changing its measured bounds. */
export function ToolbarDetailsFrame({ tokens, children, side = "above", ready = true }: {
  tokens: ExtendedThemeTokens; children: ReactNode; side?: TooltipPlacement; ready?: boolean;
}) {
  const entrance = usePreviewEntrance({ ready, from: side === "below" ? -PREVIEW_REVEAL.shift : PREVIEW_REVEAL.shift });
  return <Animated.View style={entrance}>
    <View testID="toolbar-details-frame" style={{ backgroundColor: tokens.surface0, borderColor: tokens.v2.border,
      borderWidth: 1, borderRadius: FLOAT.radius, boxShadow: floatShadow(tokens) }}>
      <View style={{ borderRadius: FLOAT.radius - 1, overflow: "hidden" }}>{children}</View>
    </View>
  </Animated.View>;
}

/** A toolbar button that copies; its icon turns into a check for 1.2 s once the text is on the clipboard. */
export function ToolbarCopyButton({ text, icon = "Copy", label, tokens, align, outlined }: {
  /** The raw text, or a function that builds it only when pressed. */
  text: string | (() => string);
  icon?: string;
  label: string;
  tokens: ExtendedThemeTokens;
  align?: TooltipAlign;
  outlined?: boolean;
}) {
  const { copied, copy } = useCopy();
  const onPress = useCallback(() => {
    const value = typeof text === "function" ? text() : text;
    if (value) void copy(value, { feedback: "icon", label });
  }, [copy, text]);
  return (
    <ToolbarButton
      icon={copied ? "Check" : icon}
      label={copied ? "Copied" : label}
      color={copied ? tokens.foreground : undefined}
      onPress={onPress}
      tokens={tokens}
      align={align}
      outlined={outlined}
    />
  );
}

/**
 * An opaque bubble: the v2 surfaces are tints of the foreground, and the
 * code under a name would show through one.
 */
function tooltipLook(tokens: ExtendedThemeTokens) {
  return {
    backgroundColor: tokens.surface0,
    borderColor: tokens.v2.border,
    boxShadow: cssShadow({
      ...tokens.v2.elevation.overlay,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 8,
      shadowOpacity: tokens.isDark ? 0.36 : 0.12,
    }),
  };
}

// The slot is wider than any name and the bubble sits at one end or in the
// middle of it, so no measuring is needed to centre it under the button.
const ALIGN = StyleSheet.create({
  start: { left: 0, width: TOOLTIP_SLOT, alignItems: "flex-start" },
  center: { left: 12 - TOOLTIP_SLOT / 2, width: TOOLTIP_SLOT, alignItems: "center" },
  end: { right: 0, width: TOOLTIP_SLOT, alignItems: "flex-end" },
});

const styles = StyleSheet.create({
  anchor: { position: "relative", flexShrink: 0 },
  raised: { zIndex: 1 },
  button: {
    width: 24,
    height: 24,
    borderRadius: radiusV2.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  pointer: { cursor: "pointer" } as ViewStyle,
  // A standalone button takes the floating controls' frame (float.ts), so the
  // table's touch button matches the menu a pointer opens.
  outlined: { width: FLOAT.control, height: FLOAT.control, borderWidth: 1, borderRadius: FLOAT.radius },
  disabled: { opacity: 0.35 },
  tooltipSlot: {
    position: "absolute",
    zIndex: 10,
  },
  below: { top: "100%", marginTop: space.xs },
  above: { bottom: "100%", marginBottom: space.xs },
  detailsAbove: { paddingBottom: space.xs },
  detailsBelow: { paddingTop: space.xs },
  tooltip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radiusV2.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tooltipText: { fontSize: UI_SCALE.base, lineHeight: 18, whiteSpace: "nowrap" } as object,
});
