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

export class Series {
  private samples: number[] = [];
  count = 0;
  total = 0;
  max = 0;

  add(value: number): void {
    this.count += 1;
    this.total += value;
    if (value > this.max) this.max = value;
    if (this.samples.length < SAMPLE_CAP) this.samples.push(value);
  }

  summary(): SeriesSummary {
    if (this.count === 0) return { count: 0, total: 0, mean: 0, p50: 0, p95: 0, max: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count: this.count,
      total: round(this.total),
      mean: round(this.total / this.count),
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      max: round(this.max),
    };
  }
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

export class PerfStore {
  private renderByKind = new Map<string, number>();
  private renderByItem = new Map<string, number>();
  private commitByKind = new Map<string, Series>();

  private parseMs = new Series();
  private parseChars = new Series();
  private blockKinds = new Map<string, string[]>();
  private flipByIndex = new Map<string, number>();
  private flips = 0;

  private heights = new Map<string, number>();
  private heightDecreases = 0;
  private heightDecreasesStreaming = 0;
  private heightDecreasePx = 0;
  private heightEvents: HeightEvent[] = [];

  private highlightByLanguage = new Map<string, number>();
  private highlightCalls = 0;

  private animMounted = new Map<string, number>();
  private animMountsTotal = 0;
  private animPeak = 0;

  private frameIntervals = new Series();
  private frames = 0;
  private droppedFrames = 0;
  private longestFrame = 0;
  private suspendedGaps = 0;

  private longTasks = new Series();
  private layoutShifts = new Series();

  render(kind: string, itemId: string | undefined): void {
    bump(this.renderByKind, kind);
    if (itemId !== undefined) bump(this.renderByItem, `${kind}:${itemId}`);
  }

  commit(kind: string, ms: number): void {
    let series = this.commitByKind.get(kind);
    if (!series) {
      series = new Series();
      this.commitByKind.set(kind, series);
    }
    series.add(ms);
  }

  markdownParse(ms: number, chars: number): void {
    this.parseMs.add(ms);
    this.parseChars.add(chars);
  }

  /**
   * Compares this parse's block kinds with the previous parse of the same
   * message. A block that was a paragraph and is now a list is a flip: the
   * reader saw it change shape while it streamed.
   */
  markdownBlocks(instance: string, kinds: readonly string[]): void {
    const previous = this.blockKinds.get(instance);
    if (previous) {
      const shared = Math.min(previous.length, kinds.length);
      for (let index = 0; index < shared; index++) {
        if (previous[index] !== kinds[index]) {
          this.flips += 1;
          bump(this.flipByIndex, String(index));
        }
      }
    }
    this.blockKinds.set(instance, [...kinds]);
  }

  /** @param streaming null when the caller cannot tell. */
  height(key: string, height: number, streaming: boolean | null): void {
    const previous = this.heights.get(key);
    this.heights.set(key, height);
    if (previous === undefined || height >= previous) return;
    this.heightDecreases += 1;
    if (streaming === true) this.heightDecreasesStreaming += 1;
    this.heightDecreasePx += previous - height;
    if (this.heightEvents.length < EVENT_CAP) {
      this.heightEvents.push({ key, from: previous, to: height, streaming });
    }
  }

  highlightRpc(language: string | undefined): void {
    this.highlightCalls += 1;
    bump(this.highlightByLanguage, language || "(none)");
  }

  animationMount(name: string): void {
    bump(this.animMounted, name);
    this.animMountsTotal += 1;
    const live = this.animationsMounted();
    if (live > this.animPeak) this.animPeak = live;
  }

  animationUnmount(name: string): void {
    const next = (this.animMounted.get(name) ?? 0) - 1;
    if (next <= 0) this.animMounted.delete(name);
    else this.animMounted.set(name, next);
  }

  animationsMounted(): number {
    let sum = 0;
    for (const count of this.animMounted.values()) sum += count;
    return sum;
  }

  /** @param expectedMs the display's frame interval, 1000/60 unless measured. */
  frame(intervalMs: number, expectedMs: number): void {
    if (intervalMs > SUSPEND_GAP_MS) {
      this.suspendedGaps += 1;
      return;
    }
    this.frames += 1;
    this.frameIntervals.add(intervalMs);
    if (intervalMs > this.longestFrame) this.longestFrame = intervalMs;
    if (intervalMs > expectedMs * DROP_THRESHOLD) {
      this.droppedFrames += Math.max(1, Math.round(intervalMs / expectedMs) - 1);
    }
  }

  longTask(durationMs: number): void {
    this.longTasks.add(durationMs);
  }

  layoutShift(value: number): void {
    this.layoutShifts.add(value);
  }

  snapshot(): PerfSnapshot {
    const total = this.frames + this.droppedFrames;
    return {
      renders: {
        byKind: toRecord(this.renderByKind),
        byItem: toRecord(this.renderByItem),
      },
      commitMs: seriesRecord(this.commitByKind),
      markdown: {
        parses: this.parseMs.count,
        parseMs: this.parseMs.summary(),
        parseChars: this.parseChars.summary(),
        formatFlips: this.flips,
        flipsByBlockIndex: toRecord(this.flipByIndex),
      },
      heightDecreases: {
        count: this.heightDecreases,
        whileStreaming: this.heightDecreasesStreaming,
        totalPx: round(this.heightDecreasePx),
        events: [...this.heightEvents],
      },
      highlightRpc: { count: this.highlightCalls, byLanguage: toRecord(this.highlightByLanguage) },
      animations: {
        mounted: this.animationsMounted(),
        peak: this.animPeak,
        mountsTotal: this.animMountsTotal,
        byName: toRecord(this.animMounted),
      },
      frames: {
        count: this.frames,
        dropped: this.droppedFrames,
        droppedRatio: total === 0 ? 0 : round(this.droppedFrames / total),
        longestMs: round(this.longestFrame),
        intervalMs: this.frameIntervals.summary(),
        suspendedGaps: this.suspendedGaps,
      },
      longTasks: this.longTasks.summary(),
      layoutShifts: this.layoutShifts.summary(),
    };
  }

  /**
   * Clears everything counted so far. Animations still mounted stay mounted:
   * resetting must not make a running loop look like it never started.
   */
  reset(): void {
    const mounted = new Map(this.animMounted);
    const fresh = new PerfStore();
    Object.assign(this, fresh);
    this.animMounted = mounted;
    this.animPeak = this.animationsMounted();
  }
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
}
