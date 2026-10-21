import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { HAIRLINE, devicePixel } from "./board-style";
import {
  MENU,
  MENU_FOCUS,
  layoutMenu,
  menuChrome,
  panelMaxHeight,
  submenuPlacement,
  menuKeyReducer,
  selectableItems,
  type MenuChrome,
  type MenuFocus,
  type MenuItem,
  type MenuSection,
} from "./menu-model";

export { MENU, menuChrome, type MenuItem, type MenuSection } from "./menu-model";

/**
 * The view menus must stay inside: the board's root. Its frame is measured
 * with the menu's own, in the same window coordinates, after layout, so a
 * board that does not reach the window's bottom still keeps its menus in
 * view. Without one, the window.
 */
export const MenuBoundsContext = createContext<RefObject<View | null> | null>(null);

type Measurable = { measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void };

export interface CascadeMenuProps {
  sections: MenuSection[];
  theme: PluginTheme;
  width: number;
  submenuWidth?: number;
  /** The panel's top inside its anchor, and which edge it hangs from. */
  top: number;
  align: "left" | "right";
  onClose(): void;
  testID?: string;
}

/**
 * A Linear-style menu with one level of submenus. A submenu opens on hover
 * after 150 ms or on a click, beside its row with its top aligned and its
 * edge over the parent's by 4; it opens towards the side with room (left
 * for a menu hung from the right). Moving onto the submenu within those
 * 150 ms keeps it: the hover-intent delay stands in for Linear's pointer
 * triangle. Keys (web): up/down, right or Enter into a submenu, left back,
 * Enter chooses, Escape closes one level. On web, a pointer press outside
 * the menu and its anchor closes it; native owners render a backdrop.
 */
export function CascadeMenu(props: CascadeMenuProps) {
  const { sections, theme, width, onClose } = props;
  const chrome = menuChrome(theme);
  const subWidth = props.submenuWidth ?? 200;
  const layout = layoutMenu(sections);
  const topItems = layout.rows.map((row) => row.item);
  const [focus, setFocus] = useState<MenuFocus>(MENU_FOCUS);
  const [scrollY, setScrollY] = useState(0);
  const openItem = focus.open !== null ? topItems[focus.open] : undefined;
  const subSections = openItem?.submenu ?? null;
  const subItems = subSections ? selectableItems(subSections) : null;

  // The side with room: towards the window's middle from the anchor.
  const window = useWindowDimensions();
  const containerRef = useRef<View>(null);
  const boundsRef = useContext(MenuBoundsContext);
  const [side, setSide] = useState<"left" | "right">(props.align === "right" ? "left" : "right");
  // Its top in the window and the area it must end inside, so neither panel
  // runs off a short window's bottom. Measured after layout (native lays
  // out after the first effect) and again when the window changes.
  const [frame, setFrame] = useState<{ y: number; top: number; bottom: number } | null>(null);
  const measure = useCallback(() => {
    const node = containerRef.current as unknown as Measurable | null;
    node?.measureInWindow?.((x, y, w) => {
      if (!w) return;
      if (x + w + subWidth > window.width) setSide("left");
      else if (x - subWidth < 0) setSide("right");
      const place = (top: number, bottom: number) =>
        setFrame((was) => (was && was.y === y && was.top === top && was.bottom === bottom ? was : { y, top, bottom }));
      const bounds = boundsRef?.current as unknown as Measurable | null;
      if (!bounds?.measureInWindow) return place(0, window.height);
      bounds.measureInWindow((_bx, by, _bw, bh) => {
        if (!bh) place(0, window.height);
        else place(Math.max(0, by), window.height > 0 ? Math.min(by + bh, window.height) : by + bh);
      });
    });
  }, [subWidth, window.width, window.height, boundsRef]);
  useEffect(measure, [measure]);
  const windowY = frame?.y ?? null;
  const maxHeight = panelMaxHeight(windowY, frame?.bottom ?? window.height);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  const latest = useRef({ focus, topItems, subItems, onClose });
  latest.current = { focus, topItems, subItems, onClose };
  const choose = useCallback((level: 0 | 1, index: number) => {
    const { topItems: tops, subItems: subs, onClose: close } = latest.current;
    const item = level === 0 ? tops[index] : subs?.[index];
    if (!item || item.disabled) return;
    if (item.submenu) {
      clearTimer();
      setFocus((current) => (current.open === index ? { ...current, open: null, level: 0 } : { level: 0, top: index, sub: -1, open: index }));
      return;
    }
    item.onSelect?.();
    if (!item.keepOpen) close();
  }, []);

  const hoverTop = (index: number) => {
    clearTimer();
    setFocus((current) => ({ ...current, level: 0, top: index }));
    timer.current = setTimeout(() => {
      timer.current = null;
      const item = latest.current.topItems[index];
      setFocus((current) => ({ ...current, sub: -1, open: item?.submenu ? index : null }));
    }, MENU.hoverMs);
  };
  const hoverSub = (index: number) => {
    clearTimer();
    setFocus((current) => ({ ...current, level: 1, sub: index }));
  };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      const now = latest.current;
      const result = menuKeyReducer(now.focus, event.key, now.topItems, now.subItems);
      if (!result.handled) return;
      event.preventDefault();
      event.stopPropagation();
      setFocus(result.focus);
      if (result.effect?.type === "close") now.onClose();
      if (result.effect?.type === "select") choose(result.effect.level, result.effect.index);
    };
    const onPointerDown = (event: PointerEvent) => {
      const menu = containerRef.current as unknown as HTMLElement | null;
      // The parent holds the trigger as well as both panels. Leave its press
      // to the trigger's toggle, otherwise it would close and immediately reopen.
      if (menu && !menu.parentElement?.contains(event.target as Node)) latest.current.onClose();
    };
    // Capture, ahead of the board's own keys.
    const doc = document;
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [choose]);

  const openRow = focus.open !== null ? layout.rows[focus.open] : undefined;
  const subHeight = subSections ? layoutMenu(subSections).height : 0;
  const sub = submenuPlacement(openRow ? openRow.top - scrollY - MENU.padV : 0, subHeight, windowY, frame?.bottom ?? window.height, frame?.top ?? 0);
  return (
    <View
      ref={containerRef}
      collapsable={false}
      onLayout={measure}
      testID={props.testID}
      style={{ position: "absolute", top: props.top, ...(props.align === "right" ? { right: 0 } : { left: 0 }), width, zIndex: 30 }}
    >
      <MenuPanel
        sections={sections}
        chrome={chrome}
        theme={theme}
        width={width}
        active={focus.level === 0 ? focus.top : focus.open ?? -1}
        open={focus.open}
        onHover={hoverTop}
        onPress={(index) => choose(0, index)}
        onScroll={setScrollY}
        maxHeight={maxHeight}
        scrolls={layout.height > maxHeight}
      />
      {subSections ? (
        <View
          testID="menu-submenu"
          onPointerEnter={clearTimer}
          style={{ position: "absolute", top: sub.top, width: subWidth, ...(side === "right" ? { left: width - MENU.overlap } : { right: width - MENU.overlap }) }}
        >
          <MenuPanel
            sections={subSections}
            chrome={chrome}
            theme={theme}
            width={subWidth}
            active={focus.level === 1 ? focus.sub : -1}
            open={null}
            onHover={hoverSub}
            onPress={(index) => choose(1, index)}
            maxHeight={sub.maxHeight}
            scrolls={subHeight > sub.maxHeight}
            testID="menu-submenu-panel"
          />
        </View>
      ) : null}
    </View>
  );
}

function MenuPanel(props: {
  sections: MenuSection[];
  chrome: MenuChrome;
  theme: PluginTheme;
  width: number;
  /** The highlighted selectable row; -1 for none. */
  active: number;
  /** The row whose submenu shows; it keeps its fill. */
  open: number | null;
  onHover(index: number): void;
  onPress(index: number): void;
  onScroll?(y: number): void;
  /** Taller content scrolls inside this. */
  maxHeight?: number;
  scrolls?: boolean;
  testID?: string;
}) {
  const { chrome, theme } = props;
  const colors = theme.colors;
  let index = -1;
  const body = props.sections.map((section, at) => (
    <View key={section.key}>
      {at > 0 ? (
        // A 1 pt box, as layoutMenu counts it, holding a one-device-pixel line at its top.
        <View testID="menu-separator" style={{ height: 1, marginVertical: MENU.separatorGap }}>
          <View style={{ height: devicePixel(), backgroundColor: chrome.border }} />
        </View>
      ) : null}
      {section.title ? (
        <View style={{ height: MENU.titleHeight, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: MENU.inset + 8 }}>
          {section.titleLeading}
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: colors.foregroundMuted }}>
            {section.title}
          </Text>
        </View>
      ) : null}
      {section.items.map((item) => {
        const at = item.disabled ? -1 : ++index;
        return (
          <MenuRow
            key={item.key}
            item={item}
            theme={theme}
            chrome={chrome}
            active={at >= 0 && (at === props.active || at === props.open)}
            onHover={() => at >= 0 && props.onHover(at)}
            onPress={() => at >= 0 && props.onPress(at)}
          />
        );
      })}
    </View>
  ));
  const frame = {
    width: props.width,
    paddingVertical: MENU.padV,
    borderRadius: MENU.radius,
    borderWidth: HAIRLINE,
    borderColor: chrome.border,
    backgroundColor: chrome.background,
    boxShadow: chrome.shadow,
    elevation: 8,
  };
  if (!props.scrolls) {
    return (
      <View testID={props.testID ?? "menu-panel"} style={frame}>
        {body}
      </View>
    );
  }
  if (Platform.OS === "android") {
    return (
      <DragScroll testID={props.testID ?? "menu-panel"} frame={frame} maxHeight={props.maxHeight ?? MENU.maxHeight} contentHeight={layoutMenu(props.sections).height} onScroll={props.onScroll}>
        {body}
      </DragScroll>
    );
  }
  return (
    <View testID={props.testID ?? "menu-panel"} style={[frame, { paddingVertical: 0, maxHeight: props.maxHeight ?? MENU.maxHeight, overflow: "hidden" }]}>
      <ScrollView
        style={{ maxHeight: props.maxHeight ?? MENU.maxHeight }}
        contentContainerStyle={{ paddingVertical: MENU.padV }}
        scrollEventThrottle={16}
        onScroll={(event) => props.onScroll?.(event.nativeEvent.contentOffset.y)}
      >
        {body}
      </ScrollView>
    </View>
  );
}

/** Past this vertical travel a drag on the panel scrolls it instead of pressing a row. */
const DRAG_SLOP = 6;

/**
 * An Android menu panel taller than its room, scrolled by dragging in JS.
 * The menu hangs below its small anchor, and Android hands a native
 * ScrollView no touch outside its parents' bounds, so a native one there
 * could not scroll; React Native still finds the rows for presses. The
 * drag takes the responder from a row once it has moved 6 vertically.
 */
function DragScroll(props: {
  testID: string;
  frame: object;
  maxHeight: number;
  contentHeight: number;
  onScroll?(y: number): void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const range = Math.max(0, props.contentHeight - props.maxHeight);
  const start = useRef(0);
  const shown = Math.min(offset, range);
  const latest = useRef({ shown, range, onScroll: props.onScroll });
  latest.current = { shown, range, onScroll: props.onScroll };
  const moveTo = (y: number) => {
    const next = Math.max(0, Math.min(latest.current.range, y));
    setOffset(next);
    latest.current.onScroll?.(next);
  };
  type Drag = { nativeEvent: { pageY: number } };
  return (
    <View
      testID={props.testID}
      style={[props.frame, { paddingVertical: 0, maxHeight: props.maxHeight, overflow: "hidden" }]}
      onMoveShouldSetResponderCapture={(event: Drag) => Math.abs(event.nativeEvent.pageY - start.current) > DRAG_SLOP}
      onStartShouldSetResponderCapture={(event: Drag) => {
        start.current = event.nativeEvent.pageY;
        return false;
      }}
      onResponderGrant={(event: Drag) => {
        start.current = event.nativeEvent.pageY + latest.current.shown;
      }}
      onResponderMove={(event: Drag) => moveTo(start.current - event.nativeEvent.pageY)}
      onResponderTerminationRequest={() => false}
    >
      <View style={{ paddingVertical: MENU.padV, transform: [{ translateY: -shown }] }}>{props.children}</View>
    </View>
  );
}

function MenuRow(props: { item: MenuItem; theme: PluginTheme; chrome: MenuChrome; active: boolean; onHover(): void; onPress(): void }) {
  const { item, chrome } = props;
  const colors = props.theme.colors;
  const leading: ReactNode = item.leading ?? (item.icon ? <Icon name={item.icon} size={MENU.icon} color={colors.foregroundMuted} /> : null);
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: item.disabled, checked: item.checked, expanded: item.submenu ? props.active : undefined }}
      disabled={item.disabled}
      onHoverIn={props.onHover}
      onPress={props.onPress}
      style={{
        height: MENU.rowHeight,
        marginHorizontal: MENU.inset,
        paddingHorizontal: 8,
        borderRadius: MENU.rowRadius,
        flexDirection: "row",
        alignItems: "center",
        gap: MENU.gap,
        backgroundColor: props.active ? chrome.hover : "transparent",
      }}
    >
      {leading}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: MENU.fontSize, color: item.disabled ? colors.foregroundMuted : colors.foreground }}>
        {item.label}
      </Text>
      {item.hint ? <Text style={{ fontSize: 13, color: colors.foregroundMuted, fontVariant: ["tabular-nums"] }}>{item.hint}</Text> : null}
      {item.checked ? <Icon name="Check" size={14} color={colors.accent} /> : null}
      {item.submenu ? <Icon name="ChevronRight" size={12} color={colors.foregroundMuted} /> : null}
    </Pressable>
  );
}
