import type { ReactNode } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix } from "../../components/theme-tokens";
import { themeKey } from "../../ui/tokens/theme-key";
import { HOST_FONT } from "../type-ramp";
import { matchesSearch, searchWords } from "./search";

/**
 * The board's menus, after Linear's (measured at 2x on its light theme):
 * a panel with a 12 pt corner, a hairline border and a soft wide shadow;
 * rows 32 high inset 6 from the panel's edges, a 6 pt rounded hover fill;
 * groups split by a full-width hairline with 6 above and below; a row is a
 * 16 icon, 8, a 14 label, then a muted hint and a small chevron for a
 * submenu. A submenu has the same chrome and opens beside its row.
 *
 * This file is the menu's data and pure rules (geometry, keyboard); the
 * component is `menu.tsx`.
 */
export const MENU = {
  radius: 12,
  padV: 6,
  inset: 6,
  rowHeight: 32,
  rowRadius: 6,
  icon: 16,
  gap: 8,
  /** The host's base step; TaskText scales it with the interface size. */
  fontSize: HOST_FONT.base,
  /** A row with a second line (`detail`): the label over a 12 muted line. */
  detailRowHeight: 44,
  /** A group title row. */
  titleHeight: 28,
  /** A searchable menu's field above its rows, a hairline under it. */
  searchHeight: 36,
  /** Space above and below a group's hairline. */
  separatorGap: 6,
  /** How far a submenu overlaps its parent's edge. */
  overlap: 4,
  /** Hover this long on a row before its submenu opens (or another closes). */
  hoverMs: 150,
  maxHeight: 420,
} as const;

/** Keep authored breathing room at small text sizes, grow with large text, and fit the available surface. */
export function menuWidth(base: number, scale: number, available: number): number {
  return Math.min(Math.round(base * Math.max(1, scale)), available);
}

export interface MenuItem {
  key: string;
  label: string;
  /** Optional minimum row height for touch-first menus. */
  minHeight?: number;
  /** A Lucide icon name, drawn 16 in the muted colour. */
  icon?: string;
  /**
   * Drawn before the label instead of `icon`: a brand mark, or a label's tag,
   * which is handed the row's fill (hovered or not) for its hole.
   */
  leading?: ReactNode | ((fill: string) => ReactNode);
  /** A muted second line under the label: a project's folder. */
  detail?: string;
  /** Muted text at the right: a count, the active direction. */
  hint?: string;
  /** A visual indicator beside the row label. */
  trailing?: ReactNode;
  accessibilityLabel?: string;
  /** A menu-local key, displayed at the right and active while its panel is open. */
  shortcut?: string;
  /** A check mark at the right: the current choice. `false` keeps its room, so a column of hints stays aligned. */
  checked?: boolean;
  submenu?: MenuSection[];
  onSelect?(): void;
  /** A multi-select row: choosing it leaves the menu open. */
  keepOpen?: boolean;
  disabled?: boolean;
  /** A destructive row (Stop): its label and icon in the danger colour, as the card's Stop button. */
  danger?: boolean;
}

export interface MenuSection {
  key: string;
  /** A muted title row above the group, e.g. a workspace's project. */
  title?: string;
  /** Drawn before the title. */
  titleLeading?: ReactNode;
  items: MenuItem[];
}

export interface MenuChrome {
  background: string;
  border: string;
  /** A row's hover and keyboard fill. */
  hover: string;
  shadow: string;
}

const chromes = new Map<string, MenuChrome>();

function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{6})/i.exec(color.trim())?.[1];
  if (!hex) return false;
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return (0.299 * channel(0) + 0.587 * channel(2) + 0.114 * channel(4)) / 255 < 0.5;
}

/**
 * The menu's colours from the host theme. Linear's #f1f1f1 hover on white is
 * the foreground at about 5.5%; a dark surface needs a little more to read.
 * The shadow is the one fixed colour (the theme has no shadow token): soft
 * and wide on light, deeper on dark where a light shadow vanishes.
 */
export function menuChrome(theme: PluginTheme): MenuChrome {
  const key = themeKey(theme);
  let chrome = chromes.get(key);
  if (!chrome) {
    if (chromes.size >= 8) chromes.delete(chromes.keys().next().value as string);
    const colors = theme.colors;
    const dark = isDark(colors.surface0);
    chrome = {
      background: colors.surface0,
      border: colors.border,
      hover: mix(colors.surface0, colors.foreground, dark ? 0.08 : 0.055),
      shadow: dark
        ? "0px 4px 24px rgba(0, 0, 0, 0.45), 0px 1px 3px rgba(0, 0, 0, 0.3)"
        : "0px 4px 24px rgba(0, 0, 0, 0.08), 0px 1px 3px rgba(0, 0, 0, 0.04)",
    };
    chromes.set(key, chrome);
  }
  return chrome;
}

export interface PlacedRow {
  item: MenuItem;
  /** The row's top inside the panel, padding included, before any scroll. */
  top: number;
}

/** A row's height with the UI scale's growth: taller with a second line. */
export function menuRowHeight(item: MenuItem, scale = 1): number {
  return Math.round(Math.max(item.minHeight ?? 0, item.detail ? MENU.detailRowHeight : MENU.rowHeight) * Math.max(1, scale));
}

/** Every selectable row's top and the panel height, including the UI scale's row growth. */
export function layoutMenu(sections: readonly MenuSection[], scale = 1): { rows: PlacedRow[]; height: number } {
  const rows: PlacedRow[] = [];
  let y = MENU.padV;
  sections.forEach((section, index) => {
    if (index > 0) y += MENU.separatorGap * 2 + 1;
    if (section.title) y += Math.round(MENU.titleHeight * Math.max(1, scale));
    for (const item of section.items) {
      if (!item.disabled) rows.push({ item, top: y });
      y += menuRowHeight(item, scale);
    }
  });
  return { rows, height: y + MENU.padV };
}

/** A searchable menu's field and the 1 pt box of its hairline, with the UI scale's growth. */
export function menuSearchHeight(scale = 1): number {
  return Math.round(MENU.searchHeight * Math.max(1, scale)) + 1;
}

/**
 * The rows a search keeps: those whose label, detail and group title hold
 * every word of `query`, ignoring case, so "beautiful main" finds the main
 * workspace under the beautiful-chat project. Only text the row shows: a
 * match inside a folded "…/" would list a row with no visible reason. A
 * group left without rows drops out with its title; an empty query keeps
 * everything.
 */
export function filterMenuSections(sections: readonly MenuSection[], query: string): MenuSection[] {
  const words = searchWords(query);
  if (words.length === 0) return [...sections];
  return sections.flatMap((section) => {
    const items = section.items.filter((item) => !item.disabled && matchesSearch([section.title, item.label, item.detail], words));
    return items.length ? [{ ...section, items }] : [];
  });
}

/** The gap a menu keeps from the window's edges. */
export const MENU_EDGE = 8;
/** However short the window, a panel shows at least this much, scrolling the rest. */
const MIN_PANEL = MENU.rowHeight * 3 + MENU.padV * 2;

/**
 * The tallest the top panel may be, its top `y` px down the window, inside
 * an area that ends `bottom` px down (the board's frame, else the window;
 * null `y`: not measured yet): MENU.maxHeight, or less so it ends MENU_EDGE
 * above that bottom. A taller menu scrolls.
 */
export function panelMaxHeight(y: number | null, bottom: number): number {
  if (y === null || bottom <= 0) return MENU.maxHeight;
  return Math.min(MENU.maxHeight, Math.max(MIN_PANEL, bottom - y - MENU_EDGE));
}

/**
 * A submenu's top inside the menu (beside its row, at `rowTop`) and its
 * height cap, in an area from `top` to `bottom` px down the window (the
 * board's frame, else the window): shifted up as far as it must to end
 * MENU_EDGE inside the bottom, but never above the top's edge; one taller
 * than the area scrolls.
 */
export function submenuPlacement(rowTop: number, height: number, y: number | null, bottom: number, top = 0): { top: number; maxHeight: number } {
  if (y === null || bottom <= 0) return { top: rowTop, maxHeight: MENU.maxHeight };
  const maxHeight = Math.min(MENU.maxHeight, Math.max(MIN_PANEL, bottom - top - MENU_EDGE * 2));
  const shown = Math.min(height, maxHeight);
  const lowest = bottom - MENU_EDGE - y - shown;
  const highest = top + MENU_EDGE - y;
  return { top: Math.max(highest, Math.min(rowTop, lowest)), maxHeight };
}

/** Where keyboard focus is: a row of the top panel, or of its open submenu. */
export interface MenuFocus {
  level: 0 | 1;
  /** Index into the top panel's selectable rows; -1 before any key. */
  top: number;
  sub: number;
  /** The top row whose submenu is open; null when none. */
  open: number | null;
}

export const MENU_FOCUS: MenuFocus = { level: 0, top: -1, sub: -1, open: null };

export type MenuKeyEffect = { type: "select"; level: 0 | 1; index: number } | { type: "close" } | null;

/**
 * Linear's menu keys: up and down move (wrapping), right or Enter on a row
 * with a submenu opens it and steps in, left steps back out, Enter chooses,
 * Escape closes one level.
 */
export function menuKeyReducer(
  focus: MenuFocus,
  key: string,
  top: readonly MenuItem[],
  sub: readonly MenuItem[] | null,
  shortcuts = true,
): { focus: MenuFocus; effect: MenuKeyEffect; handled: boolean } {
  const step = (index: number, length: number, by: number) => (length === 0 ? -1 : index < 0 ? (by > 0 ? 0 : length - 1) : (index + by + length) % length);
  const inSub = focus.level === 1 && sub !== null;
  const items = sub ?? top;
  const index = shortcuts && (key !== "Enter" || (inSub ? focus.sub : focus.top) < 0)
    ? items.findIndex((item) => !item.disabled && item.shortcut?.toLowerCase() === key.toLowerCase())
    : -1;
  if (index >= 0) {
    if (items[index]!.submenu) return { focus: { level: 1, top: index, sub: 0, open: index }, effect: null, handled: true };
    return { focus, effect: { type: "select", level: sub ? 1 : 0, index }, handled: true };
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    const by = key === "ArrowDown" ? 1 : -1;
    const next = inSub ? { ...focus, sub: step(focus.sub, sub!.length, by) } : { ...focus, top: step(focus.top, top.length, by), open: null };
    return { focus: next, effect: null, handled: true };
  }
  if (key === "Escape") {
    if (inSub || focus.open !== null) return { focus: { ...focus, level: 0, sub: -1, open: null }, effect: null, handled: true };
    return { focus, effect: { type: "close" }, handled: true };
  }
  if (key === "ArrowLeft") {
    if (!inSub) return { focus, effect: null, handled: false };
    return { focus: { ...focus, level: 0, sub: -1, open: null }, effect: null, handled: true };
  }
  if (key === "ArrowRight" || key === "Enter") {
    if (inSub) {
      if (key === "ArrowRight" || focus.sub < 0) return { focus, effect: null, handled: key === "Enter" };
      return { focus, effect: { type: "select", level: 1, index: focus.sub }, handled: true };
    }
    const row = top[focus.top];
    if (!row) return { focus, effect: null, handled: false };
    if (row.submenu) return { focus: { level: 1, top: focus.top, sub: 0, open: focus.top }, effect: null, handled: true };
    if (key === "ArrowRight") return { focus, effect: null, handled: false };
    return { focus, effect: { type: "select", level: 0, index: focus.top }, handled: true };
  }
  return { focus, effect: null, handled: false };
}

/** The selectable items of a panel, in order. */
export function selectableItems(sections: readonly MenuSection[]): MenuItem[] {
  return sections.flatMap((section) => section.items.filter((item) => !item.disabled));
}
