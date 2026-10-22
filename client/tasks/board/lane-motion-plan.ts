/**
 * What a lane change moves, worked out from where the cards were drawn
 * before it and where they are laid out after it (FLIP). Pure geometry: the
 * board measures, this decides, `lane-motion.tsx` plays it.
 *
 * Linear's board does not jump when an issue changes status: the cards under
 * it close the gap, the cards in the new column make room, and the card itself
 * travels from one column to the other. Here the same three cases are:
 *
 * - `slide`: a card that stays in its lane but moved (a card above it left, or
 *   came in) eases from its old place to its new one.
 * - `fly`: a card that changed lanes travels as a copy above the lanes, from
 *   its old place to its new one; the real card shows once it lands. A card
 *   whose new place is out of view (its lane collapsed, scrolled, or the row
 *   not rendered) flies towards its lane and fades on the way.
 * - `leave`: a card that left the board, or a phone's lane on screen, fades
 *   where it was.
 */
import type { LaneId } from "../model";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MotionFrame {
  /** Each rendered card: drawn (before) or laid out without any offset (after), in window coordinates. */
  cards: ReadonlyMap<string, Rect>;
  /** What each lane shows of its cards: an expanded lane's list, a collapsed lane's pill. */
  lanes: ReadonlyMap<LaneId, Rect>;
  /** Every card's lane, rendered or not. */
  laneOf: ReadonlyMap<string, LaneId>;
  /** What the lanes show at all (the board's lane area); a card outside it is out of view. */
  viewport: Rect | null;
}

export type LaneMove =
  | { kind: "slide"; id: string; dx: number; dy: number }
  /** `land`: the copy lands on the real card, hidden until then; otherwise the copy fades out on the way. */
  | { kind: "fly"; id: string; from: Rect; to: Rect; land: boolean }
  | { kind: "leave"; id: string; from: Rect };

export interface PlanOptions {
  /** Cards may travel between lanes; off on the phone, which shows one lane. */
  flights: boolean;
  /** Cards whose copy is still in the air: their real card is hidden, so they fly again. */
  flying: ReadonlySet<string>;
}

/** Less than this is no move at all: rounding between two measures of the same place. */
const STILL = 0.5;

export function planLaneMotion(before: MotionFrame, after: MotionFrame, options: PlanOptions): LaneMove[] {
  const moves: LaneMove[] = [];
  for (const [id, to] of after.cards) {
    const from = before.cards.get(id);
    if (!from) continue;
    const was = before.laneOf.get(id);
    const lane = after.laneOf.get(id);
    const flying = options.flying.has(id);
    if (was === lane && !flying) {
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (Math.abs(dx) >= STILL || Math.abs(dy) >= STILL) moves.push({ kind: "slide", id, dx, dy });
      continue;
    }
    // Out of view before: nothing to travel from; the card fades in where it lands.
    if (!flying && !inView(from, laneRect(before, was), before.viewport)) continue;
    if (!options.flights) {
      moves.push({ kind: "leave", id, from });
      continue;
    }
    const target = laneRect(after, lane);
    if (inView(to, target, after.viewport)) moves.push({ kind: "fly", id, from, to, land: true });
    else if (target) moves.push({ kind: "fly", id, from, to: toward(from, to, target), land: false });
    else moves.push({ kind: "leave", id, from });
  }
  for (const [id, from] of before.cards) {
    if (after.cards.has(id)) continue;
    const was = before.laneOf.get(id);
    const lane = after.laneOf.get(id);
    // Still in its lane, only no longer rendered (pushed out of the list's window): no move to show.
    if (lane !== undefined && lane === was && !options.flying.has(id)) continue;
    if (!options.flying.has(id) && !inView(from, laneRect(before, was), before.viewport)) continue;
    const target = options.flights && lane !== undefined ? laneRect(after, lane) : null;
    if (target) moves.push({ kind: "fly", id, from, to: toward(from, null, target), land: false });
    else moves.push({ kind: "leave", id, from });
  }
  return moves;
}

function laneRect(frame: MotionFrame, lane: LaneId | undefined): Rect | null {
  return lane === undefined ? null : frame.lanes.get(lane) ?? null;
}

/** Some of the card shows: inside its lane's list (when known) and inside the lane area. */
export function inView(card: Rect, lane: Rect | null, viewport: Rect | null): boolean {
  if (lane && !overlaps(card, lane)) return false;
  if (viewport && !overlaps(card, viewport)) return false;
  return true;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Where a card heads for when its new place is out of view: into its lane, at
 * the edge nearest that place (or at the height it left from), centred on a
 * lane narrower than the card (a collapsed lane's pill).
 */
export function toward(from: Rect, to: Rect | null, lane: Rect): Rect {
  const width = to?.width ?? from.width;
  const height = to?.height ?? from.height;
  const x = lane.width < width ? lane.x + (lane.width - width) / 2 : to ? clamp(to.x, lane.x, lane.x + lane.width - width) : lane.x + (lane.width - width) / 2;
  const top = lane.y;
  const bottom = Math.max(top, lane.y + lane.height - height);
  const y = clamp(to ? to.y : from.y, top, bottom);
  return { x, y, width, height };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** The lanes hold the same cards in the same order: nothing moved, whatever else changed on the cards. */
export function sameOrder<Lane extends { cards: readonly { id: string }[] }>(left: Record<LaneId, Lane>, right: Record<LaneId, Lane>, lanes: readonly LaneId[]): boolean {
  return lanes.every((lane) => sameCards(left[lane].cards, right[lane].cards));
}

export function sameCards(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index]!.id !== b[index]!.id) return false;
  return true;
}
