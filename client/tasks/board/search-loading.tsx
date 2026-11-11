import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import type { SearchCoverageControl } from "../data/search-first-prompts";
import type { BoardStrings } from "./strings";
import { TaskText as Text, taskControlHeight, useTasksFontScale } from "../typography";
import { useReducedMotion } from "../../ui/use-reduced-motion";
import { useHover } from "../../ui/use-hover";
import { taskTokens } from "../cards/tokens";
import { liftStyle, scaleStyle, surfaceLift } from "../cards/surface-lift";
import { usePressCue } from "../cards/action-pressable";
import { tipProps } from "../cards/card-hints";
import { HoverPressable } from "./board-parts";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginIcon } from "@getpaseo/plugin/client";

export const SearchCoverageContext = createContext<{
  status: SearchCoverageControl;
  cancelled?: boolean;
  setCancelled?(cancelled: boolean): void;
  cancelText?: string;
  resumeText?: string;
  stoppedText?: string;
  historyLoading?: boolean;
  historyError?: string | null;
  retryHistory?(): void;
  historyLoadingText?: string;
  historyFailedText?: string;
  query: string;
  strings: BoardStrings["searchCoverage"];
  fullConversation?: boolean;
  onFullConversationChange?(on: boolean): void;
  fullConversationLabel?: string;
  fullConversationShortLabel?: string;
  fullConversationHint?: string;
} | null>(null);

export function SearchCoverageProvider(props: React.PropsWithChildren<{ status: SearchCoverageControl; cancelled?: boolean; setCancelled?(cancelled: boolean): void; cancelText?: string; resumeText?: string; stoppedText?: string; historyLoading?: boolean; historyError?: string | null; retryHistory?(): void; historyLoadingText?: string; historyFailedText?: string; query: string; strings: BoardStrings["searchCoverage"]; fullConversation?: boolean; onFullConversationChange?(on: boolean): void; fullConversationLabel?: string; fullConversationShortLabel?: string; fullConversationHint?: string }>) {
  const value = useMemo(() => ({ status: props.status, cancelled: props.cancelled, setCancelled: props.setCancelled, cancelText: props.cancelText, resumeText: props.resumeText, stoppedText: props.stoppedText, historyLoading: props.historyLoading, historyError: props.historyError, retryHistory: props.retryHistory, historyLoadingText: props.historyLoadingText, historyFailedText: props.historyFailedText, query: props.query, strings: props.strings, fullConversation: props.fullConversation, onFullConversationChange: props.onFullConversationChange, fullConversationLabel: props.fullConversationLabel, fullConversationShortLabel: props.fullConversationShortLabel, fullConversationHint: props.fullConversationHint }), [props.status, props.cancelled, props.setCancelled, props.cancelText, props.resumeText, props.stoppedText, props.historyLoading, props.historyError, props.retryHistory, props.historyLoadingText, props.historyFailedText, props.query, props.strings, props.fullConversation, props.onFullConversationChange, props.fullConversationLabel, props.fullConversationShortLabel, props.fullConversationHint]);
  return <SearchCoverageContext.Provider value={value}>{props.children}<SearchAnnouncement /></SearchCoverageContext.Provider>;
}

const EMPTY = { pending: 0, loaded: 0 };
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

/**
 * `staticIcon` keeps the magnifier while a read runs: the loading state is
 * shown elsewhere (the field's count badge), so the icon must not crossfade
 * into a spinner.
 */
export function SearchInput(props: React.ComponentProps<typeof TextInput> & { theme: PluginTheme; iconSize: number; iconColor: string; hideSearchIcon?: boolean; staticIcon?: boolean; ref?: React.Ref<NativeTextInput>; beforeCancel?: ReactNode }) {
  const { theme, iconSize, iconColor, hideSearchIcon, staticIcon, beforeCancel, ...input } = props;
  const { context, counts } = useSearchCoverage();
  const loading = !context?.cancelled && (counts.pending > 0 || context?.historyLoading === true);
  const shown = useSearchLoading(loading, input.value ?? "");
  const opacity = useRef(new Animated.Value(0)).current;
  const [present, setPresent] = useState<string | null>(null);
  useEffect(() => {
    if (!shown && present === null) return;
    if (shown) setPresent(input.value ?? null);
    const timer = setTimeout(() => { if (!shown) setPresent(null); }, input.value?.trim() ? 120 : 0);
    const animation = Animated.timing(opacity, { toValue: shown ? 1 : 0, duration: input.value?.trim() ? 120 : 0, useNativeDriver: Platform.OS !== "web", isInteraction: false });
    animation.start();
    return () => { clearTimeout(timer); animation.stop(); };
  }, [opacity, shown, Boolean(input.value?.trim())]);
  const spinnerVisible = Boolean(input.value?.trim() && (shown || present === input.value));
  return <>
    {!hideSearchIcon ? <View testID="search-icon-slot" {...tipProps(shown && context ? counts.pending ? context.strings.tip(counts.loaded) : context.historyLoading ? context.historyLoadingText : undefined : undefined)} style={{ width: iconSize, height: iconSize, flexShrink: 0 }}>
      <Animated.View style={{ position: "absolute", opacity: staticIcon ? 1 : opacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}><Icon name="Search" size={iconSize} color={iconColor} /></Animated.View>
      {!staticIcon && spinnerVisible ? <Animated.View style={{ position: "absolute", opacity }}><SearchSpinner size={iconSize} color={iconColor} /></Animated.View> : null}
    </View> : null}
    <TextInput {...input} accessibilityState={{ ...input.accessibilityState, busy: loading }} />
    {beforeCancel}
    {input.value?.trim() ? <SearchCancelToggle theme={theme} iconSize={iconSize} iconColor={iconColor} /> : null}
  </>;
}

/** Stays mounted when a tablet replaces its search field with a query pill. */
function SearchAnnouncement() {
  const { context, counts } = useSearchCoverage();
  const loading = !context?.cancelled && (counts.pending > 0 || context?.historyLoading === true);
  const shown = useSearchLoading(loading, context?.query ?? "");
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef({ query: context?.query, started: false });
  useEffect(() => {
    if (announced.current.query !== context?.query) {
      announced.current = { query: context?.query, started: false };
      setAnnouncement("");
    }
    if (!context?.query.trim()) return;
    if (context.historyError) {
      announced.current.started = false;
      setAnnouncement(context.historyFailedText ?? context.historyError);
      return;
    }
    if (shown && loading && !announced.current.started) {
      announced.current.started = true;
      setAnnouncement(context.historyLoading ? context.historyLoadingText ?? context.strings.started : context.strings.started);
    }
    if (!loading && announced.current.started) {
      announced.current.started = false;
      setAnnouncement(context.cancelled ? context.stoppedText ?? "" : context.historyError ? context.historyFailedText ?? context.historyError : context.strings.complete(counts.loaded));
    }
  }, [shown, loading, context, counts.loaded]);
  useEffect(() => {
    if (announcement && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);
  return <Text testID="search-announcement" accessibilityLiveRegion="polite" role="status" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>{context?.query.trim() ? announcement : ""}</Text>;
}

/** The one state a collapsed query shows; the mark and its spoken hint both read it. */
function useSearchStatus() {
  const { context, counts } = useSearchCoverage();
  if (!context?.query.trim()) return { context, state: null };
  const state = context.historyError ? "failed" as const : context.cancelled ? "stopped" as const : counts.pending || context.historyLoading ? "loading" as const : null;
  return { context, state };
}

/** A narrow tablet keeps its search state visible inside the editable query. */
export function SearchStatusMark({ theme }: { theme: PluginTheme }) {
  const { state } = useSearchStatus();
  if (state === "failed") return <Icon name="CircleAlert" size={14} color={taskTokens(theme).danger} />;
  if (state === "stopped") return <Icon name="Pause" size={14} color={theme.colors.foregroundMuted} />;
  if (state === "loading") return <SearchSpinner size={14} color={theme.colors.foregroundMuted} />;
  return null;
}

/** What `SearchStatusMark` shows, worded as the live region words it. */
export function useSearchStatusText(): string | undefined {
  const { context, state } = useSearchStatus();
  if (!context || !state) return undefined;
  if (state === "failed") return context.historyFailedText ?? context.historyError ?? undefined;
  if (state === "stopped") return context.stoppedText;
  return context.historyLoading ? context.historyLoadingText ?? context.strings.started : context.strings.started;
}

/** Shared by the search field and the tablet's collapsed query. */
export function SearchCancelToggle({ theme, iconSize, iconColor = theme.colors.foregroundMuted }: { theme: PluginTheme; iconSize: number; iconColor?: string }) {
  const { context, counts } = useSearchCoverage();
  const loading = !context?.cancelled && (counts.pending > 0 || context?.historyLoading === true);
  if (!context?.query.trim() || !context.setCancelled || (!loading && !context.cancelled)) return null;
  return <HoverPressable lift="toolbar" testID="search-cancel-toggle" accessibilityRole="button" accessibilityLabel={context.cancelled ? context.resumeText : context.cancelText} accessibilityHint={context.cancelled ? context.stoppedText : undefined} {...tipProps(context.cancelled ? context.resumeText : context.cancelText)} onPress={() => context.setCancelled?.(!context.cancelled)} hitSlop={6} style={(hovered, pressed, source) => ({ width: 20, height: 20, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: "transparent", ...liftStyle(() => taskTokens(theme), surfaceLift(hovered, pressed, undefined, "toolbar", source)) })}>
      <Icon name={context.cancelled ? "Play" : "Square"} size={iconSize} color={iconColor} />
    </HoverPressable>;
}

const SVG_HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';

/** Full-text search: a page of text without a folded corner, cut open for a magnifier in the corner. */
const FULL_TEXT_SEARCH_ICON: PluginIcon = {
  svg: `${SVG_HEAD}<path d="M10.5 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6.5"/><path d="M8 7h8"/><path d="M8 11h5"/><path d="M8 15h2"/><circle cx="15.5" cy="16.5" r="3.5"/><path d="m21.5 22-3.5-3"/></svg>`,
};

/** Outline search (task info and first message): Lucide's List, its lower lines shortened for the same magnifier. */
const OUTLINE_SEARCH_ICON: PluginIcon = {
  svg: `${SVG_HEAD}<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h3.5"/><path d="M8 19h3.5"/><circle cx="16.5" cy="15.5" r="3.5"/><path d="m22 21-3-3"/></svg>`,
};

export function FullConversationSwitch({ theme, compact, iconSize: requestedIconSize }: { theme: PluginTheme; compact?: boolean; iconSize?: number }) {
  const { context } = useSearchCoverage();
  const { hovered, hoverProps } = useHover();
  const press = usePressCue(hovered);
  const reduced = useReducedMotion();
  const scale = useTasksFontScale();
  const size = !compact && Platform.OS === "web" ? taskControlHeight(28, scale) : compact ? 36 : 32;
  const iconSize = requestedIconSize ?? (!compact && Platform.OS === "web" ? taskControlHeight(16, scale) : 16);
  const on = context?.fullConversation === true;
  const toggle = () => context?.onFullConversationChange?.(!on);
  if (!context?.onFullConversationChange) return null;
  const lift = surfaceLift(hovered, press.pressed, reduced, "toolbar", press.input);
  const outlined = !compact && Platform.OS === "web";
  return <Pressable testID="search-full-conversation-toggle" accessibilityRole="button" accessibilityLabel={context.fullConversationLabel}
    accessibilityState={{ selected: on }} aria-pressed={on} {...tipProps(context.fullConversationHint)} onPress={press.guard(toggle)} hitSlop={4} {...hoverProps}
    onPressIn={press.onPressIn} onPressOut={press.onPressOut} onTouchStart={press.onTouchStart} onTouchMove={press.onTouchMove} onTouchEnd={press.onTouchEnd} onTouchCancel={press.onTouchCancel}
    style={{ flexShrink: 0, width: size, height: size, alignItems: "center", justifyContent: "center", borderWidth: outlined ? 1 : 0, borderColor: hovered ? theme.colors.border : "transparent", borderRadius: 7, backgroundColor: theme.colors.surface0, ...liftStyle(() => taskTokens(theme), lift, outlined ? { border: hovered ? theme.colors.border : "transparent" } : {}), ...scaleStyle(lift.scale) }}>
    <Icon icon={on ? FULL_TEXT_SEARCH_ICON : OUTLINE_SEARCH_ICON} size={iconSize} color={theme.colors.foreground} />
  </Pressable>;
}
