/**
 * Lane changes without the jump: the board measures its rendered cards just
 * before new lanes commit and again right after, and `planLaneMotion` turns
 * the two into slides, flights and fades (see `lane-motion-plan.ts`).
 *
 * The first measure is taken while the new lanes render, from the screen as it
 * still is; the second in the board's layout effect, which runs after every
 * card's own. Measuring there is synchronous on the web
 * (`getBoundingClientRect`) and on Fabric (`measureInWindow` answers from the
 * shadow tree at once); where it is not, a card has no rect and no motion, and
 * the board still shows the right lanes. What is measured is a card's slot,
 * which never moves itself.
 *
 * Two ways to play it, as the platforms differ in what reaches the screen
 * together with the new lanes:
 *
 * - Web: the browser paints after the layout effect, so the effect can still
 *   set each card's offset (a slide back to its old place) and hide a card that
 *   changed lanes while a copy of it flies there. Only the moving card is copied.
 * - Native ("cover"): iOS drew the new layout a frame before anything the
 *   layout effect set, Animated or React state alike, so a card jumped there
 *   and back. Only what renders with the new lanes is safe: in that same render
 *   the lanes that change hide their list and the layer draws copies of their
 *   cards where they were. The effect then moves the copies to the measured new
 *   places, and the lists show again, under copies that match them, once every
 *   copy has arrived.
 *
 * A list scrolled to its end that loses its last card scrolls back on its own
 * once the native view takes the shorter content, after the effect has
 * measured: the measure still has the old offset. Native moves its copies to
 * where the cards will be after that scroll (`scrollBack`), so the cards above
 * slide down into the gap instead of the whole list dropping as it shows
 * again. The browser scrolls back during layout, so the web measures it.
 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Animated, Platform, View } from "react-native";
import { LANE_ORDER, type LaneId, type LaneModel, type TaskCard } from "../model";
import { MOTION } from "./board-style";
import { inView, planLaneMotion, sameCards, sameOrder, scrollBack, type LaneMove, type MotionFrame, type Rect } from "./lane-motion-plan";

/** JS-driven: the cover's copies and the web's offsets are set from JS in the frame they belong to. */
const nativeDriver = false;
const COVER = Platform.OS !== "web";
/** A cover outlives no animation by more than this, whatever happens to the callbacks. */
const COVER_LIMIT_MS = 1200;

type Measurable = {
  getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void;
};

/** The node's rect now, or null: not laid out, hidden (`display: none`), or not answered at once. */
export function measureNow(node: unknown): Rect | null {
  const target = node as Measurable | null;
  if (!target) return null;
  let rect: Rect | null = null;
  if (Platform.OS === "web" && typeof target.getBoundingClientRect === "function") {
    const box = target.getBoundingClientRect();
    rect = { x: box.left, y: box.top, width: box.width, height: box.height };
  } else {
    target.measureInWindow?.((x, y, width, height) => {
      rect = { x, y, width, height };
    });
  }
  const out = rect as Rect | null;
  return out && (out.width > 0 || out.height > 0) ? out : null;
}

/** A list's scrolling node: the element on the web, the native scroll view's instance elsewhere. */
export function scrollNode(list: unknown): unknown {
  const scroller = list as { getScrollableNode?(): unknown; getNativeScrollRef?(): unknown } | null;
  return Platform.OS === "web" ? scroller?.getScrollableNode?.() : scroller?.getNativeScrollRef?.();
}

/** A web card's own offset and visibility. */
interface CellValues {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
}

interface Cell {
  node: unknown;
  values: CellValues | null;
}

/** A web slide in progress, so a lane change in the middle of it starts from where the card is. */
interface Slide {
  dx: number;
  dy: number;
  start: number;
  animation: Animated.CompositeAnimation;
}

export interface Ghost {
  /** One copy per card. */
  key: string;
  card: TaskCard;
  from: Rect;
  to: Rect;
  /** "out": fades on the way (a card that left, or heads out of view); "in": fades in where it is. */
  fade: "none" | "out" | "in";
  /** Web: the real card is hidden until this copy lands on it. */
  reveal: boolean;
  /** When it set off; `Infinity` for a cover's copy still waiting for its new place. */
  start: number;
  duration: number;
  /** The layer's top left: rects are in window coordinates, a ghost draws in the layer. */
  origin: { x: number; y: number };
}

interface Snapshot {
  frame: MotionFrame;
  cards: ReadonlyMap<string, TaskCard>;
  /** Web: the cards hidden while their copy flies to them, which fly on from where the copy is. */
  flying: ReadonlySet<string>;
}

const now = () => Date.now();

function progress(start: number, duration: number, at: number): number {
  if (!Number.isFinite(start)) return 0;
  if (duration <= 0) return 1;
  return MOTION.ease(Math.min(1, Math.max(0, (at - start) / duration)));
}

/** Where a ghost is drawn now. */
function ghostRect(ghost: Ghost, at: number): Rect {
  const t = progress(ghost.start, ghost.duration, at);
  return { x: ghost.from.x + (ghost.to.x - ghost.from.x) * t, y: ghost.from.y + (ghost.to.y - ghost.from.y) * t, width: ghost.to.width, height: ghost.to.height };
}

export interface LaneMotionStore {
  /** The ghosts' layer: its rect is their origin and the lanes' viewport. */
  layer: unknown;
  attach(id: string, node: unknown, values: CellValues | null): () => void;
  /** A lane's measurable node: an expanded lane's list, a collapsed lane's pill. */
  setLane(id: LaneId, node: (() => unknown) | null): void;
  ghosts(): readonly Ghost[];
  /** Native: the lanes whose list is hidden under copies of their cards. */
  covered(): ReadonlySet<LaneId>;
  subscribe(listener: () => void): () => void;
  /** The cards as drawn now, with the lanes they are in. */
  snapshot(lanes: Record<LaneId, LaneModel>): Snapshot;
  /** Native, while the new lanes render: cover the lanes that change with copies of what they show now. */
  freeze(before: Snapshot, last: Record<LaneId, LaneModel>, next: Record<LaneId, LaneModel>): void;
  /** Plays what changed between `before` and the lanes just committed. */
  play(before: Snapshot, lanes: Record<LaneId, LaneModel>): void;
  /** A ghost reached its end. */
  finish(key: string): void;
  /** Everything back in place: the board stopped showing motion (hidden, reduced motion, unmounted). */
  settle(): void;
}

const NO_LANES: ReadonlySet<LaneId> = new Set();

// A closure, not a class: Hermes compiles no class syntax.
export function createLaneMotionStore(flights: boolean): LaneMotionStore {
  const cells = new Map<string, Cell>();
  const lanes = new Map<LaneId, () => unknown>();
  const slides = new Map<string, Slide>();
  const listeners = new Set<() => void>();
  let ghostList: readonly Ghost[] = [];
  let coveredLanes: ReadonlySet<LaneId> = NO_LANES;
  let coverTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function setGhosts(next: readonly Ghost[]): void {
    if (next === ghostList) return;
    ghostList = next;
    notify();
  }

  /** The lists show again and the copies go, in one update: the copies sit where the cards are. */
  function uncover(): void {
    if (coverTimer) clearTimeout(coverTimer);
    coverTimer = null;
    if (coveredLanes.size === 0 && ghostList.length === 0) return;
    coveredLanes = NO_LANES;
    ghostList = [];
    notify();
  }

  function holdCover(ms: number): void {
    if (coverTimer) clearTimeout(coverTimer);
    coverTimer = setTimeout(uncover, ms);
  }

  /** How far a web card is still drawn from its place. */
  function offset(id: string, at: number): { x: number; y: number } {
    const slide = slides.get(id);
    if (!slide) return { x: 0, y: 0 };
    const left = 1 - progress(slide.start, MOTION.slideMs, at);
    return { x: slide.dx * left, y: slide.dy * left };
  }

  /** The cards whose copy is where they are seen: their real card is hidden or covered. */
  function standing(): Set<string> {
    const out = new Set<string>();
    for (const ghost of ghostList) if (ghost.reveal || (COVER && ghost.fade !== "out")) out.add(ghost.key);
    return out;
  }

  function laneRects(): Map<LaneId, Rect> {
    const out = new Map<LaneId, Rect>();
    for (const [id, node] of lanes) {
      const rect = measureNow(node());
      if (rect) out.set(id, rect);
    }
    return out;
  }

  /** Native: how far each lane's list will scroll back on its own, for content that got shorter. */
  function scrollBacks(rects: ReadonlyMap<LaneId, Rect>): Map<LaneId, number> {
    const out = new Map<LaneId, number>();
    for (const [id, node] of lanes) {
      const viewport = rects.get(id);
      const scroller = node() as { getInnerViewRef?(): unknown } | null;
      const content = viewport ? measureNow(scroller?.getInnerViewRef?.()) : null;
      const shift = viewport && content ? scrollBack(viewport, content) : 0;
      if (shift > 0) out.set(id, shift);
    }
    return out;
  }

  function slide(id: string, values: CellValues, dx: number, dy: number, at: number): void {
    slides.get(id)?.animation.stop();
    values.x.setValue(dx);
    values.y.setValue(dy);
    const timing = (value: Animated.Value) =>
      Animated.timing(value, { toValue: 0, duration: MOTION.slideMs, easing: MOTION.ease, useNativeDriver: nativeDriver });
    const animation = Animated.parallel([timing(values.x), timing(values.y)]);
    const entry: Slide = { dx, dy, start: at, animation };
    slides.set(id, entry);
    animation.start(() => {
      if (slides.get(id) === entry) slides.delete(id);
    });
  }

  /** Web: offsets and visibility on the real cards, a copy only for a card that changes lanes or leaves. */
  function playOnCards(moves: LaneMove[], at: number, cardOf: (move: LaneMove) => TaskCard | undefined, viewport: Rect | null): void {
    const replaced = new Set<string>();
    const added: Ghost[] = [];
    const origin = viewport ? { x: viewport.x, y: viewport.y } : { x: 0, y: 0 };
    for (const move of moves) {
      const values = cells.get(move.id)?.values ?? null;
      if (move.kind === "slide") {
        if (values) slide(move.id, values, move.dx, move.dy, at);
        continue;
      }
      replaced.add(move.id);
      const card = cardOf(move);
      if (!card || !viewport) {
        // No layer to draw a copy in: the card just shows in its new place.
        values?.opacity.setValue(1);
        continue;
      }
      if (move.kind === "leave") {
        added.push({ key: move.id, card, from: move.from, to: move.from, fade: "out", reveal: false, start: at, duration: MOTION.leaveMs, origin });
        continue;
      }
      const reveal = move.land && values !== null;
      if (values && reveal) {
        // The copy carries the card; the card itself waits, unmoved, where it lands.
        slides.get(move.id)?.animation.stop();
        slides.delete(move.id);
        values.x.setValue(0);
        values.y.setValue(0);
        values.opacity.setValue(0);
      } else {
        values?.opacity.setValue(1);
      }
      added.push({ key: move.id, card, from: move.from, to: move.to, fade: reveal ? "none" : "out", reveal, start: at, duration: MOTION.flyMs, origin });
    }
    if (replaced.size > 0 || added.length > 0) setGhosts([...ghostList.filter((ghost) => !replaced.has(ghost.key)), ...added]);
  }

  /** Native: every copy under the cover heads for its card's new place, and new cards fade in over theirs. */
  function playCover(moves: LaneMove[], before: MotionFrame, after: MotionFrame, at: number, cardOf: (move: LaneMove) => TaskCard | undefined, current: ReadonlyMap<string, TaskCard>): void {
    const byId = new Map(moves.map((move) => [move.id, move]));
    const next: Ghost[] = [];
    for (const ghost of ghostList) {
      if (Number.isFinite(ghost.start)) {
        // A card still fading out from an earlier change goes on.
        next.push(ghost);
        continue;
      }
      const move = byId.get(ghost.key);
      const to = after.cards.get(ghost.key);
      if (move?.kind === "fly") {
        next.push({ ...ghost, card: cardOf(move) ?? ghost.card, to: move.to, fade: move.land ? "none" : "out", start: at, duration: MOTION.flyMs });
      } else if (move?.kind === "leave" || !to) {
        next.push({ ...ghost, fade: "out", start: at, duration: MOTION.leaveMs });
      } else {
        next.push({ ...ghost, to, start: at, duration: MOTION.slideMs });
      }
    }
    const present = new Set(next.map((ghost) => ghost.key));
    const origin = next[0]?.origin ?? (after.viewport ? { x: after.viewport.x, y: after.viewport.y } : { x: 0, y: 0 });
    for (const [id, to] of after.cards) {
      const lane = after.laneOf.get(id);
      if (present.has(id) || lane === undefined || !coveredLanes.has(lane)) continue;
      const card = current.get(id);
      if (!card || !inView(to, after.lanes.get(lane) ?? null, after.viewport)) continue;
      const from = before.laneOf.get(id) === lane ? before.cards.get(id) : undefined;
      // Laid out just out of view, it slides in with the cards around it (the list scrolled back).
      if (from) next.push({ key: id, card, from, to, fade: "none", reveal: false, start: at, duration: MOTION.slideMs, origin });
      // Came in from out of view: it fades in once the cards around it are on their way.
      else next.push({ key: id, card, from: to, to, fade: "in", reveal: false, start: at + MOTION.fadeDelayMs, duration: MOTION.fadeMs, origin });
    }
    if (!next.some((ghost) => Number.isFinite(ghost.start))) {
      uncover();
      return;
    }
    holdCover(COVER_LIMIT_MS);
    setGhosts(next);
  }

  const store: LaneMotionStore = {
    layer: null,
    attach(id, node, values) {
      const cell = { node, values };
      cells.set(id, cell);
      return () => {
        if (cells.get(id) !== cell) return;
        cells.delete(id);
        slides.get(id)?.animation.stop();
        slides.delete(id);
      };
    },
    setLane(id, node) {
      if (node) lanes.set(id, node);
      else lanes.delete(id);
    },
    ghosts: () => ghostList,
    covered: () => coveredLanes,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot(current) {
      const at = now();
      const cards = new Map<string, Rect>();
      for (const [id, cell] of cells) {
        const rect = measureNow(cell.node);
        if (!rect) continue;
        const shift = offset(id, at);
        cards.set(id, { ...rect, x: rect.x + shift.x, y: rect.y + shift.y });
      }
      // A card stood in for by its copy is where the copy is, not where its hidden self waits.
      const stand = standing();
      for (const ghost of ghostList) if (stand.has(ghost.key)) cards.set(ghost.key, ghostRect(ghost, at));
      const { laneOf, byId } = index(current);
      const flying = new Set(ghostList.filter((ghost) => ghost.reveal).map((ghost) => ghost.key));
      return { frame: { cards, lanes: laneRects(), laneOf, viewport: measureNow(store.layer) }, cards: byId, flying };
    },
    freeze(before, last, next) {
      const viewport = before.frame.viewport;
      if (!COVER || !viewport) return;
      const changed = new Set(coveredLanes);
      LANE_ORDER.forEach((lane) => {
        if (!sameCards(last[lane].cards, next[lane].cards)) changed.add(lane);
      });
      const { byId, laneOf } = index(next);
      const origin = { x: viewport.x, y: viewport.y };
      const kept = ghostList.filter((ghost) => ghost.fade === "out" && Number.isFinite(ghost.start));
      const copies: Ghost[] = kept.map((ghost) => ({ ...ghost }));
      const taken = new Set(kept.map((ghost) => ghost.key));
      for (const [id, rect] of before.frame.cards) {
        const lane = before.frame.laneOf.get(id);
        if (taken.has(id) || lane === undefined || !changed.has(lane)) continue;
        if (!inView(rect, before.frame.lanes.get(lane) ?? null, viewport)) continue;
        // A card that leaves the lanes on screen fades as it was; one that stays or flies shows as it is now.
        const leaves = !byId.has(id) || (!flights && laneOf.get(id) !== lane);
        const card = leaves ? before.cards.get(id) : byId.get(id);
        if (!card) continue;
        copies.push({ key: id, card, from: rect, to: rect, fade: "none", reveal: false, start: Infinity, duration: 0, origin });
      }
      // Read by the lanes and the layer in this same render; nothing is notified while rendering.
      coveredLanes = changed;
      ghostList = copies;
      // A render that never commits leaves no cover behind.
      holdCover(COVER_LIMIT_MS);
    },
    play(before, next) {
      const at = now();
      const { laneOf, byId } = index(next);
      const laneAt = laneRects();
      const back = COVER ? scrollBacks(laneAt) : null;
      const cards = new Map<string, Rect>();
      for (const [id, cell] of cells) {
        const rect = measureNow(cell.node);
        const lane = laneOf.get(id);
        const shift = back && lane !== undefined ? back.get(lane) ?? 0 : 0;
        if (rect) cards.set(id, shift ? { ...rect, y: rect.y + shift } : rect);
      }
      const viewport = measureNow(store.layer);
      const after: MotionFrame = { cards, lanes: laneAt, laneOf, viewport };
      const moves = planLaneMotion(before.frame, after, { flights, flying: before.flying });
      // A card that leaves draws as it was; one that flies, as it will be where it lands.
      const cardOf = (move: LaneMove) => (move.kind === "leave" ? before.cards.get(move.id) : byId.get(move.id) ?? before.cards.get(move.id));
      if (COVER) {
        if (coveredLanes.size > 0) playCover(moves, before.frame, after, at, cardOf, byId);
      } else if (moves.length > 0) {
        playOnCards(moves, at, cardOf, viewport);
      }
    },
    finish(key) {
      const ghost = ghostList.find((item) => item.key === key);
      if (!ghost) return;
      if (COVER) {
        // The last copy home lifts the cover; a copy that faded out simply goes.
        const rest = ghostList.filter((item) => item !== ghost);
        const moving = rest.some((item) => Number.isFinite(item.start) && now() < item.start + item.duration + 50);
        if (moving) {
          if (ghost.fade === "out") setGhosts(rest);
        } else uncover();
        return;
      }
      // The card it carried shows, and the ghost goes a frame later, over the card.
      if (ghost.reveal) cells.get(key)?.values?.opacity.setValue(1);
      const remove = () => setGhosts(ghostList.filter((item) => item !== ghost));
      if (ghost.reveal && typeof requestAnimationFrame === "function") requestAnimationFrame(remove);
      else remove();
    },
    settle() {
      slides.forEach((entry) => entry.animation.stop());
      slides.clear();
      cells.forEach((cell) => {
        cell.values?.x.setValue(0);
        cell.values?.y.setValue(0);
        cell.values?.opacity.setValue(1);
      });
      uncover();
    },
  };
  return store;
}

function index(lanes: Record<LaneId, LaneModel>): { laneOf: Map<string, LaneId>; byId: Map<string, TaskCard> } {
  const laneOf = new Map<string, LaneId>();
  const byId = new Map<string, TaskCard>();
  LANE_ORDER.forEach((lane) => {
    for (const card of lanes[lane].cards) {
      laneOf.set(card.id, lane);
      byId.set(card.id, card);
    }
  });
  return { laneOf, byId };
}

/**
 * The board's lane motion. `scope` is what the user set that takes effect at
 * once (search, sort): lanes that change with it take their new order without
 * motion, as a search would be slow to read if every keystroke slid the
 * cards. A filter is outside it, so its cards slide and fade.
 */
export function useLaneMotion(lanes: Record<LaneId, LaneModel>, options: { enabled: boolean; scope: unknown; flights: boolean }): LaneMotionStore {
  const [store] = useState(() => createLaneMotionStore(options.flights));
  const committed = useRef<{ lanes: Record<LaneId, LaneModel>; scope: unknown } | null>(null);
  const pending = useRef<{ lanes: Record<LaneId, LaneModel>; before: Snapshot } | null>(null);
  const { enabled, scope } = options;
  const last = committed.current;
  // While the new lanes render, the screen still shows the old ones: measure them now.
  if (enabled && last && last.lanes !== lanes && last.scope === scope && pending.current?.lanes !== lanes && !sameOrder(last.lanes, lanes, LANE_ORDER)) {
    const before = store.snapshot(last.lanes);
    store.freeze(before, last.lanes, lanes);
    pending.current = { lanes, before };
  }
  useLayoutEffect(() => {
    committed.current = { lanes, scope };
    const before = pending.current;
    pending.current = null;
    if (enabled && before && before.lanes === lanes) store.play(before.before, lanes);
  }, [store, lanes, scope, enabled]);
  useEffect(() => {
    if (!enabled) store.settle();
  }, [store, enabled]);
  useEffect(() => () => store.settle(), [store]);
  return store;
}

const LaneMotionContext = createContext<LaneMotionStore | null>(null);
export const LaneMotionProvider = LaneMotionContext.Provider;

/**
 * A card cell's part in the lane motion: its slot registered with the board's
 * store under the card's id, and on the web its offset and visibility. Null
 * values outside a board (the settings preview), on native, or when `off` (a
 * copy of a card: a ghost, the phone's outgoing lane).
 */
export function useCardMotion(id: string, node: React.RefObject<unknown>, off: boolean): CellValues | null {
  const store = useContext(LaneMotionContext);
  const [values] = useState<CellValues | null>(() => (COVER ? null : { x: new Animated.Value(0), y: new Animated.Value(0), opacity: new Animated.Value(1) }));
  const active = store && !off ? store : null;
  useLayoutEffect(() => {
    if (!active) return;
    return active.attach(id, node.current, values);
  }, [active, id, node, values]);
  return active ? values : null;
}

/** Native: the lane's list is hidden while copies of its cards move over it. */
export function useLaneCovered(id: LaneId): boolean {
  const store = useContext(LaneMotionContext);
  const read = () => (store ? store.covered().has(id) : false);
  return useSyncExternalStore(store ? store.subscribe : noSubscribe, read, read);
}

const noSubscribe = () => () => {};

/**
 * The copies of cards in motion, above the lanes and clipped to them. Its
 * own rect is the ghosts' origin; nothing in it takes a touch.
 */
export function LaneMotionLayer(props: { store: LaneMotionStore; renderCard(card: TaskCard): ReactNode }) {
  const { store } = props;
  const ghosts = useSyncExternalStore(store.subscribe, store.ghosts, store.ghosts);
  const ref = useRef<View>(null);
  useLayoutEffect(() => {
    store.layer = ref.current;
    return () => {
      if (store.layer === ref.current) store.layer = null;
    };
  }, [store]);
  return (
    <View ref={ref} collapsable={false} pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}>
      {ghosts.map((ghost) => (
        <GhostCard key={ghost.key} ghost={ghost} onDone={store.finish}>
          {props.renderCard(ghost.card)}
        </GhostCard>
      ))}
    </View>
  );
}

function GhostCard(props: { ghost: Ghost; onDone(key: string): void; children: ReactNode }) {
  const { ghost, onDone } = props;
  const { origin } = ghost;
  const [t] = useState(() => new Animated.Value(0));
  useLayoutEffect(() => {
    t.setValue(0);
    // A cover's copy waits, drawn where its card was, until it knows where to go.
    if (!Number.isFinite(ghost.start)) return;
    // Drawn a little after the move was planned: pick up where the card should be by now.
    const wait = Math.max(0, ghost.start - now());
    const elapsed = Math.min(ghost.duration, Math.max(0, now() - ghost.start));
    const animation = Animated.timing(t, { toValue: 1, delay: wait, duration: ghost.duration - elapsed, easing: MOTION.ease, useNativeDriver: nativeDriver });
    animation.start(({ finished }) => {
      if (finished) onDone(ghost.key);
    });
    return () => animation.stop();
  }, [ghost, t, onDone]);
  const dx = ghost.to.x - ghost.from.x;
  const dy = ghost.to.y - ghost.from.y;
  const opacity =
    ghost.fade === "out"
      ? t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
      : ghost.fade === "in"
        ? t.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })
        : 1;
  const scale = ghost.fade === "out" ? t.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) : 1;
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: ghost.from.x - origin.x,
        top: ghost.from.y - origin.y,
        width: ghost.to.width,
        opacity,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
          { scale },
        ],
      }}
    >
      {props.children}
    </Animated.View>
  );
}

/**
 * Where a lane's cards show, for the cards that fly to it: `node` answers the
 * lane's list when expanded and its pill when collapsed.
 */
export function useLaneTarget(id: LaneId, node: () => unknown): void {
  const store = useContext(LaneMotionContext);
  const latest = useRef(node);
  latest.current = node;
  useLayoutEffect(() => {
    if (!store) return;
    store.setLane(id, () => latest.current());
    return () => store.setLane(id, null);
  }, [store, id]);
}
