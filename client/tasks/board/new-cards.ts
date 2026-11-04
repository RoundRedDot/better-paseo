/**
 * New tasks the user has not seen yet. A task created while the board is open
 * enters its lane and, once it is on screen, its card breathes an outline in
 * its lane's colour. Until then its lane says so: a "N new" pill over the
 * list when the card is above or below what the list shows (the running lane
 * keeps its oldest task first, so a new one lands at its end), a dot on the
 * phone's lane tab while another lane is shown, a dot on a collapsed lane.
 *
 * Module level, per host: the phone's pager pages and the lanes mount and
 * unmount, and what was seen has to outlive them. Only what changes is
 * announced; each card and lane reads its own part.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ViewToken } from "react-native";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../model";
import { FLASH } from "./breathing";
import { MOTION } from "./board-style";

/** A task created longer ago than this is not new: unarchived, paged in, or brought back by a filter. */
export const NEW_WINDOW_MS = 60_000;
/** On screen this much counts as seen. */
export const SEEN_PERCENT = 60;
/**
 * How long a new card may go unseen before its lane says so. A list reports a
 * row on screen only once it is laid out, a few frames after the row came: the
 * pill or dot would blink in and out for a card the user is looking at.
 */
export const ANNOUNCE_AFTER_MS = 500;
/** A task seen this soon after it came is still entering: its outline waits for the entrance. */
const ENTERING_MS = 1000;
/** The outline of a card seen as it entered starts as the entrance settles. */
export const FLASH_AFTER_ENTER_MS = MOTION.enterDelayMs + MOTION.enterMs - 40;
/** The outline of a card scrolled to (or shown by its tab) starts at once, nearly. */
export const FLASH_AFTER_SCROLL_MS = 120;
/** Two breaths. */
const FLASH_PULSES = 2;
const FLASH_MS = FLASH_PULSES * (FLASH.inMs + FLASH.outMs);

export interface NewCardFlash {
  /** Changes for every outline; 0 when there is none. */
  key: number;
  delay: number;
}

const NO_FLASH: NewCardFlash = { key: 0, delay: 0 };
const NO_IDS: readonly string[] = [];
const NO_LANES: ReadonlySet<LaneId> = new Set();

export interface NewCardStore {
  /** The cards the board shows now. The first ready call only learns them. */
  track(lanes: Record<LaneId, LaneModel>, now?: number): void;
  /** These cards are on screen: the new ones among them breathe and stop counting. */
  seen(ids: Iterable<string>, now?: number): void;
  /** A lane's new cards not seen yet, in the lane's order, once they have gone unseen for `ANNOUNCE_AFTER_MS`. */
  unseen(lane: LaneId): readonly string[];
  /** A lane's new cards not seen yet, at once: what its list checks against what it shows. */
  pending(lane: LaneId): readonly string[];
  /** The lanes holding new cards not seen yet. */
  lanes(): ReadonlySet<LaneId>;
  flash(id: string): NewCardFlash;
  subscribe(listener: () => void): () => void;
  /** Forget everything (tests, a board that goes away for good). */
  reset(): void;
}

interface Pending {
  lane: LaneId;
  at: number;
  /** Unseen long enough for its lane to say so. */
  announced: boolean;
}

// A closure, not a class: Hermes compiles no class syntax.
export function createNewCardStore(): NewCardStore {
  let known: Set<string> | null = null;
  const pending = new Map<string, Pending>();
  const flashes = new Map<string, NewCardFlash>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  let order: Record<LaneId, readonly string[]> | null = null;
  let byLane: Partial<Record<LaneId, readonly string[]>> = {};
  let pendingByLane: Partial<Record<LaneId, readonly string[]>> = {};
  let laneSet: ReadonlySet<LaneId> = NO_LANES;
  let flashKey = 0;

  function rebuild(): void {
    const next: Partial<Record<LaneId, readonly string[]>> = {};
    const nextPending: Partial<Record<LaneId, readonly string[]>> = {};
    const lanes = new Set<LaneId>();
    // The same arrays while their ids hold, so a lane reading them draws again only for a change.
    const keep = (last: readonly string[] | undefined, ids: string[]) => (last && sameIds(last, ids) ? last : ids);
    if (order) {
      for (const lane of LANE_ORDER) {
        const all = order[lane].filter((id) => pending.get(id)?.lane === lane);
        if (all.length === 0) continue;
        nextPending[lane] = keep(pendingByLane[lane], all);
        const shown = all.filter((id) => pending.get(id)!.announced);
        if (shown.length === 0) continue;
        next[lane] = keep(byLane[lane], shown);
        lanes.add(lane);
      }
    }
    byLane = next;
    pendingByLane = nextPending;
    laneSet = sameLanes(laneSet, lanes) ? laneSet : lanes.size === 0 ? NO_LANES : lanes;
  }

  function clearTimer(id: string): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  }

  // The timers are made here, not in the loops that call these: on Hermes a
  // closure made in a for-of body sees the loop's last value once it ends.
  function announceLater(id: string, entry: Pending): void {
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        if (pending.get(id) !== entry) return;
        entry.announced = true;
        notify();
      }, ANNOUNCE_AFTER_MS),
    );
  }

  function forgetFlashLater(id: string, ms: number): void {
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        flashes.delete(id);
        notify();
      }, ms),
    );
  }

  function notify(): void {
    rebuild();
    listeners.forEach((listener) => listener());
  }

  const store: NewCardStore = {
    track(lanes, now = Date.now()) {
      order = Object.fromEntries(LANE_ORDER.map((lane) => [lane, lanes[lane].cards.map((card) => card.id)])) as unknown as Record<LaneId, readonly string[]>;
      let changed = false;
      const where = new Map<string, LaneId>();
      for (const lane of LANE_ORDER) for (const card of lanes[lane].cards) where.set(card.id, lane);
      if (!known) {
        known = new Set(where.keys());
        return;
      }
      for (const lane of LANE_ORDER) {
        for (const card of lanes[lane].cards) {
          if (known.has(card.id)) continue;
          known.add(card.id);
          if (!isNewTask(card, now)) continue;
          const entry: Pending = { lane, at: now, announced: false };
          pending.set(card.id, entry);
          announceLater(card.id, entry);
          changed = true;
        }
      }
      // A new card that left its lane before anyone saw it moved on: its move shows that.
      for (const [id, entry] of pending) {
        if (where.get(id) === entry.lane) continue;
        pending.delete(id);
        clearTimer(id);
        changed = true;
      }
      if (changed) notify();
      else rebuild();
    },
    seen(ids, now = Date.now()) {
      let changed = false;
      for (const id of ids) {
        const entry = pending.get(id);
        if (!entry) continue;
        pending.delete(id);
        flashKey += 1;
        const delay = now - entry.at < ENTERING_MS ? FLASH_AFTER_ENTER_MS : FLASH_AFTER_SCROLL_MS;
        flashes.set(id, { key: flashKey, delay });
        clearTimer(id);
        // Gone once it has breathed, so a card scrolled away and back does not breathe again.
        forgetFlashLater(id, delay + FLASH_MS);
        changed = true;
      }
      if (changed) notify();
    },
    unseen: (lane) => byLane[lane] ?? NO_IDS,
    pending: (lane) => pendingByLane[lane] ?? NO_IDS,
    lanes: () => laneSet,
    flash: (id) => flashes.get(id) ?? NO_FLASH,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      known = null;
      order = null;
      pending.clear();
      flashes.clear();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      notify();
    },
  };
  return store;
}

/** A task created just now, not a provider's subagent (those come and go in bursts inside their parent's turn). */
function isNewTask(card: TaskCard, now: number): boolean {
  if (card.subagent) return false;
  const created = Date.parse(card.timing.createdAt);
  return Number.isFinite(created) && now - created <= NEW_WINDOW_MS;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sameLanes(a: ReadonlySet<LaneId>, b: ReadonlySet<LaneId>): boolean {
  if (a.size !== b.size) return false;
  for (const lane of b) if (!a.has(lane)) return false;
  return true;
}

const stores = new Map<string, NewCardStore>();

export function newCardStore(hostId: string): NewCardStore {
  let store = stores.get(hostId);
  if (!store) {
    store = createNewCardStore();
    stores.set(hostId, store);
  }
  return store;
}

/** Tests: every host starts over. */
export function resetNewCards(): void {
  stores.forEach((store) => store.reset());
  stores.clear();
}

const noSubscribe = () => () => {};

/** The board tells the store what it shows, once the lanes are committed. */
export function useTrackNewCards(hostId: string, lanes: Record<LaneId, LaneModel>, ready: boolean): void {
  useEffect(() => {
    if (ready) newCardStore(hostId).track(lanes);
  }, [hostId, lanes, ready]);
}

export function useUnseenCards(hostId: string, lane: LaneId): readonly string[] {
  const store = newCardStore(hostId);
  const read = () => store.unseen(lane);
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useUnseenLanes(hostId: string): ReadonlySet<LaneId> {
  const store = newCardStore(hostId);
  return useSyncExternalStore(store.subscribe, store.lanes, store.lanes);
}

/** A card's outline; none for a copy of a card (a ghost, the phone's outgoing lane). */
export function useNewCardFlash(hostId: string, id: string, off: boolean): NewCardFlash {
  const store = newCardStore(hostId);
  const read = () => (off ? NO_FLASH : store.flash(id));
  return useSyncExternalStore(off ? noSubscribe : store.subscribe, read, read);
}

/**
 * A lane list's part: which of its cards are on screen. `active` is whether
 * the list is what the user looks at (the board shown, the phone's current
 * page); a page the pager keeps beside it sees nothing. The callback pair is
 * one object for the list's life: a list cannot take a new one.
 */
export function useSeenCards(hostId: string, lane: LaneId, active: boolean): {
  viewabilityConfigCallbackPairs: { viewabilityConfig: { itemVisiblePercentThreshold: number }; onViewableItemsChanged(info: { viewableItems: ViewToken[] }): void }[];
  /** The index of the first card shown, -1 before the list reports. */
  firstShown(): number;
} {
  const store = newCardStore(hostId);
  const shown = useRef<{ ids: readonly string[]; first: number }>({ ids: [], first: -1 });
  const live = useRef(active);
  live.current = active;
  const read = () => store.pending(lane);
  const pending = useSyncExternalStore(store.subscribe, read, read);
  const [pairs] = useState(() => [
    {
      viewabilityConfig: { itemVisiblePercentThreshold: SEEN_PERCENT },
      onViewableItemsChanged(info: { viewableItems: ViewToken[] }) {
        const ids: string[] = [];
        let first = -1;
        for (const token of info.viewableItems) {
          if (!token.isViewable) continue;
          ids.push(String(token.key));
          if (token.index !== null && (first === -1 || token.index < first)) first = token.index;
        }
        shown.current = { ids, first };
        if (live.current) store.seen(ids);
      },
    },
  ]);
  // A card that was on screen before it counted as new (the list reported it
  // first), or a page that just became the one shown.
  useEffect(() => {
    if (active && pending.length > 0) store.seen(shown.current.ids);
  }, [store, active, pending]);
  const firstShown = useCallback(() => shown.current.first, []);
  return { viewabilityConfigCallbackPairs: pairs, firstShown };
}

/** Up when the first new card is above the cards the list shows, down otherwise (the running lane adds at its end). */
export function pillDirection(cards: readonly { id: string }[], unseen: readonly string[], firstShown: number): "up" | "down" {
  if (unseen.length === 0 || firstShown < 0) return "down";
  const index = cards.findIndex((card) => card.id === unseen[0]);
  return index >= 0 && index < firstShown ? "up" : "down";
}
