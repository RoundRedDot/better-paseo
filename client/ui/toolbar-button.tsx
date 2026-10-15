import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View, type ViewStyle, type StyleProp } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { useCopy } from "./use-copy";
import { useHover } from "./use-hover";
import { UI_SCALE } from "./tokens/typography";
import { cssShadow } from "./tokens/css-shadow";
import { FLOAT } from "./tokens/float";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { liftStackingRow, placeTooltipNear, type DomBox, type TooltipPlacement } from "./tooltip-placement";
import { bindTouchDismiss, suppressTouchCallout } from "../web";
import { useInputCapabilities } from "./use-input-capabilities";

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
}: Omit<ToolbarButtonProps, "icon" | "color" | "onPress"> & {
  children: ReactNode;
  onPress?: () => void;
  buttonStyle?: StyleProp<ViewStyle>;
  hitSlop?: number;
  accessibilityLabel?: string;
  /** Interactive hover content; a long press opens it on touch screens. */
  details?: ReactNode;
}) {
  const groupAlign = useContext(TooltipAlignContext);
  const sideMode = useContext(TooltipSideContext);
  const anchorRef = useRef<View>(null);
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
  useEffect(() => {
    if (details) suppressTouchCallout(anchorRef.current);
  }, [details]);
  useEffect(() => {
    if (!details || !open || Platform.OS !== "web") return;
    const release = bindTouchDismiss(anchorRef.current, closeDetails);
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
      setSide(sideMode === "auto" ? placeTooltipNear(anchorRef.current, Platform.OS, details ? 128 : undefined) : "below");
      setNamed(true);
    }, TOOLBAR_TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [hovered, insideDetails, focused, details, sideMode]);
  useEffect(() => {
    if (!open || sideMode !== "auto" || side !== "below" || Platform.OS !== "web") return;
    return liftStackingRow(anchorRef.current as unknown as DomBox | null);
  }, [open, sideMode, side]);
  const bubble = (
    <View style={[styles.tooltip, tooltipLook(tokens)]}>
      <Text selectable={false} numberOfLines={1}
        style={[styles.tooltipText, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}>
        {toolbarLabel(label, preferences.language)}
      </Text>
      {details}
    </View>
  );
  return (
    // Every web View is its own stacking context (`z-index: 0`), so the name
    // can only rise over the buttons after this one if the button does.
    <View ref={anchorRef} style={[styles.anchor, open && styles.raised]}>
      <Pressable
        accessibilityRole={onPress ? "button" : "image"}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={onPress ? checked === undefined ? { disabled } : { disabled, checked } : undefined}
        focusable={onPress ? undefined : false}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={disabled ? undefined : onPress}
        onLongPress={details && !disabled ? () => {
          setSide(sideMode === "auto" ? placeTooltipNear(anchorRef.current, Platform.OS, 128) : "below");
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
        <Modal visible transparent animationType="fade" onRequestClose={closeDetails}>
          <View style={styles.detailsStage}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close preview"
              onPress={closeDetails} style={StyleSheet.absoluteFill} />
            <View accessibilityViewIsModal style={{ maxWidth: "100%" }}>{bubble}</View>
          </View>
        </Modal>
      ) : open ? (
        <View pointerEvents={details ? "box-none" : "none"}
          style={[styles.tooltipSlot, side === "above" ? styles.above : styles.below, ALIGN[align]]}>
          {details ? (
            <Pressable accessible={false} focusable={false}
              onFocus={capabilities.hover ? () => setFocused(true) : undefined}
              onBlur={() => setFocused(false)}
              onHoverIn={() => setInsideDetails(true)} onHoverOut={() => setInsideDetails(false)}>
              {bubble}
            </Pressable>
          ) : bubble}
        </View>
      ) : null}
    </View>
  );
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
  detailsStage: { flex: 1, justifyContent: "center", alignItems: "center", padding: space.lg },
  below: { top: "100%", marginTop: space.xs },
  above: { bottom: "100%", marginBottom: space.xs },
  tooltip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: radiusV2.chip,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tooltipText: { fontSize: UI_SCALE.base, lineHeight: 18, whiteSpace: "nowrap" } as object,
});
