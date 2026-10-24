import type { LaneWidth, SidebarCount } from "../../../shared/tasks-settings";
import { ACTIVE_LANE_ORDER, type BoardCounts, type LaneId } from "../model";

/**
 * The board's pure decisions: keyboard focus on the desktop board, the
 * phone's lane swipe and default lane, and the sidebar's counts. Kept apart
 * from the components so the rules are tested without rendering.
 */

/** The keyboard-focused card: its lane and its index in the lane's filtered cards. */
export interface BoardFocus {
  lane: LaneId;
  index: number;
}

/** What the reducer needs of each lane, in `LANE_ORDER`. */
export interface LaneShape {
  id: LaneId;
  count: number;
  collapsed: boolean;
}

/** Side effects the board runs after a key: open the focused card, cancel a stop, focus the search. */
export type BoardKeyEffect = "open" | "cancel" | "search" | null;

export interface BoardKeyResult {
  focus: BoardFocus | null;
  effect: BoardKeyEffect;
  /** The key was ours: the board prevents its default. */
  handled: boolean;
}

const MOVES: Record<string, "down" | "up" | "left" | "right"> = {
  j: "down",
  ArrowDown: "down",
  k: "up",
  ArrowUp: "up",
  h: "left",
  ArrowLeft: "left",
  l: "right",
  ArrowRight: "right",
};

/**
 * J/K or ↑/↓ within a lane, H/L or ←/→ across lanes skipping empty and
 * collapsed ones, Enter opens, Esc cancels a stop confirmation, "/" focuses
 * the search. Without a focus, a move lands on the first card of the first
 * lane that has one. A focus left past the end of a shrunken lane is clamped
 * first, so every result points at a card or is null.
 */
export function boardKeyReducer(focus: BoardFocus | null, key: string, lanes: readonly LaneShape[]): BoardKeyResult {
  const current = clampFocus(focus, lanes);
  if (key === "/") return { focus: current, effect: "search", handled: true };
  if (key === "Escape") return { focus: current, effect: "cancel", handled: current !== null };
  if (key === "Enter") return { focus: current, effect: current ? "open" : null, handled: current !== null };
  const move = MOVES[key];
  if (!move) return { focus: current, effect: null, handled: false };
  const open = lanes.filter((lane) => lane.count > 0 && !lane.collapsed);
  if (!current) {
    const first = open[0];
    return { focus: first ? { lane: first.id, index: 0 } : null, effect: null, handled: first !== undefined };
  }
  const lane = lanes.find((entry) => entry.id === current.lane)!;
  if (move === "down") return moved({ lane: lane.id, index: Math.min(current.index + 1, lane.count - 1) });
  if (move === "up") return moved({ lane: lane.id, index: Math.max(current.index - 1, 0) });
  const order = lanes.map((entry) => entry.id);
  const step = move === "left" ? -1 : 1;
  for (let at = order.indexOf(current.lane) + step; at >= 0 && at < order.length; at += step) {
    const next = lanes[at]!;
    if (next.count > 0 && !next.collapsed) return moved({ lane: next.id, index: Math.min(current.index, next.count - 1) });
  }
  return moved(current);
}

function moved(focus: BoardFocus): BoardKeyResult {
  return { focus, effect: null, handled: true };
}

/** The focus still pointing at a card after the lanes changed, else null. */
export function clampFocus(focus: BoardFocus | null, lanes: readonly LaneShape[]): BoardFocus | null {
  if (!focus) return null;
  const lane = lanes.find((entry) => entry.id === focus.lane);
  if (!lane || lane.count === 0 || lane.collapsed) return null;
  return focus.index < lane.count ? focus : { lane: focus.lane, index: lane.count - 1 };
}

/** The phone's swipe rule on web (prototype 6.6); iOS and Android page the lanes natively. */
export const SWIPE = {
  /** Horizontal travel, px. */
  distance: 56,
  /** |dx| must be at least this many times |dy|; vertical scrolling wins otherwise. */
  ratio: 1.5,
  /** Card taps are swallowed this long after a swipe. */
  swallowMs: 350,
} as const;

/** +1 for the next lane (a swipe to the left), −1 for the previous, 0 for no swipe. */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE.distance || Math.abs(dx) < SWIPE.ratio * Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** A phone tab's layout: the tab in the bar, its content row in the tab, and the label (with its count) in the row. */
export interface TabBox {
  tab?: { x: number; width: number };
  row?: { x: number; width: number };
  label?: { x: number; width: number };
}

/** True when some tab's content is wider than its share of the bar (a quarter, a fifth with the archived lane): the tabs then size to content and scroll. */
export function tabsOverflow(boxes: Partial<Record<LaneId, TabBox>>, barWidth: number, tabs = ACTIVE_LANE_ORDER.length): boolean {
  if (barWidth <= 0) return false;
  return Object.values(boxes).some((box) => (box?.row?.width ?? 0) > barWidth / tabs + 0.5);
}

/**
 * Where the lane underline sits, as a centre and a width in the bar's
 * content: under the active tab's label and count once laid out, else the
 * tab's share less 24 centred in it. Null before the bar is.
 */
export function tabUnderline(
  box: TabBox | undefined,
  index: number,
  barWidth: number,
  tabs = ACTIVE_LANE_ORDER.length,
): { center: number; width: number; measured: boolean } | null {
  if (box?.tab && box.row && box.label && box.label.width > 0) {
    return { center: box.tab.x + box.row.x + box.label.x + box.label.width / 2, width: box.label.width, measured: true };
  }
  if (barWidth <= 0) return null;
  const share = barWidth / tabs;
  return { center: index * share + share / 2, width: Math.max(0, share - 24), measured: false };
}

/** The lane a step lands on in the board's `order`; null past either end (no wrap). */
export function laneAfter(lane: LaneId, step: -1 | 0 | 1, order: readonly LaneId[] = ACTIVE_LANE_ORDER): LaneId | null {
  if (step === 0) return null;
  const at = order.indexOf(lane);
  return at < 0 ? null : order[at + step] ?? null;
}

/** True while a tap still belongs to the swipe that just ended. */
export function swallowsTap(swipedAt: number | null, now: number): boolean {
  return swipedAt !== null && now - swipedAt < SWIPE.swallowMs;
}

/** The phone's lane: the session's pick, else needs-input when it has cards, else running. */
export function defaultLane(needsInput: number, remembered: LaneId | null): LaneId {
  if (remembered) return remembered;
  return needsInput > 0 ? "needs_input" : "running";
}

/** One trailing count of the sidebar row, in lane order: needs input, running, review. */
export interface SidebarCountPart {
  lane: Exclude<LaneId, "done" | "archived">;
  count: number;
}

/** The sidebar row's trailing counts; a zero count is left out, so it disappears. */
export function sidebarCountParts(
  counts: Pick<BoardCounts, "needsInput" | "running" | "review">,
  mode: SidebarCount,
): SidebarCountPart[] {
  if (mode === "none") return [];
  const all: SidebarCountPart[] = [
    { lane: "needs_input", count: counts.needsInput },
    ...(mode === "all" ? [{ lane: "running", count: counts.running }, { lane: "review", count: counts.review }] as const : []),
  ];
  return all.filter((part) => part.count > 0);
}

const SIDEBAR_COUNT_TEXT: Record<"en" | "zh", Record<SidebarCountPart["lane"], (count: number) => string>> = {
  en: { needs_input: (n) => `${n} need input`, running: (n) => `${n} running`, review: (n) => `${n} to review` },
  zh: { needs_input: (n) => `${n} 个待输入`, running: (n) => `${n} 个运行中`, review: (n) => `${n} 个待查看` },
};

/** The counts as the row's accessibility text, "" when nothing shows. */
export function sidebarCountText(parts: readonly SidebarCountPart[], language: "en" | "zh"): string {
  return parts.map((part) => SIDEBAR_COUNT_TEXT[language][part.lane](part.count)).join(language === "zh" ? "，" : ", ");
}

/** The desktop lanes' geometry: Linear-style panels on the board's background. */
export const LANES = {
  /** The default scroll width before adapting to a narrow board (cards 300 - 2 x 8 = 284). */
  min: 300,
  /** The narrowest a lane ever gets (cards 220 - 2 x 8 = 204). */
  narrow: 220,
  /**
   * The widest a lane gets at the default lane width: Linear's card, 322
   * wide (646 device px at 2x), plus the panel's padding and, on web, its
   * scrollbar gutter (340 - 8 - 4 - 6 = 322). A wider card only spreads the
   * same rows apart.
   */
  max: 340,
  /** A collapsed lane's strip. */
  collapsed: 40,
  /** Between two lanes. */
  gap: 8,
  /** Around the row of lanes, left and right. */
  edge: 12,
} as const;

/**
 * Each `board.laneWidth`'s scroll width and widest lane. Four lanes stop
 * scrolling on a board 1088 wide at narrow (4 x 260 + 48), 1248 at default
 * and 1408 at wide; the widest cards are 262, 322 and 382. On a narrower
 * board default lanes adapt down to 260 and narrow lanes down to 220, keeping
 * a 40 pt difference while scrolling. Wide lanes use 300 below a 632 pt board.
 */
export const LANE_SIZES: Readonly<Record<LaneWidth, { min: number; max: number }>> = {
  narrow: { min: 260, max: 280 },
  default: { min: LANES.min, max: LANES.max },
  wide: { min: 340, max: 400 },
};

/**
 * True when the board draws the phone layout: the host's compact layout only.
 * A tablet whose board is narrow (a foldable with the host's sidebar open, a
 * split screen) keeps the desktop lanes at their lane width and scrolls
 * them sideways, as the desktop does, rather than switching to the phone's
 * one-lane tabs.
 */
export function boardIsCompact(hostCompact: boolean): boolean {
  return hostCompact;
}

export interface LaneLayout {
  /** Each expanded lane's width; collapsed lanes are `LANES.collapsed`. */
  laneWidth: number;
  /** The row's full width, edges included. */
  contentWidth: number;
  /** True only when the lanes do not fit at the width they scroll at: then the row scrolls sideways. */
  scroll: boolean;
}

/**
 * Expanded lanes share the viewport equally up to the lane width's `max`;
 * past it they keep that width and sit at the left, as Linear's do, leaving
 * the rest of a wide window empty. Default lanes adapt their scroll width
 * to fit up to two expanded lanes beside the collapsed strips, down to 260.
 * Narrow lanes adapt down to 220 to stay smaller than default lanes; wide
 * lanes use 300 when two standard default lanes cannot fit in the board.
 * Any lanes that do not fit scroll sideways (a lane never exceeds the board
 * itself unless it is below 220).
 */
export function laneLayout(viewport: number, expanded: number, collapsed: number, size: LaneWidth = "default"): LaneLayout {
  const preset = LANE_SIZES[size];
  const smallWide = size === "wide" && viewport < 2 * LANES.min + 2 * LANES.edge + LANES.gap;
  const max = smallWide ? 300 : preset.max;
  const lanes = expanded + collapsed;
  const fixed = 2 * LANES.edge + Math.max(0, lanes - 1) * LANES.gap + collapsed * LANES.collapsed;
  if (expanded === 0) return { laneWidth: 0, contentWidth: Math.max(viewport, fixed), scroll: fixed > viewport };
  const visible = Math.min(2, expanded);
  const visibleFixed = 2 * LANES.edge + (visible + collapsed - 1) * LANES.gap + collapsed * LANES.collapsed;
  const defaultMin = Math.max(260, Math.min(LANES.min, (viewport - visibleFixed) / visible));
  const min = size === "default" ? defaultMin : size === "narrow" ? Math.min(preset.min, defaultMin - 40) : smallWide ? 300 : preset.min;
  const share = (viewport - fixed) / expanded;
  if (share >= min) return { laneWidth: Math.min(share, max), contentWidth: viewport, scroll: false };
  const width = Math.max(LANES.narrow, Math.min(min, viewport - 2 * LANES.edge));
  const contentWidth = Math.max(viewport, fixed + expanded * width);
  return { laneWidth: width, contentWidth, scroll: contentWidth > viewport };
}
