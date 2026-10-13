import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { radiusV2, space } from "../components/theme-tokens";
import { unselectable } from "../components/selection";
import { useCopy } from "./use-copy";
import { useHover } from "./use-hover";
import { UI_SCALE } from "./tokens/typography";
import { cssShadow } from "./tokens/css-shadow";
import { useEnhancerPreferences } from "../preferences";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { liftStackingRow, placeTooltipNear, type DomBox, type TooltipPlacement } from "./tooltip-placement";

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

function ToolbarItem({
  children,
  label,
  onPress,
  tokens,
  disabled = false,
  checked,
  align: alignProp,
}: Omit<ToolbarButtonProps, "icon" | "color" | "onPress"> & { children: ReactNode; onPress?: () => void }) {
  const groupAlign = useContext(TooltipAlignContext);
  const sideMode = useContext(TooltipSideContext);
  const anchorRef = useRef<View>(null);
  const [side, setSide] = useState<TooltipPlacement>("below");
  const preferences = useEnhancerPreferences();
  const align = alignProp ?? groupAlign;
  const { hovered, hoverProps } = useHover();
  const [named, setNamed] = useState(false);
  useEffect(() => {
    if (!hovered) {
      setNamed(false);
      return;
    }
    const timer = setTimeout(() => {
      setSide(sideMode === "auto" ? placeTooltipNear(anchorRef.current, Platform.OS) : "below");
      setNamed(true);
    }, TOOLBAR_TOOLTIP_MS);
    return () => clearTimeout(timer);
  }, [hovered, sideMode]);
  useEffect(() => {
    if (!named || sideMode !== "auto" || side !== "below" || Platform.OS !== "web") return;
    return liftStackingRow(anchorRef.current as unknown as DomBox | null);
  }, [named, sideMode, side]);
  return (
    // Every web View is its own stacking context (`z-index: 0`), so the name
    // can only rise over the buttons after this one if the button does.
    <View ref={anchorRef} style={[styles.anchor, named && styles.raised]}>
      <Pressable
        accessibilityRole={onPress ? "button" : "image"}
        accessibilityLabel={label}
        accessibilityState={onPress ? checked === undefined ? { disabled } : { disabled, checked } : undefined}
        focusable={onPress ? undefined : false}
        disabled={disabled}
        hitSlop={4}
        onPress={onPress}
        {...hoverProps}
        style={({ pressed }) => [
          styles.button,
          disabled && styles.disabled,
          onPress && !disabled && hovered && { backgroundColor: tokens.v2.surface2 },
          onPress && !disabled && pressed && { backgroundColor: tokens.v2.surface2 },
        ]}
      >
        {children}
      </Pressable>
      {named ? (
        <View pointerEvents="none" style={[styles.tooltipSlot, side === "above" ? styles.above : styles.below, ALIGN[align]]}>
          <View style={[styles.tooltip, tooltipLook(tokens)]}>
            <Text
              selectable={false}
              numberOfLines={1}
              style={[styles.tooltipText, unselectable, { color: tokens.foreground, fontFamily: tokens.fontUi }]}
            >
              {toolbarLabel(label, preferences.language)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** A toolbar button that copies; its icon turns into a check for 1.2 s once the text is on the clipboard. */
export function ToolbarCopyButton({ text, icon = "Copy", label, tokens, align }: {
  /** The raw text, or a function that builds it only when pressed. */
  text: string | (() => string);
  icon?: string;
  label: string;
  tokens: ExtendedThemeTokens;
  align?: TooltipAlign;
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
  anchor: { position: "relative" },
  raised: { zIndex: 1 },
  button: {
    width: 24,
    height: 24,
    borderRadius: radiusV2.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.35 },
  tooltipSlot: {
    position: "absolute",
    zIndex: 10,
  },
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
