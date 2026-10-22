import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { useCopy } from "../ui/use-copy";
import { useReducedMotion } from "../ui/use-reduced-motion";
import { useHover } from "../ui/use-hover";
import { useInputCapabilities } from "../ui/use-input-capabilities";
import { useEnhancerPreferences } from "../preferences";
import type { CopyItem } from "./contracts";

/** A group divider: a hairline with 4 above and below, as Paseo's menus. */
const SEPARATOR = 9;

export interface RowMenuAnchor { x: number; y: number; width: number; height: number }
export interface RowMenuProps {
  anchor: RowMenuAnchor;
  title: string;
  subtitle?: readonly string[];
  hasBody: boolean;
  readsImage?: boolean;
  copyItems: readonly CopyItem[];
  /** The body is open in the timeline: the menu offers to close it. */
  expanded?: boolean;
  /** The row is the one the details panel shows: no "Open details". */
  detailsOpen?: boolean;
  tokens: ExtendedThemeTokens;
  onOpen(): void;
  onToggle(): void;
  onViewImage?(): void;
  onClose(): void;
}

/**
 * A top-layer menu on web; a separate native window above the scrolling list.
 *
 * Copies come first, in the order the row gives them: a tap already opens
 * the row, so what the menu adds is mostly getting text out. A hairline
 * splits them from the ways to look at the row (image, details, timeline).
 */
export function RowMenu(props: RowMenuProps) {
  const { anchor, tokens, onClose } = props;
  const { copy } = useCopy();
  const { language } = useEnhancerPreferences();
  const label = (text: string) => toolbarLabel(text, language);
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const layer = useRef<View>(null);
  const window = useWindowDimensions();
  // As wide as its longest label, between Paseo's menu minimum and a cap.
  // Placed with the cap until the panel has measured itself, so a menu by
  // the window's right edge never opens past it.
  const maxWidth = Math.min(280, Math.max(0, window.width - 16));
  const minWidth = Math.min(180, maxWidth);
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? maxWidth;
  // Text in the reader's block size, like the row it opened from; rows are
  // Paseo's menu pitch (line + 10) under a pointer and 44 under a finger.
  const block = tokens.typography.block;
  const touch = useInputCapabilities().touch;
  const rowHeight = touch ? 44 : block.label.lineHeight + 10;
  const copies = props.hasBody ? props.copyItems : [{ id: "title", label: "Copy title", icon: "Copy", text: props.title }];
  const groups = [
    copies.filter((item) => item.text).map((item) => ({ ...item, run: () => void copy(item.text, { feedback: "toast", label: item.label }) })),
    [
      ...(props.readsImage && props.onViewImage ? [{ id: "viewer", label: "View image", icon: "Image", run: props.onViewImage }] : []),
      ...(props.hasBody && !props.detailsOpen ? [{ id: "details", label: "Open details", icon: "PanelRight", run: props.onOpen }] : []),
      ...(props.hasBody ? [props.expanded
        ? { id: "collapse", label: "Collapse in timeline", icon: "ChevronUp", run: props.onToggle }
        : { id: "expand", label: "Expand in timeline", icon: "ChevronDown", run: props.onToggle }] : []),
    ],
  ].filter((group) => group.length > 0);
  const rows = groups.reduce((count, group) => count + group.length, 0);
  const header = props.readsImage ? props.subtitle?.join(" · ") : undefined;
  const height = Math.min(window.height - 16,
    rows * rowHeight + (groups.length - 1) * SEPARATOR + 12 + (header ? rowHeight : 0));
  const left = Math.max(8, Math.min(anchor.x, window.width - width - 8));
  const top = Math.max(8, Math.min(anchor.y + anchor.height, window.height - height - 8));
  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: reduced ? 120 : 160, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = layer.current as unknown as HTMLElement | null;
    if (!node) return;
    node.setAttribute("popover", "manual");
    node.showPopover();
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    node.ownerDocument.addEventListener("keydown", key, true);
    return () => {
      node.ownerDocument.removeEventListener("keydown", key, true);
      node.hidePopover();
    };
  }, [onClose]);
  const content = (
    <View ref={layer} testID="details-row-menu-layer" style={[
      StyleSheet.absoluteFill,
      Platform.OS === "web" && { position: "fixed", margin: 0, padding: 0, borderWidth: 0, width: "100%", height: "100%", backgroundColor: "transparent" } as never,
    ]}>
      <Pressable accessibilityLabel={label("Close menu")} onPress={onClose} style={StyleSheet.absoluteFill} />
      <Animated.View testID="details-row-menu" role="menu" onLayout={(event) => setMeasured(event.nativeEvent.layout.width)} style={{
        position: "absolute", left, top, minWidth, maxWidth, maxHeight: height, borderRadius: 12,
        backgroundColor: tokens.v2.surface0, borderColor: tokens.v2.border, borderWidth: StyleSheet.hairlineWidth,
        boxShadow: tokens.isDark ? "0px 8px 32px rgba(0,0,0,0.5)" : "0px 8px 32px rgba(0,0,0,0.12)",
        opacity: progress, transformOrigin: [Math.max(0, anchor.x - left), anchor.y + anchor.height / 2 - top, 0],
        transform: reduced ? undefined : [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      }}>
        {/* Scrolls only when the menu is taller than the room; no track drawn beside it (Android drew one always). */}
        <ScrollView contentContainerStyle={{ paddingVertical: 6 }} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
          {header ? (
            <Text numberOfLines={1} style={{ paddingHorizontal: 14, height: rowHeight, lineHeight: rowHeight, color: tokens.foregroundMuted,
              fontFamily: tokens.fontUi, fontSize: block.caption.size }}>{header}</Text>
          ) : null}
          {groups.map((group, index) => (
            <React.Fragment key={group[0]!.id}>
              {index > 0 ? <View style={{ height: StyleSheet.hairlineWidth, marginVertical: (SEPARATOR - 1) / 2, backgroundColor: tokens.v2.border }} /> : null}
              {group.map((item) => (
                <RowMenuItem key={item.id} label={label(item.label)} icon={item.icon} height={rowHeight} iconSize={touch ? 16 : 14}
                  tokens={tokens} onPress={() => { onClose(); item.run(); }} />
              ))}
            </React.Fragment>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
  return Platform.OS === "web" ? content : (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>{content}</Modal>
  );
}

function RowMenuItem(props: { label: string; icon: string; height: number; iconSize: number; tokens: ExtendedThemeTokens; onPress(): void }) {
  const { tokens } = props;
  const ref = useRef<View>(null);
  const { hovered, hoverProps } = useHover(ref);
  const block = tokens.typography.block;
  return (
    <Pressable ref={ref} accessibilityRole="menuitem" accessibilityLabel={props.label} onPress={props.onPress} {...hoverProps}
      style={({ pressed }) => ({ height: props.height, marginHorizontal: 6, paddingHorizontal: 8, borderRadius: 6,
        flexDirection: "row", alignItems: "center", gap: 8,
        backgroundColor: pressed || hovered ? tokens.v2.surface2 : "transparent" })}>
      <View style={{ flexShrink: 0 }}><Icon name={props.icon} size={props.iconSize} color={tokens.foregroundMuted} /></View>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: tokens.fontUi, fontSize: block.label.size,
        lineHeight: block.label.lineHeight, color: tokens.foreground }}>{props.label}</Text>
    </Pressable>
  );
}
