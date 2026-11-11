import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, Pressable, View, useWindowDimensions } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, taskControlHeight, useTasksFontScale } from "../typography";
import { panelChrome } from "../cards/panel";
import { taskTokens } from "../cards/tokens";
import { liftStyle, scaleStyle, surfaceLift } from "../cards/surface-lift";
import { usePressCue } from "../cards/action-pressable";
import { useHover } from "../../ui/use-hover";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { openToolbarDetailsLayer } from "../../web";
import { SearchSpinner, useSearchCoverage } from "./search-loading";

/**
 * Board-wide information stays with the search, outside each lane's scroll:
 * how many tasks' messages are loaded while a read is running, a stopped
 * search, and a failed history page. Reads that fail are not offered a retry:
 * their prerequisites (a closed session, a missing directory, an unavailable
 * provider) do not change between attempts.
 *
 * While the desktop search field is on screen the count sits inside it as the
 * `badge` part — a bare number beside the spinner, no repeated "loaded"
 * wording — and only the stopped/failed notices keep their place in the
 * toolbar as the `notice` part. Tablet summaries use compact counts and
 * retry targets; the resume button carries the stopped-state explanation.
 */
export function SearchCoverageItems(props: { theme: PluginTheme; phone?: boolean; part?: "all" | "badge" | "notice"; compact?: boolean; compactLabels?: { stopped: string; failed: string } }) {
  const scale = useTasksFontScale();
  const target = taskControlHeight(32, scale);
  const part = props.part ?? "all";
  const badge = part === "badge" || props.compact;
  const showsBadge = part !== "notice";
  const showsNotice = part !== "badge";
  const { context, counts: currentCounts } = useSearchCoverage();
  const active = Boolean(context?.query.trim());
  const visible = active && Boolean((showsNotice && (((!props.compact || props.compactLabels) && context?.cancelled) || context?.historyError)) || (showsBadge && currentCounts.pending && (!props.compact || !context?.cancelled)));
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
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 120, useNativeDriver: false, isInteraction: false }),
      Animated.timing(height, { toValue: visible ? 1 : 0, duration: 160, useNativeDriver: false, isInteraction: false }),
    ]);
    const timer = setTimeout(() => { if (!visible) setPresent(false); }, props.phone ? 160 : 120);
    animation.start();
    return () => { clearTimeout(timer); animation.stop(); };
  }, [active, visible, opacity, height, props.phone]);
  const anchor = useRef<View>(null);
  const panel = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 100 });
  const window = useWindowDimensions();
  const { hovered, hoverProps } = useHover(anchor);
  const loadedPress = usePressCue(hovered);
  const reduced = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
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
  const toggle = () => { cancel(); setOpen((value) => !value); };
  const textStyle = { fontSize: 13, lineHeight: 18, color: colors.foregroundMuted, fontVariant: ["tabular-nums" as const] };
  const loadedLift = surfaceLift(hovered, loadedPress.pressed, reduced, "control", loadedPress.input);
  const explanation = <View testID="search-coverage-popover" role="dialog" accessibilityLabel={strings.title} style={{ ...panelChrome(props.theme), borderRadius: 10, padding: 6 }}>
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foregroundMuted }}>{strings.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={strings.close} onPress={() => setOpen(false)}><Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{props.phone || Platform.OS !== "web" ? strings.close : "Esc"}</Text></Pressable>
    </View>
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 7, paddingHorizontal: 8 }}>
      <View style={{ width: 15, height: 20, justifyContent: "center", alignItems: "center" }}><SearchSpinner size={13} color={colors.foregroundMuted} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 13, lineHeight: 20, fontWeight: "500", color: colors.foreground, fontVariant: ["tabular-nums"] }}>{strings.loaded(counts.loaded)}</Text>
        <Text style={{ fontSize: 12.5, lineHeight: 19, color: colors.foregroundMuted }}>{strings.readingHint}</Text>
      </View>
    </View>
  </View>;
  return <Animated.View testID={part === "notice" ? "search-coverage-notices" : "search-coverage-items"} ref={anchor} collapsable={false} {...(Platform.OS === "web" ? {} : hoverProps)} style={{ flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0, flexShrink: props.compact ? 0 : 1, height: props.compact ? target : props.phone ? height.interpolate({ inputRange: [0, 1], outputRange: [0, 32] }) : 28, opacity, zIndex: open ? 40 : 1 }}>
    {showsNotice && context.cancelled && (!props.compact || props.compactLabels) ? <Text testID="search-stopped" numberOfLines={1} style={[textStyle, { flexShrink: 0 }]}>{props.compact ? props.compactLabels?.stopped : context.stoppedText}</Text> : null}
    {showsNotice && context.historyError ? <View testID="search-history-failure" style={{ flexDirection: "row", alignItems: "center", gap: props.compact ? 0 : 6, paddingHorizontal: props.compact ? 0 : 8 }}>
      {props.compact ? null : <Icon name="CircleAlert" size={15} color={danger} />}
      {!props.compact || props.compactLabels ? <Text numberOfLines={1} style={[textStyle, { flexShrink: 0 }]}>{props.compact ? props.compactLabels?.failed : context.historyFailedText}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={strings.retry} accessibilityHint={props.compact ? context.historyFailedText : undefined} hitSlop={props.phone ? { top: 6, bottom: 6, left: 6, right: 6 } : undefined} onPress={context.retryHistory} style={{ minWidth: props.compact ? target : undefined, minHeight: props.compact ? target : props.phone ? 32 : 24, alignItems: "center", justifyContent: "center" }}>{props.compact ? <Icon name="RotateCw" size={14} color={danger} /> : <Text style={textStyle}>{strings.retry}</Text>}</Pressable>
    </View> : null}
    {showsBadge && counts.pending && (!props.compact || !context.cancelled) ? <Pressable testID="search-coverage-loaded" accessibilityRole="button" accessibilityLabel={strings.loaded(counts.loaded)} accessibilityState={{ expanded: open }} hitSlop={props.phone ? { top: 6, bottom: 6 } : undefined} onPress={loadedPress.guard(toggle)} onPressIn={loadedPress.onPressIn} onPressOut={loadedPress.onPressOut} onTouchStart={loadedPress.onTouchStart} onTouchMove={loadedPress.onTouchMove} onTouchEnd={loadedPress.onTouchEnd} onTouchCancel={loadedPress.onTouchCancel} style={{ flexDirection: "row", alignItems: "center", gap: badge ? 5 : 6, paddingHorizontal: badge ? 2 : 8, height: props.compact ? target : badge ? 24 : "100%", borderRadius: badge ? 5 : 7, overflow: "hidden", backgroundColor: open ? colors.surface1 : "transparent", ...liftStyle(() => taskTokens(props.theme), loadedLift), ...scaleStyle(loadedLift.scale) }}>
      <SearchSpinner size={13} color={colors.foregroundMuted} />
      <Text numberOfLines={1} style={badge ? { ...textStyle, fontSize: 12, flexShrink: 1 } : textStyle}>{badge ? String(counts.loaded) : strings.loaded(counts.loaded)}</Text>
      <Icon name="Info" size={badge ? 13 : 14} color={colors.foregroundMuted} />
    </Pressable> : null}
    {showsBadge && open && Platform.OS === "web" ? <View ref={panel} collapsable={false} style={{ position: "absolute", left: 0, top: "100%", paddingTop: 6, width: Math.min(props.phone ? 340 : 320, window.width - 16) }}>{explanation}</View> : null}
    {showsBadge && open && Platform.OS !== "web" ? <Modal transparent visible onRequestClose={() => setOpen(false)} animationType="none"><Pressable testID="search-coverage-backdrop" accessibilityLabel={strings.close} onPress={() => setOpen(false)} style={{ flex: 1 }}><Pressable onPress={(event) => event.stopPropagation()} style={{ position: "absolute", ...position, width: Math.min(props.phone ? 340 : 320, window.width - 16) }}>{explanation}</Pressable></Pressable></Modal> : null}
  </Animated.View>;
}
