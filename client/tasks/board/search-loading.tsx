import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { SearchCoverageControl } from "../data/search-first-prompts";
import type { BoardStrings } from "./strings";
import { TaskText as Text } from "../typography";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { tipProps } from "../cards/card-hints";
import type { PluginTheme } from "@getpaseo/plugin";

export const SearchCoverageContext = createContext<{
  status: SearchCoverageControl;
  query: string;
  strings: BoardStrings["searchCoverage"];
  total: number;
  fullConversation?: boolean;
  onFullConversationChange?(on: boolean): void;
  fullConversationLabel?: string;
  fullConversationShortLabel?: string;
  fullConversationHint?: string;
} | null>(null);

export function SearchCoverageProvider(props: React.PropsWithChildren<{ status: SearchCoverageControl; query: string; strings: BoardStrings["searchCoverage"]; total: number; fullConversation?: boolean; onFullConversationChange?(on: boolean): void; fullConversationLabel?: string; fullConversationShortLabel?: string; fullConversationHint?: string }>) {
  const value = useMemo(() => ({ status: props.status, query: props.query, strings: props.strings, total: props.total, fullConversation: props.fullConversation, onFullConversationChange: props.onFullConversationChange, fullConversationLabel: props.fullConversationLabel, fullConversationShortLabel: props.fullConversationShortLabel, fullConversationHint: props.fullConversationHint }), [props.status, props.query, props.strings, props.total, props.fullConversation, props.onFullConversationChange, props.fullConversationLabel, props.fullConversationShortLabel, props.fullConversationHint]);
  return <SearchCoverageContext.Provider value={value}>{props.children}</SearchCoverageContext.Provider>;
}

const EMPTY = { pending: 0, unavailable: 0, failed: 0, retrying: 0 };
const emptyRead = () => EMPTY;
const emptySubscribe = () => () => {};

export function useSearchCoverage() {
  const context = useContext(SearchCoverageContext);
  const counts = useSyncExternalStore(context?.status.subscribe ?? emptySubscribe, context?.status.read ?? emptyRead, emptyRead);
  return { context, counts: context?.query.trim() ? counts : EMPTY };
}

/** A short read never flashes. Clearing the query cancels the minimum lifetime too. */
export function useSearchLoading(loading: boolean, query: string) {
  const [state, setState] = useState({ query, shown: false });
  const since = useRef(0);
  const active = Boolean(query.trim());
  const shown = state.query === query && state.shown;
  useEffect(() => {
    if (!active) { setState({ query, shown: false }); since.current = 0; return; }
    if (loading && !shown) {
      const timer = setTimeout(() => { since.current = Date.now(); setState({ query, shown: true }); }, 300);
      return () => clearTimeout(timer);
    }
    if (!loading && shown) {
      const timer = setTimeout(() => setState({ query, shown: false }), Math.max(0, 400 - (Date.now() - since.current)));
      return () => clearTimeout(timer);
    }
  }, [active, loading, shown, query]);
  return active && shown;
}

/** Views keep the exact same animation path on iOS, Android and RN Web. */
export function SearchSpinner(props: { size: number; color: string }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    const timing = (toValue: number) => Animated.timing(progress, { toValue, duration: reduced ? 800 : 900, easing: (value) => value, useNativeDriver: Platform.OS !== "web", isInteraction: false });
    const animation = Animated.loop(reduced ? Animated.sequence([timing(1), timing(0)]) : timing(1));
    animation.start();
    return () => animation.stop();
  }, [progress, reduced]);
  const diameter = props.size * 0.75;
  const circle = { position: "absolute" as const, width: diameter, height: diameter, borderRadius: diameter / 2, borderWidth: props.size * 1.5 / 13 };
  const arc = { ...circle, borderColor: "transparent", borderTopColor: props.color };
  return <Animated.View testID="search-spinner" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: props.size, height: props.size, alignItems: "center", justifyContent: "center", opacity: reduced ? progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) : 1, transform: reduced ? undefined : [{ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
    <View style={{ ...circle, borderColor: props.color, opacity: 0.22 }} />
    <View style={arc} />
    <View style={{ ...arc, transform: [{ rotate: "10deg" }] }} />
  </Animated.View>;
}

export function SearchInput(props: React.ComponentProps<typeof TextInput> & { iconSize: number; iconColor: string; ref?: React.Ref<NativeTextInput> }) {
  const { iconSize, iconColor, ...input } = props;
  const { context, counts } = useSearchCoverage();
  const loading = counts.pending > 0 || counts.retrying > 0;
  const shown = useSearchLoading(loading, input.value ?? "");
  const opacity = useRef(new Animated.Value(0)).current;
  const [present, setPresent] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef({ query: input.value, started: false });
  const lastCount = useRef(0);
  if (counts.pending) lastCount.current = counts.pending;
  useEffect(() => {
    if (!shown && present === null) return;
    if (shown) setPresent(input.value ?? null);
    const timer = setTimeout(() => { if (!shown) setPresent(null); }, input.value?.trim() ? 120 : 0);
    const animation = Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: input.value?.trim() ? 120 : 0, useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.start();
    return () => { clearTimeout(timer); animation.stop(); };
  }, [opacity, shown, Boolean(input.value?.trim())]);
  useEffect(() => {
    if (announced.current.query !== input.value) {
      announced.current = { query: input.value, started: false };
      setAnnouncement("");
    }
    if (!input.value?.trim()) return;
    if (!context) return;
    if (shown && loading && !announced.current.started) {
      announced.current.started = true;
      setAnnouncement(context.strings.started);
    }
    if (!loading && announced.current.started) {
      announced.current.started = false;
      setAnnouncement(context.strings.complete(context.total, counts.unavailable, counts.failed));
    }
  }, [shown, loading, context, counts.unavailable, counts.failed, input.value]);
  useEffect(() => {
    if (announcement && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);
  return <>
    <View testID="search-icon-slot" {...tipProps(shown && context ? context.strings.tip(counts.pending || lastCount.current) : undefined)} style={{ width: iconSize, height: iconSize, flexShrink: 0 }}>
      <Animated.View style={{ position: "absolute", opacity: opacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Icon name="Search" size={iconSize} color={iconColor} /></Animated.View>
      {input.value?.trim() && (shown || present === input.value) ? <Animated.View style={{ position: "absolute", opacity }}><SearchSpinner size={iconSize} color={iconColor} /></Animated.View> : null}
    </View>
    <TextInput {...input} accessibilityState={{ ...input.accessibilityState, busy: loading }} />
    <Text testID="search-announcement" accessibilityLiveRegion="polite" role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>{announcement}</Text>
  </>;
}

export function FullConversationSwitch({ theme, compact }: { theme: PluginTheme; compact?: boolean }) {
  const { context } = useSearchCoverage();
  const on = context?.fullConversation === true;
  const toggle = () => context?.onFullConversationChange?.(!on);
  if (!context?.onFullConversationChange) return null;
  return <Pressable testID="search-full-conversation-toggle" accessibilityRole="button" accessibilityLabel={context.fullConversationLabel}
    accessibilityState={{ selected: on }} aria-pressed={on} {...tipProps(context.fullConversationHint)} onPress={toggle} hitSlop={4}
    style={{ flexShrink: 0, width: compact ? 36 : 32, height: compact ? 36 : 32, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.colors.border, borderRadius: compact ? 18 : 16, backgroundColor: on ? theme.colors.surface2 : theme.colors.surface0 }}>
    <Icon name={on ? "FileText" : "List"} size={16} color={theme.colors.foreground} />
  </Pressable>;
}
