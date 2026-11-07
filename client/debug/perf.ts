/**
 * Production-safe perf probes (plan §3.2, BC-07).
 *
 * The host's production build never calls React's `<Profiler onRender>`, so the
 * plugin counts its own renders. Everything here sits behind one module-level
 * flag: while `debugPerf` is off each probe is a single boolean test that
 * returns a shared constant, allocates nothing, and adds no hooks, so the cost
 * on the render path is not measurable.
 *
 * Toggle with the hidden `debugPerf` preference or at runtime with
 * `globalThis.__bcPerf.enable()` / `.disable()`. Read results with
 * `__bcPerf.snapshot()` (JSON), clear with `.reset()`, print with `.report()`.
 *
 * Probes that count at render time are plain function calls, so enabling takes
 * effect on the next render. Animations are counted when their effect mounts,
 * so enable before the loops under test start.
 */
import { createElement, useLayoutEffect, useRef, type ReactElement } from "react";
import type { LayoutChangeEvent } from "react-native";
import { getEnhancerPreferences, updateEnhancerPreferences } from "../preferences";
import { createPerfStore, type PerfSnapshot } from "./store";
import { resetFontProbe } from "./font-probe-store";

const EXPECTED_FRAME_MS = 1000 / 60;

let on = false;
/**
 * Bumped when the probes turn on and on every reset. State a probe carries
 * between calls (a drag in progress, the notifications a board has seen)
 * remembers the round it began in and is dropped in a later one, so a new
 * round never measures a gap from the last one.
 */
let round = 0;
const store = createPerfStore();
const imageRpcInFlight = new Map<string, number>();

const now: () => number =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

/** True while the probes are live. Hot paths test this before doing any work. */
export function perfOn(): boolean {
  return on;
}

// --- Item identity ---------------------------------------------------------

const KEY_PREFIX_CHARS = 80;
const textKeys = new Map<string, Array<{ prefix: string; key: string }>>();

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * A stable id for a streamed text item. The host rewrites a thought's
 * timestamp on every chunk, so the timestamp cannot name it. The id is a hash
 * of the first 80 characters; while the text is still shorter than that, the
 * item keeps the id of an earlier text it extends, so growth never splits it.
 * Empty text falls back to the kind. Returns "" while the probes are off.
 */
export function textItemKey(kind: string, text: string): string {
  if (!on) return "";
  if (text === "") return kind;
  const prefix = text.slice(0, KEY_PREFIX_CHARS);
  let known = textKeys.get(kind);
  if (!known) {
    known = [];
    textKeys.set(kind, known);
  }
  for (const entry of known) {
    if (prefix.startsWith(entry.prefix)) {
      entry.prefix = prefix;
      return entry.key;
    }
  }
  const key = `${kind}#${fnv1a(prefix)}`;
  known.push({ prefix, key });
  return key;
}

// --- Cards -----------------------------------------------------------------

export interface CardProbe {
  /** Spread onto the card's root `View`. Empty while the probes are off. */
  viewProps: { onLayout?: (event: LayoutChangeEvent) => void };
  /** Render inside the root `View`. Null while the probes are off. */
  node: ReactElement | null;
}

const OFF_PROBE: CardProbe = Object.freeze({ viewProps: Object.freeze({}), node: null });

interface CommitProbeProps {
  kind: string;
  start: number;
}

/**
 * Renders nothing; its layout effect closes the render-to-commit interval.
 * The commit is also a mark (`card.commit`, at the layout effect, with the
 * interval as `ms`), so a dump can place timeline renders against a drag.
 */
function CommitProbe({ kind, start }: CommitProbeProps): null {
  useLayoutEffect(() => {
    const at = now();
    store.commit(kind, at - start);
    store.mark({ name: "card.commit", at, data: { kind, ms: ms(at - start) } });
  });
  return null;
}

/**
 * Call once at the top of a card renderer, before any other work.
 *
 * Counts the render, starts the commit timer, and returns the `onLayout`
 * handler plus the effect node. `streaming` is null for a card that has no
 * phase to report.
 */
export function probeCard(
  kind: string,
  itemId: string | undefined,
  streaming: boolean | null = null,
): CardProbe {
  if (!on) return OFF_PROBE;
  const start = now();
  store.render(kind, itemId);
  const heightKey = `${kind}:${itemId ?? ""}`;
  return {
    viewProps: {
      onLayout: (event) => store.height(heightKey, event.nativeEvent.layout.height, streaming),
    },
    node: createElement(CommitProbe, { kind, start }),
  };
}

// --- Markdown --------------------------------------------------------------

/**
 * Wraps one `parseMarkdown` call: counts it, times it, and compares its block
 * kinds with the previous parse of the same message (`instance`).
 */
export function probeMarkdown<Block extends { kind: string }>(
  instance: string | undefined,
  text: string,
  parse: (text: string) => Block[],
): Block[] {
  if (!on) return parse(text);
  const start = now();
  const blocks = parse(text);
  store.markdownParse(now() - start, text.length);
  if (instance !== undefined) {
    store.markdownBlocks(
      instance,
      blocks.map((block) => block.kind),
    );
  }
  return blocks;
}

// --- Highlight RPC ---------------------------------------------------------

export function probeHighlightRpc(language: string | undefined): void {
  if (!on) return;
  store.highlightRpc(language);
}

/** Counts image RPCs and repeated cwd/path pairs while a prior call is pending. */
export function probeImageRpc(cwd: string, path: string, request: Promise<unknown>): void {
  if (!on) return;
  const key = JSON.stringify([cwd, path]);
  const inFlight = imageRpcInFlight.get(key) ?? 0;
  store.imageRpc(inFlight > 0);
  imageRpcInFlight.set(key, inFlight + 1);

  const settled = (): void => {
    const remaining = (imageRpcInFlight.get(key) ?? 1) - 1;
    if (remaining === 0) imageRpcInFlight.delete(key);
    else imageRpcInFlight.set(key, remaining);
  };
  void request.then(settled, settled);
}

// --- Named counters --------------------------------------------------------

/** Adds `by` to the counter `name` (e.g. `md.finalRerender`). One test while off. */
export function perfCount(name: string, by = 1): void {
  if (!on) return;
  store.count(name, by);
}

// --- Looping animations ----------------------------------------------------

const noop = (): void => {};

/**
 * Call when a looping animation starts; call the returned function when it
 * stops. Safe to return from an effect cleanup.
 */
export function probeAnimationLoop(name: string): () => void {
  if (!on) return noop;
  store.animationMount(name);
  return () => store.animationUnmount(name);
}

// --- Drags -----------------------------------------------------------------

/** Mark data: three decimals are plenty for milliseconds and keep a dump small. */
function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A touch's `nativeEvent.timestamp`, or null where the platform sent none. */
function rawTimestamp(timestamp: number | undefined): number | null {
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * One drag of a handle, from its grant to its release or termination. Null
 * while the probes are off when the drag starts: a drag is measured whole or
 * not at all.
 *
 * Two clocks are kept apart on purpose. `at` is the probes' clock in JS
 * (`performance.now()`); `ts` is the touch's `nativeEvent.timestamp`, set
 * natively where the touch happened (Android: `MotionEvent.eventTime`, whole
 * milliseconds; iOS: `UITouch.timestamp`; web: the DOM event's). Nothing makes
 * the two share an origin on every platform, so their difference is not an
 * input latency. What is recorded:
 *
 * - `<name>.move.jsGapMs`: JS clock between two moves' handlers starting. A
 *   gap far above the touch rate means JS ran each move late or got fewer.
 * - `<name>.move.tsGapMs`: the touch clock between the same two moves. React
 *   Native coalesces moves waiting for JS into the newest, so this grows too
 *   when JS falls behind; with no coalescing it is the digitizer's rate.
 * - `<name>.move.handlerMs`: JS time inside the move handler: the clamp and
 *   whatever `Animated.Value.setValue` does on the JS thread before it
 *   returns. Not the native layout or the frame that shows it.
 * - `<name>.move.offsetRiseMs`: `at - ts` minus the lowest `at - ts` seen so
 *   far in the same drag. Unknown origins cancel out, so this is how much
 *   later than its best move of the drag this move reached JS, valid only if
 *   both clocks run at the same rate; Android's whole-millisecond `ts` adds
 *   up to 1 ms of noise. Recorded only when the touch has a timestamp.
 * - `<name>.dragJsMs`: JS clock from the grant to the release or termination.
 *
 * Each grant, move, release and termination is also a mark, with the raw
 * `at` and `ts`, so a dump can be checked against a system trace.
 */
export interface DragTrack {
  readonly name: string;
  readonly id: number;
  readonly round: number;
  readonly startAt: number;
  moves: number;
  lastAt: number;
  lastTs: number | null;
  minOffset: number | null;
}

let dragIds = 0;

export function probeDragStart(name: string, timestamp: number | undefined): DragTrack | null {
  if (!on) return null;
  const at = now();
  const ts = rawTimestamp(timestamp);
  const track: DragTrack = { name, id: ++dragIds, round, startAt: at, moves: 0, lastAt: at, lastTs: ts, minOffset: null };
  store.count(`${name}.grant`, 1);
  store.mark({ name: `${name}.grant`, at, data: { drag: track.id, ts } });
  return track;
}

/** The probes' clock, or 0 while they are off (no clock read). Read it first thing in a handler `probeDragMove` times. */
export function perfStart(): number {
  return on ? now() : 0;
}

/** Call at the end of the move handler, with what `perfStart` returned at its start. */
export function probeDragMove(track: DragTrack | null, timestamp: number | undefined, startedAt: number): void {
  if (!on || track === null || track.round !== round) return;
  const handlerMs = now() - startedAt;
  const ts = rawTimestamp(timestamp);
  const name = track.name;
  track.moves += 1;
  store.sample(`${name}.move.handlerMs`, handlerMs);
  // The first move's gaps run from the grant.
  store.sample(`${name}.move.jsGapMs`, startedAt - track.lastAt);
  if (ts !== null && track.lastTs !== null) store.sample(`${name}.move.tsGapMs`, ts - track.lastTs);
  if (ts !== null) {
    const offset = startedAt - ts;
    if (track.minOffset === null || offset < track.minOffset) track.minOffset = offset;
    store.sample(`${name}.move.offsetRiseMs`, offset - track.minOffset);
  }
  track.lastAt = startedAt;
  track.lastTs = ts;
  store.mark({ name: `${name}.move`, at: startedAt, data: { drag: track.id, move: track.moves, ts, handlerMs: ms(handlerMs) } });
}

export function probeDragEnd(track: DragTrack | null, how: "release" | "terminate", timestamp: number | undefined): void {
  if (!on || track === null || track.round !== round) return;
  const at = now();
  store.count(`${track.name}.${how}`, 1);
  store.sample(`${track.name}.dragJsMs`, at - track.startAt);
  store.mark({ name: `${track.name}.${how}`, at, data: { drag: track.id, moves: track.moves, ts: rawTimestamp(timestamp) } });
}

// --- Store notifications and the commits after them ------------------------

/** Notification times kept per store, so a board several notifications behind still finds its oldest. */
const NOTIFY_RING = 64;

interface NotifyTrack {
  id: number;
  round: number;
  /** Notifications this round; the first is 1. */
  seq: number;
  /** `times[seq % NOTIFY_RING]`: when notification `seq` went out. */
  times: number[];
}

/** By the store's owner (the Tasks store's `PaseoApi`): one count per store, so two hosts never share one. */
const notifyTracks = new WeakMap<object, NotifyTrack>();
let notifyIds = 0;

function notifyTrack(owner: object): NotifyTrack {
  let track = notifyTracks.get(owner);
  if (!track) {
    track = { id: ++notifyIds, round, seq: 0, times: [] };
    notifyTracks.set(owner, track);
  } else if (track.round !== round) {
    track.round = round;
    track.seq = 0;
    track.times = [];
  }
  return track;
}

/**
 * The store told its listeners it changed. One notification can stand for a
 * batch of updates (`batchUpdates`); this counts notifications, not updates.
 */
export function probeTasksNotify(owner: object, listeners: number): void {
  if (!on) return;
  const at = now();
  const track = notifyTrack(owner);
  track.seq += 1;
  track.times[track.seq % NOTIFY_RING] = at;
  store.count("tasks.notify", 1);
  store.mark({ name: "tasks.notify", at, data: { store: track.id, seq: track.seq, listeners } });
}

/** What one mounted board has seen of its store's notifications. */
export interface CommitSeen {
  board: number;
  round: number;
  store: number;
  /** The store's `seq` at this board's last commit. */
  seen: number;
  /** The store's `seq` when `lanes` last changed. */
  lanesSeen: number;
  live: unknown;
  lanes: unknown;
}

let boardIds = 0;

/**
 * A commit of a board that reads `owner`'s store. `live` is the tasks object
 * the board got this render, `lanes` the one its lanes drew (they differ
 * while the lanes are deferred). Returns what the board has now seen.
 *
 * The first commit in a round, or after the board moved to another store,
 * only takes the store's count as seen. After that, a commit that finds
 * notifications it has not seen records:
 *
 * - `<name>.notifyToCommitMs.newest` / `.oldest`: from the newest (oldest)
 *   unseen notification to this commit's layout effect. This is not render
 *   time: it holds the wait for React to schedule the render, any batching of
 *   several notifications into one render, renders React threw away or
 *   interrupted, and the render and commit themselves. It does not say the
 *   board drew the newest notification's data, only that the commit came
 *   after it.
 * - `<name>.notifiesPerCommit`: how many notifications that commit followed.
 * - `<name>.notifyToLanesChangeMs`: when `lanes` is a new object, from the
 *   oldest notification since the lanes last changed. An upper bound: the
 *   lanes may show data from a later notification than that one, and a
 *   notification that changed nothing the lanes draw still counts.
 *
 * A commit that finds none counts in `<name>.commitWithoutNotify` (the
 * board's own state: a detent, a width, a hover).
 */
export function observeTasksCommit(
  previous: CommitSeen | null,
  name: string,
  owner: object,
  live: unknown,
  lanes: unknown,
): CommitSeen | null {
  if (!on) return previous;
  const at = now();
  const track = notifyTrack(owner);
  if (previous === null || previous.round !== round || previous.store !== track.id) {
    return { board: previous?.board ?? ++boardIds, round, store: track.id, seen: track.seq, lanesSeen: track.seq, live, lanes };
  }
  const seq = track.seq;
  const pending = seq - previous.seen;
  const lanesChanged = lanes !== previous.lanes;
  const timeOf = (from: number) => {
    // A board more than a ring behind gets the oldest time the ring still has.
    const kept = Math.max(from, seq - NOTIFY_RING + 1);
    return track.times[kept % NOTIFY_RING] ?? at;
  };
  store.count(`${name}.commit`, 1);
  if (pending > 0) {
    store.sample(`${name}.notifyToCommitMs.newest`, at - timeOf(seq));
    store.sample(`${name}.notifyToCommitMs.oldest`, at - timeOf(previous.seen + 1));
    store.sample(`${name}.notifiesPerCommit`, pending);
    if (pending > NOTIFY_RING) store.count(`${name}.notifyRingOverflow`, 1);
  } else {
    store.count(`${name}.commitWithoutNotify`, 1);
  }
  let lanesSeen = previous.lanesSeen;
  if (lanesChanged && seq > lanesSeen) {
    store.sample(`${name}.notifyToLanesChangeMs`, at - timeOf(lanesSeen + 1));
    lanesSeen = seq;
  }
  store.mark({
    name: `${name}.commit`,
    at,
    data: { board: previous.board, store: track.id, seenFrom: previous.seen, seenTo: seq, liveChanged: live !== previous.live ? 1 : 0, lanesChanged: lanesChanged ? 1 : 0 },
  });
  previous.seen = seq;
  previous.lanesSeen = lanesSeen;
  previous.live = live;
  previous.lanes = lanes;
  return previous;
}

interface TasksCommitProbeProps {
  name: string;
  owner: object;
  live: unknown;
  lanes: unknown;
}

/** Renders nothing; its layout effect runs in every commit of the board that renders it. */
function TasksCommitProbe({ name, owner, live, lanes }: TasksCommitProbeProps): null {
  const seen = useRef<CommitSeen | null>(null);
  useLayoutEffect(() => {
    seen.current = observeTasksCommit(seen.current, name, owner, live, lanes);
  });
  return null;
}

/**
 * Render inside a board that reads the Tasks store of `owner`. Null while the
 * probes are off, so the board has no extra hook, effect or subscription.
 * Turning the probes on mounts it, and its first commit is only a baseline.
 */
export function probeTasksCommit(name: string, owner: object | null | undefined, live: unknown, lanes: unknown): ReactElement | null {
  if (!on || typeof owner !== "object" || owner === null) return null;
  return createElement(TasksCommitProbe, { name, owner, live, lanes });
}

// --- Frame meter and web observers -----------------------------------------

let frameHandle: number | null = null;
let lastFrameAt = 0;
let observers: Array<{ disconnect(): void }> = [];

function onFrame(timestamp: number): void {
  if (lastFrameAt > 0) store.frame(timestamp - lastFrameAt, EXPECTED_FRAME_MS);
  lastFrameAt = timestamp;
  frameHandle = requestAnimationFrame(onFrame);
}

function startMeters(): void {
  if (frameHandle === null && typeof requestAnimationFrame === "function") {
    lastFrameAt = 0;
    frameHandle = requestAnimationFrame(onFrame);
  }
  if (observers.length === 0 && typeof PerformanceObserver === "function") {
    const watch = (type: string, record: (entry: PerformanceEntry) => void): void => {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) record(entry);
        });
        observer.observe({ type, buffered: false });
        observers.push(observer);
      } catch {
        // The entry type is not supported on this engine.
      }
    };
    watch("longtask", (entry) => {
      store.longTask(entry.duration);
      // `startTime` is on the probes' clock (`performance.now()`), so a long task lines up with the other marks.
      store.mark({ name: "js.longtask", at: entry.startTime, data: { ms: ms(entry.duration) } });
    });
    watch("layout-shift", (entry) => {
      const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
      if (!shift.hadRecentInput) store.layoutShift(shift.value ?? 0);
    });
  }
}

function stopMeters(): void {
  if (frameHandle !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameHandle);
  }
  frameHandle = null;
  lastFrameAt = 0;
  for (const observer of observers) observer.disconnect();
  observers = [];
}

// --- Public handle ---------------------------------------------------------

export function enablePerf(): void {
  if (!on) {
    on = true;
    round += 1;
    startMeters();
  }
  if (!getEnhancerPreferences().debugPerf) updateEnhancerPreferences({ debugPerf: true });
}

export function disablePerf(): void {
  if (on) {
    on = false;
    stopMeters();
  }
  if (getEnhancerPreferences().debugPerf) updateEnhancerPreferences({ debugPerf: false });
}

export function perfSnapshot(): PerfSnapshot {
  return store.snapshot();
}

export function resetPerf(): void {
  round += 1;
  store.reset();
  resetFontProbe();
  textKeys.clear();
}

/** Prints the headline numbers as tables and returns the full snapshot. */
export function reportPerf(): PerfSnapshot {
  const snap = store.snapshot();
  const rows: Record<string, unknown> = {
    "renders (all cards)": Object.values(snap.renders.byKind).reduce((a, b) => a + b, 0),
    "markdown parses": snap.markdown.parses,
    "markdown parse p95 ms": snap.markdown.parseMs.p95,
    "format flips": snap.markdown.formatFlips,
    "height decreases (streaming)": `${snap.heightDecreases.count} (${snap.heightDecreases.whileStreaming})`,
    "highlight RPCs": snap.highlightRpc.count,
    "image RPCs": snap.imageRpc.count,
    "image RPCs repeated in flight": snap.imageRpc.duplicatesInFlight,
    "animations mounted (peak)": `${snap.animations.mounted} (${snap.animations.peak})`,
    "dropped frame ratio": snap.frames.droppedRatio,
    "longest frame ms": snap.frames.longestMs,
    "long tasks": snap.longTasks.count,
    "layout shifts": snap.layoutShifts.count,
  };
  console.table(rows);
  console.table(snap.renders.byKind);
  console.table(snap.commitMs);
  return snap;
}

export interface BcPerfHandle {
  enable(): void;
  disable(): void;
  enabled(): boolean;
  snapshot(): PerfSnapshot;
  reset(): void;
  report(): PerfSnapshot;
}

const handle: BcPerfHandle = {
  enable: enablePerf,
  disable: disablePerf,
  enabled: perfOn,
  snapshot: perfSnapshot,
  reset: resetPerf,
  report: reportPerf,
};

(globalThis as { __bcPerf?: BcPerfHandle }).__bcPerf = handle;

if (getEnhancerPreferences().debugPerf) {
  on = true;
  startMeters();
}
