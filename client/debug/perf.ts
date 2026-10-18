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
import { createElement, useLayoutEffect, type ReactElement } from "react";
import type { LayoutChangeEvent } from "react-native";
import { getEnhancerPreferences, updateEnhancerPreferences } from "../preferences";
import { createPerfStore, type PerfSnapshot } from "./store";
import { resetFontProbe } from "./font-probe-store";

const EXPECTED_FRAME_MS = 1000 / 60;

let on = false;
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

/** Renders nothing; its layout effect closes the render-to-commit interval. */
function CommitProbe({ kind, start }: CommitProbeProps): null {
  useLayoutEffect(() => {
    store.commit(kind, now() - start);
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
    watch("longtask", (entry) => store.longTask(entry.duration));
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
