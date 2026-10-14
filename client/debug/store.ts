/**
 * Pure aggregation behind the perf probes. Nothing here touches React, the
 * DOM, or the clock, so the arithmetic is testable on its own; `perf.ts` owns
 * the wiring and the timing.
 */

/** Percentile samples are capped; count, total and max keep counting past it. */
const SAMPLE_CAP = 4000;
/** Raw height-decrease events kept for the report; the counters keep going. */
const EVENT_CAP = 200;

export interface SeriesSummary {
  count: number;
  total: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export interface Series {
  count: number;
  total: number;
  max: number;
  add(value: number): void;
  summary(): SeriesSummary;
}

/**
 * A closure, not a class: the plugin client runs under Hermes, where class
 * syntax in a runtime-evaluated bundle has failed to load (see
 * docs/bench/baseline-host.md).
 */
export function createSeries(): Series {
  const samples: number[] = [];
  const series: Series = {
    count: 0,
    total: 0,
    max: 0,
    add(value) {
      series.count += 1;
      series.total += value;
      if (value > series.max) series.max = value;
      if (samples.length < SAMPLE_CAP) samples.push(value);
    },
    summary() {
      if (series.count === 0) return { count: 0, total: 0, mean: 0, p50: 0, p95: 0, max: 0 };
      const sorted = [...samples].sort((x, y) => x - y);
      return {
        count: series.count,
        total: round(series.total),
        mean: round(series.total / series.count),
        p50: round(percentile(sorted, 0.5)),
        p95: round(percentile(sorted, 0.95)),
        max: round(series.max),
      };
    },
  };
  return series;
}

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function bump(map: Map<string, number>, key: string, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function toRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map);
}

function seriesRecord(map: Map<string, Series>): Record<string, SeriesSummary> {
  const out: Record<string, SeriesSummary> = {};
  for (const [key, series] of map) out[key] = series.summary();
  return out;
}

export interface HeightEvent {
  key: string;
  from: number;
  to: number;
  streaming: boolean | null;
}

/** Frames slower than this multiple of the expected interval count as dropped. */
const DROP_THRESHOLD = 1.5;
/** A gap this long is a hidden tab or a suspended page, not a dropped frame. */
const SUSPEND_GAP_MS = 1000;

export interface PerfStore {
  render(kind: string, itemId: string | undefined): void;
  commit(kind: string, ms: number): void;
  markdownParse(ms: number, chars: number): void;
  /**
   * Compares this parse's block kinds with the previous parse of the same
   * message. A block that was a paragraph and is now a list is a flip: the
   * reader saw it change shape while it streamed.
   */
  markdownBlocks(instance: string, kinds: readonly string[]): void;
  /** @param streaming null when the caller cannot tell. */
  height(key: string, height: number, streaming: boolean | null): void;
  highlightRpc(language: string | undefined): void;
  imageRpc(duplicateInFlight: boolean): void;
  animationMount(name: string): void;
  animationUnmount(name: string): void;
  animationsMounted(): number;
  /** @param expectedMs the display's frame interval, 1000/60 unless measured. */
  frame(intervalMs: number, expectedMs: number): void;
  longTask(durationMs: number): void;
  layoutShift(value: number): void;
  /** A named event counter, for probes that only need "how many times". */
  count(name: string, by: number): void;
  snapshot(): PerfSnapshot;
  /**
   * Clears everything counted so far. Animations still mounted stay mounted:
   * resetting must not make a running loop look like it never started.
   */
  reset(): void;
}

function createCounters() {
  return {
    renderByKind: new Map<string, number>(),
    renderByItem: new Map<string, number>(),
    commitByKind: new Map<string, Series>(),
    parseMs: createSeries(),
    parseChars: createSeries(),
    blockKinds: new Map<string, string[]>(),
    flipByIndex: new Map<string, number>(),
    flips: 0,
    heights: new Map<string, number>(),
    heightDecreases: 0,
    heightDecreasesStreaming: 0,
    heightDecreasePx: 0,
    heightEvents: [] as HeightEvent[],
    highlightByLanguage: new Map<string, number>(),
    highlightCalls: 0,
    imageCalls: 0,
    imageDuplicatesInFlight: 0,
    animMounted: new Map<string, number>(),
    animMountsTotal: 0,
    animPeak: 0,
    frameIntervals: createSeries(),
    frames: 0,
    droppedFrames: 0,
    longestFrame: 0,
    suspendedGaps: 0,
    longTasks: createSeries(),
    layoutShifts: createSeries(),
    counters: new Map<string, number>(),
  };
}

/** A closure, not a class: see `createSeries`. */
export function createPerfStore(): PerfStore {
  let c = createCounters();

  function animationsMounted(): number {
    let sum = 0;
    for (const count of c.animMounted.values()) sum += count;
    return sum;
  }

  return {
    render(kind, itemId) {
      bump(c.renderByKind, kind);
      if (itemId !== undefined) bump(c.renderByItem, `${kind}:${itemId}`);
    },

    commit(kind, ms) {
      let series = c.commitByKind.get(kind);
      if (!series) {
        series = createSeries();
        c.commitByKind.set(kind, series);
      }
      series.add(ms);
    },

    markdownParse(ms, chars) {
      c.parseMs.add(ms);
      c.parseChars.add(chars);
    },

    markdownBlocks(instance, kinds) {
      const previous = c.blockKinds.get(instance);
      if (previous) {
        const shared = Math.min(previous.length, kinds.length);
        for (let index = 0; index < shared; index++) {
          if (previous[index] !== kinds[index]) {
            c.flips += 1;
            bump(c.flipByIndex, String(index));
          }
        }
      }
      c.blockKinds.set(instance, [...kinds]);
    },

    height(key, height, streaming) {
      const previous = c.heights.get(key);
      c.heights.set(key, height);
      if (previous === undefined || height >= previous) return;
      c.heightDecreases += 1;
      if (streaming === true) c.heightDecreasesStreaming += 1;
      c.heightDecreasePx += previous - height;
      if (c.heightEvents.length < EVENT_CAP) {
        c.heightEvents.push({ key, from: previous, to: height, streaming });
      }
    },

    highlightRpc(language) {
      c.highlightCalls += 1;
      bump(c.highlightByLanguage, language || "(none)");
    },

    imageRpc(duplicateInFlight) {
      c.imageCalls += 1;
      if (duplicateInFlight) c.imageDuplicatesInFlight += 1;
    },

    animationMount(name) {
      bump(c.animMounted, name);
      c.animMountsTotal += 1;
      const live = animationsMounted();
      if (live > c.animPeak) c.animPeak = live;
    },

    animationUnmount(name) {
      const next = (c.animMounted.get(name) ?? 0) - 1;
      if (next <= 0) c.animMounted.delete(name);
      else c.animMounted.set(name, next);
    },

    animationsMounted,

    frame(intervalMs, expectedMs) {
      if (intervalMs > SUSPEND_GAP_MS) {
        c.suspendedGaps += 1;
        return;
      }
      c.frames += 1;
      c.frameIntervals.add(intervalMs);
      if (intervalMs > c.longestFrame) c.longestFrame = intervalMs;
      if (intervalMs > expectedMs * DROP_THRESHOLD) {
        c.droppedFrames += Math.max(1, Math.round(intervalMs / expectedMs) - 1);
      }
    },

    longTask(durationMs) {
      c.longTasks.add(durationMs);
    },

    layoutShift(value) {
      c.layoutShifts.add(value);
    },

    count(name, by) {
      bump(c.counters, name, by);
    },

    snapshot() {
      const total = c.frames + c.droppedFrames;
      return {
        renders: {
          byKind: toRecord(c.renderByKind),
          byItem: toRecord(c.renderByItem),
        },
        commitMs: seriesRecord(c.commitByKind),
        markdown: {
          parses: c.parseMs.count,
          parseMs: c.parseMs.summary(),
          parseChars: c.parseChars.summary(),
          formatFlips: c.flips,
          flipsByBlockIndex: toRecord(c.flipByIndex),
        },
        heightDecreases: {
          count: c.heightDecreases,
          whileStreaming: c.heightDecreasesStreaming,
          totalPx: round(c.heightDecreasePx),
          events: [...c.heightEvents],
        },
        highlightRpc: {
          count: c.highlightCalls,
          byLanguage: toRecord(c.highlightByLanguage),
        },
        imageRpc: {
          count: c.imageCalls,
          duplicatesInFlight: c.imageDuplicatesInFlight,
        },
        animations: {
          mounted: animationsMounted(),
          peak: c.animPeak,
          mountsTotal: c.animMountsTotal,
          byName: toRecord(c.animMounted),
        },
        frames: {
          count: c.frames,
          dropped: c.droppedFrames,
          droppedRatio: total === 0 ? 0 : round(c.droppedFrames / total),
          longestMs: round(c.longestFrame),
          intervalMs: c.frameIntervals.summary(),
          suspendedGaps: c.suspendedGaps,
        },
        longTasks: c.longTasks.summary(),
        layoutShifts: c.layoutShifts.summary(),
        counters: toRecord(c.counters),
      };
    },

    reset() {
      const mounted = new Map(c.animMounted);
      c = createCounters();
      c.animMounted = mounted;
      c.animPeak = animationsMounted();
    },
  };
}

export interface PerfSnapshot {
  renders: { byKind: Record<string, number>; byItem: Record<string, number> };
  commitMs: Record<string, SeriesSummary>;
  markdown: {
    parses: number;
    parseMs: SeriesSummary;
    parseChars: SeriesSummary;
    formatFlips: number;
    flipsByBlockIndex: Record<string, number>;
  };
  heightDecreases: {
    count: number;
    whileStreaming: number;
    totalPx: number;
    events: HeightEvent[];
  };
  highlightRpc: { count: number; byLanguage: Record<string, number> };
  imageRpc: { count: number; duplicatesInFlight: number };
  animations: { mounted: number; peak: number; mountsTotal: number; byName: Record<string, number> };
  frames: {
    count: number;
    dropped: number;
    droppedRatio: number;
    longestMs: number;
    intervalMs: SeriesSummary;
    suspendedGaps: number;
  };
  longTasks: SeriesSummary;
  layoutShifts: SeriesSummary;
  /** Named counters from `perfCount`, e.g. `md.finalRerender`. */
  counters: Record<string, number>;
}
