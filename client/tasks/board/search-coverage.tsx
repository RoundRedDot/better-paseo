import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, View, useWindowDimensions } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text } from "../typography";
import { panelChrome } from "../cards/panel";
import { taskTokens } from "../cards/tokens";
import { useHover } from "../../ui/use-hover";
import { openToolbarDetailsLayer } from "../../web";
import { SearchSpinner, useSearchCoverage } from "./search-loading";

/** Board-wide information stays with the search, outside each lane's scroll. */
export function SearchCoverageItems(props: { theme: PluginTheme; phone?: boolean }) {
  const { context, counts: currentCounts } = useSearchCoverage();
  const active = Boolean(context?.query.trim());
  const visible = active && Boolean(currentCounts.unavailable || currentCounts.failed || currentCounts.retrying);
  const lastCounts = useRef(currentCounts);
  if (visible) lastCounts.current = currentCounts;
  const counts = visible ? currentCounts : lastCounts.current;
  const [present, setPresent] = useState(visible);
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const height = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (!active) { setPresent(false); opacity.setValue(0); height.setValue(0); return; }
    if (visible) setPresent(true);
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 120, useNativeDriver: Platform.OS !== "web", isInteraction: false }),
      Animated.timing(height, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: false, isInteraction: false }),
    ]);
    const timer = setTimeout(() => { if (!visible) setPresent(false); }, props.phone ? 160 : 120);
    animation.start();
    return () => { clearTimeout(timer); animation.stop(); };
  }, [active, visible, opacity, height, props.phone]);
  const anchor = useRef<View>(null);
  const panel = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(0);
  const [unavailableWidth, setUnavailableWidth] = useState(0);
  const [failureWidth, setFailureWidth] = useState(0);
  const [position, setPosition] = useState({ left: 16, top: 100 });
  const window = useWindowDimensions();
  const { hovered, hoverProps } = useHover(anchor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  useEffect(() => {
    cancel();
    if (hovered) timer.current = setTimeout(() => setOpen(true), 300);
    else timer.current = setTimeout(() => setOpen(false), 150);
    return cancel;
  }, [hovered]);
  useEffect(() => { setOpen(false); return cancel; }, [context?.query, visible]);
  useLayoutEffect(() => {
    if (!open || !visible) return;
    if (Platform.OS === "web") return openToolbarDetailsLayer(panel.current, anchor.current, "below");
    anchor.current?.measureInWindow((x, y, _width, height) => setPosition({ left: Math.max(8, Math.min(x, window.width - Math.min(340, window.width - 16) - 8)), top: Math.min(y + height + 6, window.height - 340) }));
  }, [open, visible, window.width, window.height]);
  useEffect(() => {
    if (!open || Platform.OS !== "web" || typeof document === "undefined") return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!(anchor.current as unknown as HTMLElement | null)?.contains(target) && !(panel.current as unknown as HTMLElement | null)?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      (anchor.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[role="button"]')?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  if (!active || (!visible && !present) || !context) return null;
  const strings = context.strings;
  const colors = props.theme.colors;
  const danger = taskTokens(props.theme).isDark ? "#F85149" : "#CF222E";
  const retrying = counts.retrying > 0;
  const failureText = retrying ? strings.retrying(counts.retrying) : strings.failed(counts.failed);
  const squeeze = width > 0 && unavailableWidth + (counts.failed || counts.retrying ? failureWidth : 0) + 2 > width;
  const toggle = () => { cancel(); setOpen((value) => !value); };
  const retry = () => { void context.status.retry(); };
  const textStyle = { fontSize: 13, lineHeight: 18, color: colors.foregroundMuted, fontVariant: ["tabular-nums" as const] };
  const retryButton = (id: string) => <Pressable testID={id} accessibilityRole="button" accessibilityLabel={strings.retry} onPress={retry} style={{ minHeight: props.phone ? 26 : 24, paddingHorizontal: 9, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0, alignItems: "center", justifyContent: "center" }}><Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: colors.foreground }}>{strings.retry}</Text></Pressable>;
  const failure = <>
    {retrying ? <SearchSpinner size={13} color={colors.foregroundMuted} /> : <Icon name="CircleAlert" size={15} color={danger} />}
    <Text numberOfLines={1} style={{ ...textStyle, color: retrying ? colors.foregroundMuted : colors.foreground, fontWeight: retrying ? "400" : "500" }}>{failureText}</Text>
  </>;
  const rows = [
    ...(counts.pending && !retrying ? [{ key: "pending", title: strings.reading(counts.pending), hint: strings.readingHint, icon: <SearchSpinner size={13} color={colors.foregroundMuted} /> }] : []),
    ...(counts.unavailable ? [{ key: "unavailable", title: strings.unavailable(counts.unavailable), hint: strings.unavailableHint, icon: <Icon name="MessageSquareOff" size={15} color={colors.foregroundMuted} /> }] : []),
    ...(counts.failed || retrying ? [{ key: "failed", title: failureText, hint: strings.failedHint, icon: retrying ? <SearchSpinner size={13} color={colors.foregroundMuted} /> : <Icon name="CircleAlert" size={15} color={danger} /> }] : []),
  ];
  const explanation = <View testID="search-coverage-popover" role="dialog" accessibilityLabel={strings.title} style={{ ...panelChrome(props.theme), borderRadius: 10, padding: 6 }}>
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foregroundMuted }}>{strings.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={strings.close} onPress={() => setOpen(false)}><Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{props.phone || Platform.OS !== "web" ? strings.close : "Esc"}</Text></Pressable>
    </View>
    {rows.map((row) => <View key={row.key} style={{ flexDirection: "row", gap: 8, paddingVertical: 7, paddingHorizontal: 8 }}>
      <View style={{ width: 15, height: 20, justifyContent: "center", alignItems: "center" }}>{row.icon}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ flex: 1, fontSize: 13, lineHeight: 20, fontWeight: "500", color: colors.foreground }}>{row.title}</Text>{row.key === "failed" && !retrying ? retryButton("search-coverage-popover-retry") : null}</View>
        <Text style={{ fontSize: 12.5, lineHeight: 19, color: colors.foregroundMuted }}>{row.hint}</Text>
      </View>
    </View>)}
  </View>;
  return <Animated.View testID="search-coverage-items" ref={anchor} collapsable={false} {...(Platform.OS === "web" ? {} : hoverProps)} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0, flexShrink: 1, height: props.phone ? height.interpolate({ inputRange: [0, 1], outputRange: [0, 32] }) : 28, opacity, marginTop: props.phone ? height.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }) : 0, marginHorizontal: props.phone ? 8 : 0, zIndex: open ? 40 : 1 }}>
    {counts.unavailable ? <Pressable testID="search-coverage-unavailable" accessibilityRole="button" accessibilityLabel={strings.unavailable(counts.unavailable)} accessibilityState={{ expanded: open }} hitSlop={props.phone ? { top: 6, bottom: 6 } : undefined} onPress={toggle} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, height: "100%", borderRadius: 7, backgroundColor: open || hovered ? colors.surface1 : "transparent" }}>
      <Icon name="MessageSquareOff" size={15} color={colors.foregroundMuted} />
      <Text numberOfLines={1} style={textStyle}>{squeeze ? counts.unavailable : strings.unavailable(counts.unavailable)}</Text>
      <Icon name="Info" size={14} color={colors.foregroundMuted} />
    </Pressable> : null}
    {counts.failed || retrying ? <View testID="search-coverage-failure" onLayout={(event) => setFailureWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 6, paddingHorizontal: 8, height: "100%" }}>
      <Pressable accessibilityRole="button" accessibilityLabel={failureText} accessibilityState={{ expanded: open }} hitSlop={props.phone ? { top: 6, bottom: 6 } : undefined} onPress={toggle} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{failure}</Pressable>
      {!retrying ? retryButton("search-coverage-retry") : null}
    </View> : null}
    {counts.unavailable ? <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: "absolute", opacity: 0 }}><Text onLayout={(event) => setUnavailableWidth(event.nativeEvent.layout.width + 15 + 14 + 12 + 16)} style={textStyle}>{strings.unavailable(counts.unavailable)}</Text></View> : null}
    {open && Platform.OS === "web" ? <View ref={panel} collapsable={false} style={{ position: "absolute", left: 0, top: "100%", paddingTop: 6, width: Math.min(props.phone ? 340 : 320, window.width - 16) }}>{explanation}</View> : null}
    {open && Platform.OS !== "web" ? <Modal transparent visible onRequestClose={() => setOpen(false)} animationType="none"><Pressable testID="search-coverage-backdrop" accessibilityLabel={strings.close} onPress={() => setOpen(false)} style={{ flex: 1 }}><Pressable onPress={(event) => event.stopPropagation()} style={{ position: "absolute", ...position, width: Math.min(props.phone ? 340 : 320, window.width - 16) }}>{explanation}</Pressable></Pressable></Modal> : null}
  </Animated.View>;
}
