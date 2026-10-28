import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, View, type LayoutChangeEvent, type TextLayoutEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { TaskText as Text, TASK_MONO, useTasksFontScale } from "../typography";
import { orderedSearchHits, searchRanges, type SearchField, type SearchHit } from "../data/search-hits";
import { useHover } from "../../ui/use-hover";
import { useInputCapabilities } from "../../ui/use-input-capabilities";
import { SelectableSpan } from "../../ui/prose-text";
import { openToolbarDetailsLayer } from "../../web";
import { cardStrings } from "./strings";
import type { TasksLanguage } from "../i18n";
import type { TaskTokens } from "./tokens";
import { panelChrome } from "./panel";

/** Return the original string when inactive: no wrapper, layout or font changes. */
export function highlightText(text: string, query: string, dark: boolean, branch = false): ReactNode {
  const ranges = searchRanges(text, query);
  if (!ranges.length) return text;
  const backgroundColor = dark ? "#5A4A17" : "#FBE7A1";
  const color = branch ? (dark ? "#B6D7FF" : "#0550AE") : dark ? "#FBEFC6" : "#1D1E21";
  const nodes: ReactNode[] = [];
  let from = 0;
  ranges.forEach((range) => {
    if (range.start > from) nodes.push(text.slice(from, range.start));
    const content = text.slice(range.start, range.end);
    nodes.push(
      Platform.OS === "web" ? (
        <mark
          key={range.start}
          data-bcsearchmark=""
          style={{
            backgroundColor,
            color,
            borderRadius: 2,
            padding: 0,
            font: "inherit",
            letterSpacing: "inherit",
            boxShadow: `0 0 0 1.5px ${backgroundColor}`,
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {content}
        </mark>
      ) : (
        <SelectableSpan key={range.start} style={{ backgroundColor, color, borderRadius: 2 }}>
          {content}
        </SelectableSpan>
      ),
    );
    from = range.end;
  });
  if (from < text.length) nodes.push(text.slice(from));
  return nodes;
}

/** Check real line clipping rather than estimating the title's character count. */
export function useSearchClip(text: string, query: string, lines: number) {
  const ref = useRef<React.ComponentRef<typeof import("react-native").Text>>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    if (!query) {
      setVisible(true);
      return;
    }
    if (Platform.OS !== "web") return;
    const element = ref.current as unknown as HTMLElement | null;
    if (!element?.getBoundingClientRect) return;
    const box = element.getBoundingClientRect();
    const marks = [...element.querySelectorAll("[data-bcsearchmark]")];
    setVisible(
      marks.some((mark) =>
        [...mark.getClientRects()].some(
          (rect) => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1,
        ),
      ),
    );
  }, [text, query, width]);
  return {
    ref,
    visible,
    onLayout: query ? (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width) : undefined,
    onTextLayout:
      query && Platform.OS !== "web"
        ? (event: TextLayoutEvent) =>
            setVisible(
              searchRanges(
                event.nativeEvent.lines
                  .slice(0, lines)
                  .map((line) => line.text)
                  .join(""),
                query,
              ).length > 0,
            )
        : undefined,
  };
}

const ICONS: Record<SearchField, string> = {
  title: "Type",
  prompt: "MessageSquare",
  pr: "GitPullRequest",
  label: "Tag",
  branch: "GitBranch",
  folder: "Folder",
  project: "FolderKanban",
  workspace: "PanelsTopLeft",
  path: "Terminal",
  model: "Bot",
  id: "Fingerprint",
};

export function SearchHitSummary(props: {
  hits: SearchHit[];
  query: string;
  tokens: TaskTokens;
  theme: PluginTheme;
  language: TasksLanguage;
  phone: boolean;
  minimal: boolean;
  rowHeight?: number;
  onOpenChange(open: boolean): void;
  promptNote?: string;
  onRetry?(): void;
}) {
  const strings = cardStrings(props.language).searchHits;
  const scale = useTasksFontScale();
  const hidden = props.hits.filter((hit) => !hit.visible);
  const input = useInputCapabilities();
  const touch = props.phone || input.touch;
  const [open, setOpen] = useState(false);
  const anchor = useRef<View>(null);
  const panel = useRef<View>(null);
  const { hovered, hoverProps } = useHover(anchor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(() => {
    if (touch) return;
    cancel();
    timer.current = setTimeout(() => setOpen(hovered), hovered ? 300 : 150);
    return cancel;
  }, [hovered, touch]);
  const { onOpenChange } = props;
  useEffect(() => {
    onOpenChange(open);
    return () => onOpenChange(false);
  }, [open, onOpenChange]);
  useEffect(() => {
    setOpen(false);
    return cancel;
  }, [props.query]);
  useLayoutEffect(() => {
    if (!open || touch || Platform.OS !== "web") return;
    const release = openToolbarDetailsLayer(panel.current, anchor.current, "below");
    const element = panel.current as unknown as HTMLElement | null;
    element?.querySelector<HTMLElement>('[role="listitem"]')?.focus({ preventScroll: true });
    return release;
  }, [open, touch]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const element = anchor.current as unknown as HTMLElement | null;
    const card = element?.closest<HTMLElement>("[data-bctaskcard]");
    const key = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowDown" && card?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
      }
      if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        card?.focus({ preventScroll: true });
      }
    };
    const outside = (event: PointerEvent) => {
      if (!element?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key, true);
    if (open) document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  if (!hidden.length) return null;
  const limit = props.phone || props.minimal ? 1 : 2;
  const shown = hidden.slice(0, limit);
  const rest = hidden.length - shown.length;
  const tokens = props.tokens;
  const row = (hit: SearchHit, index: number, full: boolean) => (
    <View
      key={`${hit.field}-${index}`}
      role={full ? "listitem" : undefined}
      {...(full && Platform.OS === "web" ? { tabIndex: -1 } : {})}
      style={full ? { paddingVertical: 6, paddingHorizontal: 8, gap: 3 } : { flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      {full ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={ICONS[hit.field]} size={13} color={tokens.foregroundMuted} />
          <Text style={{ fontSize: 12, lineHeight: 18, color: tokens.foregroundMuted }}>
            {strings.fields[hit.field]}
            {hit.visible ? ` · ${strings.visible}` : ""}
          </Text>
        </View>
      ) : (
        <>
          <Icon name={ICONS[hit.field]} size={13} color={tokens.foregroundMuted} />
          <Text style={{ fontSize: 12, lineHeight: 18, color: tokens.foregroundMuted }}>{strings.fields[hit.field]}</Text>
        </>
      )}
      <Text
        numberOfLines={full ? 2 : 1}
        style={{
          flex: full ? undefined : 1,
          minWidth: 0,
          marginLeft: full ? 19 : 0,
          fontSize: full ? (hit.mono ? 12.5 : 13) : hit.mono ? 11.5 : 12,
          lineHeight: full ? 19 : 18,
          color: tokens.foregroundMuted,
          ...(hit.mono ? { fontFamily: TASK_MONO } : null),
        }}
      >
        {highlightText(full ? hit.preview : hit.snippet, props.query.replace(/\s+/g, " "), tokens.isDark)}
      </Text>
      {!full && index === shown.length - 1 && rest > 0 ? (
        <Text
          style={{
            fontSize: 11.5,
            lineHeight: 18,
            color: tokens.foregroundMuted,
            backgroundColor: tokens.surface2,
            borderRadius: 4,
            paddingHorizontal: 6,
          }}
        >
          {strings.more(rest)}
        </Text>
      ) : null}
    </View>
  );
  const all = (
    <>
      <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 8 }}>
        <Text style={{ fontSize: 12, lineHeight: 18, color: tokens.foreground, fontWeight: "600" }}>
          {strings.count(props.hits.length, props.query)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.close}
          onPress={(event) => {
            event.stopPropagation();
            setOpen(false);
          }}
        >
          <Text style={{ fontSize: 12, color: tokens.foregroundMuted }}>{touch ? strings.close : "Esc"}</Text>
        </Pressable>
      </View>
      <View accessibilityRole="list">{orderedSearchHits(props.hits).map((hit, index) => row(hit, index, true))}</View>
      {props.promptNote ? (
        <View style={{ flexDirection: "row", alignItems: "center", padding: 8, gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 12, color: tokens.foregroundMuted }}>{props.promptNote}</Text>
          {props.onRetry ? (
            <Pressable
              accessibilityRole="button"
              onPress={(event) => {
                event.stopPropagation();
                props.onRetry?.();
              }}
            >
              <Text style={{ fontSize: 12, color: tokens.foreground }}>{strings.retry}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Text
        style={{
          borderTopWidth: 1,
          borderTopColor: tokens.card.border,
          marginTop: 4,
          padding: 8,
          fontSize: 12,
          lineHeight: 18,
          color: tokens.foregroundMuted,
        }}
      >
        {strings.detailHint}
      </Text>
    </>
  );
  return (
    <Pressable
      role="group"
      focusable={false}
      ref={anchor}
      testID="task-search-summary"
      {...(Platform.OS === "web" ? {} : hoverProps)}
      style={{
        flex: props.minimal ? 1 : undefined,
        // The 18px visual line borrows from the existing footer gap, keeping minimal cards the same height.
        marginVertical: props.rowHeight === undefined ? undefined : -Math.max(0, Math.round(18 * scale) - props.rowHeight) / 2,
        minWidth: 0,
        marginTop: props.minimal ? undefined : 6,
        paddingTop: props.minimal ? 0 : 6,
        borderTopWidth: props.minimal ? 0 : 1,
        borderTopColor: tokens.card.border,
        zIndex: open ? 40 : undefined,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.viewAll(props.hits.length)}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        aria-haspopup={touch ? undefined : "dialog"}
        onPress={(event) => {
          event.stopPropagation();
          cancel();
          setOpen((value) => !value);
        }}
        hitSlop={touch ? { top: 13, bottom: 13 } : undefined}
        style={({ pressed }) => ({ gap: 3, borderRadius: 6, backgroundColor: pressed || open ? tokens.surface2 : "transparent" })}
        testID="task-search-summary-trigger"
      >
        {shown.map((hit, index) => row(hit, index, false))}
      </Pressable>
      {open && touch ? <View testID="task-search-expanded">{all}</View> : null}
      {open && !touch ? (
        <View ref={panel} collapsable={false} style={{ position: "absolute", top: "100%", left: 0, paddingTop: 8, width: 336 }}>
          <View
            role="dialog"
            accessibilityLabel={strings.dialog}
            testID="task-search-popover"
            style={{ ...panelChrome(props.theme), borderRadius: 10, padding: 6 }}
          >
            <ScrollView style={{ maxHeight: 400 }}>{all}</ScrollView>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}
