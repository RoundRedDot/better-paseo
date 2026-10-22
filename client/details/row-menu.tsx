import React, { useEffect, useLayoutEffect, useRef } from "react";
import { Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ExtendedThemeTokens } from "../components/theme-tokens";
import { toolbarLabel } from "../i18n/toolbar-strings";
import { useCopy } from "../ui/use-copy";
import { useReducedMotion } from "../ui/use-reduced-motion";
import { useEnhancerPreferences } from "../preferences";
import type { CopyItem } from "./contracts";

export interface RowMenuAnchor { x: number; y: number; width: number; height: number }
export interface RowMenuProps {
  anchor: RowMenuAnchor;
  title: string;
  subtitle?: readonly string[];
  hasBody: boolean;
  readsImage?: boolean;
  copyItems: readonly CopyItem[];
  tokens: ExtendedThemeTokens;
  onOpen(): void;
  onExpand(): void;
  onViewImage?(): void;
  onClose(): void;
}

/** A top-layer menu on web; a separate native window above the scrolling list. */
export function RowMenu(props: RowMenuProps) {
  const { anchor, tokens, onClose } = props;
  const { copy } = useCopy();
  const { language } = useEnhancerPreferences();
  const label = (text: string) => toolbarLabel(text, language);
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const layer = useRef<View>(null);
  const window = useWindowDimensions();
  const width = Math.min(280, Math.max(0, window.width - 16));
  const copies = props.hasBody ? props.copyItems : [{ id: "title", label: "Copy title", icon: "Copy", text: props.title }];
  const actions = [
    ...(props.readsImage && props.onViewImage ? [{ id: "viewer", label: "View image", icon: "Image", run: props.onViewImage }] : []),
    ...(props.hasBody ? [
      { id: "details", label: "Open details", icon: "PanelRight", run: props.onOpen },
      { id: "expand", label: "Expand in timeline", icon: "ChevronDown", run: props.onExpand },
    ] : []),
    ...copies.filter((item) => item.text).map((item) => ({ ...item, run: () => void copy(item.text, { feedback: "toast", label: item.label }) })),
  ];
  const header = props.readsImage ? props.subtitle?.join(" · ") : undefined;
  const height = Math.min(window.height - 16, actions.length * 44 + 12 + (header ? 32 : 0));
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
      <Animated.View testID="details-row-menu" role="menu" style={{
        position: "absolute", left, top, width, maxHeight: height, borderRadius: 12,
        backgroundColor: tokens.v2.surface0, borderColor: tokens.v2.border, borderWidth: StyleSheet.hairlineWidth,
        boxShadow: tokens.isDark ? "0px 8px 32px rgba(0,0,0,0.5)" : "0px 8px 32px rgba(0,0,0,0.12)",
        opacity: progress, transformOrigin: [Math.max(0, anchor.x - left), anchor.y + anchor.height / 2 - top, 0],
        transform: reduced ? undefined : [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
      }}>
        {/* Scrolls only when the menu is taller than the room; no track drawn beside it (Android drew one always). */}
        <ScrollView contentContainerStyle={{ paddingVertical: 6 }} showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
          {header ? <Text style={{ paddingHorizontal: 14, height: 32, color: tokens.foregroundMuted, fontFamily: tokens.fontUi, fontSize: 12 }}>{header}</Text> : null}
          {actions.map((item) => (
            <Pressable key={item.id} accessibilityRole="menuitem" accessibilityLabel={label(item.label)}
              onPress={() => { onClose(); item.run(); }}
              style={({ pressed }) => ({ height: 44, marginHorizontal: 6, paddingHorizontal: 8, borderRadius: 6,
                flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: pressed ? tokens.v2.surface2 : "transparent" })}>
              <Icon name={item.icon} size={16} color={tokens.foregroundMuted} />
              <Text style={{ fontFamily: tokens.fontUi, fontSize: 14, color: tokens.foreground }}>{label(item.label)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
  return Platform.OS === "web" ? content : (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>{content}</Modal>
  );
}
